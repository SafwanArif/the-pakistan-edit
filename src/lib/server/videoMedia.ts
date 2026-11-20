import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "tpe-videos");
export const SAFE_MEDIA_ID_RE = /^media-[a-zA-Z0-9_-]+\.mp4$/;
const STALE_EXPORT_TEMP_RE = /^(exp|subs|filter|export|audio|raw)-/;
let lastSweepAt = 0;

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
            } catch {}
        }));
    } catch {}
};

let exportQueueTail: Promise<void> = Promise.resolve();

/** Serializes heavy FFmpeg master renders (concurrency = 1) while honouring AbortSignal while queued. */
export const withExportSlot = async <T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> => {
    if (signal?.aborted) throw new Error("Export aborted before starting");
    const prev = exportQueueTail;
    let release!: () => void;
    exportQueueTail = new Promise<void>((resolve) => { release = resolve; });
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
        return await task();
    } finally {
        release();
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
}

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
            try { child.kill("SIGTERM"); } catch {}
            const forceKill = setTimeout(() => {
                try { if (child.exitCode === null && !child.killed) child.kill("SIGKILL"); } catch {}
            }, 3000);
            forceKill.unref();
            reject(new Error(reason));
        };

        const onAbort = () => killChild(`${bin} aborted by client`);
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const timer = options.timeoutMs
            ? setTimeout(() => killChild(`${bin} timed out after ${Math.round(options.timeoutMs! / 1000)}s`), options.timeoutMs)
            : null;

        let lineBuf = "";
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
        child.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString("utf8")).slice(-4096); });
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

    const cleanupFile = () => {
        if (options.unlinkOnClose) {
            void fs.promises.unlink(filePath).catch(() => {});
        }
    };

    return new ReadableStream<Uint8Array>({
        start(controller) {
            nodeStream = options.start !== undefined && options.end !== undefined
                ? fs.createReadStream(filePath, { start: options.start, end: options.end, highWaterMark: 256 * 1024 })
                : fs.createReadStream(filePath, { highWaterMark: 256 * 1024 });

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
                    cleanupFile();
                }
            });

            nodeStream.once("end", () => {
                if (closed) return;
                closed = true;
                try { controller.close(); } catch {}
                cleanupFile();
            });

            nodeStream.once("error", (err) => {
                if (closed) return;
                closed = true;
                try { controller.error(err); } catch {}
                cleanupFile();
            });
        },
        pull() {
            if (!closed) nodeStream?.resume();
        },
        cancel() {
            closed = true;
            nodeStream?.destroy();
            nodeStream = null;
            cleanupFile();
        },
    });
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
