import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, useState, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, evaluateSceneTransition, getTimelineStructure, clamp, type PlaybackSyncProfile } from "../../../types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";
import { clampMediaTarget, getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";
import {
    AUDIO_MASTER_GRACE_MS,
    MOBILE_SCRUB_THROTTLE_MS,
    VIDEO_FOLLOW_RATE_INTERVAL_MS,
    VIDEO_FOLLOW_SNAP_COOLDOWN_MS,
    computeVideoToAudioClockAdjustment,
    createInitialAvSyncDiag,
    getCanPlayTimeoutMs,
    resolvePlaybackSyncAction,
    resolveScrubSeekTarget,
    type AvSyncDiagSnapshot,
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
}

/**
 * Synchronises dual-deck `<video>` playback (plus an audio-master companion `<audio>` rail for high-risk
 * 4K AV1 / HEVC / long-GOP / fragmented / mobile `blob:` clips) with studio timeline state, coalesced seeks,
 * and real `stss` keyframe scrubbing.
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
    const [failedVideoSrc, setFailedVideoSrc] = useState<string | null>(null);
    const isCompanionFallback = failedVideoSrc === videoSrc;

    const videoRef = useRef<HTMLVideoElement>(null);
    const standbyVideoRef = useRef<HTMLVideoElement>(null);
    const companionAudioRef = useRef<HTMLAudioElement>(null);
    const activeVideoRef = useRef<HTMLVideoElement | null>(null);
    const audioOutputRef = useRef<HTMLMediaElement | null>(null);
    const activeDeckRef = useRef<0 | 1>(0);
    const effectiveMutedRef = useRef(effectiveMuted);
    const companionAudioFailedRef = useRef(false);
    const companionAudioUnlockedRef = useRef(false);
    const audioLaunchClaimedRef = useRef(false);
    const audioMasterStartedAtRef = useRef(0);
    const lastVideoRateAdjustAtRef = useRef(0);
    const lastVideoSnapAtRef = useRef(0);
    const consecutiveVideoSnapFramesRef = useRef(0);
    const rVfcHandleRef = useRef<{ el: HTMLVideoElement; id: number } | null>(null);
    const rVfcCallbackRef = useRef<VideoFrameRequestCallback | null>(null);
    const seekCleanupRef = useRef<(() => void) | null>(null);
    const playGateCleanupRef = useRef<(() => void) | null>(null);
    const ambientRafRef = useRef<number | null>(null);
    const seekStartedAtRef = useRef<number | null>(null);
    const avDiagRef = useRef<AvSyncDiagSnapshot>(createInitialAvSyncDiag());
    const lastMobileScrubSeekAtRef = useRef(0);
    const useStandbyDeckRef = useRef(useStandbyDeck);
    const playbackProfileRef = useRef<PlaybackSyncProfile>(playbackProfile);
    const prevPlaybackProfileRef = useRef<PlaybackSyncProfile>(playbackProfile);
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

    const pauseAllDecks = useCallback((video: HTMLVideoElement | null, standby: HTMLVideoElement | null) => {
        if (video) {
            video.playbackRate = 1;
            if (!video.paused) video.pause();
        }
        if (standby && !standby.paused) standby.pause();
        const audio = companionAudioRef.current;
        if (audio && !audio.paused) audio.pause();
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        consecutiveVideoSnapFramesRef.current = 0;
    }, []);

    // Expose live mutable diagnostics object once on mount (zero per-frame / per-render allocation)
    useEffect(() => {
        (globalThis as { __TPE_AV_DIAG__?: AvSyncDiagSnapshot }).__TPE_AV_DIAG__ = avDiagRef.current;
    }, []);

    // Sync refs before paint so `useSmoothFramingLoop`'s `useLayoutEffect` reads fresh `audioOutputRef` on frame 0
    useLayoutEffect(() => {
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
        isHeavyVideo: playbackProfile !== 'standard',
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
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        consecutiveVideoSnapFramesRef.current = 0;
        setFailedVideoSrc(videoSrcRef.current);
        const audio = companionAudioRef.current;
        if (audio) {
            try {
                audio.pause();
                audio.playbackRate = 1;
            } catch {}
        }
        const video = getActiveVideo();
        if (video) {
            video.playbackRate = 1;
            video.muted = effectiveMutedRef.current;
            audioOutputRef.current = video;
        }
        avDiagRef.current.companionAudioActive = false;
        avDiagRef.current.companionAudioFallback = true;
    }, [getActiveVideo]);

    const handleCompanionAudioError = useCallback(() => {
        fallbackToNativeVideoAudio();
    }, [fallbackToNativeVideoAudio]);

    /** Synchronously primes companion `<audio>` inside Play/Scrub pointer/keyboard gestures so mobile browsers allow async playback. */
    const unlockCompanionAudio = useCallback(() => {
        if (!isDecoupledActive()) return;
        const audio = companionAudioRef.current;
        if (!audio || companionAudioUnlockedRef.current) return;
        const prevMuted = audio.muted;
        audio.muted = true;
        audio.play().then(() => {
            // Pause if `beginAudioMasterLaunch` has not officially claimed ownership yet (prevents leaking old audio mid-seek)
            if (!audioLaunchClaimedRef.current || !isPlayingRef.current || isScrubbingRef.current) {
                audio.pause();
            }
            audio.muted = effectiveMutedRef.current;
            companionAudioUnlockedRef.current = true;
        }).catch(() => {
            audio.muted = prevMuted;
        });
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
    }, [cancelDeferredAmbientPaint, cancelPlayGate]);

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
        companionAudioFailedRef.current = false;
        companionAudioUnlockedRef.current = false;
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        lastVideoRateAdjustAtRef.current = 0;
        lastVideoSnapAtRef.current = 0;
        consecutiveVideoSnapFramesRef.current = 0;
        avDiagRef.current.companionAudioFallback = false;
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
            video.muted = decoupled ? true : effectiveMuted;
            video.volume = targetVol;
        }
        if (audio) {
            audio.muted = effectiveMuted;
            audio.volume = targetVol;
        }
        const standby = getStandbyVideo();
        if (standby) standby.muted = true;
    }, [effectiveMuted, draft.volume, isPlaying, playbackProfile, isCompanionFallback, getActiveVideo, getStandbyVideo, isDecoupledActive]);

    const syncCompanionAudioToTime = useCallback((targetMediaTime: number, shouldPause: boolean) => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        if (shouldPause && !audio.paused) audio.pause();
        if (shouldPause) {
            audioLaunchClaimedRef.current = false;
            audioMasterStartedAtRef.current = 0;
            consecutiveVideoSnapFramesRef.current = 0;
        }
        audio.playbackRate = 1;
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
                if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
                if (video.seeking) {
                    const onSettled = () => {
                        playGateCleanupRef.current = null;
                        armGate();
                    };
                    playGateCleanupRef.current = () => video.removeEventListener('seeked', onSettled);
                    video.addEventListener('seeked', onSettled, { once: true });
                    return;
                }

                const nowMs = performance.now();
                if (seekStartedAtRef.current !== null) {
                    avDiagRef.current.lastSeekDurationMs = Math.round(nowMs - seekStartedAtRef.current);
                    avDiagRef.current.readyStateAtPlay = video.readyState;
                    seekStartedAtRef.current = null;
                }

                scheduleDeferredAmbientPaint(video, false);
                onTimeUpdate?.(currentTimeRef.current, video.duration || 0);

                if (isDecoupledActive() && companionAudioRef.current) {
                    const audio = companionAudioRef.current;
                    const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
                    video.muted = true;
                    video.playbackRate = 1;
                    audio.playbackRate = 1;
                    audio.muted = effectiveMutedRef.current;
                    audio.volume = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);

                    // Audio-Master Launch: start uninterrupted <audio> FIRST and launch <video> when `playing` opens
                    const beginAudioMasterLaunch = () => {
                        cancelPlayGate();
                        if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
                        let videoLaunched = false;
                        const launchVideoLocked = () => {
                            if (videoLaunched) return;
                            videoLaunched = true;
                            cancelPlayGate();
                            if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
                            audioMasterStartedAtRef.current = performance.now();
                            lastVideoRateAdjustAtRef.current = 0;
                            consecutiveVideoSnapFramesRef.current = 0;
                            video.playbackRate = 1;
                            video.play().catch(() => { });
                        };
                        const launchTimer = setTimeout(launchVideoLocked, 450);
                        const onAudioPlaying = () => launchVideoLocked();
                        playGateCleanupRef.current = () => {
                            clearTimeout(launchTimer);
                            audio.removeEventListener('playing', onAudioPlaying);
                        };
                        audio.addEventListener('playing', onAudioPlaying, { once: true });
                        audioLaunchClaimedRef.current = true;
                        audio.play().catch((err) => {
                            cancelPlayGate();
                            audioLaunchClaimedRef.current = false;
                            if (!(err instanceof DOMException && err.name === 'AbortError')) {
                                fallbackToNativeVideoAudio();
                                if (isPlayingRef.current && !isScrubbingRef.current && !isOutroRef.current) {
                                    video.play().catch(() => { });
                                }
                            }
                        });
                    };

                    const prepareAndLaunchAudio = () => {
                        cancelPlayGate();
                        if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
                        if (audio.readyState >= 1) {
                            const clampedAudio = clampMediaTarget(video.currentTime, audio.duration || video.duration || 10);
                            if (Math.abs(audio.currentTime - clampedAudio) > 0.05) {
                                audio.currentTime = clampedAudio;
                            }
                        }
                        if (audio.seeking) {
                            const onAudioSeeked = () => {
                                playGateCleanupRef.current = null;
                                beginAudioMasterLaunch();
                            };
                            playGateCleanupRef.current = () => audio.removeEventListener('seeked', onAudioSeeked);
                            audio.addEventListener('seeked', onAudioSeeked, { once: true });
                        } else {
                            beginAudioMasterLaunch();
                        }
                    };

                    if (audio.readyState < 1) {
                        // Cold start: wait for `<audio>` metadata so `currentTime` actually parks at the target offset
                        const metaTimer = setTimeout(prepareAndLaunchAudio, 1500);
                        const onAudioMeta = () => prepareAndLaunchAudio();
                        playGateCleanupRef.current = () => {
                            clearTimeout(metaTimer);
                            audio.removeEventListener('loadedmetadata', onAudioMeta);
                            audio.removeEventListener('canplay', onAudioMeta);
                        };
                        audio.addEventListener('loadedmetadata', onAudioMeta, { once: true });
                        audio.addEventListener('canplay', onAudioMeta, { once: true });
                    } else {
                        prepareAndLaunchAudio();
                    }
                } else {
                    video.muted = effectiveMutedRef.current;
                    video.playbackRate = 1;
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
    }, [cancelPlayGate, fallbackToNativeVideoAudio, isDecoupledActive, onTimeUpdate, scheduleDeferredAmbientPaint]);

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
                    video.currentTime = pending.target;
                }
            } else {
                pendingSeekRef.current = null;
                if (Math.abs(video.currentTime - pending.target) > 0.015) {
                    video.currentTime = pending.target;
                }
                if (isDecoupledActive()) {
                    syncCompanionAudioToTime(pending.target, true);
                }
            }
        }
    }, [getActiveVideo, isDecoupledActive, scheduleDeferredAmbientPaint, syncCompanionAudioToTime]);

    /** Seeks to `targetMediaTime` safely (strict pause-before-seek, coalesced behind `video.seeking`) and plays once `seeked` + `canplay` settle. */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean) => {
        if (video.readyState < 1) return;

        const clampedTarget = clampMediaTarget(targetMediaTime, video.duration);
        const seekTol = shouldPlay ? 0.08 : 0.015;
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > seekTol;
        const decoupled = isDecoupledActive();

        cancelPendingSeekListener();
        video.playbackRate = 1;
        if (decoupled) {
            video.muted = true;
            syncCompanionAudioToTime(clampedTarget, true);
        }

        if (!shouldPlay) {
            if (!video.paused) video.pause();
            if (video.seeking) {
                pendingSeekRef.current = { target: clampedTarget, shouldPlay: false };
            } else if (needsSeek) {
                pendingSeekRef.current = null;
                video.currentTime = clampedTarget;
            } else {
                pendingSeekRef.current = null;
            }
            return;
        }

        if (needsSeek || video.seeking) {
            if (!video.paused) video.pause();
            seekStartedAtRef.current = performance.now();
            avDiagRef.current.lastSeekTargetSec = clampedTarget;
            if (decoupled) video.muted = true;
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
            if (!video.seeking && needsSeek) {
                video.currentTime = clampedTarget;
            }
        } else {
            pendingSeekRef.current = null;
            playWhenAudioPrimed(video);
        }
    }, [cancelPendingSeekListener, isDecoupledActive, playWhenAudioPrimed, syncCompanionAudioToTime]);

    // Seamlessly hand off audio when `playbackProfile` switches mid-playback (e.g. lazy IDB inspect or viewport resize)
    useEffect(() => {
        const prev = prevPlaybackProfileRef.current;
        prevPlaybackProfileRef.current = playbackProfile;
        if (prev === playbackProfile || overlayOnly) return;
        const video = getActiveVideo();
        if (!video) return;
        if (playbackProfile === 'decoupled-audio-lock' && !companionAudioFailedRef.current) {
            video.muted = true;
            if (isPlayingRef.current && !isScrubbingRef.current && !isOutroRef.current && video.readyState >= 1) {
                seekAndSync(video, video.currentTime, true);
            }
        } else if (prev === 'decoupled-audio-lock') {
            const audio = companionAudioRef.current;
            if (audio && !audio.paused) audio.pause();
            audioLaunchClaimedRef.current = false;
            audioMasterStartedAtRef.current = 0;
            consecutiveVideoSnapFramesRef.current = 0;
            video.playbackRate = 1;
            video.muted = effectiveMutedRef.current;
            audioOutputRef.current = video;
        }
    }, [playbackProfile, overlayOnly, getActiveVideo, seekAndSync]);

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
            standby.playbackRate = 1;
            const { audioGain } = evaluateSceneTransition(draftRef.current, nextTimelineTime);
            standby.volume = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);
            audioOutputRef.current = decoupled ? companionAudioRef.current : standby;
            if (isPlayingRef.current && !isScrubbingRef.current) {
                if (decoupled) {
                    seekAndSync(standby, targetMediaTime, true);
                } else {
                    standby.play().catch(() => { });
                }
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
    }, [cancelPendingSeekListener, cancelPreParkTimer, getStandbyVideo, isDecoupledActive, onTimeUpdate, scheduleDeferredAmbientPaint, seekAndSync]);

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
            pauseAllDecks(video, standby);
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
            pauseAllDecks(video, standby);
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
                pendingSeekRef.current = { target: scrubTarget, shouldPlay: false };
            } else if (Math.abs(video.currentTime - scrubTarget) > 0.015) {
                lastMobileScrubSeekAtRef.current = nowMs;
                pendingSeekRef.current = null;
                video.currentTime = scrubTarget;
            }
            return;
        }

        if (action === 'pause-seek') {
            cancelPreParkTimer();
            pauseAllDecks(video, standby);
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
                if (isDecoupledActive()) {
                    syncCompanionAudioToTime(clampedTarget, true);
                }
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
        isDecoupledActive,
        pauseAllDecks,
        cancelPendingSeekListener,
        cancelPreParkTimer,
        syncCompanionAudioToTime,
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
                const audioRolling = isDecoupledActive() && Boolean(audio) && audio!.readyState >= 1 && !audio!.paused && !audio!.seeking;
                if (isDecoupledActive() && audio && cur.readyState >= 2) {
                    cur.muted = true;
                    const frameTime = clampMediaTarget(metadata.mediaTime, cur.duration || 10);
                    const nowMs = performance.now();
                    if (
                        audioRolling &&
                        audioMasterStartedAtRef.current > 0 &&
                        nowMs - audioMasterStartedAtRef.current >= AUDIO_MASTER_GRACE_MS
                    ) {
                        // Video-Follower Lock: NEVER seek or rate-shift <audio>; gently adjust muted <video> only
                        const adj = computeVideoToAudioClockAdjustment(frameTime, audio.currentTime);
                        avDiagRef.current.lastAudioDriftMs = Math.round(adj.driftSec * 1000);

                        if (adj.mode === 'snap-video') {
                            consecutiveVideoSnapFramesRef.current += 1;
                            if (
                                consecutiveVideoSnapFramesRef.current >= 4 &&
                                nowMs - lastVideoSnapAtRef.current >= VIDEO_FOLLOW_SNAP_COOLDOWN_MS &&
                                adj.targetVideoTime !== undefined
                            ) {
                                consecutiveVideoSnapFramesRef.current = 0;
                                lastVideoSnapAtRef.current = nowMs;
                                cur.playbackRate = 1;
                                cur.currentTime = clampMediaTarget(adj.targetVideoTime, cur.duration || 10);
                            }
                        } else {
                            consecutiveVideoSnapFramesRef.current = 0;
                            if (
                                nowMs - lastVideoRateAdjustAtRef.current >= VIDEO_FOLLOW_RATE_INTERVAL_MS &&
                                Math.abs(cur.playbackRate - adj.videoPlaybackRate) > 0.004
                            ) {
                                lastVideoRateAdjustAtRef.current = nowMs;
                                cur.playbackRate = adj.videoPlaybackRate;
                            }
                        }
                    }
                }
                // Single Master Clock: evaluate scene/cut boundaries from `<audio>` whenever decoupled audio is rolling
                const masterMediaTime = audioRolling && audio ? audio.currentTime : metadata.mediaTime;
                syncTimelineTick(cur, masterMediaTime);
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
    }, [isPlaying, isScrubbing, overlayOnly, getActiveVideo, isDecoupledActive, syncTimelineTick]);

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

    const handleCompanionAudioLoadedMetadata = useCallback(() => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        const vDur = getActiveVideo()?.duration || audio.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
        syncCompanionAudioToTime(targetMediaTime, !audioLaunchClaimedRef.current);
    }, [getActiveVideo, isDecoupledActive, syncCompanionAudioToTime]);

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
        const audio = companionAudioRef.current;
        const masterTime = (isDecoupledActive() && audio && audio.readyState >= 1 && !audio.paused && !audio.seeking)
            ? audio.currentTime
            : video.currentTime;
        syncTimelineTick(video, masterTime);
    };

    const handleEnded = useCallback(() => {
        const video = getActiveVideo();
        if (!video || overlayOnly || isOutroRef.current) return;
        const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draftRef.current.scenes || []);
        const t = currentTimeRef.current;
        const target = t < hookDur ? hookOffset : (hasReHook && t < preStoryDur ? rehookOffset : storyOffset);
        seekAndSync(video, target, isPlayingRef.current);
    }, [overlayOnly, getActiveVideo, seekAndSync]);

    return {
        videoRef,
        standbyVideoRef,
        companionAudioRef,
        activeVideoRef,
        audioOutputRef,
        currentTimeRef,
        ambientCropRef,
        ambientVisibilityRef,
        isCameraGlidingRef,
        ambientCanvasRef,
        midEdgeCanvasRef,
        nearEdgeCanvasRef,
        topAmbientCanvasRef,
        topMidEdgeCanvasRef,
        topNearEdgeCanvasRef,
        isCompanionFallback,
        unlockCompanionAudio,
        handleCompanionAudioError,
        handleCompanionAudioLoadedMetadata,
        refreshAmbientGlow,
        handleLoadedMetadata,
        handleStandbyLoadedMetadata,
        handleTimeUpdate,
        handleEnded,
    };
};
