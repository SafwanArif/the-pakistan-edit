import { spawn } from "child_process";
import fs from "fs";
import path from "path";

export const CACHE_DIR = path.join(process.cwd(), ".next", "cache", "tpe-videos");
export const SAFE_MEDIA_ID_RE = /^media-[a-zA-Z0-9_-]+\.mp4$/;

interface SpawnExecOptions {
    signal?: AbortSignal;
    timeoutMs?: number;
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
            reject(new Error(reason));
        };

        const onAbort = () => killChild(`${bin} aborted by client`);
        options.signal?.addEventListener("abort", onAbort, { once: true });

        const timer = options.timeoutMs
            ? setTimeout(() => killChild(`${bin} timed out after ${Math.round(options.timeoutMs! / 1000)}s`), options.timeoutMs)
            : null;

        child.stdout.on("data", (c: Buffer) => { stdout += c.toString("utf8"); });
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
                ? fs.createReadStream(filePath, { start: options.start, end: options.end })
                : fs.createReadStream(filePath);

            nodeStream.on("data", (chunk: Buffer | string) => {
                if (closed) return;
                try {
                    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
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
