import { useRef, useEffect, useCallback, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, getHookTransitionFade, getBreathDipAudioGain, getTimelineStructure, clamp } from "../../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";
import { getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";

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
    ambientCrop?: AmbientCropRect;
    ambientVisibility?: AmbientVisibilityState;
    onTimeUpdate?: (current: number, duration: number) => void;
    onAspectDetected: (aspect: number) => void;
}

/**
 * Synchronises dual-deck `<video>` playback with studio timeline state (gating `play()` behind `seeked`)
 * and supports frame-accurate local scrubbing with pending-target flush.
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
    ambientVisibility = { topVisible: false, botVisible: true },
    onTimeUpdate,
    onAspectDetected,
}: UseVideoElementSyncOptions) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const standbyVideoRef = useRef<HTMLVideoElement>(null);
    const activeVideoRef = useRef<HTMLVideoElement | null>(null);
    const activeDeckRef = useRef<0 | 1>(0);
    const effectiveMutedRef = useRef(effectiveMuted);
    const rVfcHandleRef = useRef<{ el: HTMLVideoElement; id: number } | null>(null);
    const rVfcCallbackRef = useRef<VideoFrameRequestCallback | null>(null);
    const seekCleanupRef = useRef<(() => void) | null>(null);
    const pendingScrubTargetRef = useRef<number | null>(null);
    const isCameraGlidingRef = useRef(false);

    const isPlayingRef = useRef(isPlaying);
    const isScrubbingRef = useRef(isScrubbing);
    const isOutroRef = useRef(isOutro);
    const playbackModeRef = useRef(playbackMode);
    const currentTimeRef = useRef(currentTime);
    const draftRef = useRef(draft);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        isScrubbingRef.current = isScrubbing;
        isOutroRef.current = isOutro;
        playbackModeRef.current = playbackMode;
        draftRef.current = draft;
        effectiveMutedRef.current = effectiveMuted;
        if (!activeVideoRef.current && videoRef.current) {
            activeVideoRef.current = videoRef.current;
        }
    });

    const getActiveVideo = useCallback(
        () => activeVideoRef.current ?? videoRef.current,
        []
    );
    const getStandbyVideo = useCallback(
        () => (activeDeckRef.current === 0 ? standbyVideoRef.current : videoRef.current),
        []
    );

    const {
        ambientCropRef,
        ambientVisibilityRef,
        ambientCanvasRef,
        midEdgeCanvasRef,
        nearEdgeCanvasRef,
        topAmbientCanvasRef,
        topMidEdgeCanvasRef,
        topNearEdgeCanvasRef,
        paintAmbientCanvas,
    } = useAmbientCanvasPainter({
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
    });

    // Only sync currentTimeRef from props when paused, scrubbing, or on an explicit >0.25s user seek
    // (prevents gated discreteKey React renders at scene/subtitle boundaries from clobbering the live media clock)
    useEffect(() => {
        if (!isPlayingRef.current || isScrubbingRef.current || Math.abs(currentTime - currentTimeRef.current) > 0.25) {
            currentTimeRef.current = currentTime;
        }
    }, [currentTime]);

    const cancelPendingSeekListener = useCallback(() => {
        seekCleanupRef.current?.();
        seekCleanupRef.current = null;
    }, []);

    useEffect(() => () => {
        cancelPendingSeekListener();
        pendingScrubTargetRef.current = null;
    }, [cancelPendingSeekListener]);

    useEffect(() => {
        if (videoRef.current) {
            videoRef.current.style.opacity = activeDeckRef.current === 0 ? '1' : '0';
            videoRef.current.style.zIndex = activeDeckRef.current === 0 ? '2' : '1';
        }
        if (standbyVideoRef.current) {
            standbyVideoRef.current.style.opacity = activeDeckRef.current === 1 ? '1' : '0';
            standbyVideoRef.current.style.zIndex = activeDeckRef.current === 1 ? '2' : '1';
        }
    }, [videoSrc]);
    // Clear pending scrub target once scrubbing finishes
    useEffect(() => {
        if (!isScrubbing) pendingScrubTargetRef.current = null;
    }, [isScrubbing]);

    useEffect(() => {
        const video = getActiveVideo();
        if (video) {
            video.muted = effectiveMuted;
            const fade = getHookTransitionFade(draftRef.current, currentTimeRef.current);
            video.volume = clamp((draft.volume ?? 1) * getBreathDipAudioGain(fade), 0, 1);
        }
        const standby = getStandbyVideo();
        if (standby) standby.muted = true;
    }, [effectiveMuted, draft.volume, isPlaying, getActiveVideo, getStandbyVideo]);

    const refreshAmbientGlow = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video) return;
        if (e && e.currentTarget !== video) return;
        paintAmbientCanvas(video, true);
        // Flush any deferred scrub seek once the previous seek finishes
        const pending = pendingScrubTargetRef.current;
        if (isScrubbingRef.current && pending !== null && !video.seeking) {
            pendingScrubTargetRef.current = null;
            if (Math.abs(video.currentTime - pending) > 0.015) {
                video.currentTime = pending;
            }
        }
    }, [getActiveVideo, paintAmbientCanvas]);

    /** Seeks to `targetMediaTime` and only calls `play()` once `seeked` has landed. */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean) => {
        if (video.readyState < 1) {
            if (shouldPlay && !isScrubbingRef.current) video.play().catch(() => { });
            return;
        }

        const vDur = video.duration || 10;
        const clampedTarget = targetMediaTime >= vDur ? Math.max(0, vDur - 0.01) : Math.max(0, targetMediaTime % vDur);
        const seekTol = shouldPlay ? 0.08 : 0.015;
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > seekTol;

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
                    paintAmbientCanvas(video);
                    onTimeUpdate?.(currentTimeRef.current, video.duration || 0);
                    video.play().catch(() => { });
                }
            };
            seekCleanupRef.current = () => video.removeEventListener('seeked', onSeeked);
            video.addEventListener('seeked', onSeeked, { once: true });
            if (needsSeek) video.currentTime = clampedTarget;
        } else {
            paintAmbientCanvas(video);
            onTimeUpdate?.(currentTimeRef.current, video.duration || 0);
            video.play().catch(() => { });
        }
    }, [cancelPendingSeekListener, onTimeUpdate, paintAmbientCanvas]);

    useEffect(() => {
        const video = getActiveVideo();
        if (overlayOnly || !video) return;
        const standby = getStandbyVideo();
        if (isOutro) {
            cancelPendingSeekListener();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
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
            preParkStandbyDeck(standby, getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
        } else {
            cancelPendingSeekListener();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
        }
    }, [isPlaying, isScrubbing, isOutro, overlayOnly, getActiveVideo, getStandbyVideo, seekAndSync, cancelPendingSeekListener]);

    /** Swaps instantaneously to the pre-parked standby deck (0ms seek latency) or falls back to seekAndSync. */
    const transitionToMediaTime = useCallback((outgoing: HTMLVideoElement, targetMediaTime: number, nextTimelineTime: number) => {
        currentTimeRef.current = nextTimelineTime;
        const standby = getStandbyVideo();
        if (standby && standby !== outgoing && isStandbyReadyAt(standby, targetMediaTime)) {
            cancelPendingSeekListener();
            standby.style.transform = outgoing.style.transform;
            standby.style.opacity = '1';
            standby.style.zIndex = '2';
            outgoing.style.opacity = '0';
            outgoing.style.zIndex = '1';
            outgoing.muted = true;
            if (!outgoing.paused) outgoing.pause();

            activeDeckRef.current = activeDeckRef.current === 0 ? 1 : 0;
            activeVideoRef.current = standby;

            standby.muted = effectiveMutedRef.current;
            const fade = getHookTransitionFade(draftRef.current, nextTimelineTime);
            standby.volume = clamp((draftRef.current.volume ?? 1) * getBreathDipAudioGain(fade), 0, 1);
            if (isPlayingRef.current && !isScrubbingRef.current) {
                standby.play().catch(() => { });
            }

            // Re-bind rVFC to the newly active deck immediately
            const prevHandle = rVfcHandleRef.current;
            if (prevHandle && typeof prevHandle.el.cancelVideoFrameCallback === 'function') {
                prevHandle.el.cancelVideoFrameCallback(prevHandle.id);
                rVfcHandleRef.current = null;
            }
            if (rVfcCallbackRef.current && typeof standby.requestVideoFrameCallback === 'function' && isPlayingRef.current) {
                rVfcHandleRef.current = { el: standby, id: standby.requestVideoFrameCallback(rVfcCallbackRef.current) };
            }

            paintAmbientCanvas(standby);
            onTimeUpdate?.(nextTimelineTime, standby.duration || 0);
            // Defer outgoing deck re-seek by 220ms and wait until any active keyframe camera glide settles
            const schedulePrePark = () => {
                if (activeVideoRef.current !== standby || !isPlayingRef.current) return;
                if (isCameraGlidingRef.current) {
                    setTimeout(schedulePrePark, 500);
                    return;
                }
                preParkStandbyDeck(outgoing, getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
            };
            setTimeout(schedulePrePark, 220);
            return true;
        }
        seekAndSync(outgoing, targetMediaTime, isPlayingRef.current);
        return false;
    }, [cancelPendingSeekListener, getStandbyVideo, onTimeUpdate, paintAmbientCanvas, seekAndSync]);

    useEffect(() => {
        const video = getActiveVideo();
        if (currentTime === undefined || overlayOnly || isOutro || !video || video.readyState < 1) return;
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTime, vDur);
        const clampedTarget = targetMediaTime >= vDur ? Math.max(0, vDur - 0.01) : Math.max(0, targetMediaTime % vDur);

        if (isScrubbing) {
            if (!video.paused) video.pause();
            if (video.seeking) {
                pendingScrubTargetRef.current = clampedTarget;
            } else if (Math.abs(video.currentTime - clampedTarget) > 0.015) {
                pendingScrubTargetRef.current = null;
                const isLocalStream = videoSrc.includes('/api/video/ingest') || videoSrc.startsWith('blob:');
                if (!isLocalStream && typeof video.fastSeek === 'function') {
                    video.fastSeek(clampedTarget);
                } else {
                    video.currentTime = clampedTarget;
                }
            }
            return;
        }

        if (!isPlaying) {
            if (Math.abs(video.currentTime - clampedTarget) > 0.015) seekAndSync(video, targetMediaTime, false);
        } else if (!video.seeking && Math.abs(video.currentTime - clampedTarget) > 0.4) {
            transitionToMediaTime(video, targetMediaTime, currentTime);
        }
    }, [currentTime, isPlaying, isScrubbing, isOutro, overlayOnly, videoSrc, draft.scenes, draft.videoDuration, getActiveVideo, seekAndSync, transitionToMediaTime]);

    const syncTimelineTick = useCallback((video: HTMLVideoElement, mediaTime: number) => {
        if (!onTimeUpdate || isOutroRef.current || video.seeking) return;
        const activeDraft = draftRef.current;
        const activeTime = currentTimeRef.current;
        const { hasReHook, hookDur, rehookDur, preStoryDur: preSetupDur, hookOffset, rehookOffset, storyOffset: setupOffset } = getTimelineStructure(activeDraft.scenes || []);
        let nextTimelineTime: number;

        const isLoop = playbackModeRef.current === 'loop-angle';
        let didBoundarySeek = false;
        if (hasReHook && activeTime < hookDur && mediaTime >= hookOffset + hookDur - 0.022) {
            nextTimelineTime = isLoop ? 0 : hookDur;
            currentTimeRef.current = nextTimelineTime;
            didBoundarySeek = !transitionToMediaTime(video, isLoop ? hookOffset : rehookOffset, nextTimelineTime);
        } else if (hasReHook && activeTime >= hookDur && activeTime < preSetupDur && mediaTime >= rehookOffset + rehookDur - 0.022) {
            nextTimelineTime = isLoop ? hookDur : preSetupDur;
            currentTimeRef.current = nextTimelineTime;
            didBoundarySeek = !transitionToMediaTime(video, isLoop ? rehookOffset : setupOffset, nextTimelineTime);
        } else if (!hasReHook && (hookOffset > 0 || setupOffset > 0) && activeTime < hookDur && mediaTime >= hookOffset + hookDur - 0.022) {
            nextTimelineTime = isLoop ? 0 : hookDur;
            currentTimeRef.current = nextTimelineTime;
            didBoundarySeek = !transitionToMediaTime(video, isLoop ? hookOffset : setupOffset, nextTimelineTime);
        } else if (setupOffset > 0 && activeTime >= preSetupDur && mediaTime < setupOffset - 0.15) {
            didBoundarySeek = true;
            seekAndSync(video, setupOffset, isPlayingRef.current);
            nextTimelineTime = activeTime;
        } else {
            nextTimelineTime = mediaTimeToTimelineTime(activeDraft, mediaTime, activeTime);
            currentTimeRef.current = nextTimelineTime;
        }

        if (!didBoundarySeek) {
            paintAmbientCanvas(video);
            onTimeUpdate(nextTimelineTime, video.duration || 0);
        }
    }, [onTimeUpdate, paintAmbientCanvas, seekAndSync, transitionToMediaTime]);

    useEffect(() => {
        const video = getActiveVideo();
        if (!video || overlayOnly) return;
        let isMounted = true;

        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (!isMounted) return;
            const cur = getActiveVideo();
            if (!cur) return;
            if (!isScrubbingRef.current && isPlayingRef.current && !cur.seeking) {
                syncTimelineTick(cur, metadata.mediaTime);
            }
            const nextEl = getActiveVideo();
            if (nextEl && typeof nextEl.requestVideoFrameCallback === 'function' && isPlayingRef.current) {
                rVfcHandleRef.current = { el: nextEl, id: nextEl.requestVideoFrameCallback(onFrame) };
            }
        };
        rVfcCallbackRef.current = onFrame;

        if (typeof video.requestVideoFrameCallback === 'function' && isPlaying && !isScrubbing) {
            rVfcHandleRef.current = { el: video, id: video.requestVideoFrameCallback(onFrame) };
        }
        return () => {
            isMounted = false;
            rVfcCallbackRef.current = null;
            const handle = rVfcHandleRef.current;
            if (handle && typeof handle.el.cancelVideoFrameCallback === 'function') {
                handle.el.cancelVideoFrameCallback(handle.id);
            }
            rVfcHandleRef.current = null;
        };
    }, [isPlaying, isScrubbing, overlayOnly, getActiveVideo, syncTimelineTick]);

    const handleLoadedMetadata = () => {
        const video = getActiveVideo();
        if (!video) return;
        if (video.videoWidth && video.videoHeight) onAspectDetected(video.videoWidth / video.videoHeight);
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
        if (Math.abs(video.currentTime - targetMediaTime) > 0.08) video.currentTime = targetMediaTime;
        if (onTimeUpdate) onTimeUpdate(currentTimeRef.current, video.duration || 0);
        preParkStandbyDeck(getStandbyVideo(), getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
    };

    const handleStandbyLoadedMetadata = useCallback(() => {
        const standby = getStandbyVideo();
        if (standby) {
            standby.style.opacity = activeDeckRef.current === 1 ? '1' : '0';
            standby.style.zIndex = activeDeckRef.current === 1 ? '2' : '1';
        }
        preParkStandbyDeck(standby, getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
    }, [getStandbyVideo]);

    const handleTimeUpdate = (e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video) || isScrubbing || !isPlaying || typeof video.requestVideoFrameCallback === 'function') return;
        syncTimelineTick(video, video.currentTime);
    };

    const handleEnded = useCallback(() => {
        const video = getActiveVideo();
        if (!video || overlayOnly || isOutroRef.current) return;
        const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draftRef.current.scenes || []);
        const t = currentTimeRef.current;
        const target = t < hookDur ? hookOffset : (hasReHook && t < preStoryDur ? rehookOffset : storyOffset);
        seekAndSync(video, target, isPlayingRef.current);
    }, [overlayOnly, getActiveVideo, seekAndSync]);

    return { videoRef, standbyVideoRef, activeVideoRef, currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef, ambientCanvasRef, midEdgeCanvasRef, nearEdgeCanvasRef, topAmbientCanvasRef, topMidEdgeCanvasRef, topNearEdgeCanvasRef, refreshAmbientGlow, handleLoadedMetadata, handleStandbyLoadedMetadata, handleTimeUpdate, handleEnded };
};
