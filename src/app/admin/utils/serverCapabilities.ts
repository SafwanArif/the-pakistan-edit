let serverIngestPromise: Promise<boolean> | null = null;

/**
 * Session-cached probe against `/api/health` so serverless deployments (e.g. Vercel)
 * skip doomed multi-megabyte `POST /api/video/ingest` uploads and load `blob:` streams immediately.
 * Transient network/5xx errors clear the cache so the next upload re-probes cleanly (`P135`).
 */
export const canUseServerIngest = (): Promise<boolean> => {
    if (serverIngestPromise) return serverIngestPromise;
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
        ? AbortSignal.timeout(4000)
        : undefined;
    serverIngestPromise = fetch("/api/health", { cache: "no-store", signal })
        .then(async (res) => {
            if (!res.ok) { serverIngestPromise = null; return true; }
            const data = (await res.json()) as { capabilities?: { localIngest?: boolean } };
            return data.capabilities?.localIngest !== false;
        })
        .catch(() => { serverIngestPromise = null; return true; });
    return serverIngestPromise;
};

/** Best-effort local disk cache cleanup when a user removes or resets a studio video. */
export const deleteServerCachedVideo = (videoUrl?: string): void => {
    if (!videoUrl?.startsWith("/api/video/ingest")) return;
    try {
        const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
        const id = new URL(videoUrl, origin).searchParams.get("id");
        if (!id) return;
        void fetch(`/api/video/ingest?id=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => {});
    } catch { /* ignore malformed URLs */ }
};
