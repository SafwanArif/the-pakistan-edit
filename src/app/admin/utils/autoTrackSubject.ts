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

const seekVideoFrame = (video: HTMLVideoElement, timeSec: number): Promise<void> =>
    new Promise((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            video.removeEventListener('seeked', finish);
            resolve();
        };
        const timer = setTimeout(finish, 1200);
        video.addEventListener('seeked', finish, { once: true });
        video.currentTime = timeSec;
    });

/** Samples the first 0.5s of the Hook window to detect whether a human face or foreground subject appears. */
export const detectFaceInHookWindow = async (videoUrl: string, hookStartSec: number): Promise<boolean> => {
    if (!videoUrl) return false;
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    try {
        await new Promise<void>((resolve, reject) => {
            if (video.readyState >= 2) { resolve(); return; }
            let settled = false;
            const cleanup = () => {
                clearTimeout(timer);
                video.removeEventListener('loadeddata', onReady);
                video.removeEventListener('error', onErr);
            };
            const onReady = () => { if (!settled) { settled = true; cleanup(); resolve(); } };
            const onErr = () => { if (!settled) { settled = true; cleanup(); reject(new Error('Video load failed')); } };
            const timer = setTimeout(onErr, 6000);
            video.addEventListener('loadeddata', onReady);
            video.addEventListener('error', onErr);
        });

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
            const t = Math.min(vDur - 0.05, Math.max(0, hookStartSec + offset));
            await seekVideoFrame(video, t);
            ctx.drawImage(video, 0, 0, w, h);
            if (detector) {
                try {
                    const faces = await detector.detect(canvas);
                    if (faces.length > 0) return true;
                } catch { /* fallback below */ }
            }
            const { clusterXs } = estimateSubjectClusters(ctx, w, h);
            if (clusterXs.length > 0) return true;
        }
        return false;
    } catch {
        return false;
    } finally {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
};
