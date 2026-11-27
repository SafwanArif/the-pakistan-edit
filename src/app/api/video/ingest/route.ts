import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { assertDiskHeadroom, CACHE_DIR, classifyFrameTimestamps, createFileWebStream, createNdjsonResponse, parseFfmpegProgressPercent, probeMediaFile, SAFE_MEDIA_ID_RE, spawnExec } from "@/lib/server/videoMedia";
import type { SourceFrameIndex, SourceMediaInfo } from "@/types/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_CACHED_VIDEOS = 8;
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const STALE_TEMP_AGE_MS = 60 * 60 * 1000;
const FRAME_LOG_SUFFIX = ".tpe-frame-index.json";
const AUDIO_SIDECAR_SUFFIX = ".tpe-audio.m4a";
const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";

const unlinkMediaWithSidecars = async (baseName: string): Promise<void> => {
    const basePath = path.join(CACHE_DIR, path.basename(baseName));
    await Promise.all([
        fs.promises.unlink(basePath).catch(() => {}),
        fs.promises.unlink(`${basePath}${FRAME_LOG_SUFFIX}`).catch(() => {}),
        fs.promises.unlink(`${basePath}${AUDIO_SIDECAR_SUFFIX}`).catch(() => {}),
    ]);
};

const buildMediaHeaders = (contentType: string, contentLength: number, range?: { start: number; end: number; totalSize: number }): Record<string, string> => ({
    ...(range ? { "Content-Range": `bytes ${range.start}-${range.end}/${range.totalSize}` } : {}),
    "Accept-Ranges": "bytes",
    "Content-Length": String(contentLength),
    "Content-Type": contentType,
    "Cache-Control": IMMUTABLE_CACHE_CONTROL,
});

const computeGopStats = (frameIndex: SourceFrameIndex | null, durationSec: number): Pick<SourceMediaInfo, "maxGopSec" | "avgGopSec" | "keyframeCount" | "isVfr"> => {
    if (!frameIndex?.keyframes.length) return {};
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
    return {
        maxGopSec: Math.round((times.length >= 2 ? Math.max(maxGap, tailGap) : durationSec) * 1000) / 1000,
        avgGopSec: Math.round((times.length >= 2 ? gapSum / (times.length - 1) : durationSec) * 1000) / 1000,
        keyframeCount: times.length,
        isVfr: !frameIndex.cfr,
    };
};

const extractAudioSidecar = async (mp4Path: string, signal?: AbortSignal): Promise<void> => {
    const sidecarPath = `${mp4Path}${AUDIO_SIDECAR_SUFFIX}`;
    try {
        await spawnExec("ffmpeg", [
            "-y", "-hide_banner", "-loglevel", "error", "-nostats",
            "-i", mp4Path, "-vn", "-sn", "-dn", "-c:a", "copy", "-movflags", "+faststart", sidecarPath,
        ], { signal, timeoutMs: 30_000 });
    } catch (err) {
        await fs.promises.unlink(sidecarPath).catch(() => {});
        if (signal?.aborted) throw err;
    }
};

const probeSourceFrameIndex = async (
    inputPath: string, mediaUrl: string, nominalFps: number, exactFps: number, signal?: AbortSignal
): Promise<SourceFrameIndex | null> => {
    try {
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error", "-select_streams", "v:0", "-show_entries", "packet=pts_time,flags", "-of", "json", inputPath,
        ], { signal, timeoutMs: 60_000 });
        const parsed = JSON.parse(stdout) as { packets?: Array<{ pts_time?: string; flags?: string }> };
        const rawPackets = Array.isArray(parsed.packets) ? parsed.packets : [];
        const entries = rawPackets
            .map((pkt) => ({ pts: Number(pkt?.pts_time), isKey: Boolean(pkt?.flags && pkt.flags.includes("K")) }))
            .filter((item) => Number.isFinite(item.pts))
            .sort((a, b) => a.pts - b.pts);
        if (!entries.length) return null;

        const startTime = entries[0]!.pts;
        const frameTimes = entries.map((item) => Math.max(0, Math.round((item.pts - startTime) * 1_000_000) / 1_000_000));
        const { cfr, medianInterval } = classifyFrameTimestamps(frameTimes);
        const keyframes: number[] = [];
        for (let i = 0; i < entries.length; i++) if (entries[i]!.isKey) keyframes.push(i);

        return {
            mediaUrl, fps: exactFps, nominalFps, startTime,
            duration: frameTimes.at(-1)! + (medianInterval || 1 / nominalFps),
            frameCount: frameTimes.length, cfr, keyframes, pts: cfr ? [] : frameTimes,
        };
    } catch (err) {
        if (signal?.aborted) throw err;
        return null;
    }
};

const persistFrameIndexSidecar = async (mediaName: string, mediaUrl: string, frameIndex: SourceFrameIndex | null): Promise<string | undefined> => {
    if (!frameIndex) return undefined;
    const frameLogName = `${mediaName}${FRAME_LOG_SUFFIX}`;
    await fs.promises.writeFile(path.join(CACHE_DIR, frameLogName), JSON.stringify({ ...frameIndex, mediaUrl }), "utf8");
    return `/api/video/ingest?frameIndex=${encodeURIComponent(frameLogName)}`;
};

/** Remuxes video bit-for-bit (`-c:v copy`) while streaming FFmpeg `-progress pipe:1` percentage updates. */
const runLosslessVideoIngest = async (
    inputPath: string, outputPath: string, fileSize: number, stripEditList: boolean,
    onStage?: (stage: string) => void, signal?: AbortSignal
) => {
    onStage?.("PROBING STREAMS & CODECS (FFPROBE)...");
    const { copyAudio, durationSec, mediaInfo } = await probeMediaFile(inputPath, { fileSize, signal });
    const fps = mediaInfo.nominalFps;
    const baseLabel = copyAudio
        ? "AAC AUDIO DETECTED — LOSSLESS STREAM COPY (+FASTSTART)"
        : "RE-ENCODING AUDIO TO 48KHZ AAC & MOVING MOOV ATOM";
    onStage?.(`${baseLabel}... 0%`);

    let lastPct = -1;
    let latestSpeed = "";
    await spawnExec("ffmpeg", [
        "-y", "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
        ...(stripEditList && !copyAudio ? ["-ignore_editlist", "1"] : []),
        "-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn", "-c:v", "copy",
        ...(copyAudio ? ["-c:a", "copy"] : ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]),
        "-movflags", "+faststart", outputPath,
    ], {
        signal,
        timeoutMs: 180_000,
        onStdoutLine: onStage ? (line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith("speed=")) {
                const sp = trimmed.slice(6).trim();
                if (sp && sp !== "N/A") latestSpeed = sp;
            } else if (trimmed === "progress=end") {
                onStage("FINALIZING MOOV ATOM (+FASTSTART)... 99%");
            } else {
                const pct = parseFfmpegProgressPercent(trimmed, durationSec, 99);
                if (pct !== null && pct !== lastPct) {
                    lastPct = pct;
                    onStage(`${baseLabel}... ${pct}%${latestSpeed ? ` (${latestSpeed})` : ""}`);
                }
            }
        } : undefined,
    });

    onStage?.("INDEXING SOURCE FRAMES & AUDIO RAIL...");
    const [frameIndex] = await Promise.all([
        probeSourceFrameIndex(outputPath, "", fps, mediaInfo.exactFps, signal),
        mediaInfo.hasAudio ? extractAudioSidecar(outputPath, signal) : Promise.resolve(),
    ]);
    const resolvedDuration = durationSec > 0 ? durationSec : (frameIndex?.duration ?? 0);
    return {
        fps,
        duration: resolvedDuration,
        frameIndex,
        mediaInfo: { ...mediaInfo, ...computeGopStats(frameIndex, resolvedDuration), moovBeforeMdat: true, container: "mp4" },
    };
};

/** Keeps `.next/cache/tpe-videos` bounded to the newest clips and removes stale/orphaned files. */
const pruneCacheDir = async (keepFilename: string): Promise<void> => {
    try {
        const entries = await fs.promises.readdir(CACHE_DIR, { withFileTypes: true });
        const keepNames = new Set([keepFilename, `${keepFilename}${FRAME_LOG_SUFFIX}`, `${keepFilename}${AUDIO_SIDECAR_SUFFIX}`]);
        const now = Date.now();
        const mediaFiles: { name: string; mtimeMs: number }[] = [];
        const sidecarFiles: { name: string; suffix: string }[] = [];
        const staleTemps: string[] = [];

        await Promise.all(entries.map(async (entry) => {
            if (!entry.isFile() || keepNames.has(entry.name)) return;
            const fullPath = path.join(CACHE_DIR, entry.name);
            const stat = await fs.promises.stat(fullPath).catch(() => null);
            if (!stat) return;
            if (entry.name.endsWith(FRAME_LOG_SUFFIX)) { sidecarFiles.push({ name: entry.name, suffix: FRAME_LOG_SUFFIX }); return; }
            if (entry.name.endsWith(AUDIO_SIDECAR_SUFFIX)) { sidecarFiles.push({ name: entry.name, suffix: AUDIO_SIDECAR_SUFFIX }); return; }
            if (!SAFE_MEDIA_ID_RE.test(entry.name)) { if (now - stat.mtimeMs > STALE_TEMP_AGE_MS) staleTemps.push(fullPath); return; }
            mediaFiles.push({ name: entry.name, mtimeMs: stat.mtimeMs });
        }));

        mediaFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
        const keptMediaNames = new Set([keepFilename, ...mediaFiles.slice(0, MAX_CACHED_VIDEOS - 1).map((m) => m.name)]);
        await Promise.all([
            ...staleTemps.map((p) => fs.promises.unlink(p).catch(() => {})),
            ...mediaFiles.slice(MAX_CACHED_VIDEOS - 1).map((stale) => unlinkMediaWithSidecars(stale.name)),
            ...sidecarFiles
                .filter((s) => !keptMediaNames.has(s.name.slice(0, -s.suffix.length)))
                .map((s) => fs.promises.unlink(path.join(CACHE_DIR, s.name)).catch(() => {})),
        ]);
    } catch { /* non-fatal cache pruning */ }
};

/** Parses an HTTP Range header (`bytes=start-end` | `bytes=-suffix`) against total file size. */
const parseByteRange = (rangeHeader: string, totalSize: number): { start: number; end: number } | null => {
    const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    if (!match || totalSize <= 0) return null;
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
    return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && start <= end && end < totalSize ? { start, end } : null;
};

const resolveMediaFile = async (request: Request): Promise<{ filePath: string; totalSize: number; contentType: string } | NextResponse> => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") || "";
    if (!SAFE_MEDIA_ID_RE.test(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    const basePath = path.join(CACHE_DIR, path.basename(id));
    if (url.searchParams.get("track") === "audio") {
        const sidecarPath = `${basePath}${AUDIO_SIDECAR_SUFFIX}`;
        const sidecarStat = await fs.promises.stat(sidecarPath).catch(() => null);
        if (sidecarStat?.isFile() && sidecarStat.size > 0) return { filePath: sidecarPath, totalSize: sidecarStat.size, contentType: "audio/mp4" };
    }
    const stat = await fs.promises.stat(basePath).catch(() => null);
    return stat?.isFile() ? { filePath: basePath, totalSize: stat.size, contentType: "video/mp4" } : NextResponse.json({ error: "Video not found" }, { status: 404 });
};

const finalizeIngestedMedia = async (
    rawInputPath: string, outPath: string, mediaName: string, fileSize: number,
    stripEditList: boolean, onStage: ((stage: string) => void) | undefined, signal: AbortSignal | undefined
) => {
    const metadata = await runLosslessVideoIngest(rawInputPath, outPath, fileSize, stripEditList, onStage, signal);
    const mediaUrl = `/api/video/ingest?id=${encodeURIComponent(mediaName)}`;
    const frameIndexUrl = await persistFrameIndexSidecar(mediaName, mediaUrl, metadata.frameIndex);
    void pruneCacheDir(mediaName);
    return { url: mediaUrl, fps: metadata.fps, duration: metadata.duration, frameIndexUrl: frameIndexUrl || "", mediaInfo: metadata.mediaInfo };
};

/** Stores uploaded video with lossless `-c:v copy` + smart AAC sync for HTTP 206 streaming. */
export async function POST(request: Request) {
    if (process.env.VERCEL === "1") return NextResponse.json({ error: "Server video ingest is unavailable on serverless deployments." }, { status: 501 });
    if (request.signal.aborted) return new Response(null, { status: 499 });

    const contentLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES + 1024 * 1024) {
        return NextResponse.json({ error: "Video exceeds 500MB upload limit" }, { status: 413 });
    }

    let rawPath: string | null = null;
    let mediaName: string | null = null;

    try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!(file instanceof Blob) || file.size === 0) return NextResponse.json({ error: "Missing or empty video file in form data" }, { status: 400 });
        if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "Video exceeds 500MB upload limit" }, { status: 413 });

        await fs.promises.mkdir(CACHE_DIR, { recursive: true });
        await assertDiskHeadroom();
        const uid = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
        const rawName = file instanceof File ? file.name : "upload.mp4";
        const safeExt = /\.(mp4|mov|webm|mkv|m4v)$/i.exec(rawName)?.[0].toLowerCase() ?? ".mp4";
        rawPath = path.join(CACHE_DIR, `raw-${uid}${safeExt}`);
        mediaName = `media-${uid}.mp4`;
        const outPath = path.join(CACHE_DIR, mediaName);

        if (typeof file.stream === "function") {
            await pipeline(Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]), fs.createWriteStream(rawPath), { signal: request.signal });
        } else {
            await fs.promises.writeFile(rawPath, Buffer.from(await file.arrayBuffer()));
        }

        const stripEditList = safeExt === ".mp4" || safeExt === ".mov" || safeExt === ".m4v";
        if (request.headers.get("accept")?.includes("application/x-ndjson")) {
            const streamRawPath = rawPath;
            const streamMediaName = mediaName;
            rawPath = null;
            mediaName = null;
            return createNdjsonResponse(request.signal, async (send, streamSignal) => {
                try {
                    send({ stage: "SAVING RAW STREAM TO STUDIO CACHE..." });
                    const payload = await finalizeIngestedMedia(streamRawPath, outPath, streamMediaName, file.size, stripEditList, (stage) => send({ stage }), streamSignal);
                    send({ stage: "SYNCING MONITOR METADATA...", ...payload });
                } catch (err) {
                    await unlinkMediaWithSidecars(streamMediaName);
                    if (!streamSignal.aborted) {
                        const msg = err instanceof Error ? err.message : "Video ingest failed";
                        console.error("VIDEO_INGEST_ERROR:", msg);
                        send({ error: msg });
                    }
                } finally {
                    await fs.promises.unlink(streamRawPath).catch(() => {});
                }
            });
        }

        return NextResponse.json(await finalizeIngestedMedia(rawPath, outPath, mediaName, file.size, stripEditList, undefined, request.signal));
    } catch (error) {
        if (mediaName) await unlinkMediaWithSidecars(mediaName);
        if (request.signal.aborted) return new Response(null, { status: 499 });
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
    return new Response(null, { status: 200, headers: buildMediaHeaders(resolved.contentType, resolved.totalSize) });
}

/** Streams stored studio videos with cancellation-safe HTTP 206 Partial Content byte ranges. */
export async function GET(request: Request) {
    const frameIndexName = new URL(request.url).searchParams.get("frameIndex") || "";
    if (frameIndexName) {
        const mediaId = frameIndexName.endsWith(FRAME_LOG_SUFFIX) ? frameIndexName.slice(0, -FRAME_LOG_SUFFIX.length) : "";
        if (!SAFE_MEDIA_ID_RE.test(mediaId)) return NextResponse.json({ error: "Invalid frame index name" }, { status: 400 });
        try {
            const contents = await fs.promises.readFile(path.join(CACHE_DIR, path.basename(frameIndexName)), "utf8");
            return new Response(contents, { headers: { "Content-Type": "application/json", "Cache-Control": IMMUTABLE_CACHE_CONTROL } });
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
        if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${totalSize}` } });
        return new Response(createFileWebStream(filePath, range), { status: 206, headers: buildMediaHeaders(contentType, range.end - range.start + 1, { ...range, totalSize }) });
    }
    return new Response(createFileWebStream(filePath), { status: 200, headers: buildMediaHeaders(contentType, totalSize) });
}

/** Immediately removes a cached studio video and its frame-index & audio sidecars on explicit clear/reset. */
export async function DELETE(request: Request) {
    if (process.env.VERCEL === "1") return new Response(null, { status: 204 });
    const id = new URL(request.url).searchParams.get("id") || "";
    if (!SAFE_MEDIA_ID_RE.test(id)) return NextResponse.json({ error: "Invalid video id" }, { status: 400 });
    await unlinkMediaWithSidecars(id);
    return new Response(null, { status: 204 });
}
