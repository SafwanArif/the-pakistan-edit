import { useRef, useEffect, useCallback, useMemo, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, evaluateSceneTransition, getTimelineStructure, clamp } from "../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";
import { clampMediaTarget, getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";
import {
    MOBILE_SCRUB_THROTTLE_MS,
    createInitialAvSyncDiag,
    createPostSeekAudit,
    evaluatePostSeekAvSkew,
    getCanPlayTimeoutMs,
    resolvePlaybackSyncAction,
    shouldUseFastSeekDuringScrub,
    type AvSyncDiagSnapshot,
    type PostSeekAuditState,
} from "./avSyncHelpers";

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

interface PendingSeekRequest {
    target: number;
    shouldPlay: boolean;
    preferFastSeek?: boolean;
}

const publishAvDiag = (diag: AvSyncDiagSnapshot) => {
    (globalThis as { __TPE_AV_DIAG__?: AvSyncDiagSnapshot }).__TPE_AV_DIAG__ = { ...diag };
};

/**
 * Synchronises dual-deck `<video>` playback with studio timeline state via a single seek/play coordinator
 * (coalescing all seeks behind `video.seeking`, using `fastSeek` during drags, strictly pausing before seeks,
 * gating `play()` behind `seeked` + `canplay`, and auditing post-seek `rVFC` A/V clock skew on mobile/`blob:`).
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
    const ambientRafRef = useRef<number | null>(null);
    const seekMutedGuardRef = useRef(false);
    const seekStartedAtRef = useRef<number | null>(null);
    const isRecoverySeekRef = useRef(false);
    const postSeekAuditRef = useRef<PostSeekAuditState | null>(null);
    const avDiagRef = useRef<AvSyncDiagSnapshot>(createInitialAvSyncDiag());
    const lastMobileScrubSeekAtRef = useRef(0);
    const useStandbyDeckRef = useRef(useStandbyDeck);
    const videoSrcRef = useRef(videoSrc);
    const preParkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const standbySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingSeekRef = useRef<PendingSeekRequest | null>(null);
    const lastSeekNonceRef = useRef(seekNonce);
    const wasPlayingRef = useRef(isPlaying);
    const wasScrubbingRef = useRef(isScrubbing);
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

    const cancelDeferredAmbientPaint = useCallback(() => {
        if (ambientRafRef.current !== null) {
            cancelAnimationFrame(ambientRafRef.current);
            ambientRafRef.current = null;
        }
    }, []);

    const scheduleDeferredAmbientPaint = useCallback((video: HTMLVideoElement, force = false) => {
        cancelDeferredAmbientPaint();
        ambientRafRef.current = requestAnimationFrame(() => {
            ambientRafRef.current = null;
            if (!video.isConnected || video.seeking) return;
            paintAmbientCanvas(video, force);
        });
    }, [cancelDeferredAmbientPaint, paintAmbientCanvas]);

    const restoreMutedAfterSeek = useCallback((video: HTMLVideoElement | null) => {
        if (!seekMutedGuardRef.current) return;
        seekMutedGuardRef.current = false;
        if (video) {
            video.muted = effectiveMutedRef.current;
        }
    }, []);

    const cancelPlayGate = useCallback(() => {
        playGateCleanupRef.current?.();
        playGateCleanupRef.current = null;
    }, []);

    const cancelPendingSeekListener = useCallback(() => {
        seekCleanupRef.current?.();
        seekCleanupRef.current = null;
        cancelPlayGate();
        cancelDeferredAmbientPaint();
        postSeekAuditRef.current = null;
        isRecoverySeekRef.current = false;
        restoreMutedAfterSeek(getActiveVideo());
    }, [cancelDeferredAmbientPaint, cancelPlayGate, getActiveVideo, restoreMutedAfterSeek]);

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
        seekStartedAtRef.current = null;
        postSeekAuditRef.current = null;
        isRecoverySeekRef.current = false;
        if (videoRef.current) {
            videoRef.current.style.opacity = activeDeckRef.current === 0 ? '1' : '0';
            videoRef.current.style.zIndex = activeDeckRef.current === 0 ? '2' : '1';
        }
        if (standbyVideoRef.current) {
            standbyVideoRef.current.style.opacity = activeDeckRef.current === 1 ? '1' : '0';
            standbyVideoRef.current.style.zIndex = activeDeckRef.current === 1 ? '2' : '1';
        }
    }, [videoSrc]);

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
            if (!seekMutedGuardRef.current) {
                video.muted = effectiveMuted;
            }
            const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
            video.volume = clamp((draft.volume ?? 1) * audioGain, 0, 1);
        }
        const standby = getStandbyVideo();
        if (standby) standby.muted = true;
    }, [effectiveMuted, draft.volume, isPlaying, getActiveVideo, getStandbyVideo]);

    const issueVideoSeek = useCallback((video: HTMLVideoElement, clampedTarget: number, preferFastSeek: boolean) => {
        if (preferFastSeek && typeof video.fastSeek === 'function') {
            video.fastSeek(clampedTarget);
        } else {
            video.currentTime = clampedTarget;
        }
    }, []);

    const playWhenAudioPrimed = useCallback((video: HTMLVideoElement) => {
        const isMobileOrBlob = !useStandbyDeckRef.current || videoSrcRef.current.startsWith('blob:');

        const armGate = () => {
            cancelPlayGate();
            const start = () => {
                cancelPlayGate();
                if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) {
                    restoreMutedAfterSeek(video);
                    return;
                }
                // Never start audio/video playback while a long-GOP seek is still in flight
                if (video.seeking) {
                    const onSettled = () => {
                        playGateCleanupRef.current = null;
                        armGate();
                    };
                    playGateCleanupRef.current = () => video.removeEventListener('seeked', onSettled);
                    video.addEventListener('seeked', onSettled, { once: true });
                    return;
                }

                restoreMutedAfterSeek(video);
                const nowMs = performance.now();
                if (seekStartedAtRef.current !== null) {
                    avDiagRef.current.lastSeekDurationMs = Math.round(nowMs - seekStartedAtRef.current);
                    avDiagRef.current.readyStateAtPlay = video.readyState;
                    seekStartedAtRef.current = null;
                    if (isMobileOrBlob && !isRecoverySeekRef.current) {
                        postSeekAuditRef.current = createPostSeekAudit(nowMs);
                    } else {
                        postSeekAuditRef.current = null;
                    }
                    isRecoverySeekRef.current = false;
                    publishAvDiag(avDiagRef.current);
                }

                scheduleDeferredAmbientPaint(video, false);
                onTimeUpdate?.(currentTimeRef.current, video.duration || 0);
                video.play().catch(() => { });
            };

            // Wait for HAVE_FUTURE_DATA (readyState >= 3) after seeks so mobile video & audio buffers start locked together
            if (video.readyState >= 3 && !video.seeking) {
                start();
                return;
            }
            const timer = setTimeout(start, getCanPlayTimeoutMs(isMobileOrBlob));
            const onReady = () => start();
            playGateCleanupRef.current = () => {
                clearTimeout(timer);
                video.removeEventListener('canplay', onReady);
                video.removeEventListener('canplaythrough', onReady);
            };
            video.addEventListener('canplay', onReady, { once: true });
            video.addEventListener('canplaythrough', onReady, { once: true });
        };

        armGate();
    }, [cancelPlayGate, onTimeUpdate, restoreMutedAfterSeek, scheduleDeferredAmbientPaint]);

    const refreshAmbientGlow = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video) return;
        if (e && e.currentTarget !== video) return;
        const isMobileOrBlob = !useStandbyDeckRef.current || videoSrcRef.current.startsWith('blob:');
        // Defer 4K ambient canvas readbacks off the seeked critical path (and skip completely during mobile/blob drag)
        if (!(isScrubbingRef.current && isMobileOrBlob)) {
            scheduleDeferredAmbientPaint(video, true);
        }
        // Flush any coalesced paused/scrub seek once the in-flight seek settles without bypassing mobile fastSeek throttle
        const pending = pendingSeekRef.current;
        if (pending && !video.seeking && !seekCleanupRef.current) {
            if (isScrubbingRef.current) {
                const nowMs = performance.now();
                if (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS) {
                    return;
                }
                pendingSeekRef.current = null;
                if (Math.abs(video.currentTime - pending.target) > 0.015) {
                    lastMobileScrubSeekAtRef.current = nowMs;
                    issueVideoSeek(video, pending.target, shouldUseFastSeekDuringScrub(typeof video.fastSeek === 'function'));
                }
            } else {
                pendingSeekRef.current = null;
                if (Math.abs(video.currentTime - pending.target) > 0.015) {
                    issueVideoSeek(video, pending.target, Boolean(pending.preferFastSeek));
                }
            }
        }
    }, [getActiveVideo, issueVideoSeek, scheduleDeferredAmbientPaint]);

    /** Seeks to `targetMediaTime` safely (strict pause-before-seek, coalesced behind `video.seeking`) and plays once `seeked` + `canplay` settle. */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean, preferFastSeek = false) => {
        if (video.readyState < 1) {
            if (shouldPlay && !isScrubbingRef.current) video.play().catch(() => { });
            return;
        }

        const clampedTarget = clampMediaTarget(targetMediaTime, video.duration);
        const seekTol = shouldPlay ? 0.08 : 0.015;
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > seekTol;
        const isMobileOrBlob = !useStandbyDeckRef.current || videoSrcRef.current.startsWith('blob:');

        cancelPendingSeekListener();

        if (!shouldPlay) {
            if (!video.paused) video.pause();
            if (video.seeking) {
                pendingSeekRef.current = { target: clampedTarget, shouldPlay: false, preferFastSeek };
            } else if (needsSeek) {
                pendingSeekRef.current = null;
                issueVideoSeek(video, clampedTarget, preferFastSeek);
            } else {
                pendingSeekRef.current = null;
            }
            return;
        }

        if (needsSeek || video.seeking) {
            // Always pause before seeking so Android's AudioTrack flushes cleanly before decoding the target GOP
            if (!video.paused) video.pause();
            seekStartedAtRef.current = performance.now();
            avDiagRef.current.lastSeekTargetSec = clampedTarget;
            if (isMobileOrBlob) {
                seekMutedGuardRef.current = true;
                video.muted = true;
            }
            pendingSeekRef.current = video.seeking ? { target: clampedTarget, shouldPlay: true, preferFastSeek } : null;
            const onSeeked = () => {
                const queued = pendingSeekRef.current;
                if (queued) {
                    pendingSeekRef.current = null;
                    if (Math.abs(video.currentTime - queued.target) > 0.015) {
                        issueVideoSeek(video, queued.target, Boolean(queued.preferFastSeek));
                        return;
                    }
                }
                video.removeEventListener('seeked', onSeeked);
                seekCleanupRef.current = null;
                if (isPlayingRef.current && !isScrubbingRef.current && !video.seeking) {
                    playWhenAudioPrimed(video);
                } else {
                    restoreMutedAfterSeek(video);
                }
            };
            seekCleanupRef.current = () => video.removeEventListener('seeked', onSeeked);
            video.addEventListener('seeked', onSeeked);
            if (!video.seeking && needsSeek) {
                issueVideoSeek(video, clampedTarget, preferFastSeek);
            }
        } else {
            pendingSeekRef.current = null;
            playWhenAudioPrimed(video);
        }
    }, [cancelPendingSeekListener, issueVideoSeek, playWhenAudioPrimed, restoreMutedAfterSeek]);

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

            scheduleDeferredAmbientPaint(standby, false);
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
    }, [cancelPendingSeekListener, cancelPreParkTimer, getStandbyVideo, onTimeUpdate, scheduleDeferredAmbientPaint, seekAndSync]);

    // Single unified playback & seek coordinator: eliminates competing double-effect seeks on scrub release
    // and prevents stale discrete-gated `currentTime` props from snapping Story playback backward.
    useEffect(() => {
        const video = getActiveVideo();
        const standby = getStandbyVideo();
        const isExplicitSeek = seekNonce !== lastSeekNonceRef.current;
        lastSeekNonceRef.current = seekNonce;
        const wasPlaying = wasPlayingRef.current;
        const wasScrubbing = wasScrubbingRef.current;
        wasPlayingRef.current = isPlaying;
        wasScrubbingRef.current = isScrubbing;

        if (overlayOnly || !video) return;

        const action = resolvePlaybackSyncAction({
            isOutro,
            isScrubbing,
            isPlaying,
            wasPlaying,
            wasScrubbing,
            isExplicitSeek,
        });

        if (action === 'outro') {
            cancelPendingSeekListener();
            cancelPreParkTimer();
            pendingSeekRef.current = null;
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
            const hookOffset = draftRef.current.scenes?.[0]?.clipStartOffset ?? 0;
            if (video.readyState >= 1 && Math.abs(video.currentTime - hookOffset) > 0.08) {
                video.currentTime = hookOffset;
            }
            return;
        }

        if (action === 'noop') return;

        // Always sync live ref deterministically when paused, scrubbing, releasing a scrub, or executing an explicit user seek
        if (action === 'scrub' || action === 'pause-seek' || isExplicitSeek || wasScrubbing) {
            currentTimeRef.current = currentTime;
        }

        if (action === 'scrub') {
            cancelPendingSeekListener();
            cancelPreParkTimer();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
            if (video.readyState < 1) return;
            const vDur = video.duration || 10;
            const clampedTarget = clampMediaTarget(wrapMediaTime(draftRef.current, currentTime, vDur), vDur);
            const isMobileOrBlob = !useStandbyDeckRef.current || videoSrc.startsWith('blob:');
            const nowMs = performance.now();
            if (video.seeking || (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS)) {
                pendingSeekRef.current = { target: clampedTarget, shouldPlay: false, preferFastSeek: true };
            } else if (Math.abs(video.currentTime - clampedTarget) > 0.015) {
                lastMobileScrubSeekAtRef.current = nowMs;
                pendingSeekRef.current = null;
                issueVideoSeek(video, clampedTarget, shouldUseFastSeekDuringScrub(typeof video.fastSeek === 'function'));
            }
            return;
        }

        if (action === 'pause-seek') {
            cancelPreParkTimer();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
            if (wasScrubbing && pendingSeekRef.current && !pendingSeekRef.current.shouldPlay) {
                pendingSeekRef.current = null;
            }
            if (video.readyState < 1) {
                cancelPendingSeekListener();
                return;
            }
            const vDur = video.duration || 10;
            const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
            const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
            if (Math.abs(video.currentTime - clampedTarget) > 0.015 || video.seeking) {
                seekAndSync(video, targetMediaTime, false);
            } else {
                cancelPendingSeekListener();
            }
            return;
        }

        if (action === 'start-play') {
            if (wasScrubbing && pendingSeekRef.current && !pendingSeekRef.current.shouldPlay) {
                pendingSeekRef.current = null;
            }
            const vDur = video.duration || 10;
            const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
            seekAndSync(video, targetMediaTime, true);
            preParkStandbyDeck(standby, getNextCutMediaTarget(draftRef.current, currentTimeRef.current, playbackModeRef.current === 'loop-angle'));
            return;
        }

        // action === 'explicit-play-seek'
        if (video.readyState < 1) return;
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTime, vDur);
        const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
        if (Math.abs(video.currentTime - clampedTarget) > 0.04 || video.seeking) {
            transitionToMediaTime(video, targetMediaTime, currentTime);
        }
    }, [
        currentTime,
        seekNonce,
        isPlaying,
        isScrubbing,
        isOutro,
        overlayOnly,
        videoSrc,
        scenesTimingKey,
        draft.videoDuration,
        getActiveVideo,
        getStandbyVideo,
        cancelPendingSeekListener,
        cancelPreParkTimer,
        issueVideoSeek,
        seekAndSync,
        transitionToMediaTime,
    ]);

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
                const audit = postSeekAuditRef.current;
                if (audit && cur.readyState >= 2) {
                    const nowMs = performance.now();
                    const res = evaluatePostSeekAvSkew(audit, nowMs, cur.currentTime, metadata.mediaTime);
                    if (audit.maxObservedSkewSec > avDiagRef.current.maxPostSeekSkewSec) {
                        avDiagRef.current.maxPostSeekSkewSec = Math.round(audit.maxObservedSkewSec * 1000) / 1000;
                        publishAvDiag(avDiagRef.current);
                    }
                    if (!res.active) {
                        postSeekAuditRef.current = null;
                    }
                    if (res.shouldRecover) {
                        postSeekAuditRef.current = null;
                        isRecoverySeekRef.current = true;
                        avDiagRef.current.recoveryCount += 1;
                        avDiagRef.current.lastRecoveryAtMs = Math.round(nowMs);
                        publishAvDiag(avDiagRef.current);
                        currentTimeRef.current = mediaTimeToTimelineTime(draftRef.current, metadata.mediaTime, currentTimeRef.current);
                        // 1-shot keyframe-lock recovery: snaps to nearest 0-preroll keyframe so audio & video restart in lockstep
                        seekAndSync(cur, metadata.mediaTime, true, true);
                        const nextEl = getActiveVideo();
                        if (nextEl && typeof nextEl.requestVideoFrameCallback === 'function' && isPlayingRef.current) {
                            rVfcHandleRef.current = { el: nextEl, id: nextEl.requestVideoFrameCallback(onFrame) };
                        }
                        return;
                    }
                }
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
    }, [isPlaying, isScrubbing, overlayOnly, getActiveVideo, seekAndSync, syncTimelineTick]);

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
