import { useRef, useEffect, useCallback, useMemo, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, evaluateSceneTransition, getTimelineStructure, clamp, type PlaybackSyncProfile } from "../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";
import { clampMediaTarget, getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";
import {
    MOBILE_SCRUB_THROTTLE_MS,
    computeCompanionAudioAdjustment,
    createInitialAvSyncDiag,
    createPostSeekAudit,
    evaluatePostSeekAvSkew,
    getCanPlayTimeoutMs,
    resolvePlaybackSyncAction,
    resolveScrubSeekTarget,
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
    playbackProfile?: PlaybackSyncProfile;
    keyframeTimes?: number[];
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
 * Synchronises dual-deck `<video>` playback (plus an `rVFC`-locked companion `<audio>` rail for high-risk
 * 4K AV1 / HEVC / long-GOP / mobile `blob:` clips) with studio timeline state, coalesced seeks,
 * real `stss` keyframe scrubbing, and post-seek A/V skew telemetry.
 */
export const useVideoElementSync = ({
    draft,
    videoSrc,
    isPlaying,
    isScrubbing,
    isOutro = false,
    playbackMode = 'play-all',
    playbackProfile = 'standard',
    keyframeTimes,
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
    const companionAudioRef = useRef<HTMLAudioElement>(null);
    const activeVideoRef = useRef<HTMLVideoElement | null>(null);
    const audioOutputRef = useRef<HTMLMediaElement | null>(null);
    const activeDeckRef = useRef<0 | 1>(0);
    const effectiveMutedRef = useRef(effectiveMuted);
    const companionAudioFailedRef = useRef(false);
    const companionAudioUnlockedRef = useRef(false);
    const companionAudioStartedRef = useRef(false);
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
    const playbackProfileRef = useRef<PlaybackSyncProfile>(playbackProfile);
    const keyframeTimesRef = useRef<number[] | undefined>(keyframeTimes);
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
    const lastCompanionAudioElRef = useRef<HTMLAudioElement | null>(null);

    const releaseDetachedDeck = useCallback((el: HTMLMediaElement | null) => {
        // Guard with `!el.isConnected` so React 19 StrictMode's simulated dev cleanup never strips `src` off live decks
        if (!el || el.isConnected) return;
        try {
            el.pause();
            el.removeAttribute("src");
            el.load();
        } catch {}
    }, []);

    const getActiveVideo = useCallback(
        () => activeVideoRef.current ?? videoRef.current,
        []
    );
    const getStandbyVideo = useCallback(
        () => (activeDeckRef.current === 0 ? standbyVideoRef.current : videoRef.current),
        []
    );
    const isDecoupledActive = useCallback(
        () => playbackProfileRef.current === 'decoupled-audio-lock' && !companionAudioFailedRef.current,
        []
    );

    useEffect(() => {
        isPlayingRef.current = isPlaying;
        isScrubbingRef.current = isScrubbing;
        isOutroRef.current = isOutro;
        playbackModeRef.current = playbackMode;
        draftRef.current = draft;
        effectiveMutedRef.current = effectiveMuted;
        useStandbyDeckRef.current = useStandbyDeck;
        playbackProfileRef.current = playbackProfile;
        keyframeTimesRef.current = keyframeTimes;
        videoSrcRef.current = videoSrc;

        const prevPrimary = lastPrimaryElRef.current;
        const prevStandby = lastStandbyElRef.current;
        const prevAudio = lastCompanionAudioElRef.current;
        lastPrimaryElRef.current = videoRef.current;
        lastStandbyElRef.current = standbyVideoRef.current;
        lastCompanionAudioElRef.current = companionAudioRef.current;
        if (prevPrimary && prevPrimary !== videoRef.current) releaseDetachedDeck(prevPrimary);
        if (prevStandby && prevStandby !== standbyVideoRef.current) releaseDetachedDeck(prevStandby);
        if (prevAudio && prevAudio !== companionAudioRef.current) releaseDetachedDeck(prevAudio);

        if ((!activeVideoRef.current || !activeVideoRef.current.isConnected) && videoRef.current) {
            activeVideoRef.current = videoRef.current;
            activeDeckRef.current = 0;
        }

        const decoupled = playbackProfile === 'decoupled-audio-lock' && !companionAudioFailedRef.current && Boolean(companionAudioRef.current);
        audioOutputRef.current = decoupled ? companionAudioRef.current : (activeVideoRef.current ?? videoRef.current);
        avDiagRef.current.profile = playbackProfile;
        avDiagRef.current.companionAudioActive = decoupled;
        publishAvDiag(avDiagRef.current);
    });

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

    const fallbackToNativeVideoAudio = useCallback(() => {
        companionAudioFailedRef.current = true;
        companionAudioStartedRef.current = false;
        const audio = companionAudioRef.current;
        if (audio) {
            try { audio.pause(); } catch {}
        }
        const video = getActiveVideo();
        if (video) {
            video.muted = effectiveMutedRef.current;
            audioOutputRef.current = video;
        }
        avDiagRef.current.companionAudioActive = false;
        avDiagRef.current.companionAudioFallback = true;
        publishAvDiag(avDiagRef.current);
    }, [getActiveVideo]);

    const handleCompanionAudioError = useCallback(() => {
        fallbackToNativeVideoAudio();
    }, [fallbackToNativeVideoAudio]);

    /** Synchronously primes companion `<audio>` inside Play/Scrub pointer gestures so mobile browsers allow async rVFC `.play()`. */
    const unlockCompanionAudio = useCallback(() => {
        if (!isDecoupledActive()) return;
        const audio = companionAudioRef.current;
        if (!audio || companionAudioUnlockedRef.current) return;
        const prevMuted = audio.muted;
        audio.muted = true;
        audio.play().then(() => {
            if (!isPlayingRef.current || isScrubbingRef.current || !companionAudioStartedRef.current) {
                audio.pause();
            }
            audio.muted = effectiveMutedRef.current;
            companionAudioUnlockedRef.current = true;
        }).catch(() => {
            audio.muted = prevMuted;
        });
    }, [isDecoupledActive]);

    const restoreMutedAfterSeek = useCallback((video: HTMLVideoElement | null) => {
        if (isDecoupledActive()) {
            seekMutedGuardRef.current = false;
            if (video) video.muted = true;
            if (companionAudioRef.current) companionAudioRef.current.muted = effectiveMutedRef.current;
            return;
        }
        if (!seekMutedGuardRef.current) return;
        seekMutedGuardRef.current = false;
        if (video) {
            video.muted = effectiveMutedRef.current;
        }
    }, [isDecoupledActive]);

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

    // Release hardware decoders & companion audio cleanly on real unmount
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
        releaseDetachedDeck(lastCompanionAudioElRef.current);
    }, [cancelPendingSeekListener, cancelPreParkTimer, releaseDetachedDeck]);

    useEffect(() => {
        seekStartedAtRef.current = null;
        postSeekAuditRef.current = null;
        isRecoverySeekRef.current = false;
        companionAudioFailedRef.current = false;
        companionAudioUnlockedRef.current = false;
        companionAudioStartedRef.current = false;
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
        const audio = companionAudioRef.current;
        const decoupled = isDecoupledActive() && Boolean(audio);
        const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
        const targetVol = clamp((draft.volume ?? 1) * audioGain, 0, 1);

        if (video) {
            if (decoupled) {
                video.muted = true;
            } else if (!seekMutedGuardRef.current) {
                video.muted = effectiveMuted;
            }
            video.volume = targetVol;
        }
        if (audio) {
            audio.muted = effectiveMuted;
            audio.volume = targetVol;
        }
        const standby = getStandbyVideo();
        if (standby) standby.muted = true;
    }, [effectiveMuted, draft.volume, isPlaying, playbackProfile, getActiveVideo, getStandbyVideo, isDecoupledActive]);

    const issueVideoSeek = useCallback((video: HTMLVideoElement, clampedTarget: number, preferFastSeek: boolean) => {
        if (preferFastSeek && typeof video.fastSeek === 'function') {
            video.fastSeek(clampedTarget);
        } else {
            video.currentTime = clampedTarget;
        }
    }, []);

    const syncCompanionAudioToTime = useCallback((targetMediaTime: number, shouldPause: boolean) => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        if (shouldPause && !audio.paused) audio.pause();
        if (shouldPause) companionAudioStartedRef.current = false;
        if (audio.readyState >= 1) {
            const clamped = clampMediaTarget(targetMediaTime, audio.duration || getActiveVideo()?.duration || 10);
            if (Math.abs(audio.currentTime - clamped) > 0.04) {
                audio.currentTime = clamped;
            }
        }
    }, [getActiveVideo, isDecoupledActive]);

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
                    if (!isDecoupledActive() && isMobileOrBlob && !isRecoverySeekRef.current) {
                        postSeekAuditRef.current = createPostSeekAudit(nowMs);
                    } else {
                        postSeekAuditRef.current = null;
                    }
                    isRecoverySeekRef.current = false;
                    publishAvDiag(avDiagRef.current);
                }

                scheduleDeferredAmbientPaint(video, false);
                onTimeUpdate?.(currentTimeRef.current, video.duration || 0);

                if (isDecoupledActive() && companionAudioRef.current) {
                    video.muted = true;
                    const audio = companionAudioRef.current;
                    companionAudioStartedRef.current = false;
                    syncCompanionAudioToTime(video.currentTime, true);
                    video.play().catch(() => { });
                    // Fallback when rVFC is unavailable: start companion audio directly
                    if (typeof video.requestVideoFrameCallback !== 'function') {
                        companionAudioStartedRef.current = true;
                        audio.playbackRate = 1;
                        audio.play().catch((err) => {
                            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                                fallbackToNativeVideoAudio();
                            }
                        });
                    }
                } else {
                    video.play().catch(() => { });
                }
            };

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
    }, [cancelPlayGate, fallbackToNativeVideoAudio, isDecoupledActive, onTimeUpdate, restoreMutedAfterSeek, scheduleDeferredAmbientPaint, syncCompanionAudioToTime]);

    const refreshAmbientGlow = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video) return;
        if (e && e.currentTarget !== video) return;
        const isMobileOrBlob = !useStandbyDeckRef.current || videoSrcRef.current.startsWith('blob:');
        if (!(isScrubbingRef.current && isMobileOrBlob)) {
            scheduleDeferredAmbientPaint(video, true);
        }
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
        const decoupled = isDecoupledActive();

        cancelPendingSeekListener();
        if (decoupled) {
            video.muted = true;
            syncCompanionAudioToTime(clampedTarget, true);
        }

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
            if (!video.paused) video.pause();
            seekStartedAtRef.current = performance.now();
            avDiagRef.current.lastSeekTargetSec = clampedTarget;
            if (decoupled) {
                video.muted = true;
            } else if (isMobileOrBlob) {
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
    }, [cancelPendingSeekListener, isDecoupledActive, issueVideoSeek, playWhenAudioPrimed, restoreMutedAfterSeek, syncCompanionAudioToTime]);

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

            const decoupled = isDecoupledActive() && Boolean(companionAudioRef.current);
            standby.muted = decoupled ? true : effectiveMutedRef.current;
            const { audioGain } = evaluateSceneTransition(draftRef.current, nextTimelineTime);
            const targetVol = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);
            standby.volume = targetVol;
            audioOutputRef.current = decoupled ? companionAudioRef.current : standby;

            if (decoupled && companionAudioRef.current) {
                companionAudioRef.current.volume = targetVol;
                companionAudioStartedRef.current = false;
                syncCompanionAudioToTime(targetMediaTime, true);
            }
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
    }, [cancelPendingSeekListener, cancelPreParkTimer, getStandbyVideo, isDecoupledActive, onTimeUpdate, scheduleDeferredAmbientPaint, seekAndSync, syncCompanionAudioToTime]);

    // Single unified playback & seek coordinator
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
            if (companionAudioRef.current && !companionAudioRef.current.paused) companionAudioRef.current.pause();
            companionAudioStartedRef.current = false;
            const hookOffset = draftRef.current.scenes?.[0]?.clipStartOffset ?? 0;
            if (video.readyState >= 1 && Math.abs(video.currentTime - hookOffset) > 0.08) {
                video.currentTime = hookOffset;
            }
            return;
        }

        if (action === 'noop') return;

        if (action === 'scrub' || action === 'pause-seek' || isExplicitSeek || wasScrubbing) {
            currentTimeRef.current = currentTime;
        }

        if (action === 'scrub') {
            cancelPendingSeekListener();
            cancelPreParkTimer();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
            if (companionAudioRef.current && !companionAudioRef.current.paused) companionAudioRef.current.pause();
            companionAudioStartedRef.current = false;
            if (video.readyState < 1) return;
            const vDur = video.duration || 10;
            const clampedTarget = clampMediaTarget(wrapMediaTime(draftRef.current, currentTime, vDur), vDur);
            const useKeyframeSnap = playbackProfileRef.current !== 'standard';
            const scrubTarget = clampMediaTarget(
                resolveScrubSeekTarget(clampedTarget, keyframeTimesRef.current, useKeyframeSnap),
                vDur
            );
            const isMobileOrBlob = !useStandbyDeckRef.current || videoSrc.startsWith('blob:');
            const nowMs = performance.now();
            if (video.seeking || (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS)) {
                pendingSeekRef.current = { target: scrubTarget, shouldPlay: false, preferFastSeek: true };
            } else if (Math.abs(video.currentTime - scrubTarget) > 0.015) {
                lastMobileScrubSeekAtRef.current = nowMs;
                pendingSeekRef.current = null;
                issueVideoSeek(video, scrubTarget, shouldUseFastSeekDuringScrub(typeof video.fastSeek === 'function'));
            }
            return;
        }

        if (action === 'pause-seek') {
            cancelPreParkTimer();
            if (!video.paused) video.pause();
            if (standby && !standby.paused) standby.pause();
            if (companionAudioRef.current && !companionAudioRef.current.paused) companionAudioRef.current.pause();
            companionAudioStartedRef.current = false;
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
                const audio = companionAudioRef.current;
                if (isDecoupledActive() && audio && cur.readyState >= 2) {
                    cur.muted = true;
                    const frameTime = clampMediaTarget(metadata.mediaTime, cur.duration || 10);
                    if (!companionAudioStartedRef.current) {
                        const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
                        audio.muted = effectiveMutedRef.current;
                        audio.volume = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);
                        audio.playbackRate = 1;
                        if (audio.readyState >= 1) {
                            audio.currentTime = clampMediaTarget(frameTime, audio.duration || cur.duration || 10);
                        }
                        companionAudioStartedRef.current = true;
                        audio.play().catch((err) => {
                            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                                fallbackToNativeVideoAudio();
                            }
                        });
                    } else if (audio.readyState >= 1) {
                        const adj = computeCompanionAudioAdjustment(audio.currentTime, frameTime);
                        avDiagRef.current.lastAudioDriftMs = Math.round(adj.driftSec * 1000);
                        if (Math.abs(adj.driftSec) > avDiagRef.current.maxPostSeekSkewSec) {
                            avDiagRef.current.maxPostSeekSkewSec = Math.round(Math.abs(adj.driftSec) * 1000) / 1000;
                        }
                        publishAvDiag(avDiagRef.current);

                        if (adj.mode === 'snap' && !audio.seeking && adj.targetTime !== undefined) {
                            audio.playbackRate = 1;
                            audio.currentTime = clampMediaTarget(adj.targetTime, audio.duration || cur.duration || 10);
                        } else if (Math.abs(audio.playbackRate - adj.playbackRate) > 0.002) {
                            audio.playbackRate = adj.playbackRate;
                        }
                        if (audio.paused && !audio.seeking) {
                            audio.play().catch((err) => {
                                if (!(err instanceof DOMException && err.name === 'AbortError')) {
                                    fallbackToNativeVideoAudio();
                                }
                            });
                        }
                    }
                } else {
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
                            const recoveryTarget = resolveScrubSeekTarget(metadata.mediaTime, keyframeTimesRef.current, true);
                            seekAndSync(cur, recoveryTarget, true, true);
                            const nextEl = getActiveVideo();
                            if (nextEl && typeof nextEl.requestVideoFrameCallback === 'function' && isPlayingRef.current) {
                                rVfcHandleRef.current = { el: nextEl, id: nextEl.requestVideoFrameCallback(onFrame) };
                            }
                            return;
                        }
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
    }, [isPlaying, isScrubbing, overlayOnly, fallbackToNativeVideoAudio, getActiveVideo, isDecoupledActive, seekAndSync, syncTimelineTick]);

    const handleLoadedMetadata = () => {
        const video = getActiveVideo();
        if (!video) return;
        if (video.videoWidth && video.videoHeight) onAspectDetected(video.videoWidth / video.videoHeight);
        const vDur = video.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
        if (isDecoupledActive()) {
            video.muted = true;
            syncCompanionAudioToTime(targetMediaTime, !isPlayingRef.current);
        }
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

    return { videoRef, standbyVideoRef, companionAudioRef, activeVideoRef, audioOutputRef, currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef, ambientCanvasRef, midEdgeCanvasRef, nearEdgeCanvasRef, topAmbientCanvasRef, topMidEdgeCanvasRef, topNearEdgeCanvasRef, unlockCompanionAudio, handleCompanionAudioError, refreshAmbientGlow, handleLoadedMetadata, handleStandbyLoadedMetadata, handleTimeUpdate, handleEnded };
};
