import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { assertDiskHeadroom, CACHE_DIR, classifyFrameTimestamps, createFileWebStream, createNdjsonResponse, probeMediaFile, SAFE_MEDIA_ID_RE, spawnExec } from "@/lib/server/videoMedia";
import type { SourceFrameIndex, SourceMediaInfo } from "@/types/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CACHED_VIDEOS = 8;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const STALE_TEMP_AGE_MS = 60 * 60 * 1000;
const FRAME_LOG_SUFFIX = ".tpe-frame-index.json";
const AUDIO_SIDECAR_SUFFIX = ".tpe-audio.m4a";

const computeGopStats = (frameIndex: SourceFrameIndex | null, durationSec: number): Pick<SourceMediaInfo, "maxGopSec" | "avgGopSec" | "keyframeCount" | "isVfr"> => {
    if (!frameIndex || !frameIndex.keyframes.length) return {};
    const fps = frameIndex.fps > 0 ? frameIndex.fps : frameIndex.nominalFps;
    const times: number[] = [];
    for (const idx of frameIndex.keyframes) {
        const t = !frameIndex.cfr && frameIndex.pts[idx] !== undefined ? frameIndex.pts[idx]! : (fps > 0 ? idx / fps : NaN);
        if (Number.isFinite(t) && (times.length === 0 || t > times[times.length - 1]!)) times.push(t);
    }
    if (!times.length) return { isVfr: !frameIndex.cfr };
    let maxGap = 0;
    let gapSum = 0;
    for (let i = 1; i < times.length; i++) {
        const gap = times[i]! - times[i - 1]!;
        if (gap > maxGap) maxGap = gap;
        gapSum += gap;
    }
    const tailGap = durationSec > times[times.length - 1]! ? durationSec - times[times.length - 1]! : 0;
    if (tailGap > maxGap) maxGap = tailGap;
    return {
        maxGopSec: Math.round((times.length >= 2 ? maxGap : durationSec) * 1000) / 1000,
        avgGopSec: Math.round((times.length >= 2 ? gapSum / (times.length - 1) : durationSec) * 1000) / 1000,
        keyframeCount: times.length,
        isVfr: !frameIndex.cfr,
    };
};

const extractAudioSidecar = async (mp4Path: string, signal?: AbortSignal): Promise<void> => {
    const sidecarPath = `${mp4Path}${AUDIO_SIDECAR_SUFFIX}`;
    try {
        await spawnExec("ffmpeg", [
            "-y",
            "-hide_banner",
            "-loglevel", "error",
            "-nostats",
            "-i", mp4Path,
            "-vn",
            "-sn",
            "-dn",
            "-c:a", "copy",
            "-movflags", "+faststart",
            sidecarPath,
        ], { signal, timeoutMs: 30_000 });
    } catch (err) {
        await fs.promises.unlink(sidecarPath).catch(() => {});
        if (signal?.aborted) throw err;
    }
};

const probeSourceFrameIndex = async (
    inputPath: string,
    mediaUrl: string,
    nominalFps: number,
    exactFps: number,
    signal?: AbortSignal
): Promise<SourceFrameIndex | null> => {
    try {
        // Demux-only packet scan (`packet=pts_time,flags`) is 10–50x faster than decoding frames
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "packet=pts_time,flags",
            "-of", "json",
            inputPath,
        ], { signal, timeoutMs: 60_000 });
        const parsed = JSON.parse(stdout) as { packets?: Array<{ pts_time?: string; flags?: string }> };
        const entries = (parsed.packets || [])
            .map((pkt) => ({
                pts: Number(pkt.pts_time),
                isKey: Boolean(pkt.flags && pkt.flags.includes("K")),
            }))
            .filter((item) => Number.isFinite(item.pts))
            .sort((a, b) => a.pts - b.pts);
        if (!entries.length) return null;

        const startTime = entries[0]!.pts;
        const frameTimes = entries.map((item) => Math.max(0, Math.round((item.pts - startTime) * 1_000_000) / 1_000_000));
        const { cfr, medianInterval } = classifyFrameTimestamps(frameTimes);
        const frameCount = frameTimes.length;
        const duration = frameTimes.at(-1)! + (medianInterval || 1 / nominalFps);
        const keyframes: number[] = [];
        for (let index = 0; index < entries.length; index++) {
            if (entries[index]!.isKey) keyframes.push(index);
        }

        return {
            mediaUrl,
            fps: exactFps,
            nominalFps,
            startTime,
            duration,
            frameCount,
            cfr,
            keyframes,
            pts: cfr ? [] : frameTimes,
        };
    } catch (err) {
        if (signal?.aborted) throw err;
        return null;
    }
};

const persistFrameIndexSidecar = async (
    mediaName: string,
    mediaUrl: string,
    frameIndex: SourceFrameIndex | null
): Promise<string | undefined> => {
    if (!frameIndex) return undefined;
    const frameLogName = `${mediaName}${FRAME_LOG_SUFFIX}`;
    const frameLogPath = path.join(CACHE_DIR, frameLogName);
    await fs.promises.writeFile(frameLogPath, JSON.stringify({ ...frameIndex, mediaUrl }), "utf8");
    return `/api/video/ingest?frameIndex=${encodeURIComponent(frameLogName)}`;
};

/**
 * Remuxes the video stream bit-for-bit untouched (`-c:v copy`).
 * Streams real-time FFmpeg `-progress pipe:1` percentage updates while copying or re-encoding audio.
 */
const runLosslessVideoIngest = async (
    inputPath: string,
    outputPath: string,
    fileSize: number,
    stripEditList: boolean,
    onStage?: (stage: string) => void,
    signal?: AbortSignal
): Promise<{ fps: number; duration: number; frameIndex: SourceFrameIndex | null; mediaInfo: SourceMediaInfo }> => {
    onStage?.("PROBING STREAMS & CODECS (FFPROBE)...");
    const { copyAudio, durationSec, mediaInfo } = await probeMediaFile(inputPath, { fileSize, signal });
    const fps = mediaInfo.nominalFps;
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
        "-map", "0:v:0",
        "-map", "0:a:0?",
        "-sn",
        "-dn",
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
    onStage?.("INDEXING SOURCE FRAMES & AUDIO RAIL...");
    const [frameIndex] = await Promise.all([
        probeSourceFrameIndex(outputPath, "", fps, mediaInfo.exactFps, signal),
        mediaInfo.hasAudio ? extractAudioSidecar(outputPath, signal) : Promise.resolve(),
    ]);
    return {
        fps,
        duration: durationSec,
        frameIndex,
        mediaInfo: {
            ...mediaInfo,
            ...computeGopStats(frameIndex, durationSec),
            moovBeforeMdat: true,
            container: "mp4",
        },
    };
};

/** Keeps `.next/cache/tpe-videos` bounded to the newest clips and removes legacy/temp files. */
const pruneCacheDir = async (keepFilename: string): Promise<void> => {
    try {
        const entries = await fs.promises.readdir(CACHE_DIR, { withFileTypes: true });
        const keepFrameIndex = `${keepFilename}${FRAME_LOG_SUFFIX}`;
        const keepAudioSidecar = `${keepFilename}${AUDIO_SIDECAR_SUFFIX}`;
        const mediaFiles: { name: string; mtimeMs: number }[] = [];
        const sidecarFiles: { name: string; suffix: string }[] = [];

        for (const entry of entries) {
            if (!entry.isFile() || entry.name === keepFilename || entry.name === keepFrameIndex || entry.name === keepAudioSidecar) continue;
            const fullPath = path.join(CACHE_DIR, entry.name);
            const stat = await fs.promises.stat(fullPath).catch(() => null);
            if (!stat) continue;
            if (entry.name.endsWith(FRAME_LOG_SUFFIX)) {
                sidecarFiles.push({ name: entry.name, suffix: FRAME_LOG_SUFFIX });
                continue;
            }
            if (entry.name.endsWith(AUDIO_SIDECAR_SUFFIX)) {
                sidecarFiles.push({ name: entry.name, suffix: AUDIO_SIDECAR_SUFFIX });
                continue;
            }
            if (!SAFE_MEDIA_ID_RE.test(entry.name)) {
                if (Date.now() - stat.mtimeMs > STALE_TEMP_AGE_MS) {
                    await fs.promises.unlink(fullPath).catch(() => {});
                }
                continue;
            }
            mediaFiles.push({ name: entry.name, mtimeMs: stat.mtimeMs });
        }

        mediaFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const keptMediaNames = new Set([keepFilename, ...mediaFiles.slice(0, MAX_CACHED_VIDEOS - 1).map((m) => m.name)]);
        for (const stale of mediaFiles.slice(MAX_CACHED_VIDEOS - 1)) {
            await fs.promises.unlink(path.join(CACHE_DIR, stale.name)).catch(() => {});
            await fs.promises.unlink(path.join(CACHE_DIR, `${stale.name}${FRAME_LOG_SUFFIX}`)).catch(() => {});
            await fs.promises.unlink(path.join(CACHE_DIR, `${stale.name}${AUDIO_SIDECAR_SUFFIX}`)).catch(() => {});
        }
        for (const sidecar of sidecarFiles) {
            const ownerMedia = sidecar.name.slice(0, -sidecar.suffix.length);
            if (!keptMediaNames.has(ownerMedia)) {
                await fs.promises.unlink(path.join(CACHE_DIR, sidecar.name)).catch(() => {});
            }
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

const resolveMediaFile = async (request: Request): Promise<{ filePath: string; totalSize: number; contentType: string } | NextResponse> => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (!SAFE_MEDIA_ID_RE.test(id)) {
        return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const basePath = path.join(CACHE_DIR, path.basename(id));
    if (url.searchParams.get("track") === "audio") {
        const sidecarPath = `${basePath}${AUDIO_SIDECAR_SUFFIX}`;
        const sidecarStat = await fs.promises.stat(sidecarPath).catch(() => null);
        if (sidecarStat && sidecarStat.size > 0) {
            return { filePath: sidecarPath, totalSize: sidecarStat.size, contentType: "audio/mp4" };
        }
    }
    try {
        const stat = await fs.promises.stat(basePath);
        return { filePath: basePath, totalSize: stat.size, contentType: "video/mp4" };
    } catch {
        return NextResponse.json({ error: "Video not found" }, { status: 404 });
    }
};

/** Stores uploaded video with lossless `-c:v copy` + smart AAC sync for HTTP 206 streaming. */
export async function POST(request: Request) {
    if (process.env.VERCEL === "1") {
        return NextResponse.json(
            { error: "Server video ingest is unavailable on serverless deployments." },
            { status: 501 }
        );
    }

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
        await assertDiskHeadroom();
        const uid = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const rawName = file instanceof File ? file.name : "upload.mp4";
        const extMatch = /\.(mp4|mov|webm|mkv|m4v)$/i.exec(rawName);
        const safeExt = extMatch ? extMatch[0].toLowerCase() : ".mp4";
        rawPath = path.join(CACHE_DIR, `raw-${uid}${safeExt}`);

        const mediaName = `media-${uid}.mp4`;
        outPath = path.join(CACHE_DIR, mediaName);

        if (typeof file.stream === "function") {
            const nodeReadable = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
            await pipeline(nodeReadable, fs.createWriteStream(rawPath), { signal: request.signal });
        } else {
            await fs.promises.writeFile(rawPath, Buffer.from(await file.arrayBuffer()));
        }

        const stripEditList = safeExt === ".mp4" || safeExt === ".mov" || safeExt === ".m4v";
        const wantsStream = request.headers.get("accept")?.includes("application/x-ndjson");

        if (wantsStream) {
            const streamRawPath = rawPath;
            rawPath = null;
            return createNdjsonResponse(request.signal, async (send, streamSignal) => {
                try {
                    send({ stage: "SAVING RAW STREAM TO STUDIO CACHE..." });
                    const metadata = await runLosslessVideoIngest(streamRawPath, outPath!, file.size, stripEditList, (stage) => send({ stage }), streamSignal);
                    void pruneCacheDir(mediaName);
                    const mediaUrl = `/api/video/ingest?id=${encodeURIComponent(mediaName)}`;
                    const frameIndexUrl = await persistFrameIndexSidecar(mediaName, mediaUrl, metadata.frameIndex);
                    send({
                        stage: "SYNCING MONITOR METADATA...",
                        url: mediaUrl,
                        fps: metadata.fps,
                        duration: metadata.duration,
                        frameIndexUrl: frameIndexUrl || "",
                        mediaInfo: metadata.mediaInfo,
                    });
                } catch (err) {
                    if (outPath) {
                        await fs.promises.unlink(outPath).catch(() => {});
                        await fs.promises.unlink(`${outPath}${AUDIO_SIDECAR_SUFFIX}`).catch(() => {});
                    }
                    const msg = err instanceof Error ? err.message : "Video ingest failed";
                    console.error("VIDEO_INGEST_ERROR:", msg);
                    send({ error: msg });
                } finally {
                    await fs.promises.unlink(streamRawPath).catch(() => {});
                }
            });
        }

        const metadata = await runLosslessVideoIngest(rawPath, outPath, file.size, stripEditList, undefined, request.signal);
        void pruneCacheDir(mediaName);
        const mediaUrl = `/api/video/ingest?id=${encodeURIComponent(mediaName)}`;
        const frameIndexUrl = await persistFrameIndexSidecar(mediaName, mediaUrl, metadata.frameIndex);
        return NextResponse.json({ url: mediaUrl, fps: metadata.fps, duration: metadata.duration, frameIndexUrl, mediaInfo: metadata.mediaInfo });
    } catch (error) {
        if (outPath) {
            await fs.promises.unlink(outPath).catch(() => {});
            await fs.promises.unlink(`${outPath}${AUDIO_SIDECAR_SUFFIX}`).catch(() => {});
        }
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
            "Content-Type": resolved.contentType,
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
    const { filePath, totalSize, contentType } = resolved;
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
                "Content-Type": contentType,
                "Cache-Control": "private, max-age=31536000, immutable",
            },
        });
    }

    return new Response(createFileWebStream(filePath), {
        status: 200,
        headers: {
            "Accept-Ranges": "bytes",
            "Content-Length": String(totalSize),
            "Content-Type": contentType,
            "Cache-Control": "private, max-age=31536000, immutable",
        },
    });
}

/** Immediately removes a cached studio video and its frame-index & audio sidecars on explicit clear/reset. */
export async function DELETE(request: Request) {
    if (process.env.VERCEL === "1") {
        return new Response(null, { status: 204 });
    }
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!SAFE_MEDIA_ID_RE.test(id)) {
        return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    }
    const base = path.basename(id);
    await Promise.all([
        fs.promises.unlink(path.join(CACHE_DIR, base)).catch(() => {}),
        fs.promises.unlink(path.join(CACHE_DIR, `${base}${FRAME_LOG_SUFFIX}`)).catch(() => {}),
        fs.promises.unlink(path.join(CACHE_DIR, `${base}${AUDIO_SIDECAR_SUFFIX}`)).catch(() => {}),
    ]);
    return new Response(null, { status: 204 });
}
