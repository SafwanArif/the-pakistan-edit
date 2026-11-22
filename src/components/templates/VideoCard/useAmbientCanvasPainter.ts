import { useRef, useEffect, useCallback } from "react";
import type { VideoDraft } from "../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";

const ctxCache = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
const get2dCtx = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
    if (!canvas) return null;
    const cached = ctxCache.get(canvas);
    if (cached) return cached;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (ctx) ctxCache.set(canvas, ctx);
    return ctx;
};

interface UseAmbientCanvasPainterOptions {
    draft: VideoDraft;
    videoSrc: string;
    overlayOnly: boolean;
    ambientCrop: AmbientCropRect;
    ambientVisibility: AmbientVisibilityState;
    draftRef: React.RefObject<VideoDraft>;
    isPlayingRef: React.RefObject<boolean>;
    isScrubbingRef: React.RefObject<boolean>;
    isCameraGlidingRef: React.RefObject<boolean>;
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
    ambientCrop,
    ambientVisibility,
    draftRef,
    isPlayingRef,
    isScrubbingRef,
    isCameraGlidingRef,
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
    const prevBlurEnabledRef = useRef(draft.enableAmbientBlur);
    const ambientCropRef = useRef<AmbientCropRect>(ambientCrop);
    const ambientVisibilityRef = useRef<AmbientVisibilityState>(ambientVisibility);

    // Clear ambient reflection canvases immediately whenever the video source is cleared or replaced
    useEffect(() => {
        for (const c of [
            ambientCanvasRef.current, midEdgeCanvasRef.current, nearEdgeCanvasRef.current,
            topAmbientCanvasRef.current, topMidEdgeCanvasRef.current, topNearEdgeCanvasRef.current,
        ]) {
            const ctx = get2dCtx(c);
            if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
    }, [videoSrc]);

    const paintAmbientCanvas = useCallback((video: HTMLVideoElement, force = false) => {
        if (overlayOnly || draftRef.current.enableAmbientBlur === false || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const { topVisible, botVisible } = ambientVisibilityRef.current;
        const doTop = topVisible || force;
        const doBot = botVisible || force;
        if (!doTop && !doBot) return;
        if (!force && Math.abs(video.currentTime - lastPaintedVideoTimeRef.current) < 0.001) return;
        const now = performance.now();
        const minInterval = isCameraGlidingRef.current ? 64 : 48;
        if (!force && now - lastAmbientPaintRef.current < minInterval) return;
        lastAmbientPaintRef.current = now;
        lastPaintedVideoTimeRef.current = video.currentTime;
        const tick = ++ambientTickCountRef.current;
        const paintMid = force || (tick % 2 === 0);
        const paintFar = force || (tick % 3 === 0);

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
                const nearCtx = get2dCtx(nearCanvas);
                if (nearCanvas && nearCtx) {
                    const botSrcY = visY + visH * 0.55;
                    const botSrcH = Math.max(1, visY + visH - botSrcY);
                    nearCtx.save();
                    nearCtx.translate(0, nearCanvas.height);
                    nearCtx.scale(1, -1);
                    nearCtx.drawImage(video, sx, botSrcY, sw, botSrcH, 0, 0, nearCanvas.width, nearCanvas.height);
                    nearCtx.restore();

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
                const topNearCtx = get2dCtx(topNearCanvas);
                if (topNearCanvas && topNearCtx) {
                    const topSrcH = Math.max(1, visH * 0.45);
                    topNearCtx.save();
                    topNearCtx.translate(0, topNearCanvas.height);
                    topNearCtx.scale(1, -1);
                    topNearCtx.drawImage(video, sx, visY, sw, topSrcH, 0, 0, topNearCanvas.width, topNearCanvas.height);
                    topNearCtx.restore();

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
        const prevBlurEnabled = prevBlurEnabledRef.current;
        prevBlurEnabledRef.current = draft.enableAmbientBlur;
        if (draft.enableAmbientBlur === false) return;
        if (isPlayingRef.current && !isScrubbingRef.current && prevBlurEnabled === draft.enableAmbientBlur) return;
        if (!isPlayingRef.current || isScrubbingRef.current) {
            ambientCropRef.current = ambientCrop;
            ambientVisibilityRef.current = ambientVisibility;
        }
        const video = getActiveVideo();
        if (video) paintAmbientCanvas(video, true);
    }, [ambientCrop, ambientVisibility, draft.zoom, draft.posX, draft.posY, draft.defaultFramingByRatio, draft.aspectRatio, draft.enableAmbientBlur, isPlayingRef, isScrubbingRef, getActiveVideo, paintAmbientCanvas]);

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
