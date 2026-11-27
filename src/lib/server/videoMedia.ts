import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { clamp, type SourceMediaInfo } from "@/types/news";

export const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "tpe-videos");
export const SAFE_MEDIA_ID_RE = /^media-[a-zA-Z0-9_-]+\.mp4$/;
const STALE_EXPORT_TEMP_RE = /^(exp|subs|filter|export|audio|raw)-/;
const MAX_LINE_BUF_CHARS = 65_536;
let lastSweepAt = 0;

/** Returns a safe multi-core worker thread count leaving 2 threads free for UI & OS responsiveness. */
export const getWorkerThreadCount = (): string => String(Math.max(2, os.cpus().length - 2));

const toFiniteNumber = (raw?: string | number, fallback = 0): number => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
};

const toPositiveInt = (raw?: string | number): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

/** Creates a cancellation-safe NDJSON streaming Response propagating `request.signal` and `ReadableStream.cancel()`. */
export const createNdjsonResponse = (
    requestSignal: AbortSignal | undefined,
    run: (send: (payload: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>
): Response => {
    const enc = new TextEncoder();
    const ac = new AbortController();
    const onRequestAbort = () => ac.abort();
    if (requestSignal) {
        if (requestSignal.aborted) ac.abort();
        else requestSignal.addEventListener("abort", onRequestAbort, { once: true });
    }
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (payload: Record<string, unknown>) => {
                if (ac.signal.aborted) return;
                try { controller.enqueue(enc.encode(`${JSON.stringify(payload)}\n`)); } catch { /* stream closed */ }
            };
            try {
                await run(send, ac.signal);
            } finally {
                requestSignal?.removeEventListener("abort", onRequestAbort);
                try { controller.close(); } catch { /* stream closed */ }
            }
        },
        cancel() {
            ac.abort();
            requestSignal?.removeEventListener("abort", onRequestAbort);
        },
    });
    return new Response(stream, {
        headers: {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Accel-Buffering": "no",
        },
    });
};

const parseProbeRatio = (rate?: string): number | null => {
    if (!rate) return null;
    const parts = rate.split("/");
    if (parts.length > 2) return null;
    const num = Number(parts[0]);
    const den = parts[1] !== undefined ? Number(parts[1]) : 1;
    return Number.isFinite(num) && Number.isFinite(den) && den > 0 && num > 0 ? num / den : null;
};

/** Resolves exact and nominal broadcast FPS from `avg_frame_rate` / `r_frame_rate` with `> 125` timebase protection. */
export const parseVideoFrameRate = (avgRate?: string, rRate?: string): { exactFps: number; nominalFps: number } => {
    const avg = parseProbeRatio(avgRate);
    const r = parseProbeRatio(rRate);
    const exactFps = avg && avg <= 125 ? avg : (r && r <= 125 ? r : 30);
    const nominalFps = Math.abs(exactFps - 23.976) < 0.1 || Math.abs(exactFps - 24) < 0.1 ? 24
        : Math.abs(exactFps - 29.97) < 0.1 || Math.abs(exactFps - 30) < 0.1 ? 30
            : Math.abs(exactFps - 59.94) < 0.1 || Math.abs(exactFps - 60) < 0.1 ? 60
                : clamp(Math.round(exactFps), 24, 120);
    return { exactFps: Math.round(exactFps * 1000) / 1000, nominalFps };
};

/** Classifies sorted frame PTS values as CFR vs VFR using a 2ms tolerance around the median frame interval. */
export const classifyFrameTimestamps = (frameTimes: number[]): { cfr: boolean; medianInterval: number } => {
    if (frameTimes.length < 3) {
        const rawDt = frameTimes.length === 2 ? frameTimes[1]! - frameTimes[0]! : 1 / 30;
        return { cfr: true, medianInterval: Number.isFinite(rawDt) && rawDt > 0 ? Math.max(0.001, rawDt) : 1 / 30 };
    }
    const intervals: number[] = [];
    for (let i = 1; i < frameTimes.length; i++) {
        const dt = frameTimes[i]! - frameTimes[i - 1]!;
        if (Number.isFinite(dt) && dt > 0) intervals.push(dt);
    }
    if (!intervals.length) return { cfr: true, medianInterval: 1 / 30 };
    const sorted = [...intervals].sort((a, b) => a - b);
    const medianInterval = sorted[sorted.length >> 1]!;
    let outliers = 0;
    for (let i = 0; i < intervals.length; i++) if (Math.abs(intervals[i]! - medianInterval) > 0.002) outliers++;
    return { cfr: outliers <= Math.min(1, Math.floor(intervals.length * 0.01)), medianInterval };
};

/** Computes an H.264 Level 4.2 VBV ceiling (`maxrate` / `bufsize` in kbps) paired with `crf 14`. */
export const computeExportVbvCeiling = (sourceVideoBitrateBps?: number): { maxrateKbps: number; bufsizeKbps: number } | null => {
    if (!sourceVideoBitrateBps || !Number.isFinite(sourceVideoBitrateBps) || sourceVideoBitrateBps <= 0) return null;
    const maxrateKbps = clamp(Math.round((sourceVideoBitrateBps / 1000) * 1.5), 16_000, 50_000);
    return { maxrateKbps, bufsizeKbps: maxrateKbps * 2 };
};

/** Non-blocking TTL sweeper removing orphaned export temp files older than `ttlMs` (never touches `media-*.mp4`). */
export const sweepStaleExportFiles = async (ttlMs = 2 * 60 * 60 * 1000): Promise<void> => {
    const now = Date.now();
    if (now - lastSweepAt < 15 * 60 * 1000) return;
    lastSweepAt = now;
    try {
        const entries = await fs.promises.readdir(CACHE_DIR);
        await Promise.all(entries.map(async (name) => {
            if (!STALE_EXPORT_TEMP_RE.test(name)) return;
            const full = path.join(CACHE_DIR, name);
            try {
                const st = await fs.promises.stat(full);
                if (st.isFile() && now - st.mtimeMs > ttlMs) await fs.promises.unlink(full);
            } catch { /* already removed or locked */ }
        }));
    } catch { /* cache dir not yet initialized */ }
};

let exportQueueTail: Promise<void> = Promise.resolve();

/** Serializes heavy FFmpeg/Whisper tasks (concurrency = 1) while honouring AbortSignal while queued. */
export const withExportSlot = async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) throw new Error("Export aborted before starting");
    const prev = exportQueueTail;
    let release!: () => void;
    exportQueueTail = new Promise<void>((resolve) => { release = resolve; });
    let acquired = false;
    try {
        await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) { reject(new Error("Export aborted while queued")); return; }
            const onAbort = () => reject(new Error("Export aborted while queued"));
            signal?.addEventListener("abort", onAbort, { once: true });
            void prev.then(() => { signal?.removeEventListener("abort", onAbort); resolve(); });
        });
        acquired = true;
        if (signal?.aborted) throw new Error("Export aborted before starting");
        return await task();
    } finally {
        if (acquired) release();
        else void prev.then(release, release);
    }
};

/** Ensures at least `minFreeBytes` (default 500MB) are available in `CACHE_DIR` before spawning FFmpeg. */
export const assertDiskHeadroom = async (minFreeBytes = 500 * 1024 * 1024): Promise<void> => {
    try {
        const stats = await fs.promises.statfs(CACHE_DIR);
        const freeBytes = Number(stats.bavail) * Number(stats.bsize);
        if (Number.isFinite(freeBytes) && freeBytes < minFreeBytes) {
            throw new Error(`Insufficient scratch disk space (${Math.round(freeBytes / (1024 * 1024))} MB free; need at least ${Math.round(minFreeBytes / (1024 * 1024))} MB).`);
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("Insufficient scratch disk space")) throw err;
    }
};

/** Parses an FFmpeg `-progress pipe:1` `out_time_us=` line into a clamped percentage `[0..maxPct]`. */
export const parseFfmpegProgressPercent = (line: string, durationSec: number, maxPct = 100): number | null => {
    if (durationSec <= 0 || !Number.isFinite(durationSec)) return null;
    const trimmed = line.trim();
    if (!trimmed.startsWith("out_time_us=")) return null;
    const us = Number(trimmed.slice(12));
    return Number.isFinite(us) && us >= 0 ? clamp(Math.round((us / 1_000_000 / durationSec) * 100), 0, maxPct) : null;
};

/** Parses live progress (0–100) from whisper.cpp `-pp` stderr lines or `[start --> end]` stdout lines. */
export const parseWhisperProgressLine = (line: string, durationSec = 0): number | null => {
    const ppMatch = /progress\s*=\s*(\d{1,3})\s*%/i.exec(line);
    if (ppMatch) return clamp(Number(ppMatch[1]), 0, 100);
    if (durationSec > 0 && Number.isFinite(durationSec)) {
        const tsMatch = /-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/.exec(line);
        if (tsMatch) {
            const endSec = Number(tsMatch[1]) * 3600 + Number(tsMatch[2]) * 60 + Number(tsMatch[3]) + Number(tsMatch[4]) / 1000;
            if (Number.isFinite(endSec) && endSec >= 0) return clamp(Math.round((endSec / durationSec) * 100), 0, 99);
        }
    }
    return null;
};

interface SpawnExecOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
}

const createLineSplitter = (onLine: (line: string) => void, splitRe: RegExp, skipEmpty: boolean) => {
    let buf = "";
    return {
        push(chunk: string) {
            buf += chunk;
            const lines = buf.split(splitRe);
            buf = lines.pop() ?? "";
            if (buf.length > MAX_LINE_BUF_CHARS) buf = buf.slice(-4096);
            for (const line of lines) if (!skipEmpty || line.trim()) onLine(line);
        },
        flush() {
            if (buf && (!skipEmpty || buf.trim())) onLine(buf);
            buf = "";
        },
    };
};

/** Spawns a native media CLI (`ffmpeg`, `ffprobe`, `whisper-cli`) with timeout and AbortSignal cleanup. */
export const spawnExec = (
    bin: string,
    args: string[],
    options: SpawnExecOptions = {}
): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
        if (options.signal?.aborted) { reject(new Error(`${bin} aborted`)); return; }

        const child = spawn(bin, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        let stdout = "";
        let stderr = "";
        let settled = false;

        const cleanup = () => {
            if (timer) clearTimeout(timer);
            options.signal?.removeEventListener("abort", onAbort);
        };

        const killChild = (reason: string) => {
            if (settled) return;
            settled = true;
            cleanup();
            try { child.kill("SIGTERM"); } catch { /* exited */ }
            const forceKill = setTimeout(() => {
                try { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); } catch { /* exited */ }
            }, 3000);
            forceKill.unref();
            child.once("exit", () => clearTimeout(forceKill));
            reject(new Error(reason));
        };

        const onAbort = () => killChild(`${bin} aborted by client`);
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const timer = options.timeoutMs !== undefined && options.timeoutMs > 0
            ? setTimeout(() => killChild(`${bin} timed out after ${Math.round(options.timeoutMs! / 1000)}s`), options.timeoutMs)
            : null;

        const outSplitter = options.onStdoutLine ? createLineSplitter(options.onStdoutLine, /\r?\n/, false) : null;
        const errSplitter = options.onStderrLine ? createLineSplitter(options.onStderrLine, /[\r\n]+/, true) : null;

        child.stdout.on("data", (text: string) => {
            if (outSplitter) outSplitter.push(text);
            else stdout += text;
        });
        child.stderr.on("data", (text: string) => {
            stderr = (stderr + text).slice(-4096);
            errSplitter?.push(text);
        });
        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(err);
        });
        child.on("close", (code) => {
            if (settled) return;
            settled = true;
            cleanup();
            outSplitter?.flush();
            errSplitter?.flush();
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || `${bin} exited with code ${code}`));
        });
    });

/** Non-blocking existence check (supports both files and directories like `tools/fonts`). */
export const fileExists = async (filePath: string): Promise<boolean> => {
    try { await fs.promises.access(filePath, fs.constants.F_OK); return true; } catch { return false; }
};

/** Resolves a `/api/video/ingest?id=media-*.mp4` URL to a verified on-disk cache path. */
export const resolveCachedVideoPath = async (rawUrl?: string): Promise<string | null> => {
    if (!rawUrl) return null;
    try {
        const id = new URL(rawUrl, "http://localhost").searchParams.get("id") || "";
        if (!SAFE_MEDIA_ID_RE.test(id)) return null;
        const full = path.join(CACHE_DIR, path.basename(id));
        const st = await fs.promises.stat(full).catch(() => null);
        return st?.isFile() ? full : null;
    } catch {
        return null;
    }
};

/** Cancellation-safe Web ReadableStream around `fs.createReadStream` with optional post-stream unlink. */
export const createFileWebStream = (
    filePath: string,
    options: { start?: number; end?: number; unlinkOnClose?: boolean } = {}
): ReadableStream<Uint8Array> => {
    let nodeStream: fs.ReadStream | null = null;
    let closed = false;
    let unlinked = false;
    const cleanupFile = () => {
        if (options.unlinkOnClose && !unlinked) {
            unlinked = true;
            void fs.promises.unlink(filePath).catch(() => {});
        }
    };

    return new ReadableStream<Uint8Array>({
        start(controller) {
            try {
                const streamOpts = options.start !== undefined && options.end !== undefined
                    ? { start: options.start, end: options.end, highWaterMark: 256 * 1024 }
                    : { highWaterMark: 256 * 1024 };
                nodeStream = fs.createReadStream(filePath, streamOpts);
                nodeStream.once("close", cleanupFile);
                nodeStream.on("data", (chunk: Buffer | string) => {
                    if (closed) return;
                    try {
                        const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
                        controller.enqueue(bytes);
                        if ((controller.desiredSize ?? 0) <= 0) nodeStream?.pause();
                    } catch {
                        closed = true;
                        nodeStream?.destroy();
                    }
                });
                nodeStream.once("end", () => { if (!closed) { closed = true; try { controller.close(); } catch { /* closed */ } } });
                nodeStream.once("error", (err) => { if (!closed) { closed = true; try { controller.error(err); } catch { /* errored */ } } });
            } catch (err) {
                closed = true;
                cleanupFile();
                throw err;
            }
        },
        pull() { if (!closed) nodeStream?.resume(); },
        cancel() {
            closed = true;
            if (nodeStream) { nodeStream.destroy(); nodeStream = null; }
            else cleanupFile();
        },
    });
};

interface ProbedMediaFile {
    durationSec: number;
    startTime: number;
    hasAudio: boolean;
    copyAudio: boolean;
    mediaInfo: SourceMediaInfo;
}

/** Canonical single-pass `ffprobe` media inspector shared by ingest, export, and transcribe routes. */
export const probeMediaFile = async (
    filePath: string,
    options: { fileSize?: number; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ProbedMediaFile> => {
    const fallbackMedia: SourceMediaInfo = {
        width: 1920, height: 1080, exactFps: 30, nominalFps: 30, hasAudio: false, isHdr: false,
        fileSize: options.fileSize && options.fileSize > 0 ? options.fileSize : undefined,
    };
    try {
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error", "-show_entries",
            "format=duration,start_time,bit_rate,size:stream=codec_type,codec_name,width,height,pix_fmt,color_transfer,bit_rate,initial_padding,r_frame_rate,avg_frame_rate,sample_rate,channels,start_time:stream_disposition=attached_pic:stream_tags=rotate:stream_side_data=rotation",
            "-of", "json", filePath,
        ], { signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000 });
        const parsed = JSON.parse(stdout) as {
            format?: { duration?: string; start_time?: string; bit_rate?: string; size?: string };
            streams?: {
                codec_type?: string; codec_name?: string; width?: number; height?: number;
                pix_fmt?: string; color_transfer?: string; bit_rate?: string; initial_padding?: number;
                r_frame_rate?: string; avg_frame_rate?: string; sample_rate?: string; channels?: number;
                start_time?: string; disposition?: { attached_pic?: number };
                tags?: { rotate?: string }; side_data_list?: { rotation?: number | string }[];
            }[];
        };

        const durationSec = Math.max(0, toFiniteNumber(parsed.format?.duration));
        const startTime = toFiniteNumber(parsed.format?.start_time);
        const videoStream = parsed.streams?.find((s) => s.codec_type === "video" && s.disposition?.attached_pic !== 1)
            ?? parsed.streams?.find((s) => s.codec_type === "video");
        const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
        const hasAudio = Boolean(audioStream);
        const streamStartDeltaSec = hasAudio
            ? Math.round((toFiniteNumber(audioStream?.start_time) - toFiniteNumber(videoStream?.start_time)) * 10000) / 10000
            : 0;
        const { exactFps, nominalFps } = parseVideoFrameRate(videoStream?.avg_frame_rate, videoStream?.r_frame_rate);

        const codedW = toPositiveInt(videoStream?.width) ?? 1920;
        const codedH = toPositiveInt(videoStream?.height) ?? 1080;
        const sideRot = videoStream?.side_data_list?.find((sd) => sd.rotation !== undefined)?.rotation;
        const rawRot = toFiniteNumber(sideRot ?? videoStream?.tags?.rotate);
        const isQuarterTurn = Math.abs(Math.round(rawRot)) % 180 === 90;
        const colorTransfer = (videoStream?.color_transfer || "").toLowerCase() || undefined;
        const isHdr = colorTransfer === "arib-std-b67" || colorTransfer === "smpte2084";

        const formatBitrate = toPositiveInt(parsed.format?.bit_rate);
        const audioBitrate = toPositiveInt(audioStream?.bit_rate);
        const videoBitrate = toPositiveInt(videoStream?.bit_rate)
            ?? (formatBitrate && audioBitrate && formatBitrate > audioBitrate ? formatBitrate - audioBitrate : formatBitrate);

        const mediaInfo: SourceMediaInfo = {
            width: isQuarterTurn ? codedH : codedW,
            height: isQuarterTurn ? codedW : codedH,
            exactFps, nominalFps,
            videoCodec: videoStream?.codec_name,
            audioCodec: audioStream?.codec_name,
            hasAudio, videoBitrate, audioBitrate,
            pixFmt: videoStream?.pix_fmt,
            colorTransfer, isHdr,
            audioSampleRate: toPositiveInt(audioStream?.sample_rate),
            audioChannels: toPositiveInt(audioStream?.channels),
            audioDelaySec: Math.abs(streamStartDeltaSec) > 0.005 ? streamStartDeltaSec : undefined,
            fileSize: toPositiveInt(parsed.format?.size) ?? (options.fileSize && options.fileSize > 0 ? options.fileSize : undefined),
        };

        const initialPadding = toFiniteNumber(audioStream?.initial_padding);
        const copyAudio = startTime < -0.05 || Math.abs(streamStartDeltaSec) > 0.03
            ? false
            : (!audioStream || (audioStream.codec_name === "aac" && initialPadding <= 2048));

        return { durationSec, startTime, hasAudio, copyAudio, mediaInfo };
    } catch (err) {
        if (options.signal?.aborted) throw err;
        return { durationSec: 0, startTime: 0, hasAudio: false, copyAudio: false, mediaInfo: fallbackMedia };
    }
};

/** Enforces a hard streaming byte ceiling even when an upstream response omits Content-Length. */
export const createByteLimitTransform = (maxBytes: number): TransformStream<Uint8Array, Uint8Array> => {
    let seen = 0;
    return new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
            seen += chunk.byteLength;
            if (seen > maxBytes) { controller.error(new Error(`Asset exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`)); return; }
            controller.enqueue(chunk);
        },
    });
};
