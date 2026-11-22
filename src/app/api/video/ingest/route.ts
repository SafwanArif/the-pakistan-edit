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
const FRAME_LOG_SUFFIX = ".tpe-frame-index.json";

const normalizeProbeFps = (rawRate: string | undefined): number => {
    if (!rawRate) return 30;
    const [numRaw, denRaw] = rawRate.split('/');
    const num = Number(numRaw);
    const den = Number(denRaw || 1);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return 30;
    const raw = num / den;
    if (Math.abs(raw - 23.976) < 0.1 || Math.abs(raw - 24) < 0.1) return 24;
    if (Math.abs(raw - 29.97) < 0.1 || Math.abs(raw - 30) < 0.1) return 30;
    if (Math.abs(raw - 59.94) < 0.1 || Math.abs(raw - 60) < 0.1) return 60;
    return Math.min(120, Math.max(24, Math.round(raw)));
};

interface IngestFrameIndex {
    mediaUrl: string;
    fps: number;
    nominalFps: number;
    startTime: number;
    duration: number;
    frameCount: number;
    cfr: boolean;
    keyframes: number[];
    pts: number[];
}

const probeSourceFrameIndex = async (
    inputPath: string,
    mediaUrl: string,
    nominalFps: number,
    signal?: AbortSignal
): Promise<IngestFrameIndex | null> => {
    try {
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "frame=pts_time,best_effort_timestamp_time,key_frame",
            "-of", "json",
            inputPath,
        ], { signal, timeoutMs: 120_000 });
        const parsed = JSON.parse(stdout) as { frames?: Array<{ pts_time?: string; best_effort_timestamp_time?: string; key_frame?: number }> };
        const pts = (parsed.frames || [])
            .map((frame) => Number(frame.pts_time ?? frame.best_effort_timestamp_time))
            .filter((time) => Number.isFinite(time));
        if (!pts.length) return null;

        const startTime = pts[0] ?? 0;
        const frameTimes = pts.map((time) => time - startTime);
        const intervals = frameTimes.slice(1).map((time, index) => time - frameTimes[index]!);
        const uniqueIntervals = intervals.filter((_, index) => index === 0 || Math.abs(intervals[index]! - intervals[index - 1]!) > 0.0001);
        const cfr = uniqueIntervals.length <= 1;
        const frameCount = pts.length;
        const duration = frameTimes.at(-1)! + (frameTimes.length > 1 ? (intervals.at(-1) || 1 / nominalFps) : 1 / nominalFps);
        const keyframes = (parsed.frames || [])
            .map((frame, index) => frame.key_frame === 1 ? index : -1)
            .filter((index) => index >= 0);

        return {
            mediaUrl,
            fps: nominalFps,
            nominalFps,
            startTime,
            duration,
            frameCount,
            cfr,
            keyframes,
            pts: cfr ? [] : frameTimes,
        };
    } catch {
        return null;
    }
};

/** Probes duration, FPS, AAC audio compatibility, and edit-list offset in one `ffprobe` pass. */
const probeIngestMetadata = async (inputPath: string, signal?: AbortSignal): Promise<{ copyAudio: boolean; durationSec: number; fps: number }> => {
    try {
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error",
            "-show_entries", "format=duration,start_time:stream=codec_type,codec_name,initial_padding,r_frame_rate,avg_frame_rate",
            "-of", "json",
            inputPath,
        ], { signal, timeoutMs: 30_000 });
        const parsed = JSON.parse(stdout) as {
            format?: { duration?: string; start_time?: string };
            streams?: { codec_type?: string; codec_name?: string; initial_padding?: number; r_frame_rate?: string; avg_frame_rate?: string }[];
        };
        const durationSec = Math.max(0, Number(parsed.format?.duration ?? 0) || 0);
        const startTime = Number(parsed.format?.start_time ?? 0);
        const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
        const fps = normalizeProbeFps(videoStream?.avg_frame_rate || videoStream?.r_frame_rate);
        if (Number.isFinite(startTime) && startTime < -0.05) return { copyAudio: false, durationSec, fps };

        const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
        if (!audioStream) return { copyAudio: true, durationSec, fps };
        return {
            copyAudio: audioStream.codec_name === "aac" && (audioStream.initial_padding ?? 0) <= 2048,
            durationSec,
            fps,
        };
    } catch {
        return { copyAudio: false, durationSec: 0, fps: 30 };
    }
};

/**
 * Remuxes the video stream bit-for-bit untouched (`-c:v copy`).
 * Streams real-time FFmpeg `-progress pipe:1` percentage updates while copying or re-encoding audio.
 */
const runLosslessVideoIngest = async (
    inputPath: string,
    outputPath: string,
    stripEditList: boolean,
    onStage?: (stage: string) => void,
    signal?: AbortSignal
): Promise<{ fps: number; frameIndex: IngestFrameIndex | null }> => {
    onStage?.("PROBING STREAMS & CODECS (FFPROBE)...");
    const { copyAudio, durationSec, fps } = await probeIngestMetadata(inputPath, signal);
    const baseLabel = copyAudio
        ? "AAC AUDIO DETECTED — LOSSLESS STREAM COPY (+FASTSTART)"
        : "RE-ENCODING AUDIO TO 48KHZ AAC & MOVING MOOV ATOM";
    onStage?.(`${baseLabel}... 0%`);
    const args = [
        "-y",
        "-hide_banner",
        "-loglevel", "error",
        "-nostats",
        "-progress", "pipe:1",
        ...(stripEditList && !copyAudio ? ["-ignore_editlist", "1"] : []),
        "-i", inputPath,
        "-c:v", "copy",
        ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]),
        "-movflags", "+faststart",
        outputPath,
    ];
    let lastPct = -1;
    let latestSpeed = "";
    await spawnExec("ffmpeg", args, {
        signal,
        timeoutMs: 180_000,
        onStdoutLine: onStage ? (line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("speed=")) {
                const sp = trimmed.slice(6).trim();
                if (sp && sp !== "N/A") latestSpeed = sp;
            } else if (trimmed.startsWith("out_time_us=") && durationSec > 0) {
                const us = Number(trimmed.slice(12));
                if (Number.isFinite(us) && us >= 0) {
                    const pct = Math.min(99, Math.max(0, Math.round((us / 1_000_000 / durationSec) * 100)));
                    if (pct !== lastPct) {
                        lastPct = pct;
                        const spSuffix = latestSpeed ? ` (${latestSpeed})` : "";
                        onStage(`${baseLabel}... ${pct}%${spSuffix}`);
                    }
                }
            } else if (trimmed === "progress=end") {
                onStage("FINALIZING MOOV ATOM (+FASTSTART)... 99%");
            }
        } : undefined,
    });
    const frameIndex = await probeSourceFrameIndex(outputPath, "", fps, signal);
    return { fps, frameIndex };
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

export async function frameIndexHandler(request: Request) {
    const name = new URL(request.url).searchParams.get("name") || "";
    if (!/^media-[A-Za-z0-9_-]+\.mp4\.tpe-frame-index\.json$/.test(name)) {
        return NextResponse.json({ error: "Invalid frame index name" }, { status: 400 });
    }
    const filePath = path.join(CACHE_DIR, path.basename(name));
    try {
        const contents = await fs.promises.readFile(filePath, "utf8");
        return new Response(contents, {
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        });
    } catch {
        return NextResponse.json({ error: "Frame index not found" }, { status: 404 });
    }
}

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
                        const metadata = await runLosslessVideoIngest(streamRawPath, outPath!, stripEditList, (stage) => send({ stage }), request.signal);
                        void pruneCacheDir(mediaName);
                        const mediaUrl = `/api/video/ingest?id=${encodeURIComponent(mediaName)}`;
                        let frameIndexUrl: string | undefined;
                        if (metadata.frameIndex) {
                            const frameLogName = `${mediaName}${FRAME_LOG_SUFFIX}`;
                            const frameLogPath = path.join(CACHE_DIR, frameLogName);
                            await fs.promises.writeFile(frameLogPath, JSON.stringify({ ...metadata.frameIndex, mediaUrl }, null, 2), "utf8");
                            frameIndexUrl = `/api/video/ingest/frame-index?name=${encodeURIComponent(frameLogName)}`;
                        }
                        send({ stage: "SYNCING MONITOR METADATA...", url: mediaUrl, fps: String(metadata.fps), frameIndexUrl: frameIndexUrl || "" });
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

        const metadata = await runLosslessVideoIngest(rawPath, outPath, stripEditList, undefined, request.signal);
        void pruneCacheDir(mediaName);
        const mediaUrl = `/api/video/ingest?id=${encodeURIComponent(mediaName)}`;
        let frameIndexUrl: string | undefined;
        if (metadata.frameIndex) {
            const frameLogName = `${mediaName}${FRAME_LOG_SUFFIX}`;
            const frameLogPath = path.join(CACHE_DIR, frameLogName);
            await fs.promises.writeFile(frameLogPath, JSON.stringify({ ...metadata.frameIndex, mediaUrl }, null, 2), "utf8");
            frameIndexUrl = `/api/video/ingest/frame-index?name=${encodeURIComponent(frameLogName)}`;
        }
        return NextResponse.json({ url: mediaUrl, fps: metadata.fps, frameIndexUrl });
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
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    });
}

/** Streams stored studio videos with cancellation-safe HTTP 206 Partial Content byte ranges. */
export async function GET(request: Request) {
    const frameIndexName = new URL(request.url).searchParams.get("frameIndex") || "";
    if (frameIndexName) {
        if (!/^media-[A-Za-z0-9_-]+\.mp4\.tpe-frame-index\.json$/.test(frameIndexName)) {
            return NextResponse.json({ error: "Invalid frame index name" }, { status: 400 });
        }
        const filePath = path.join(CACHE_DIR, path.basename(frameIndexName));
        try {
            const contents = await fs.promises.readFile(filePath, "utf8");
            return new Response(contents, {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "private, max-age=31536000, immutable",
                },
            });
        } catch {
            return NextResponse.json({ error: "Frame index not found" }, { status: 404 });
        }
    }
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
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        });
    }

    return new Response(createFileWebStream(filePath), {
        status: 200,
        headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(totalSize),
            "Content-Type": "video/mp4",
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    });
}
