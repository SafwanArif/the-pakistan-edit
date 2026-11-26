import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import type { SourceMediaInfo } from "@/types/news";

export const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "tpe-videos");
export const SAFE_MEDIA_ID_RE = /^media-[a-zA-Z0-9_-]+\.mp4$/;
const STALE_EXPORT_TEMP_RE = /^(exp|subs|filter|export|audio|raw)-/;
let lastSweepAt = 0;

/** Returns a safe multi-core worker thread count leaving 2 threads free for UI & OS responsiveness. */
export const getWorkerThreadCount = (): string => String(Math.max(2, os.cpus().length - 2));

/** Creates a cancellation-safe NDJSON streaming Response that propagates both `request.signal` and `ReadableStream.cancel()`. */
export const createNdjsonResponse = (
    requestSignal: AbortSignal | undefined,
    run: (send: (payload: Record<string, unknown>) => void, signal: AbortSignal) => Promise<void>
): Response => {
    const enc = new TextEncoder();
    const abortController = new AbortController();
    const onRequestAbort = () => abortController.abort();
    if (requestSignal) {
        if (requestSignal.aborted) abortController.abort();
        else requestSignal.addEventListener("abort", onRequestAbort, { once: true });
    }
    const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
            const send = (payload: Record<string, unknown>) => {
                if (abortController.signal.aborted) return;
                try {
                    controller.enqueue(enc.encode(`${JSON.stringify(payload)}\n`));
                } catch { /* stream already closed by client */ }
            };
            try {
                await run(send, abortController.signal);
            } finally {
                requestSignal?.removeEventListener("abort", onRequestAbort);
                try { controller.close(); } catch { /* stream already closed */ }
            }
        },
        cancel() {
            abortController.abort();
            requestSignal?.removeEventListener("abort", onRequestAbort);
        },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
};

/** Parses an `ffprobe` fractional rate string (e.g. `30000/1001`) into a positive number or null. */
const parseProbeRatio = (rate?: string): number | null => {
    if (!rate) return null;
    const [numStr, denStr] = rate.split("/");
    const num = Number(numStr);
    const den = denStr ? Number(denStr) : 1;
    if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0 || num <= 0) return null;
    return num / den;
};

/** Resolves exact and nominal broadcast FPS from `avg_frame_rate` / `r_frame_rate` with `> 125` timebase protection. */
export const parseVideoFrameRate = (avgRate?: string, rRate?: string): { exactFps: number; nominalFps: number } => {
    const avg = parseProbeRatio(avgRate);
    const r = parseProbeRatio(rRate);
    const exactFps = (avg && avg <= 125) ? avg : ((r && r <= 125) ? r : 30);
    let nominalFps: number;
    if (Math.abs(exactFps - 23.976) < 0.1 || Math.abs(exactFps - 24) < 0.1) nominalFps = 24;
    else if (Math.abs(exactFps - 29.97) < 0.1 || Math.abs(exactFps - 30) < 0.1) nominalFps = 30;
    else if (Math.abs(exactFps - 59.94) < 0.1 || Math.abs(exactFps - 60) < 0.1) nominalFps = 60;
    else nominalFps = Math.min(120, Math.max(24, Math.round(exactFps)));
    return { exactFps: Math.round(exactFps * 1000) / 1000, nominalFps };
};

/**
 * Classifies sorted frame PTS values as CFR vs VFR using a 2ms tolerance around the median frame interval,
 * avoiding false VFR flags from standard 29.97fps / 23.976fps container timebase rounding.
 */
export const classifyFrameTimestamps = (frameTimes: number[]): { cfr: boolean; medianInterval: number } => {
    if (frameTimes.length < 3) {
        const dt = frameTimes.length === 2 ? Math.max(0.001, frameTimes[1]! - frameTimes[0]!) : 1 / 30;
        return { cfr: true, medianInterval: dt };
    }
    const intervals: number[] = [];
    for (let i = 1; i < frameTimes.length; i++) {
        const dt = frameTimes[i]! - frameTimes[i - 1]!;
        if (dt > 0) intervals.push(dt);
    }
    if (intervals.length === 0) return { cfr: true, medianInterval: 1 / 30 };
    const sorted = [...intervals].sort((a, b) => a - b);
    const medianInterval = sorted[sorted.length >> 1]!;
    const toleranceSec = 0.002;
    let outliers = 0;
    for (let i = 0; i < intervals.length; i++) {
        if (Math.abs(intervals[i]! - medianInterval) > toleranceSec) outliers++;
    }
    // Allow at most 1 boundary frame outlier (e.g. truncated final frame) while keeping genuine VFR flagged
    const cfr = outliers <= Math.min(1, Math.floor(intervals.length * 0.01));
    return { cfr, medianInterval };
};

/**
 * Computes an H.264 Level 4.2 VBV ceiling (`maxrate` / `bufsize` in kbps) paired with `crf 14` so crisp burned-in
 * headlines/logos never suffer low-bitrate mosquito noise while respecting native source bitrates and Level 4.2 caps.
 */
export const computeExportVbvCeiling = (sourceVideoBitrateBps?: number): { maxrateKbps: number; bufsizeKbps: number } | null => {
    if (!sourceVideoBitrateBps || !Number.isFinite(sourceVideoBitrateBps) || sourceVideoBitrateBps <= 0) return null;
    const minBroadcastKbps = 16_000; // 16 Mbps floor guarantees crisp 1080p vector overlays even on low-bitrate inputs
    const level42CapKbps = 50_000;   // H.264 High@L4.2 safe ceiling
    const scaledKbps = Math.round((sourceVideoBitrateBps / 1000) * 1.5);
    const maxrateKbps = Math.min(level42CapKbps, Math.max(minBroadcastKbps, scaledKbps));
    return { maxrateKbps, bufsizeKbps: maxrateKbps * 2 };
};

/** Non-blocking TTL sweeper that removes orphaned export temp files older than `ttlMs` (never touches `media-*.mp4`). */
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
                if (now - st.mtimeMs > ttlMs) await fs.promises.unlink(full);
            } catch { /* file already removed or locked */ }
        }));
    } catch { /* cache directory not yet initialized */ }
};

let exportQueueTail: Promise<void> = Promise.resolve();

/** Serializes heavy FFmpeg master renders (concurrency = 1) while honouring AbortSignal while queued. */
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
            void prev.then(() => {
                signal?.removeEventListener("abort", onAbort);
                resolve();
            });
        });
        acquired = true;
        return await task();
    } finally {
        // Only release the tail slot after `prev` finishes so an aborted queued waiter never overlaps with the running task
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
            const freeMb = Math.round(freeBytes / (1024 * 1024));
            throw new Error(`Insufficient scratch disk space (${freeMb} MB free; need at least ${Math.round(minFreeBytes / (1024 * 1024))} MB).`);
        }
    } catch (err) {
        if (err instanceof Error && err.message.startsWith("Insufficient scratch disk space")) throw err;
    }
};

interface SpawnExecOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
    onStdoutLine?: (line: string) => void;
    onStderrLine?: (line: string) => void;
}

/** Parses live progress (0–100) from whisper.cpp `-pp` stderr lines or `[start --> end]` stdout transcript lines. */
export const parseWhisperProgressLine = (line: string, durationSec = 0): number | null => {
    const ppMatch = /progress\s*=\s*(\d{1,3})\s*%/i.exec(line);
    if (ppMatch) {
        return Math.min(100, Math.max(0, Number(ppMatch[1])));
    }
    if (durationSec > 0) {
        const tsMatch = /-->\s*(\d{2}):(\d{2}):(\d{2})[.,](\d{3})/.exec(line);
        if (tsMatch) {
            const endSec = Number(tsMatch[1]) * 3600 + Number(tsMatch[2]) * 60 + Number(tsMatch[3]) + Number(tsMatch[4]) / 1000;
            if (Number.isFinite(endSec) && endSec >= 0) {
                return Math.min(99, Math.max(0, Math.round((endSec / durationSec) * 100)));
            }
        }
    }
    return null;
};

/** Spawns a native media CLI (`ffmpeg`, `ffprobe`, `whisper-cli`) with timeout and AbortSignal cleanup. */
export const spawnExec = (
    bin: string,
    args: string[],
    options: SpawnExecOptions = {}
): Promise<{ stdout: string; stderr: string }> =>
    new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
            reject(new Error(`${bin} aborted`));
            return;
        }

        const child = spawn(bin, args, { windowsHide: true });
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
            try { child.kill("SIGTERM"); } catch { /* process already exited */ }
            const forceKill = setTimeout(() => {
                try {
                    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
                } catch { /* process already exited */ }
            }, 3000);
            forceKill.unref();
            child.once("exit", () => clearTimeout(forceKill));
            reject(new Error(reason));
        };

        const onAbort = () => killChild(`${bin} aborted by client`);
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const timer = options.timeoutMs
            ? setTimeout(() => killChild(`${bin} timed out after ${Math.round(options.timeoutMs! / 1000)}s`), options.timeoutMs)
            : null;

        let lineBuf = "";
        let errLineBuf = "";
        child.stdout.on("data", (c: Buffer) => {
            const text = c.toString("utf8");
            stdout += text;
            if (options.onStdoutLine) {
                lineBuf += text;
                const lines = lineBuf.split(/\r?\n/);
                lineBuf = lines.pop() ?? "";
                for (const line of lines) options.onStdoutLine(line);
            }
        });
        child.stderr.on("data", (c: Buffer) => {
            const text = c.toString("utf8");
            stderr = (stderr + text).slice(-4096);
            if (options.onStderrLine) {
                errLineBuf += text;
                const lines = errLineBuf.split(/[\r\n]+/);
                errLineBuf = lines.pop() ?? "";
                for (const line of lines) {
                    if (line.trim()) options.onStderrLine(line);
                }
            }
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
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(stderr.trim() || `${bin} exited with code ${code}`));
        });
    });

/** Non-blocking existence check using fs.promises.access. */
export const fileExists = async (filePath: string): Promise<boolean> => {
    try {
        await fs.promises.access(filePath, fs.constants.F_OK);
        return true;
    } catch {
        return false;
    }
};

/** Resolves a `/api/video/ingest?id=media-*.mp4` URL to a verified on-disk cache path. */
export const resolveCachedVideoPath = async (rawUrl?: string): Promise<string | null> => {
    if (!rawUrl) return null;
    try {
        const id = new URL(rawUrl, "http://localhost").searchParams.get("id") || "";
        if (!SAFE_MEDIA_ID_RE.test(id)) return null;
        const full = path.join(CACHE_DIR, path.basename(id));
        return (await fileExists(full)) ? full : null;
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
            void fs.promises.unlink(filePath).catch(() => { /* already removed */ });
        }
    };

    return new ReadableStream<Uint8Array>({
        start(controller) {
            nodeStream = options.start !== undefined && options.end !== undefined
                ? fs.createReadStream(filePath, { start: options.start, end: options.end, highWaterMark: 256 * 1024 })
                : fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });

            // Unlink strictly after the OS file descriptor closes (prevents Windows EBUSY/EPERM temp file leaks)
            nodeStream.once("close", cleanupFile);

            nodeStream.on("data", (chunk: Buffer | string) => {
                if (closed) return;
                try {
                    const bytes = typeof chunk === "string"
                        ? Buffer.from(chunk)
                        : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
                    controller.enqueue(bytes);
                    if ((controller.desiredSize ?? 0) <= 0) nodeStream?.pause();
                } catch {
                    closed = true;
                    nodeStream?.destroy();
                }
            });

            nodeStream.once("end", () => {
                if (closed) return;
                closed = true;
                try { controller.close(); } catch { /* stream already closed */ }
            });

            nodeStream.once("error", (err) => {
                if (closed) return;
                closed = true;
                try { controller.error(err); } catch { /* stream already errored */ }
            });
        },
        pull() {
            if (!closed) nodeStream?.resume();
        },
        cancel() {
            closed = true;
            if (nodeStream) {
                nodeStream.destroy();
                nodeStream = null;
            } else {
                cleanupFile();
            }
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

const toPositiveInt = (raw?: string | number): number | undefined => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : undefined;
};

/**
 * Canonical single-pass `ffprobe` media inspector shared by ingest, export, and transcribe routes.
 * Resolves post-rotation display dimensions, exact/nominal FPS, HDR transfer, bitrates, and AAC copy compatibility.
 */
export const probeMediaFile = async (
    filePath: string,
    options: { fileSize?: number; signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<ProbedMediaFile> => {
    const fallbackMedia: SourceMediaInfo = {
        width: 1920,
        height: 1080,
        exactFps: 30,
        nominalFps: 30,
        hasAudio: false,
        isHdr: false,
        fileSize: options.fileSize && options.fileSize > 0 ? options.fileSize : undefined,
    };
    try {
        const { stdout } = await spawnExec("ffprobe", [
            "-v", "error",
            "-show_entries",
            "format=duration,start_time,bit_rate,size:stream=codec_type,codec_name,width,height,pix_fmt,color_transfer,bit_rate,initial_padding,r_frame_rate,avg_frame_rate,sample_rate,channels,start_time:stream_tags=rotate:stream_side_data=rotation",
            "-of", "json",
            filePath,
        ], { signal: options.signal, timeoutMs: options.timeoutMs ?? 30_000 });
        const parsed = JSON.parse(stdout) as {
            format?: { duration?: string; start_time?: string; bit_rate?: string; size?: string };
            streams?: {
                codec_type?: string;
                codec_name?: string;
                width?: number;
                height?: number;
                pix_fmt?: string;
                color_transfer?: string;
                bit_rate?: string;
                initial_padding?: number;
                r_frame_rate?: string;
                avg_frame_rate?: string;
                sample_rate?: string;
                channels?: number;
                start_time?: string;
                tags?: { rotate?: string };
                side_data_list?: { rotation?: number | string }[];
            }[];
        };

        const durationSec = Math.max(0, Number(parsed.format?.duration ?? 0) || 0);
        const rawStartTime = Number(parsed.format?.start_time ?? 0);
        const startTime = Number.isFinite(rawStartTime) ? rawStartTime : 0;
        const videoStream = parsed.streams?.find((s) => s.codec_type === "video");
        const audioStream = parsed.streams?.find((s) => s.codec_type === "audio");
        const hasAudio = Boolean(audioStream);
        const rawVideoStart = Number(videoStream?.start_time ?? 0);
        const rawAudioStart = Number(audioStream?.start_time ?? 0);
        const videoStartTime = Number.isFinite(rawVideoStart) ? rawVideoStart : 0;
        const audioStartTime = Number.isFinite(rawAudioStart) ? rawAudioStart : 0;
        const streamStartDeltaSec = hasAudio ? Math.round((audioStartTime - videoStartTime) * 10000) / 10000 : 0;
        const { exactFps, nominalFps } = parseVideoFrameRate(videoStream?.avg_frame_rate, videoStream?.r_frame_rate);

        const codedW = videoStream?.width || 1920;
        const codedH = videoStream?.height || 1080;
        const sideRot = videoStream?.side_data_list?.find((sd) => sd.rotation !== undefined)?.rotation;
        const rawRot = Number(sideRot ?? videoStream?.tags?.rotate ?? 0);
        const isQuarterTurn = Number.isFinite(rawRot) && Math.abs(Math.round(rawRot)) % 180 === 90;
        const colorTransfer = (videoStream?.color_transfer || "").toLowerCase() || undefined;
        const isHdr = colorTransfer === "arib-std-b67" || colorTransfer === "smpte2084";

        const formatBitrate = toPositiveInt(parsed.format?.bit_rate);
        const audioBitrate = toPositiveInt(audioStream?.bit_rate);
        const videoBitrate = toPositiveInt(videoStream?.bit_rate)
            ?? (formatBitrate && audioBitrate && formatBitrate > audioBitrate ? formatBitrate - audioBitrate : formatBitrate);

        const mediaInfo: SourceMediaInfo = {
            width: isQuarterTurn ? codedH : codedW,
            height: isQuarterTurn ? codedW : codedH,
            exactFps,
            nominalFps,
            videoCodec: videoStream?.codec_name,
            audioCodec: audioStream?.codec_name,
            hasAudio,
            videoBitrate,
            audioBitrate,
            pixFmt: videoStream?.pix_fmt,
            colorTransfer,
            isHdr,
            audioSampleRate: toPositiveInt(audioStream?.sample_rate),
            audioChannels: toPositiveInt(audioStream?.channels),
            audioDelaySec: Math.abs(streamStartDeltaSec) > 0.005 ? streamStartDeltaSec : undefined,
            fileSize: toPositiveInt(parsed.format?.size) ?? (options.fileSize && options.fileSize > 0 ? options.fileSize : undefined),
        };

        const copyAudio = startTime < -0.05 || Math.abs(streamStartDeltaSec) > 0.03
            ? false
            : (!audioStream || (audioStream.codec_name === "aac" && (audioStream.initial_padding ?? 0) <= 2048));

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
            if (seen > maxBytes) {
                controller.error(new Error(`Asset exceeds ${Math.round(maxBytes / (1024 * 1024))}MB limit`));
                return;
            }
            controller.enqueue(chunk);
        },
    });
};
