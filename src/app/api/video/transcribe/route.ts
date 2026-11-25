import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { SubtitleSegment } from "../../../../types/news";
import { CACHE_DIR, fileExists, parseWhisperProgressLine, probeMediaFile, resolveCachedVideoPath, spawnExec, withExportSlot } from "../../../../lib/server/videoMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WHISPER_DIR = path.join(process.cwd(), "tools", "whisper");
let cachedWhisperSetup: { bin: string; model: string; modelLabel: string; kind: "cpp" | "cli" } | null = null;

const findWhisperSetup = async (): Promise<{ bin: string; model: string; modelLabel: string; kind: "cpp" | "cli" } | null> => {
    if (cachedWhisperSetup && await fileExists(cachedWhisperSetup.bin) && await fileExists(cachedWhisperSetup.model)) {
        return cachedWhisperSetup;
    }
    for (const exe of ["whisper-cli.exe", "main.exe", "whisper-cli", "main"]) {
        const binPath = path.join(WHISPER_DIR, exe);
        if (!await fileExists(binPath)) continue;
        for (const mod of ["ggml-large-v3-turbo.bin", "ggml-medium.bin", "ggml-small.bin", "ggml-base.bin", "ggml-tiny.bin"]) {
            const modPath = path.join(WHISPER_DIR, mod);
            if (await fileExists(modPath)) {
                const modelLabel = mod.replace(/^ggml-/, "").replace(/\.bin$/, "").toUpperCase();
                cachedWhisperSetup = { bin: binPath, model: modPath, modelLabel, kind: "cpp" };
                return cachedWhisperSetup;
            }
        }
    }
    return null;
};

interface WhisperCppJson {
    transcription?: {
        offsets?: { from?: number; to?: number };
        text?: string;
    }[];
}

const runTranscriptionPipeline = async (
    videoPath: string,
    whisper: { bin: string; model: string; modelLabel: string },
    onProgress?: (stage: string, percent: number) => void,
    signal?: AbortSignal
): Promise<SubtitleSegment[]> => {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    const uid = crypto.randomUUID().slice(0, 8);
    const wavPath = path.join(CACHE_DIR, `audio-${uid}.wav`);
    const jsonPrefix = path.join(CACHE_DIR, `subs-${uid}`);

    try {
        onProgress?.("PROBING AUDIO TRACK...", 5);
        const { durationSec } = await probeMediaFile(videoPath, { signal, timeoutMs: 15_000 });

        onProgress?.("EXTRACTING 16KHZ MONO AUDIO...", 10);
        let lastExtractPct = -1;
        await spawnExec("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            "-nostats", "-progress", "pipe:1",
            "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath,
        ], {
            signal,
            timeoutMs: 120_000,
            onStdoutLine: onProgress && durationSec > 0 ? (line) => {
                const trimmed = line.trim();
                if (trimmed.startsWith("out_time_us=")) {
                    const us = Number(trimmed.slice(12));
                    if (Number.isFinite(us) && us >= 0) {
                        const rawPct = Math.min(100, Math.max(0, Math.round((us / 1_000_000 / durationSec) * 100)));
                        if (rawPct !== lastExtractPct) {
                            lastExtractPct = rawPct;
                            const overall = 10 + Math.round(rawPct * 0.15);
                            onProgress(`EXTRACTING 16KHZ MONO AUDIO (${rawPct}%)...`, overall);
                        }
                    }
                }
            } : undefined,
        });

        onProgress?.(`LOADING WHISPER ${whisper.modelLabel} MODEL...`, 26);
        let maxWhisperPct = -1;
        const handleWhisperLine = (line: string) => {
            if (!onProgress) return;
            const pct = parseWhisperProgressLine(line, durationSec);
            if (pct !== null && pct > maxWhisperPct) {
                maxWhisperPct = pct;
                const overall = 28 + Math.round(pct * 0.68);
                onProgress(`TRANSCRIBING SPEECH (${pct}%)...`, Math.min(96, overall));
            }
        };

        const whisperThreads = String(Math.max(2, os.cpus().length - 2));
        await withExportSlot(() => spawnExec(whisper.bin, [
            "-m", whisper.model,
            "-f", wavPath,
            "-t", whisperThreads,
            "-l", "auto",
            "-pp",
            "-oj",
            "-of", jsonPrefix,
        ], {
            signal,
            timeoutMs: 300_000,
            onStdoutLine: handleWhisperLine,
            onStderrLine: handleWhisperLine,
        }), signal);

        onProgress?.("BUILDING SUBTITLE TIMELINE...", 98);
        const jsonRaw = await fs.promises.readFile(`${jsonPrefix}.json`, "utf8");
        const parsed = JSON.parse(jsonRaw) as WhisperCppJson;
        return (parsed.transcription || [])
            .map((item, idx) => ({
                id: `sub-${idx + 1}`,
                start: Math.round(((item.offsets?.from ?? 0) / 1000) * 100) / 100,
                end: Math.round(((item.offsets?.to ?? 0) / 1000) * 100) / 100,
                text: (item.text || "").trim(),
            }))
            .filter((s) => s.text.length > 0 && s.end > s.start);
    } finally {
        await fs.promises.unlink(wavPath).catch(() => {});
        await fs.promises.unlink(`${jsonPrefix}.json`).catch(() => {});
    }
};

export async function POST(request: Request) {
    if (process.env.VERCEL === "1") {
        return NextResponse.json(
            { error: "Local Whisper transcription is unavailable on serverless deployments. Run the studio locally to auto-generate subtitles." },
            { status: 501 }
        );
    }

    try {
        const body = await request.json() as { videoUrl?: string };
        const videoPath = await resolveCachedVideoPath(body.videoUrl);
        if (!videoPath) {
            return NextResponse.json({ error: "Transcribe requires an ingested studio video on disk." }, { status: 400 });
        }

        const whisper = await findWhisperSetup();
        if (!whisper) {
            return NextResponse.json({
                error: "Local Whisper not installed yet. Place whisper-cli.exe and ggml-small.bin inside tools/whisper/."
            }, { status: 422 });
        }

        const wantsStream = request.headers.get("accept")?.includes("application/x-ndjson");
        if (wantsStream) {
            const enc = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    const send = (obj: Record<string, unknown>) => {
                        try { controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`)); } catch {}
                    };
                    try {
                        const segments = await runTranscriptionPipeline(
                            videoPath,
                            whisper,
                            (stage, percent) => send({ stage, percent }),
                            request.signal
                        );
                        send({ stage: "SUBTITLES READY", percent: 100, segments });
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : "Transcription failed";
                        console.error("VIDEO_TRANSCRIBE_ERROR:", msg);
                        send({ error: msg });
                    } finally {
                        try { controller.close(); } catch {}
                    }
                },
            });
            return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
        }

        const segments = await runTranscriptionPipeline(videoPath, whisper, undefined, request.signal);
        return NextResponse.json({ segments });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription failed";
        console.error("VIDEO_TRANSCRIBE_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
