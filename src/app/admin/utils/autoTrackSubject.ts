import { clamp } from "@/types/news";

interface FaceDetectorInstance {
    detect: (image: HTMLCanvasElement) => Promise<{ boundingBox: { x: number; width: number; height: number } }[]>;
}

interface WindowWithFaceDetector extends Window {
    FaceDetector?: new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorInstance;
}

/** Finds horizontal skin-saliency clusters across the frame to detect foreground speaker presence. */
const hasSkinSaliencyCluster = (ctx: CanvasRenderingContext2D, w: number, h: number): boolean => {
    const data = ctx.getImageData(0, 0, w, h).data;
    const yMin = Math.floor(h * 0.1);
    const yMax = Math.floor(h * 0.78);
    const colWeights = new Float32Array(w);

    for (let y = yMin; y < yMax; y++) {
        for (let x = 0; x < w; x++) {
            const idx = (y * w + x) * 4;
            const r = data[idx]!;
            const g = data[idx + 1]!;
            const b = data[idx + 2]!;
            if (r > 95 && g > 40 && b > 20 && r > g && r > b && Math.abs(r - g) > 15) {
                colWeights[x]! += 4.0;
            }
        }
    }

    const peakThreshold = (yMax - yMin) * 0.35;
    for (let x = 2; x < w - 2; x++) {
        const val = colWeights[x]!;
        if (val > peakThreshold && val >= colWeights[x - 1]! && val >= colWeights[x + 1]!) return true;
    }
    return false;
};

const FACE_SCAN_CACHE = new Map<string, boolean>();
const MAX_FACE_SCAN_CACHE_ENTRIES = 20;

const normalizeStartSec = (sec: number): number =>
    Math.round(Math.max(0, Number.isFinite(sec) ? sec : 0) * 100) / 100;

const getFaceScanCacheKey = (videoUrl: string, hookStartSec: number) => `${videoUrl}@${normalizeStartSec(hookStartSec)}`;

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
        if (signal?.aborted || Math.abs(video.currentTime - timeSec) < 0.001) { resolve(); return; }
        const ac = new AbortController();
        const finish = () => {
            clearTimeout(timer);
            ac.abort();
            resolve();
        };
        const timer = setTimeout(finish, 1200);
        video.addEventListener("seeked", finish, { once: true, signal: ac.signal });
        signal?.addEventListener("abort", finish, { once: true, signal: ac.signal });
        video.currentTime = timeSec;
    });

/** Samples the first 0.5s of the Hook window to detect whether a human face or foreground subject appears. */
export const detectFaceInHookWindow = async (
    videoUrl: string,
    hookStartSec: number,
    signal?: AbortSignal
): Promise<boolean> => {
    if (!videoUrl || signal?.aborted) return false;
    const safeStart = normalizeStartSec(hookStartSec);
    const cacheKey = getFaceScanCacheKey(videoUrl, safeStart);
    const cached = FACE_SCAN_CACHE.get(cacheKey);
    if (cached !== undefined) return cached;

    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted = true;
    video.playsInline = true;
    // `auto` ensures `loadeddata` fires reliably across Safari & mobile Chrome (`P150`)
    video.preload = "auto";
    video.src = videoUrl;

    try {
        await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) { reject(new DOMException("Scan aborted", "AbortError")); return; }
            if (video.readyState >= 2) { resolve(); return; }
            const ac = new AbortController();
            const settle = (err?: Error) => {
                clearTimeout(timer);
                ac.abort();
                if (err) reject(err);
                else resolve();
            };
            const timer = setTimeout(() => settle(new Error("Video load timed out")), 6000);
            video.addEventListener("loadeddata", () => settle(), { once: true, signal: ac.signal });
            video.addEventListener("error", () => settle(new Error("Video load failed")), { once: true, signal: ac.signal });
            signal?.addEventListener("abort", () => settle(new DOMException("Scan aborted", "AbortError")), { once: true, signal: ac.signal });
        });

        if (signal?.aborted || !video.videoWidth || !video.videoHeight) return false;
        const w = 160;
        const h = Math.max(90, Math.round((video.videoHeight / video.videoWidth) * w));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return false;

        let detector: FaceDetectorInstance | null = null;
        const FaceDetCtor = (window as WindowWithFaceDetector).FaceDetector;
        if (FaceDetCtor) {
            try { detector = new FaceDetCtor({ fastMode: true, maxDetectedFaces: 3 }); }
            catch { detector = null; }
        }
        const vDur = Number.isFinite(video.duration) && video.duration > 0 ? Math.max(0.5, video.duration) : 10;

        for (const offset of [0.05, 0.45]) {
            if (signal?.aborted) return false;
            const t = clamp(safeStart + offset, 0, Math.max(0, vDur - 0.05));
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
                } catch { /* fall through to skin saliency */ }
            }
            if (hasSkinSaliencyCluster(ctx, w, h)) {
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
        video.removeAttribute("src");
        video.load();
    }
};
