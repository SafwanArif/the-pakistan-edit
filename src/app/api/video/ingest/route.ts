import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { CACHE_DIR, SAFE_MEDIA_ID_RE, createFileWebStream, spawnExec } from "../../../../lib/server/videoMedia";

export const runtime = "nodejs";

const MAX_CACHED_VIDEOS = 5;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const STALE_TEMP_AGE_MS = 60 * 60 * 1000;

/** Checks if the container already has clean AAC audio and no negative edit-list offset. */
const canCopyAudioLosslessly = async (inputPath: string, signal?: AbortSignal): Promise<boolean> => {
    try {
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error",
            "-show_entries", "format=start_time:stream=codec_type,codec_name,initial_padding",
            "-of", "json",
            inputPath,
        ], { signal, timeoutMs: 30_000 });
        const parsed = JSON.parse(stdout) as {
            format?: { start_time?: string };
            streams?: { codec_type?: string; codec_name?: string; initial_padding?: number }[];
        };
        const startTime = Number(parsed.format?.start_time ?? 0);
        if (Number.isFinite(startTime) && startTime < -0.05) return false;

        const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
        if (!audioStream) return true;
        return audioStream.codec_name === "aac" && (audioStream.initial_padding ?? 0) <= 2048;
    } catch {
        return false;
    }
};

/**
 * Remuxes the video stream bit-for-bit untouched (`-c:v copy`).
 * Copies clean AAC audio directly, or strips negative edit lists and converts Opus/PCM audio to AAC.
 */
const runLosslessVideoIngest = async (
    inputPath: string,
    outputPath: string,
    stripEditList: boolean,
    onStage?: (stage: string) => void,
    signal?: AbortSignal
): Promise<void> => {
    onStage?.("PROBING STREAMS & CODECS (FFPROBE)...");
    const copyAudio = await canCopyAudioLosslessly(inputPath, signal);
    onStage?.(copyAudio
        ? "AAC AUDIO DETECTED — LOSSLESS STREAM COPY (+FASTSTART)..."
        : "RE-ENCODING AUDIO TO 48KHZ AAC & MOVING MOOV ATOM...");
    const args = [
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        ...(stripEditList && !copyAudio ? ["-ignore_editlist", "1"] : []),
        "-i", inputPath,
        "-c:v", "copy",
        ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]),
        "-movflags", "+faststart",
        outputPath,
    ];
    await spawnExec("ffmpeg", args, { signal, timeoutMs: 180_000 });
};

/** Keeps `.next/cache/tpe-videos` bounded to the newest clips and removes legacy/temp files. */
const pruneCacheDir = async (keepFilename: string): Promise<void> => {
    try {
        const entries = await fs.promises.readdir(CACHE_DIR, { withFileTypes: true });
        const mediaFiles: { name: string; mtimeMs: number }[] = [];

        for (const entry of entries) {
            if (!entry.isFile() || entry.name === keepFilename) continue;
            const fullPath = path.join(CACHE_DIR, entry.name);
            const stat = await fs.promises.stat(fullPath).catch(() => null);
            if (!stat) continue;
            if (!SAFE_MEDIA_ID_RE.test(entry.name)) {
                if (Date.now() - stat.mtimeMs > STALE_TEMP_AGE_MS) {
                    await fs.promises.unlink(fullPath).catch(() => {});
                }
                continue;
            }
            mediaFiles.push({ name: entry.name, mtimeMs: stat.mtimeMs });
        }

        mediaFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        for (const stale of mediaFiles.slice(MAX_CACHED_VIDEOS - 1)) {
            await fs.promises.unlink(path.join(CACHE_DIR, stale.name)).catch(() => {});
        }
    } catch { /* non-fatal cache pruning */ }
};

/** Parses an HTTP Range header (bytes=start-end | bytes=-suffix) against total file size. */
const parseByteRange = (rangeHeader: string, totalSize: number): { start: number; end: number } | null => {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match) return null;
    const [, rawStart, rawEnd] = match;

    let start: number;
    let end: number;
    if (rawStart === "" && rawEnd !== "") {
        const suffix = Number(rawEnd);
        if (!Number.isFinite(suffix) || suffix <= 0) return null;
        start = Math.max(0, totalSize - suffix);
        end = totalSize - 1;
    } else if (rawStart !== "") {
        start = Number(rawStart);
        end = rawEnd !== "" ? Math.min(Number(rawEnd), totalSize - 1) : totalSize - 1;
    } else {
        return null;
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start > end || end >= totalSize) {
        return null;
    }
    return { start, end };
};

const resolveMediaFile = async (request: Request): Promise<{ filePath: string; totalSize: number } | NextResponse> => {
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!SAFE_MEDIA_ID_RE.test(id)) {
        return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const filePath = path.join(CACHE_DIR, path.basename(id));
    try {
        const stat = await fs.promises.stat(filePath);
        return { filePath, totalSize: stat.size };
    } catch {
        return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
};

/** Stores uploaded video with lossless `-c:v copy` + smart AAC sync for HTTP 206 streaming. */
export async function POST(request: Request) {
    let rawPath: string | null = null;
    let outPath: string | null = null;

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!(file instanceof Blob)) {
            return NextResponse.json({ error: "Missing video file in form data" }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
            return NextResponse.json({ error: "Video exceeds 500MB upload limit" }, { status: 413 });
        }

        await fs.promises.mkdir(CACHE_DIR, { recursive: true });
        const uid = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const rawName = file instanceof File ? file.name : "upload.mp4";
        const extMatch = /\.(mp4|mov|webm|mkv|m4v)$/i.exec(rawName);
        const safeExt = extMatch ? extMatch[0].toLowerCase() : ".mp4";
        rawPath = path.join(CACHE_DIR, `raw-${uid}${safeExt}`);

        const mediaName = `media-${uid}.mp4`;
        outPath = path.join(CACHE_DIR, mediaName);

        if (typeof file.stream === "function") {
            const nodeReadable = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
            await pipeline(nodeReadable, fs.createWriteStream(rawPath));
        } else {
            await fs.promises.writeFile(rawPath, Buffer.from(await file.arrayBuffer()));
        }

        const stripEditList = safeExt === ".mp4" || safeExt === ".mov" || safeExt === ".m4v";
        const wantsStream = request.headers.get("accept")?.includes("application/x-ndjson");

        if (wantsStream) {
            const streamRawPath = rawPath;
            rawPath = null;
            const enc = new TextEncoder();
            const stream = new ReadableStream<Uint8Array>({
                async start(controller) {
                    const send = (obj: Record<string, string>) => {
                        try { controller.enqueue(enc.encode(`${JSON.stringify(obj)}\n`)); } catch {}
                    };
                    try {
                        send({ stage: "SAVING RAW STREAM TO STUDIO CACHE..." });
                        await runLosslessVideoIngest(streamRawPath, outPath!, stripEditList, (stage) => send({ stage }), request.signal);
                        void pruneCacheDir(mediaName);
                        send({ stage: "SYNCING MONITOR METADATA...", url: `/api/video/ingest?id=${encodeURIComponent(mediaName)}` });
                    } catch (err) {
                        if (outPath) await fs.promises.unlink(outPath).catch(() => {});
                        const msg = err instanceof Error ? err.message : "Video ingest failed";
                        console.error("VIDEO_INGEST_ERROR:", msg);
                        send({ error: msg });
                    } finally {
                        await fs.promises.unlink(streamRawPath).catch(() => {});
                        try { controller.close(); } catch {}
                    }
                },
            });
            return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
        }

        await runLosslessVideoIngest(rawPath, outPath, stripEditList, undefined, request.signal);
        void pruneCacheDir(mediaName);

        return NextResponse.json({ url: `/api/video/ingest?id=${encodeURIComponent(mediaName)}` });
    } catch (error) {
        if (outPath) await fs.promises.unlink(outPath).catch(() => {});
        const message = error instanceof Error ? error.message : "Video ingest failed";
        console.error("VIDEO_INGEST_ERROR:", message);
        return NextResponse.json({ error: message }, { status: 500 });
    } finally {
        if (rawPath) await fs.promises.unlink(rawPath).catch(() => {});
    }
}

/** Handles metadata preflight probes without allocating a file stream. */
export async function HEAD(request: Request) {
    const resolved = await resolveMediaFile(request);
    if (resolved instanceof NextResponse) return resolved;
    return new Response(null, {
        status: 200,
        headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(resolved.totalSize),
            "Content-Type": "video/mp4",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}

/** Streams stored studio videos with cancellation-safe HTTP 206 Partial Content byte ranges. */
export async function GET(request: Request) {
    const resolved = await resolveMediaFile(request);
    if (resolved instanceof NextResponse) return resolved;
    const { filePath, totalSize } = resolved;
    const rangeHeader = request.headers.get("range");

    if (rangeHeader) {
        const range = parseByteRange(rangeHeader, totalSize);
        if (!range) {
            return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
        }
        const { start, end } = range;
        return new Response(createFileWebStream(filePath, { start, end }), {
            status: 206,
            headers: {
                "Content-Range": `bytes ${start}-${end}/${totalSize}`,
                "Accept-Ranges": "bytes",
                "Content-Length": String(end - start + 1),
                "Content-Type": "video/mp4",
                "Cache-Control": "public, max-age=31536000, immutable",
            },
        });
    }

    return new Response(createFileWebStream(filePath), {
        status: 200,
        headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(totalSize),
            "Content-Type": "video/mp4",
            "Cache-Control": "public, max-age=31536000, immutable",
        },
    });
}
