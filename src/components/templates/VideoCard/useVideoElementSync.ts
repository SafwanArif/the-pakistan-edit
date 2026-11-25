import { useRef, useEffect, useCallback, useMemo, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, evaluateSceneTransition, getTimelineStructure, clamp } from "../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";
import { clampMediaTarget, getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";

interface UseVideoElementSyncOptions {
    draft: VideoDraft;
    videoSrc: string;
    isPlaying: boolean;
    isScrubbing: boolean;
    isOutro?: boolean;
    playbackMode?: 'play-all' | 'loop-angle';
    currentTime: number;
    seekNonce?: number;
    useStandbyDeck?: boolean;
    effectiveMuted: boolean;
    overlayOnly: boolean;
    ambientBlurActive?: boolean;
    ambientCrop?: AmbientCropRect;
    ambientVisibility?: AmbientVisibilityState;
    onTimeUpdate?: (current: number, duration: number) => void;
    onAspectDetected: (aspect: number) => void;
}

/**
 * Synchronises dual-deck `<video>` playback with studio timeline state (coalescing all seeks behind `video.seeking`
 * and gating `play()` behind `seeked` + `canplay` audio priming) for jitter-free mobile and desktop playback.
 */
export const useVideoElementSync = ({
    draft,
    videoSrc,
    isPlaying,
    isScrubbing,
    isOutro = false,
    playbackMode = 'play-all',
    currentTime,
    seekNonce = 0,
    useStandbyDeck = false,
    effectiveMuted,
    overlayOnly,
    ambientBlurActive = false,
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
    const playGateCleanupRef = useRef<(() => void) | null>(null);
    const androidResyncCleanupRef = useRef<(() => void) | null>(null);
    const androidResyncActiveRef = useRef(false);
    const needsAndroidAudioResyncRef = useRef(false);
    const lastMobileScrubSeekAtRef = useRef(0);
    const useStandbyDeckRef = useRef(useStandbyDeck);
    const videoSrcRef = useRef(videoSrc);
    const preParkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const standbySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSeekRef = useRef<{ target: number; shouldPlay: boolean } | null>(null);
    const lastSeekNonceRef = useRef(seekNonce);
    const isCameraGlidingRef = useRef(false);

    const isPlayingRef = useRef(isPlaying);
    const isScrubbingRef = useRef(isScrubbing);
    const isOutroRef = useRef(isOutro);
    const playbackModeRef = useRef(playbackMode);
    const currentTimeRef = useRef(currentTime);
    const draftRef = useRef(draft);

    const lastPrimaryElRef = useRef<HTMLVideoElement | null>(null);
    const lastStandbyElRef = useRef<HTMLVideoElement | null>(null);

    const releaseDetachedDeck = useCallback((el: HTMLVideoElement | null) => {
        // Guard with `!el.isConnected` so React 19 StrictMode's simulated dev cleanup never strips `src` off a live `<video>` deck
        if (!el || el.isConnected) return;
        try {
            el.pause();
            el.removeAttribute("src");
            el.load();
        } catch {}
    }, []);

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        isScrubbingRef.current = isScrubbing;
        isOutroRef.current = isOutro;
        playbackModeRef.current = playbackMode;
        draftRef.current = draft;
        effectiveMutedRef.current = effectiveMuted;
        useStandbyDeckRef.current = useStandbyDeck;
        videoSrcRef.current = videoSrc;
        const prevPrimary = lastPrimaryElRef.current;
        const prevStandby = lastStandbyElRef.current;
        lastPrimaryElRef.current = videoRef.current;
        lastStandbyElRef.current = standbyVideoRef.current;
        if (prevPrimary && prevPrimary !== videoRef.current) releaseDetachedDeck(prevPrimary);
        if (prevStandby && prevStandby !== standbyVideoRef.current) releaseDetachedDeck(prevStandby);
        if ((!activeVideoRef.current || !activeVideoRef.current.isConnected) && videoRef.current) {
            activeVideoRef.current = videoRef.current;
            activeDeckRef.current = 0;
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
        ambientBlurActive,
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

    const cancelAndroidResync = useCallback(() => {
        androidResyncCleanupRef.current?.();
        androidResyncCleanupRef.current = null;
        androidResyncActiveRef.current = false;
    }, []);

    const cancelPlayGate = useCallback(() => {
        playGateCleanupRef.current?.();
        playGateCleanupRef.current = null;
        cancelAndroidResync();
    }, [cancelAndroidResync]);

    const markNeedsAndroidResync = useCallback((targetMediaTime: number) => {
        if ((!useStandbyDeckRef.current || videoSrcRef.current.startsWith('blob:')) && targetMediaTime >= 0) {
            needsAndroidAudioResyncRef.current = true;
        }
    }, []);

    const cancelPendingSeekListener = useCallback(() => {
        seekCleanupRef.current?.();
        seekCleanupRef.current = null;
        cancelPlayGate();
    }, [cancelPlayGate]);

    const cancelPreParkTimer = useCallback(() => {
        if (preParkTimerRef.current !== null) {
            clearTimeout(preParkTimerRef.current);
            preParkTimerRef.current = null;
        }
    }, []);

    // Release hardware video decoders cleanly on real unmount and clear pending seek/pre-park timers
    useEffect(() => () => {
        cancelPendingSeekListener();
        cancelPreParkTimer();
        if (standbySyncTimerRef.current !== null) {
            clearTimeout(standbySyncTimerRef.current);
            standbySyncTimerRef.current = null;
        }
        pendingSeekRef.current = null;
        releaseDetachedDeck(lastPrimaryElRef.current);
        releaseDetachedDeck(lastStandbyElRef.current);
    }, [cancelPendingSeekListener, cancelPreParkTimer, releaseDetachedDeck]);

    useEffect(() => {
        needsAndroidAudioResyncRef.current = false;
        if (videoRef.current) {
            videoRef.current.style.opacity = activeDeckRef.current === 0 ? '1' : '0';
            videoRef.current.style.zIndex = activeDeckRef.current === 0 ? '2' : '1';
        }
        if (standbyVideoRef.current) {
            standbyVideoRef.current.style.opacity = activeDeckRef.current === 1 ? '1' : '0';
            standbyVideoRef.current.style.zIndex = activeDeckRef.current === 1 ? '2' : '1';
        }
    }, [videoSrc]);

    // Clear stale scrub-only pending target once scrubbing finishes
    useEffect(() => {
        if (!isScrubbing && pendingSeekRef.current && !pendingSeekRef.current.shouldPlay) {
            pendingSeekRef.current = null;
        }
    }, [isScrubbing]);

    // Pure timing signature so headline/subtitle typing never re-runs `<video>` seek checks or pokes the standby decoder
    const scenesTimingKey = useMemo(
        () => (draft.scenes || []).map((s) => `${s.id}:${s.duration}:${s.clipStartOffset ?? ''}:${s.mediaUrl ?? ''}:${s.mediaType ?? ''}:${s.shareHookText ?? ''}`).join('|'),
        [draft.scenes]
    );

    // Keep desktop standby deck freshly pre-parked whenever Hook/Re-Hook/Story offsets or durations change
    useEffect(() => {
        if (standbySyncTimerRef.current !== null) {
            clearTimeout(standbySyncTimerRef.current);
            standbySyncTimerRef.current = null;
        }
        if (!useStandbyDeck || overlayOnly || isScrubbing || isOutro) return;
        standbySyncTimerRef.current = setTimeout(() => {
            standbySyncTimerRef.current = null;
            preParkStandbyDeck(getStandbyVideo(), getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
        }, 180);
        return () => {
            if (standbySyncTimerRef.current !== null) {
                clearTimeout(standbySyncTimerRef.current);
                standbySyncTimerRef.current = null;
            }
        };
    }, [useStandbyDeck, overlayOnly, isScrubbing, isOutro, scenesTimingKey, playbackMode, getStandbyVideo]);

    useEffect(() => {
        const video = getActiveVideo();
        if (video) {
            if (!androidResyncActiveRef.current) {
                video.muted = effectiveMuted;
            }
            const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
            video.volume = clamp((draft.volume ?? 1) * audioGain, 0, 1);
        }
        const standby = getStandbyVideo();
        if (standby) standby.muted = true;
    }, [effectiveMuted, draft.volume, isPlaying, getActiveVideo, getStandbyVideo]);

    const playWhenAudioPrimed = useCallback((video: HTMLVideoElement) => {
        cancelPlayGate();
        const start = () => {
            cancelPlayGate();
            if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current || video.seeking) return;
            paintAmbientCanvas(video);
            onTimeUpdate?.(currentTimeRef.current, video.duration || 0);
            if (needsAndroidAudioResyncRef.current && (!useStandbyDeckRef.current || videoSrcRef.current.startsWith('blob:'))) {
                // Warm-sink re-seek: once Android's AudioTrack is open (`playing`), execute a real 2ms-nudged seek
                // while muted so Chromium's FFmpegDemuxer + AudioRenderer flush stale pre-roll GOP buffers in lockstep
                needsAndroidAudioResyncRef.current = false;
                androidResyncActiveRef.current = true;
                video.muted = true;
                let failSafeTimer: ReturnType<typeof setTimeout> | null = null;
                let warmSeekedListener: (() => void) | null = null;

                const finishResync = () => {
                    if (failSafeTimer !== null) {
                        clearTimeout(failSafeTimer);
                        failSafeTimer = null;
                    }
                    video.removeEventListener('playing', onFirstPlaying);
                    if (warmSeekedListener) {
                        video.removeEventListener('seeked', warmSeekedListener);
                        warmSeekedListener = null;
                    }
                    androidResyncCleanupRef.current = null;
                    androidResyncActiveRef.current = false;
                    video.muted = effectiveMutedRef.current;
                };

                const onFirstPlaying = () => {
                    if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current || video.seeking) {
                        finishResync();
                        return;
                    }
                    const vDur = video.duration || 10;
                    const expectedMediaTime = clampMediaTarget(wrapMediaTime(draftRef.current, currentTimeRef.current, vDur), vDur);
                    const resyncTarget = Math.abs(video.currentTime - expectedMediaTime) < 0.002
                        ? clampMediaTarget(expectedMediaTime + 0.002, vDur)
                        : expectedMediaTime;
                    warmSeekedListener = () => {
                        finishResync();
                        if (isPlayingRef.current && !isScrubbingRef.current && !isOutroRef.current && video.paused) {
                            video.play().catch(() => { });
                        }
                    };
                    video.addEventListener('seeked', warmSeekedListener, { once: true });
                    video.currentTime = resyncTarget;
                };

                failSafeTimer = setTimeout(finishResync, 650);
                androidResyncCleanupRef.current = finishResync;
                video.addEventListener('playing', onFirstPlaying, { once: true });
            }
            video.play().catch(() => { });
        };
        // Wait for HAVE_FUTURE_DATA (readyState >= 3) after seeks so mobile video & audio buffers start locked together
        if (video.readyState >= 3) {
            start();
            return;
        }
        const timer = setTimeout(start, 350);
        const onCanPlay = () => start();
        playGateCleanupRef.current = () => {
            clearTimeout(timer);
            video.removeEventListener('canplay', onCanPlay);
        };
        video.addEventListener('canplay', onCanPlay, { once: true });
    }, [cancelPlayGate, onTimeUpdate, paintAmbientCanvas]);

    const refreshAmbientGlow = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video) return;
        if (e && e.currentTarget !== video) return;
        paintAmbientCanvas(video, true);
        // Flush any coalesced paused/scrub seek once the in-flight seek settles
        const pending = pendingSeekRef.current;
        if (pending && !video.seeking && !seekCleanupRef.current) {
            pendingSeekRef.current = null;
            if (Math.abs(video.currentTime - pending.target) > 0.015) {
                video.currentTime = pending.target;
            }
        }
    }, [getActiveVideo, paintAmbientCanvas]);

    /** Seeks to `targetMediaTime` safely (coalescing behind `video.seeking`) and only plays once `seeked` + `canplay` settle. */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean) => {
        if (video.readyState < 1) {
            if (shouldPlay && !isScrubbingRef.current) video.play().catch(() => { });
            return;
        }

        const clampedTarget = clampMediaTarget(targetMediaTime, video.duration);
        const seekTol = shouldPlay ? 0.08 : 0.015;
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > seekTol;

        cancelPendingSeekListener();

        if (!shouldPlay) {
            if (!video.paused) video.pause();
            if (video.seeking) {
                markNeedsAndroidResync(clampedTarget);
                pendingSeekRef.current = { target: clampedTarget, shouldPlay: false };
            } else if (needsSeek) {
                markNeedsAndroidResync(clampedTarget);
                pendingSeekRef.current = null;
                video.currentTime = clampedTarget;
            } else {
                pendingSeekRef.current = null;
            }
            return;
        }

        if (needsSeek || video.seeking) {
            markNeedsAndroidResync(clampedTarget);
            if (!video.paused) video.pause();
            pendingSeekRef.current = video.seeking ? { target: clampedTarget, shouldPlay: true } : null;
            const onSeeked = () => {
                const queued = pendingSeekRef.current;
                if (queued) {
                    pendingSeekRef.current = null;
                    if (Math.abs(video.currentTime - queued.target) > 0.015) {
                        video.currentTime = queued.target;
                        return;
                    }
                }
                video.removeEventListener('seeked', onSeeked);
                seekCleanupRef.current = null;
                if (isPlayingRef.current && !isScrubbingRef.current && !video.seeking) {
                    playWhenAudioPrimed(video);
                }
            };
            seekCleanupRef.current = () => video.removeEventListener('seeked', onSeeked);
            video.addEventListener('seeked', onSeeked);
            if (!video.seeking && needsSeek) video.currentTime = clampedTarget;
        } else {
            pendingSeekRef.current = null;
            playWhenAudioPrimed(video);
        }
    }, [cancelPendingSeekListener, markNeedsAndroidResync, playWhenAudioPrimed]);

    useEffect(() => {
        const video = getActiveVideo();
        if (overlayOnly || !video) return;
        const standby = getStandbyVideo();
        if (isOutro) {
            cancelPendingSeekListener();
            cancelPreParkTimer();
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
            cancelPreParkTimer();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
        }
    }, [isPlaying, isScrubbing, isOutro, overlayOnly, getActiveVideo, getStandbyVideo, seekAndSync, cancelPendingSeekListener, cancelPreParkTimer]);

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
            const { audioGain } = evaluateSceneTransition(draftRef.current, nextTimelineTime);
            standby.volume = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);
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
            cancelPreParkTimer();
            const schedulePrePark = () => {
                preParkTimerRef.current = null;
                if (activeVideoRef.current !== standby || !isPlayingRef.current) return;
                if (isCameraGlidingRef.current) {
                    preParkTimerRef.current = setTimeout(schedulePrePark, 500);
                    return;
                }
                preParkStandbyDeck(outgoing, getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
            };
            preParkTimerRef.current = setTimeout(schedulePrePark, 220);
            return true;
        }
        seekAndSync(outgoing, targetMediaTime, isPlayingRef.current);
        return false;
    }, [cancelPendingSeekListener, cancelPreParkTimer, getStandbyVideo, onTimeUpdate, paintAmbientCanvas, seekAndSync]);

    useEffect(() => {
        const video = getActiveVideo();
        const isExplicitSeek = seekNonce !== lastSeekNonceRef.current;
        lastSeekNonceRef.current = seekNonce;
        if (currentTime === undefined || overlayOnly || isOutro || !video || video.readyState < 1) return;
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTime, vDur);
        const clampedTarget = clampMediaTarget(targetMediaTime, vDur);

        if (isScrubbing) {
            if (!video.paused) video.pause();
            markNeedsAndroidResync(clampedTarget);
            const isMobileOrBlob = !useStandbyDeckRef.current || videoSrc.startsWith('blob:');
            const nowMs = performance.now();
            if (video.seeking || (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < 80)) {
                pendingSeekRef.current = { target: clampedTarget, shouldPlay: false };
            } else if (Math.abs(video.currentTime - clampedTarget) > 0.015) {
                lastMobileScrubSeekAtRef.current = nowMs;
                pendingSeekRef.current = null;
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
            if (Math.abs(video.currentTime - clampedTarget) > 0.015 || video.seeking) {
                seekAndSync(video, targetMediaTime, false);
            }
        } else if (
            (isExplicitSeek && Math.abs(video.currentTime - clampedTarget) > 0.04) ||
            (!video.seeking && Math.abs(video.currentTime - clampedTarget) > 0.4)
        ) {
            transitionToMediaTime(video, targetMediaTime, currentTime);
        }
    }, [currentTime, seekNonce, isPlaying, isScrubbing, isOutro, overlayOnly, videoSrc, scenesTimingKey, draft.videoDuration, getActiveVideo, markNeedsAndroidResync, seekAndSync, transitionToMediaTime]);

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
        if (isPlayingRef.current && !isScrubbingRef.current && !isOutroRef.current) {
            seekAndSync(video, targetMediaTime, true);
        } else {
            if (Math.abs(video.currentTime - targetMediaTime) > 0.08) video.currentTime = targetMediaTime;
            if (onTimeUpdate) onTimeUpdate(currentTimeRef.current, video.duration || 0);
        }
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
