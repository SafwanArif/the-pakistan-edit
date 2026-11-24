let serverIngestPromise: Promise<boolean> | null = null;

/**
 * Session-cached probe against `/api/health` so serverless deployments (e.g. Vercel)
 * skip doomed multi-megabyte `POST /api/video/ingest` uploads and load `blob:` streams immediately.
 */
export const canUseServerIngest = (): Promise<boolean> => {
    if (serverIngestPromise) return serverIngestPromise;
    serverIngestPromise = fetch("/api/health", { cache: "no-store" })
        .then(async (res) => {
            if (!res.ok) return true;
            const data = (await res.json()) as { capabilities?: { localIngest?: boolean } };
            return data.capabilities?.localIngest !== false;
        })
        .catch(() => true);
    return serverIngestPromise;
};

/** Best-effort local disk cache cleanup when a user removes or resets a studio video. */
export const deleteServerCachedVideo = (videoUrl?: string): void => {
    if (!videoUrl?.startsWith("/api/video/ingest")) return;
    try {
        const id = new URL(videoUrl, window.location.origin).searchParams.get("id");
        if (!id) return;
        void fetch(`/api/video/ingest?id=${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true }).catch(() => {});
    } catch { /* ignore malformed URLs */ }
};
