import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import type { SubtitleSegment } from "../../../../types/news";
import { CACHE_DIR, resolveCachedVideoPath, spawnExec } from "../../../../lib/server/videoMedia";

export const runtime = "nodejs";

const WHISPER_DIR = path.join(process.cwd(), "tools", "whisper");
let cachedWhisperSetup: { bin: string; model: string; kind: "cpp" | "cli" } | null = null;

const fileExists = async (target: string): Promise<boolean> => {
    try {
        await fs.promises.access(target);
        return true;
    } catch {
        return false;
    }
};

const findWhisperSetup = async (): Promise<{ bin: string; model: string; kind: "cpp" | "cli" } | null> => {
    if (cachedWhisperSetup && await fileExists(cachedWhisperSetup.bin) && await fileExists(cachedWhisperSetup.model)) {
        return cachedWhisperSetup;
    }
    for (const exe of ["whisper-cli.exe", "main.exe", "whisper-cli", "main"]) {
        const binPath = path.join(WHISPER_DIR, exe);
        if (!await fileExists(binPath)) continue;
        for (const mod of ["ggml-large-v3-turbo.bin", "ggml-medium.bin", "ggml-small.bin", "ggml-base.bin", "ggml-tiny.bin"]) {
            const modPath = path.join(WHISPER_DIR, mod);
            if (await fileExists(modPath)) {
                cachedWhisperSetup = { bin: binPath, model: modPath, kind: "cpp" };
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

export async function POST(request: Request) {
    let wavPath: string | null = null;
    let jsonPrefix: string | null = null;

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

        const uid = crypto.randomUUID().slice(0, 8);
        wavPath = path.join(CACHE_DIR, `audio-${uid}.wav`);
        jsonPrefix = path.join(CACHE_DIR, `subs-${uid}`);

        await spawnExec("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error",
            "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath,
        ], { signal: request.signal, timeoutMs: 120_000 });

        await spawnExec(whisper.bin, [
            "-m", whisper.model,
            "-f", wavPath,
            "-l", "auto",
            "-oj",
            "-of", jsonPrefix,
        ], { signal: request.signal, timeoutMs: 300_000 });

        const jsonRaw = await fs.promises.readFile(`${jsonPrefix}.json`, "utf8");
        const parsed = JSON.parse(jsonRaw) as WhisperCppJson;
        const segments: SubtitleSegment[] = (parsed.transcription || [])
            .map((item, idx) => ({
                id: `sub-${idx + 1}`,
                start: Math.round(((item.offsets?.from ?? 0) / 1000) * 100) / 100,
                end: Math.round(((item.offsets?.to ?? 0) / 1000) * 100) / 100,
                text: (item.text || "").trim(),
            }))
            .filter((s) => s.text.length > 0 && s.end > s.start);

        return NextResponse.json({ segments });
    } catch (error) {
        const message = error instanceof Error ? error.message : "Transcription failed";
        console.error("VIDEO_TRANSCRIBE_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    } finally {
        if (wavPath) await fs.promises.unlink(wavPath).catch(() => {});
        if (jsonPrefix) await fs.promises.unlink(`${jsonPrefix}.json`).catch(() => {});
    }
}
