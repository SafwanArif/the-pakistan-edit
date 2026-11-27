import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { SubtitleSegment } from "@/types/news";
import { assertDiskHeadroom, CACHE_DIR, createNdjsonResponse, fileExists, getWorkerThreadCount, parseFfmpegProgressPercent, parseWhisperProgressLine, probeMediaFile, resolveCachedVideoPath, spawnExec, sweepStaleExportFiles, withExportSlot } from "@/lib/server/videoMedia";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const WHISPER_DIR = path.join(process.cwd(), "tools", "whisper");
const WHISPER_BINS = ["whisper-cli.exe", "main.exe", "whisper-cli", "main"] as const;
const WHISPER_MODELS = ["ggml-large-v3-turbo.bin", "ggml-medium.bin", "ggml-small.bin", "ggml-base.bin", "ggml-tiny.bin"] as const;
let cachedWhisperSetup: { bin: string; model: string; modelLabel: string } | null = null;

const findWhisperSetup = async (): Promise<{ bin: string; model: string; modelLabel: string } | null> => {
    if (cachedWhisperSetup) {
        if (await fileExists(cachedWhisperSetup.bin) && await fileExists(cachedWhisperSetup.model)) return cachedWhisperSetup;
        cachedWhisperSetup = null;
    }
    for (const exe of WHISPER_BINS) {
        const binPath = path.join(WHISPER_DIR, exe);
        if (!await fileExists(binPath)) continue;
        for (const mod of WHISPER_MODELS) {
            const modPath = path.join(WHISPER_DIR, mod);
            if (await fileExists(modPath)) {
                cachedWhisperSetup = { bin: binPath, model: modPath, modelLabel: mod.replace(/^ggml-/, "").replace(/\.bin$/, "").toUpperCase() };
                return cachedWhisperSetup;
            }
        }
    }
    return null;
};

interface WhisperCppJson {
    transcription?: { offsets?: { from?: number; to?: number }; text?: string }[];
}

const runTranscriptionPipeline = async (
    videoPath: string,
    whisper: { bin: string; model: string; modelLabel: string },
    onProgress?: (stage: string, percent: number) => void,
    signal?: AbortSignal
): Promise<SubtitleSegment[]> => {
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    await assertDiskHeadroom();
    const uid = crypto.randomUUID().slice(0, 8);
    const wavPath = path.join(CACHE_DIR, `audio-${uid}.wav`);
    const jsonPrefix = path.join(CACHE_DIR, `subs-${uid}`);

    try {
        onProgress?.("PROBING AUDIO TRACK...", 5);
        const { durationSec, hasAudio } = await probeMediaFile(videoPath, { signal, timeoutMs: 15_000 });
        if (!hasAudio) throw new Error("This video has no audio track to transcribe.");

        onProgress?.("EXTRACTING 16KHZ MONO AUDIO...", 10);
        let lastExtractPct = -1;
        await spawnExec("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
            "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath,
        ], {
            signal,
            timeoutMs: 120_000,
            onStdoutLine: onProgress && durationSec > 0 ? (line) => {
                const rawPct = parseFfmpegProgressPercent(line, durationSec, 100);
                if (rawPct !== null && rawPct !== lastExtractPct) {
                    lastExtractPct = rawPct;
                    onProgress(`EXTRACTING 16KHZ MONO AUDIO (${rawPct}%)...`, 10 + Math.round(rawPct * 0.15));
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
                onProgress(`TRANSCRIBING SPEECH (${pct}%)...`, Math.min(96, 28 + Math.round(pct * 0.68)));
            }
        };

        await withExportSlot(() => spawnExec(whisper.bin, [
            "-m", whisper.model, "-f", wavPath, "-t", getWorkerThreadCount(), "-l", "auto", "-pp", "-oj", "-of", jsonPrefix,
        ], { signal, timeoutMs: 300_000, onStdoutLine: handleWhisperLine, onStderrLine: handleWhisperLine }), signal);

        onProgress?.("BUILDING SUBTITLE TIMELINE...", 98);
        const parsed = JSON.parse(await fs.promises.readFile(`${jsonPrefix}.json`, "utf8")) as WhisperCppJson;
        const items = Array.isArray(parsed.transcription) ? parsed.transcription : [];
        return items
            .map((item, idx) => {
                const rawFrom = Number(item?.offsets?.from);
                const rawTo = Number(item?.offsets?.to);
                const start = Number.isFinite(rawFrom) ? Math.max(0, Math.round((rawFrom / 1000) * 100) / 100) : 0;
                const end = Number.isFinite(rawTo) ? Math.max(0, Math.round((rawTo / 1000) * 100) / 100) : 0;
                return { id: `sub-${idx + 1}`, start, end, text: typeof item?.text === "string" ? item.text.trim() : "" };
            })
            .filter((s) => s.text.length > 0 && s.end > s.start);
    } finally {
        await Promise.all([
            fs.promises.unlink(wavPath).catch(() => {}),
            fs.promises.unlink(`${jsonPrefix}.json`).catch(() => {}),
        ]);
    }
};

export async function POST(request: Request) {
    if (process.env.VERCEL === "1") {
        return NextResponse.json(
            { error: "Local Whisper transcription is unavailable on serverless deployments. Run the studio locally to auto-generate subtitles." },
            { status: 501 }
        );
    }
    if (request.signal.aborted) return new Response(null, { status: 499 });

    void sweepStaleExportFiles();

    try {
        let body: unknown;
        try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON request body." }, { status: 400 }); }
        const rawVideoUrl = body && typeof body === "object" && "videoUrl" in body && typeof (body as { videoUrl?: unknown }).videoUrl === "string"
            ? (body as { videoUrl: string }).videoUrl
            : undefined;
        const videoPath = await resolveCachedVideoPath(rawVideoUrl);
        if (!videoPath) return NextResponse.json({ error: "Transcribe requires an ingested studio video on disk." }, { status: 400 });

        const whisper = await findWhisperSetup();
        if (!whisper) {
            return NextResponse.json({ error: "Local Whisper not installed yet. Place whisper-cli.exe and ggml-small.bin inside tools/whisper/." }, { status: 422 });
        }

        if (request.headers.get("accept")?.includes("application/x-ndjson")) {
            return createNdjsonResponse(request.signal, async (send, streamSignal) => {
                try {
                    const segments = await runTranscriptionPipeline(videoPath, whisper, (stage, percent) => send({ stage, percent }), streamSignal);
                    send({ stage: "SUBTITLES READY", percent: 100, segments });
                } catch (err) {
                    if (!streamSignal.aborted) {
                        const msg = err instanceof Error ? err.message : "Transcription failed";
                        console.error("VIDEO_TRANSCRIBE_ERROR:", msg);
                        send({ error: msg });
                    }
                }
            });
        }

        return NextResponse.json({ segments: await runTranscriptionPipeline(videoPath, whisper, undefined, request.signal) });
    } catch (error) {
        if (request.signal.aborted) return new Response(null, { status: 499 });
        const message = error instanceof Error ? error.message : "Transcription failed";
        console.error("VIDEO_TRANSCRIBE_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
