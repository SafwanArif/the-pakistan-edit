"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, type RefObject } from "react";
import { clamp } from "@/types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./videoCardGeometry";
import type { VideoSyncRuntimeCtx } from "./useCompanionAudioLock";

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

const paintTieredStack = (
    video: HTMLVideoElement,
    near: HTMLCanvasElement | null,
    mid: HTMLCanvasElement | null,
    far: HTMLCanvasElement | null,
    sx: number, sy: number, sw: number, sh: number,
    paintMid: boolean, paintFar: boolean
): void => {
    const nearCtx = getFlipped2dCtx(near);
    if (!near || !nearCtx) return;
    nearCtx.drawImage(video, sx, sy, sw, sh, 0, 0, near.width, near.height);
    if (paintMid) get2dCtx(mid)?.drawImage(near, 0, 0);
    if (paintFar) get2dCtx(far)?.drawImage(near, 0, 0);
};

export interface AmbientCanvasRefs {
    far: RefObject<HTMLCanvasElement | null>;
    mid: RefObject<HTMLCanvasElement | null>;
    near: RefObject<HTMLCanvasElement | null>;
    topFar: RefObject<HTMLCanvasElement | null>;
    topMid: RefObject<HTMLCanvasElement | null>;
    topNear: RefObject<HTMLCanvasElement | null>;
}

interface UseAmbientCanvasPainterOptions {
    videoSrc: string;
    ambientBlurActive: boolean;
    ambientCrop: AmbientCropRect;
    ambientVisibility: AmbientVisibilityState;
    enableAmbientBlur?: boolean;
    ctxRef: RefObject<VideoSyncRuntimeCtx>;
    isCameraGlidingRef: RefObject<boolean>;
    isHeavyVideo?: boolean;
    getActiveVideo: () => HTMLVideoElement | null;
}

/**
 * Manages the 3–6 GPU-accelerated 384×180 4:5 ambient blur `<canvas>` elements with cached 2D contexts
 * and Hierarchical Temporal Rate Shading (`1/1` near, `1/2` mid, `1/4` far) plus instant `0% Energy` bypass.
 */
export const useAmbientCanvasPainter = ({
    videoSrc, ambientBlurActive, ambientCrop, ambientVisibility, enableAmbientBlur,
    ctxRef, isCameraGlidingRef, isHeavyVideo = false, getActiveVideo,
}: UseAmbientCanvasPainterOptions) => {
    const far = useRef<HTMLCanvasElement>(null);
    const mid = useRef<HTMLCanvasElement>(null);
    const near = useRef<HTMLCanvasElement>(null);
    const topFar = useRef<HTMLCanvasElement>(null);
    const topMid = useRef<HTMLCanvasElement>(null);
    const topNear = useRef<HTMLCanvasElement>(null);
    const ambientCanvases = useMemo<AmbientCanvasRefs>(() => ({ far, mid, near, topFar, topMid, topNear }), []);

    const lastAmbientPaintRef = useRef(0);
    const ambientTickCountRef = useRef(0);
    const lastPaintedVideoTimeRef = useRef(-1);
    const prevBlurActiveRef = useRef(ambientBlurActive);
    const configRef = useRef({ ambientBlurActive, isHeavyVideo });
    const ambientCropRef = useRef<AmbientCropRect>(ambientCrop);
    const ambientVisibilityRef = useRef<AmbientVisibilityState>(ambientVisibility);

    useLayoutEffect(() => {
        configRef.current.ambientBlurActive = ambientBlurActive;
        configRef.current.isHeavyVideo = isHeavyVideo;
    }, [ambientBlurActive, isHeavyVideo]);

    // Clear ambient reflection canvases and reset paint cache whenever the video source is cleared or replaced
    useEffect(() => {
        lastPaintedVideoTimeRef.current = -1;
        lastAmbientPaintRef.current = 0;
        ambientTickCountRef.current = 0;
        if (!ambientBlurActive) return;
        for (const ref of [far, mid, near, topFar, topMid, topNear]) {
            const c = ref.current;
            const ctx = get2dCtx(c);
            if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
    }, [videoSrc, ambientBlurActive]);

    const paintAmbientCanvas = useCallback((video: HTMLVideoElement, force = false) => {
        if (
            !configRef.current.ambientBlurActive ||
            ctxRef.current.draft.enableAmbientBlur === false ||
            video.readyState < 2 || !video.videoWidth || !video.videoHeight
        ) return;
        const { topVisible, botVisible } = ambientVisibilityRef.current;
        if (!topVisible && !botVisible) return;
        if (!force && Math.abs(video.currentTime - lastPaintedVideoTimeRef.current) < 0.001) return;
        const now = performance.now();
        const minInterval = configRef.current.isHeavyVideo ? 120 : (isCameraGlidingRef.current ? 80 : 48);
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
            const sx = clamp(vw * xFrac, 0, Math.max(0, vw - 1));
            const sw = clamp(vw * wFrac, 1, Math.max(1, vw - sx));
            const visY = Math.max(0, vh * yFrac);
            const visH = clamp(vh * hFrac, 1, Math.max(1, vh - visY));

            if (botVisible) {
                const botSrcY = visY + visH * 0.55;
                paintTieredStack(video, near.current, mid.current, far.current, sx, botSrcY, sw, Math.max(1, visY + visH - botSrcY), paintMid, paintFar);
            }
            if (topVisible) {
                paintTieredStack(video, topNear.current, topMid.current, topFar.current, sx, visY, sw, Math.max(1, visH * 0.45), paintMid, paintFar);
            }
        } catch { /* ignore cross-origin canvas taint */ }
    }, [ctxRef, isCameraGlidingRef]);

    // Repaint ambient canvases immediately whenever framing, blur toggle, or cached source changes while paused/scrubbing
    const { xFrac, wFrac, yFrac, hFrac } = ambientCrop;
    const { topVisible, botVisible } = ambientVisibility;
    useEffect(() => {
        const prevActive = prevBlurActiveRef.current;
        prevBlurActiveRef.current = ambientBlurActive;
        if (!ambientBlurActive || (!topVisible && !botVisible)) return;
        const { isPlaying, isScrubbing } = ctxRef.current;
        if (isPlaying && !isScrubbing && prevActive === ambientBlurActive) return;
        if (!isPlaying || isScrubbing) {
            ambientCropRef.current = { xFrac, wFrac, yFrac, hFrac };
            ambientVisibilityRef.current = { topVisible, botVisible };
        }
        const video = getActiveVideo();
        if (video) paintAmbientCanvas(video, true);
    }, [videoSrc, ambientBlurActive, xFrac, wFrac, yFrac, hFrac, topVisible, botVisible, enableAmbientBlur, ctxRef, getActiveVideo, paintAmbientCanvas]);

    return { ambientCropRef, ambientVisibilityRef, ambientCanvases, paintAmbientCanvas };
};
