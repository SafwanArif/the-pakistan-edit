interface FaceDetectorInstance {
    detect: (image: HTMLCanvasElement) => Promise<{ boundingBox: { x: number; width: number; height: number } }[]>;
}

/** Finds up to N horizontal skin-saliency clusters across the frame to estimate speaker positions & count. */
const estimateSubjectClusters = (ctx: CanvasRenderingContext2D, w: number, h: number): { primaryX: number; clusterXs: number[] } => {
    const data = ctx.getImageData(0, 0, w, h).data;
    const yMin = Math.floor(h * 0.1);
    const yMax = Math.floor(h * 0.78);
    const colWeights = new Float32Array(w);
    let weightedX = 0;
    let totalWeight = 0;

    for (let y = yMin; y < yMax; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = data[idx]!;
            const g = data[idx + 1]!;
            const b = data[idx + 2]!;
            const isSkin = r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15;
            const luma = 0.299 * r + 0.587 * g + 0.114 * b;
            const weight = isSkin ? 4.0 : (luma > 45 && luma < 235 ? 0.35 : 0.05);
            if (isSkin) colWeights[x] = (colWeights[x] ?? 0) + 4.0;
            weightedX += (x / w) * 100 * weight;
            totalWeight += weight;
        }
    }

    const primaryX = totalWeight > 0 ? Math.max(15, Math.min(85, Math.round(weightedX / totalWeight))) : 50;
    const peakThreshold = (yMax - yMin) * 0.35;
    const clusterXs: number[] = [];
    for (let x = 2; x < w - 2; x++) {
        const val = colWeights[x]!;
        if (val > peakThreshold && val >= colWeights[x - 1]! && val >= colWeights[x + 1]!) {
            const pct = Math.round((x / w) * 100);
            if (clusterXs.length === 0 || pct - clusterXs[clusterXs.length - 1]! >= 10) clusterXs.push(pct);
        }
    }
    return { primaryX, clusterXs };
};

const FACE_SCAN_CACHE = new Map<string, boolean>();
const MAX_FACE_SCAN_CACHE_ENTRIES = 20;

const getFaceScanCacheKey = (videoUrl: string, hookStartSec: number) => `${videoUrl}@${hookStartSec}`;

const setCachedFaceScan = (key: string, detected: boolean) => {
    if (FACE_SCAN_CACHE.has(key)) FACE_SCAN_CACHE.delete(key);
    FACE_SCAN_CACHE.set(key, detected);
    if (FACE_SCAN_CACHE.size > MAX_FACE_SCAN_CACHE_ENTRIES) {
        const oldestKey = FACE_SCAN_CACHE.keys().next().value;
        if (oldestKey !== undefined) FACE_SCAN_CACHE.delete(oldestKey);
    }
};

/** Returns a previously cached hook-window face-scan result for instant checklist opens. */
export const getCachedFaceScan = (videoUrl: string, hookStartSec: number): boolean | undefined =>
    videoUrl ? FACE_SCAN_CACHE.get(getFaceScanCacheKey(videoUrl, hookStartSec)) : undefined;

const seekVideoFrame = (video: HTMLVideoElement, timeSec: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve) => {
        if (signal?.aborted) { resolve(); return; }
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener('seeked', finish);
            signal?.removeEventListener('abort', finish);
            resolve();
        };
        const timer = setTimeout(finish, 1200);
        video.addEventListener('seeked', finish, { once: true });
        signal?.addEventListener('abort', finish, { once: true });
        video.currentTime = timeSec;
    });

/** Samples the first 0.5s of the Hook window to detect whether a human face or foreground subject appears. */
export const detectFaceInHookWindow = async (
    videoUrl: string,
    hookStartSec: number,
    signal?: AbortSignal
): Promise<boolean> => {
    if (!videoUrl || signal?.aborted) return false;
    const cacheKey = getFaceScanCacheKey(videoUrl, hookStartSec);
    const cached = FACE_SCAN_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    video.src = videoUrl;

    try {
        await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) { reject(new Error('Scan aborted')); return; }
            if (video.readyState >= 2) { resolve(); return; }
            let settled = false;
            const cleanup = () => {
                clearTimeout(timer);
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('error', onErr);
                signal?.removeEventListener('abort', onAbort);
            };
            const onReady = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
            const onErr = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Video load failed')); } };
            const onAbort = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Scan aborted')); } };
            const timer = setTimeout(onErr, 6000);
            video.addEventListener('loadeddata', onReady);
            video.addEventListener('error', onErr);
            signal?.addEventListener('abort', onAbort, { once: true });
        });

        if (signal?.aborted) return false;
        const w = 160;
        const h = Math.max(90, Math.round((video.videoHeight / Math.max(1, video.videoWidth)) * w));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return false;

        const FaceDetCtor = (window as unknown as { FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorInstance }).FaceDetector;
        const detector = FaceDetCtor ? new FaceDetCtor({ fastMode: true, maxDetectedFaces: 3 }) : null;
        const vDur = Math.max(0.5, video.duration || 1);

        for (const offset of [0.05, 0.45]) {
            if (signal?.aborted) return false;
            const t = Math.min(vDur - 0.05, Math.max(0, hookStartSec + offset));
            await seekVideoFrame(video, t, signal);
            if (signal?.aborted) return false;
            ctx.drawImage(video, 0, 0, w, h);
            if (detector) {
                try {
                    const faces = await detector.detect(canvas);
                    if (signal?.aborted) return false;
                    if (faces.length > 0) {
                        setCachedFaceScan(cacheKey, true);
                        return true;
                    }
                } catch { /* fallback below */ }
            }
            const { clusterXs } = estimateSubjectClusters(ctx, w, h);
            if (clusterXs.length > 0) {
                setCachedFaceScan(cacheKey, true);
                return true;
            }
        }
        if (signal?.aborted) return false;
        setCachedFaceScan(cacheKey, false);
        return false;
    } catch {
        return false;
    } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
};
