import { useRef, useEffect, useCallback } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, getHookTransitionFade, getBreathDipAudioGain, getTimelineStructure, clamp } from "../../../../types/news";

interface UseVideoElementSyncOptions {
    draft: VideoDraft;
    videoSrc: string;
    isPlaying: boolean;
    isScrubbing: boolean;
    isOutro?: boolean;
    playbackMode?: 'play-all' | 'loop-angle';
    currentTime: number;
    effectiveMuted: boolean;
    overlayOnly: boolean;
    ambientCrop?: { xFrac: number; wFrac: number; yFrac: number; hFrac: number };
    onTimeUpdate?: (current: number, duration: number) => void;
    onAspectDetected: (aspect: number) => void;
}

/**
 * Synchronises `<video>` playback with studio timeline state (gating `play()` behind `seeked`)
 * and paints a 32x18 mirrored ambient canvas at ~6fps for seamless 4:5 edge colour spill.
 */
export const useVideoElementSync = ({
    draft,
    videoSrc,
    isPlaying,
    isScrubbing,
    isOutro = false,
    playbackMode = 'play-all',
    currentTime,
    effectiveMuted,
    overlayOnly,
    ambientCrop = { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 },
    onTimeUpdate,
    onAspectDetected,
}: UseVideoElementSyncOptions) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const ambientCanvasRef = useRef<HTMLCanvasElement>(null);
    const midEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const nearEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const topAmbientCanvasRef = useRef<HTMLCanvasElement>(null);
    const topMidEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const topNearEdgeCanvasRef = useRef<HTMLCanvasElement>(null);
    const seekCleanupRef = useRef<(() => void) | null>(null);
    const lastAmbientPaintRef = useRef(0);

    const isPlayingRef = useRef(isPlaying);
    const isScrubbingRef = useRef(isScrubbing);
    const isOutroRef = useRef(isOutro);
    const playbackModeRef = useRef(playbackMode);
    const currentTimeRef = useRef(currentTime);
    const draftRef = useRef(draft);
    const ambientCropRef = useRef(ambientCrop);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        isScrubbingRef.current = isScrubbing;
        isOutroRef.current = isOutro;
        playbackModeRef.current = playbackMode;
        currentTimeRef.current = currentTime;
        draftRef.current = draft;
        ambientCropRef.current = ambientCrop;
    });

    const cancelPendingSeekListener = useCallback(() => {
        seekCleanupRef.current?.();
        seekCleanupRef.current = null;
    }, []);

    useEffect(() => () => cancelPendingSeekListener(), [cancelPendingSeekListener]);

    // Clear ambient reflection canvases immediately whenever the video source is cleared or replaced
    useEffect(() => {
        for (const c of [
            ambientCanvasRef.current, midEdgeCanvasRef.current, nearEdgeCanvasRef.current,
            topAmbientCanvasRef.current, topMidEdgeCanvasRef.current, topNearEdgeCanvasRef.current,
        ]) {
            const ctx = c?.getContext('2d', { alpha: false });
            if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
        }
    }, [videoSrc]);

    useEffect(() => {
        const video = videoRef.current;
        if (video) {
            video.muted = effectiveMuted;
            const fade = getHookTransitionFade(draftRef.current, currentTimeRef.current);
            video.volume = clamp((draft.volume ?? 1) * getBreathDipAudioGain(fade), 0, 1);
        }
    }, [effectiveMuted, draft.volume, isPlaying]);

    const paintAmbientCanvas = useCallback((video: HTMLVideoElement, force = false) => {
        const canvas = ambientCanvasRef.current;
        if (overlayOnly || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
        const now = performance.now();
        if (!force && now - lastAmbientPaintRef.current < 150) return;
        lastAmbientPaintRef.current = now;

        try {
            const ctx = canvas.getContext('2d', { alpha: false });
            if (!ctx) return;
            const { xFrac, wFrac, yFrac, hFrac } = ambientCropRef.current;
            const sx = Math.max(0, Math.min(video.videoWidth - 1, Math.floor(video.videoWidth * xFrac)));
            const sw = Math.max(1, Math.min(video.videoWidth - sx, Math.floor(video.videoWidth * wFrac)));
            const visY = Math.max(0, Math.floor(video.videoHeight * yFrac));
            const visH = Math.max(1, Math.min(video.videoHeight - visY, Math.floor(video.videoHeight * hFrac)));
            const botSrcY = visY + Math.floor(visH * 0.55);
            const botSrcH = Math.max(1, visY + visH - botSrcY);
            ctx.save();
            ctx.translate(0, canvas.height);
            ctx.scale(1, -1);
            ctx.drawImage(video, sx, botSrcY, sw, botSrcH, 0, 0, canvas.width, canvas.height);
            ctx.restore();

            for (const tierCanvas of [midEdgeCanvasRef.current, nearEdgeCanvasRef.current]) {
                const tierCtx = tierCanvas?.getContext('2d', { alpha: false });
                if (tierCanvas && tierCtx) tierCtx.drawImage(canvas, 0, 0, tierCanvas.width, tierCanvas.height);
            }

            const topCanvas = topAmbientCanvasRef.current;
            const topCtx = topCanvas?.getContext('2d', { alpha: false });
            if (topCanvas && topCtx) {
                const topSrcH = Math.max(1, Math.floor(visH * 0.45));
                topCtx.save();
                topCtx.translate(0, topCanvas.height);
                topCtx.scale(1, -1);
                topCtx.drawImage(video, sx, visY, sw, topSrcH, 0, 0, topCanvas.width, topCanvas.height);
                topCtx.restore();
                for (const tierCanvas of [topMidEdgeCanvasRef.current, topNearEdgeCanvasRef.current]) {
                    const tierCtx = tierCanvas?.getContext('2d', { alpha: false });
                    if (tierCanvas && tierCtx) tierCtx.drawImage(topCanvas, 0, 0, tierCanvas.width, tierCanvas.height);
                }
            }
        } catch { /* ignore cross-origin canvas taint */ }
    }, [overlayOnly]);

    const refreshAmbientGlow = useCallback(() => {
        if (videoRef.current) paintAmbientCanvas(videoRef.current, true);
    }, [paintAmbientCanvas]);

    // Repaint ambient canvases immediately whenever zoom, pan, or posY changes while paused
    useEffect(() => {
        ambientCropRef.current = ambientCrop;
        if (videoRef.current) paintAmbientCanvas(videoRef.current, !isPlayingRef.current);
    }, [ambientCrop, draft.posY, paintAmbientCanvas]);

    /** Seeks to `targetMediaTime` and only calls `play()` once `seeked` has landed. */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean) => {
        if (video.readyState < 1) {
            if (shouldPlay && !isScrubbingRef.current) video.play().catch(() => { });
            return;
        }

        const vDur = video.duration || 10;
        const clampedTarget = Math.max(0, Math.min(targetMediaTime % vDur, vDur));
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > 0.05;

        cancelPendingSeekListener();

        if (!shouldPlay) {
            if (!video.paused) video.pause();
            if (needsSeek) video.currentTime = clampedTarget;
            return;
        }

        if (needsSeek || video.seeking) {
            if (!video.paused) video.pause();
            const onSeeked = () => {
                video.removeEventListener('seeked', onSeeked);
                seekCleanupRef.current = null;
                if (isPlayingRef.current && !isScrubbingRef.current && !video.seeking) {
                    video.play().catch(() => { });
                }
            };
            seekCleanupRef.current = () => video.removeEventListener('seeked', onSeeked);
            video.addEventListener('seeked', onSeeked, { once: true });
            if (needsSeek) video.currentTime = clampedTarget;
        } else {
            video.play().catch(() => { });
        }
    }, [cancelPendingSeekListener]);

    useEffect(() => {
        const video = videoRef.current;
        if (overlayOnly || !video) return;
        if (isOutro) {
            cancelPendingSeekListener();
            if (!video.paused) video.pause();
            // Pre-park at Hook start frame so Outro -> 01. Hook loop-back is instant
            const hookOffset = draftRef.current.scenes?.[0]?.clipStartOffset ?? 0;
            if (video.readyState >= 1 && Math.abs(video.currentTime - hookOffset) > 0.08) {
                video.currentTime = hookOffset;
            }
            return;
        }
        if (isPlaying && !isScrubbing) {
            const vDur = video.duration || 10;
            const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
            seekAndSync(video, targetMediaTime, true);
        } else {
            cancelPendingSeekListener();
            if (!video.paused) video.pause();
        }
    }, [isPlaying, isScrubbing, isOutro, overlayOnly, seekAndSync, cancelPendingSeekListener]);

    useEffect(() => {
        const video = videoRef.current;
        if (currentTime === undefined || overlayOnly || isScrubbing || isOutro || !video || video.readyState < 1) return;
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTime, vDur);

        if (!isPlaying) {
            if (Math.abs(video.currentTime - targetMediaTime) > 0.05) seekAndSync(video, targetMediaTime, false);
        } else if (!video.seeking && Math.abs(video.currentTime - targetMediaTime) > 0.4) {
            seekAndSync(video, targetMediaTime, true);
        }
    }, [currentTime, isPlaying, isScrubbing, isOutro, overlayOnly, draft.scenes, draft.videoDuration, seekAndSync]);

    const syncTimelineTick = useCallback((video: HTMLVideoElement, mediaTime: number) => {
        if (!onTimeUpdate || isOutroRef.current || video.seeking) return;
        const activeDraft = draftRef.current;
        const activeTime = currentTimeRef.current;
        const { hasReHook, hookDur, rehookDur, preStoryDur: preSetupDur, hookOffset, rehookOffset, storyOffset: setupOffset } = getTimelineStructure(activeDraft.scenes || []);
        let nextTimelineTime: number;

        const isLoop = playbackModeRef.current === 'loop-angle';
        if (hasReHook && activeTime < hookDur && mediaTime >= hookOffset + hookDur - 0.04) {
            nextTimelineTime = isLoop ? 0 : hookDur;
            currentTimeRef.current = nextTimelineTime;
            seekAndSync(video, isLoop ? hookOffset : rehookOffset, isPlayingRef.current);
        } else if (hasReHook && activeTime >= hookDur && activeTime < preSetupDur && mediaTime >= rehookOffset + rehookDur - 0.04) {
            nextTimelineTime = isLoop ? hookDur : preSetupDur;
            currentTimeRef.current = nextTimelineTime;
            seekAndSync(video, isLoop ? rehookOffset : setupOffset, isPlayingRef.current);
        } else if (!hasReHook && (hookOffset > 0 || setupOffset > 0) && activeTime < hookDur && mediaTime >= hookOffset + hookDur - 0.04) {
            nextTimelineTime = isLoop ? 0 : hookDur;
            currentTimeRef.current = nextTimelineTime;
            seekAndSync(video, isLoop ? hookOffset : setupOffset, isPlayingRef.current);
        } else if (setupOffset > 0 && activeTime >= preSetupDur && mediaTime < setupOffset - 0.15) {
            seekAndSync(video, setupOffset, isPlayingRef.current);
            nextTimelineTime = activeTime;
        } else {
            nextTimelineTime = mediaTimeToTimelineTime(activeDraft, mediaTime, activeTime);
            currentTimeRef.current = nextTimelineTime;
        }

        const fade = getHookTransitionFade(activeDraft, nextTimelineTime);
        video.volume = clamp((activeDraft.volume ?? 1) * getBreathDipAudioGain(fade), 0, 1);
        paintAmbientCanvas(video);
        onTimeUpdate(nextTimelineTime, video.duration || 0);
    }, [onTimeUpdate, paintAmbientCanvas, seekAndSync]);

    useEffect(() => {
        const video = videoRef.current;
        if (!video || overlayOnly) return;
        let rVFCId: number | null = null;
        let isMounted = true;

        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (!isMounted) return;
            if (!isScrubbingRef.current && isPlayingRef.current && !video.seeking) {
                syncTimelineTick(video, metadata.mediaTime);
            }
            if (typeof video.requestVideoFrameCallback === 'function' && isPlayingRef.current) {
                rVFCId = video.requestVideoFrameCallback(onFrame);
            }
        };

        if (typeof video.requestVideoFrameCallback === 'function' && isPlaying && !isScrubbing) {
            rVFCId = video.requestVideoFrameCallback(onFrame);
        }
        return () => {
            isMounted = false;
            if (rVFCId !== null && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(rVFCId);
        };
    }, [isPlaying, isScrubbing, overlayOnly, syncTimelineTick]);

    const handleLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        if (video.videoWidth && video.videoHeight) onAspectDetected(video.videoWidth / video.videoHeight);
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
        if (Math.abs(video.currentTime - targetMediaTime) > 0.08) video.currentTime = targetMediaTime;
        if (onTimeUpdate) onTimeUpdate(currentTimeRef.current, video.duration || 0);
    };

    const handleTimeUpdate = () => {
        const video = videoRef.current;
        if (!video || isScrubbing || !isPlaying || typeof video.requestVideoFrameCallback === 'function') return;
        syncTimelineTick(video, video.currentTime);
    };

    const handleEnded = useCallback(() => {
        const video = videoRef.current;
        if (!video || overlayOnly || isOutroRef.current) return;
        const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draftRef.current.scenes || []);
        const t = currentTimeRef.current;
        const target = t < hookDur
            ? hookOffset
            : (hasReHook && t < preStoryDur ? rehookOffset : storyOffset);
        seekAndSync(video, target, isPlayingRef.current);
    }, [overlayOnly, seekAndSync]);

    return { videoRef, ambientCanvasRef, midEdgeCanvasRef, nearEdgeCanvasRef, topAmbientCanvasRef, topMidEdgeCanvasRef, topNearEdgeCanvasRef, refreshAmbientGlow, handleLoadedMetadata, handleTimeUpdate, handleEnded };
};
