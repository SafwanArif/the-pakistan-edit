import { useRef, useEffect, useCallback } from "react";
import type { VideoDraft } from "../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";

const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
const flippedCtxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();

const get2dCtx = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!canvas) return null;
    const cached = ctxCache.get(canvas);
    if (cached) return cached;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) ctxCache.set(canvas, ctx);
    return ctx;
};

/** Returns a cached 2D context pre-configured with a permanent vertical mirror transform (avoids per-frame save/restore). */
const getFlipped2dCtx = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!canvas) return null;
    const cached = flippedCtxCache.get(canvas);
    if (cached) return cached;
    const ctx = get2dCtx(canvas);
    if (ctx) {
        ctx.setTransform(1, 0, 0, -1, 0, canvas.height);
        flippedCtxCache.set(canvas, ctx);
    }
    return ctx;
};

interface UseAmbientCanvasPainterOptions {
    draft: VideoDraft;
    videoSrc: string;
    overlayOnly: boolean;
    ambientBlurActive: boolean;
    ambientCrop: AmbientCropRect;
    ambientVisibility: AmbientVisibilityState;
    draftRef: React.RefObject<VideoDraft>;
    isPlayingRef: React.RefObject<boolean>;
    isScrubbingRef: React.RefObject<boolean>;
    isCameraGlidingRef: React.RefObject<boolean>;
    isHeavyVideo?: boolean;
    getActiveVideo: () => HTMLVideoElement | null;
}

/**
 * Manages the 6 GPU-accelerated 384×180 4:5 ambient blur `<canvas>` elements with cached 2D contexts
 * and Hierarchical Temporal Rate Shading (`1/1` near, `1/2` mid, `1/3` far) plus instant `0% Energy` bypass.
 */
export const useAmbientCanvasPainter = ({
    draft,
    videoSrc,
    overlayOnly,
    ambientBlurActive,
    ambientCrop,
    ambientVisibility,
    draftRef,
    isPlayingRef,
    isScrubbingRef,
    isCameraGlidingRef,
    isHeavyVideo = false,
    getActiveVideo,
}: UseAmbientCanvasPainterOptions) => {
    const ambientCanvasRef = useRef<HTMLCanvasElement>(null);
    const midEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const nearEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const topAmbientCanvasRef = useRef<HTMLCanvasElement>(null);
    const topMidEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const topNearEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const lastAmbientPaintRef = useRef(0);
    const ambientTickCountRef = useRef(0);
    const lastPaintedVideoTimeRef = useRef(-1);
    const prevBlurActiveRef = useRef(ambientBlurActive);
    const ambientBlurActiveRef = useRef(ambientBlurActive);
    const isHeavyVideoRef = useRef(isHeavyVideo);
    const ambientCropRef = useRef<AmbientCropRect>(ambientCrop);
    const ambientVisibilityRef = useRef<AmbientVisibilityState>(ambientVisibility);

    useEffect(() => {
        ambientBlurActiveRef.current = ambientBlurActive;
        isHeavyVideoRef.current = isHeavyVideo;
    }, [ambientBlurActive, isHeavyVideo]);

    // Clear ambient reflection canvases immediately whenever the video source is cleared or replaced
    useEffect(() => {
        if (!ambientBlurActive) return;
        for (const c of [
            ambientCanvasRef.current, midEdgeCanvasRef.current, nearEdgeCanvasRef.current,
            topAmbientCanvasRef.current, topMidEdgeCanvasRef.current, topNearEdgeCanvasRef.current,
        ]) {
            const ctx = get2dCtx(c);
            if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
    }, [videoSrc, ambientBlurActive]);

    const paintAmbientCanvas = useCallback((video: HTMLVideoElement, force = false) => {
        if (overlayOnly || !ambientBlurActiveRef.current || draftRef.current.enableAmbientBlur === false || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const { topVisible, botVisible } = ambientVisibilityRef.current;
        if (!topVisible && !botVisible) return;
        const doTop = topVisible;
        const doBot = botVisible;
        if (!force && Math.abs(video.currentTime - lastPaintedVideoTimeRef.current) < 0.001) return;
        const now = performance.now();
        const minInterval = isHeavyVideoRef.current ? 120 : (isCameraGlidingRef.current ? 80 : 48);
        if (!force && now - lastAmbientPaintRef.current < minInterval) return;
        lastAmbientPaintRef.current = now;
        lastPaintedVideoTimeRef.current = video.currentTime;
        const tick = ++ambientTickCountRef.current;
        const paintMid = force || (tick % 2 === 0);
        const paintFar = force || (tick % 4 === 0);

        try {
            const vw = video.videoWidth;
            const vh = video.videoHeight;
            const { xFrac, wFrac, yFrac, hFrac } = ambientCropRef.current;
            const sx = Math.max(0, Math.min(vw - 1, vw * xFrac));
            const sw = Math.max(1, Math.min(vw - sx, vw * wFrac));
            const visY = Math.max(0, vh * yFrac);
            const visH = Math.max(1, Math.min(vh - visY, vh * hFrac));

            if (doBot) {
                const nearCanvas = nearEdgeCanvasRef.current;
                const nearCtx = getFlipped2dCtx(nearCanvas);
                if (nearCanvas && nearCtx) {
                    const botSrcY = visY + visH * 0.55;
                    const botSrcH = Math.max(1, visY + visH - botSrcY);
                    nearCtx.drawImage(video, sx, botSrcY, sw, botSrcH, 0, 0, nearCanvas.width, nearCanvas.height);

                    if (paintMid) {
                        const midCtx = get2dCtx(midEdgeCanvasRef.current);
                        if (midCtx) midCtx.drawImage(nearCanvas, 0, 0);
                    }
                    if (paintFar) {
                        const farCtx = get2dCtx(ambientCanvasRef.current);
                        if (farCtx) farCtx.drawImage(nearCanvas, 0, 0);
                    }
                }
            }
            if (doTop) {
                const topNearCanvas = topNearEdgeCanvasRef.current;
                const topNearCtx = getFlipped2dCtx(topNearCanvas);
                if (topNearCanvas && topNearCtx) {
                    const topSrcH = Math.max(1, visH * 0.45);
                    topNearCtx.drawImage(video, sx, visY, sw, topSrcH, 0, 0, topNearCanvas.width, topNearCanvas.height);

                    if (paintMid) {
                        const topMidCtx = get2dCtx(topMidEdgeCanvasRef.current);
                        if (topMidCtx) topMidCtx.drawImage(topNearCanvas, 0, 0);
                    }
                    if (paintFar) {
                        const topFarCtx = get2dCtx(topAmbientCanvasRef.current);
                        if (topFarCtx) topFarCtx.drawImage(topNearCanvas, 0, 0);
                    }
                }
            }
        } catch { /* ignore cross-origin canvas taint */ }
    }, [overlayOnly, draftRef, isCameraGlidingRef]);

    // Repaint ambient canvases immediately whenever zoom, pan, posY, or blur toggle changes while paused/scrubbing or toggled
    useEffect(() => {
        const prevActive = prevBlurActiveRef.current;
        prevBlurActiveRef.current = ambientBlurActive;
        if (!ambientBlurActive) return;
        if (!ambientVisibility.topVisible && !ambientVisibility.botVisible) return;
        if (isPlayingRef.current && !isScrubbingRef.current && prevActive === ambientBlurActive) return;
        if (!isPlayingRef.current || isScrubbingRef.current) {
            ambientCropRef.current = ambientCrop;
            ambientVisibilityRef.current = ambientVisibility;
        }
        const video = getActiveVideo();
        if (video) paintAmbientCanvas(video, true);
    }, [ambientBlurActive, ambientCrop, ambientVisibility, draft.zoom, draft.posX, draft.posY, draft.defaultFramingByRatio, draft.aspectRatio, draft.enableAmbientBlur, isPlayingRef, isScrubbingRef, getActiveVideo, paintAmbientCanvas]);

    return {
        ambientCropRef,
        ambientVisibilityRef,
        ambientCanvasRef,
        midEdgeCanvasRef,
        nearEdgeCanvasRef,
        topAmbientCanvasRef,
        topMidEdgeCanvasRef,
        topNearEdgeCanvasRef,
        paintAmbientCanvas,
    };
};
