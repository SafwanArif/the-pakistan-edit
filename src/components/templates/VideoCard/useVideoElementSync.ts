import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, evaluateSceneTransition, getTimelineStructure, clamp, type PlaybackSyncProfile } from "@/types/news";
import type { AmbientCropRect, AmbientVisibilityState } from "./useSmoothFramingLoop";
import { clampMediaTarget, getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";
import { useCompanionAudioLock, type VideoSyncRuntimeCtx } from "./useCompanionAudioLock";
import {
    MOBILE_SCRUB_THROTTLE_MS,
    createInitialAvSyncDiag,
    getCanPlayTimeoutMs,
    resolvePlaybackSyncAction,
    resolveScrubSeekTarget,
    type AvSyncDiagSnapshot,
    type PlaybackEngineState,
} from "./avSyncHelpers";
import { seekMediaElement, waitForMediaEvent } from "./mediaAsyncHelpers";

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

const getFiniteDuration = (video: HTMLVideoElement): number | null =>
    Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

/**
 * Synchronises dual-deck `<video>` playback + pure-`.m4a` companion `<audio>` rail with studio timeline state
 * via a single `AbortController`-scoped 5-state engine (`idle | seeking | priming | playing | buffering`).
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
    const activeVideoRef = useRef<HTMLVideoElement | null>(null);
    const audioOutputRef = useRef<HTMLMediaElement | null>(null);
    const activeDeckRef = useRef<0 | 1>(0);
    const engineStateRef = useRef<PlaybackEngineState>('idle');
    const opAbortRef = useRef<AbortController | null>(null);
    const rVfcHandleRef = useRef<{ el: HTMLVideoElement; id: number } | null>(null);
    const rVfcCallbackRef = useRef<VideoFrameRequestCallback | null>(null);
    const ambientRafRef = useRef<number | null>(null);
    const seekStartedAtRef = useRef<number | null>(null);
    const avDiagRef = useRef<AvSyncDiagSnapshot>(createInitialAvSyncDiag());
    const lastMobileScrubSeekAtRef = useRef(0);
    const prevPlaybackProfileRef = useRef<PlaybackSyncProfile>(playbackProfile);
    const preParkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const standbySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingScrubTargetRef = useRef<number | null>(null);
    const lastSeekNonceRef = useRef(seekNonce);
    const wasPlayingRef = useRef(isPlaying);
    const wasScrubbingRef = useRef(isScrubbing);
    const isCameraGlidingRef = useRef(false);

    // Consolidated runtime context (replaces 15+ scattered prop-mirror refs)
    const ctxRef = useRef<VideoSyncRuntimeCtx>({
        draft, videoSrc, isPlaying, isScrubbing, isOutro, playbackMode,
        playbackProfile, effectiveMuted, useStandbyDeck, keyframeTimes,
    });
    const currentTimeRef = useRef(currentTime);
    const draftRef = useRef(draft);
    const isPlayingRef = useRef(isPlaying);
    const isScrubbingRef = useRef(isScrubbing);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onAspectDetectedRef = useRef(onAspectDetected);
    const lastPrimaryElRef = useRef<HTMLVideoElement | null>(null);
    const lastStandbyElRef = useRef<HTMLVideoElement | null>(null);

    const releaseDetachedDeck = useCallback((el: HTMLMediaElement | null) => {
        // Guard with `!el.isConnected` so React 19 StrictMode's dev cleanup never strips `src` off live decks
        if (!el || el.isConnected) return;
        try {
            el.pause();
            el.removeAttribute("src");
            el.load();
        } catch { /* ignore detached media element teardown errors */ }
    }, []);

    const getActiveVideo = useCallback(() => activeVideoRef.current ?? videoRef.current, []);
    const getStandbyVideo = useCallback(
        () => (activeDeckRef.current === 0 ? standbyVideoRef.current : videoRef.current),
        []
    );

    const {
        companionAudioRef,
        isCompanionFallback,
        isDecoupledActive,
        isAudioUnlocking,
        pauseCompanionAudio,
        resetForNewSource,
        syncDetachedAudioRef,
        releaseCompanionAudio,
        handleCompanionAudioError,
        handleCompanionAudioEnded,
        unlockCompanionAudio,
        syncCompanionAudioToTime,
        handleCompanionAudioLoadedMetadata,
        launchDecoupledAudioMaster,
        applyVideoFollowerTick,
        getRollingCompanionAudioTime,
    } = useCompanionAudioLock({
        videoSrc,
        ctxRef,
        currentTimeRef,
        audioOutputRef,
        avDiagRef,
        engineStateRef,
        getActiveVideo,
        releaseDetachedDeck,
    });

    const cancelDeferredAmbientPaint = useCallback(() => {
        if (ambientRafRef.current !== null) {
            cancelAnimationFrame(ambientRafRef.current);
            ambientRafRef.current = null;
        }
    }, []);

    const cancelActiveOp = useCallback(() => {
        opAbortRef.current?.abort();
        opAbortRef.current = null;
        cancelDeferredAmbientPaint();
        engineStateRef.current = 'idle';
    }, [cancelDeferredAmbientPaint]);

    const beginOp = useCallback((): AbortSignal => {
        cancelActiveOp();
        const controller = new AbortController();
        opAbortRef.current = controller;
        return controller.signal;
    }, [cancelActiveOp]);

    const cancelPreParkTimer = useCallback(() => {
        if (preParkTimerRef.current !== null) {
            clearTimeout(preParkTimerRef.current);
            preParkTimerRef.current = null;
        }
    }, []);

    const pauseAllDecks = useCallback((video: HTMLVideoElement | null, standby: HTMLVideoElement | null) => {
        if (video) {
            video.playbackRate = 1;
            if (!video.paused) video.pause();
        }
        if (standby && !standby.paused) standby.pause();
        pauseCompanionAudio();
    }, [pauseCompanionAudio]);

    useEffect(() => {
        (globalThis as { __TPE_AV_DIAG__?: AvSyncDiagSnapshot }).__TPE_AV_DIAG__ = avDiagRef.current;
    }, []);

    // Sync refs before paint so `useSmoothFramingLoop`'s `useLayoutEffect` reads fresh `audioOutputRef` & `engineStateRef`
    useLayoutEffect(() => {
        ctxRef.current = {
            draft, videoSrc, isPlaying, isScrubbing, isOutro, playbackMode,
            playbackProfile, effectiveMuted, useStandbyDeck, keyframeTimes,
        };
        draftRef.current = draft;
        isPlayingRef.current = isPlaying;
        isScrubbingRef.current = isScrubbing;
        onTimeUpdateRef.current = onTimeUpdate;
        onAspectDetectedRef.current = onAspectDetected;

        const prevPrimary = lastPrimaryElRef.current;
        const prevStandby = lastStandbyElRef.current;
        lastPrimaryElRef.current = videoRef.current;
        lastStandbyElRef.current = standbyVideoRef.current;
        if (prevPrimary && prevPrimary !== videoRef.current) releaseDetachedDeck(prevPrimary);
        if (prevStandby && prevStandby !== standbyVideoRef.current) releaseDetachedDeck(prevStandby);
        syncDetachedAudioRef();

        // Reset to primary deck whenever standby deck unmounts or active element detaches (`A6`)
        if ((!activeVideoRef.current || !activeVideoRef.current.isConnected || (!useStandbyDeck && activeDeckRef.current === 1)) && videoRef.current) {
            activeVideoRef.current = videoRef.current;
            activeDeckRef.current = 0;
            videoRef.current.style.opacity = '1';
            videoRef.current.style.zIndex = '2';
        }

        const decoupled = isDecoupledActive() && Boolean(companionAudioRef.current);
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

    const scheduleDeferredAmbientPaint = useCallback((video: HTMLVideoElement, force = false) => {
        cancelDeferredAmbientPaint();
        ambientRafRef.current = requestAnimationFrame(() => {
            ambientRafRef.current = null;
            if (!video.isConnected || video.seeking) return;
            paintAmbientCanvas(video, force);
        });
    }, [cancelDeferredAmbientPaint, paintAmbientCanvas]);

    // Release hardware decoders & companion audio cleanly on real unmount
    useEffect(() => () => {
        cancelActiveOp();
        cancelPreParkTimer();
        if (standbySyncTimerRef.current !== null) {
            clearTimeout(standbySyncTimerRef.current);
            standbySyncTimerRef.current = null;
        }
        pendingScrubTargetRef.current = null;
        releaseDetachedDeck(lastPrimaryElRef.current);
        releaseDetachedDeck(lastStandbyElRef.current);
        releaseCompanionAudio();
    }, [cancelActiveOp, cancelPreParkTimer, releaseCompanionAudio, releaseDetachedDeck]);

    // Reset active deck & abort in-flight ops whenever `videoSrc` changes (`A6`, `A12`)
    useEffect(() => {
        cancelActiveOp();
        cancelPreParkTimer();
        pendingScrubTargetRef.current = null;
        seekStartedAtRef.current = null;
        resetForNewSource();
        activeDeckRef.current = 0;
        activeVideoRef.current = videoRef.current;
        if (videoRef.current) {
            videoRef.current.style.opacity = '1';
            videoRef.current.style.zIndex = '2';
        }
        if (standbyVideoRef.current) {
            standbyVideoRef.current.style.opacity = '0';
            standbyVideoRef.current.style.zIndex = '1';
        }
    }, [videoSrc, cancelActiveOp, cancelPreParkTimer, resetForNewSource]);

    // Pure timing signature (excludes non-timing `shareHookText`, fixing `A8`)
    const scenesTimingKey = useMemo(
        () => (draft.scenes || []).map((s) => `${s.id}:${s.duration}:${s.clipStartOffset ?? ''}:${s.mediaUrl ?? ''}:${s.mediaType ?? ''}`).join('|'),
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
            preParkStandbyDeck(getStandbyVideo(), getNextCutMediaTarget(ctxRef.current.draft, currentTimeRef.current, ctxRef.current.playbackMode === 'loop-angle'));
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
        const { audioGain } = evaluateSceneTransition(ctxRef.current.draft, currentTimeRef.current);
        const targetVol = clamp((draft.volume ?? 1) * audioGain, 0, 1);

        if (video) {
            video.muted = decoupled ? true : effectiveMuted;
            video.volume = targetVol;
        }
        if (audio) {
            audio.muted = isAudioUnlocking() ? true : effectiveMuted;
            audio.volume = targetVol;
        }
        const standby = getStandbyVideo();
        if (standby) standby.muted = true;
    }, [effectiveMuted, draft.volume, isPlaying, playbackProfile, isCompanionFallback, companionAudioRef, getActiveVideo, getStandbyVideo, isAudioUnlocking, isDecoupledActive]);

    const refreshAmbientGlow = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video)) return;
        const ctx = ctxRef.current;
        const isMobileOrBlob = !ctx.useStandbyDeck || ctx.videoSrc.startsWith('blob:');
        if (!(ctx.isScrubbing && isMobileOrBlob) && !(ctx.isPlaying && !ctx.isScrubbing)) {
            scheduleDeferredAmbientPaint(video, true);
        }
        const pending = pendingScrubTargetRef.current;
        if (pending !== null && !ctx.isPlaying && !video.seeking && engineStateRef.current === 'idle') {
            if (ctx.isScrubbing) {
                const nowMs = performance.now();
                if (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS) return;
                pendingScrubTargetRef.current = null;
                if (Math.abs(video.currentTime - pending) > 0.045) {
                    lastMobileScrubSeekAtRef.current = nowMs;
                    video.currentTime = pending;
                }
            } else {
                pendingScrubTargetRef.current = null;
                if (Math.abs(video.currentTime - pending) > 0.045) video.currentTime = pending;
                if (isDecoupledActive()) syncCompanionAudioToTime(pending, true);
            }
        }
    }, [getActiveVideo, isDecoupledActive, scheduleDeferredAmbientPaint, syncCompanionAudioToTime]);

    /**
     * Single linear `AbortSignal`-scoped seek & playback orchestrator.
     * Eliminates nested seek/canplay/rVFC callbacks and defers ambient/React updates past launch lock (`A7`).
     */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean) => {
        const vDur = getFiniteDuration(video);
        if (video.readyState < 1 || vDur === null) return;

        const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
        const seekTol = shouldPlay ? 0.08 : 0.045;
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > seekTol;
        const decoupled = isDecoupledActive();

        video.playbackRate = 1;
        if (decoupled) {
            video.muted = true;
            syncCompanionAudioToTime(clampedTarget, true);
        }

        if (!shouldPlay) {
            cancelActiveOp();
            if (!video.paused) video.pause();
            if (video.seeking) {
                pendingScrubTargetRef.current = clampedTarget;
            } else if (needsSeek) {
                pendingScrubTargetRef.current = null;
                video.currentTime = clampedTarget;
            } else {
                pendingScrubTargetRef.current = null;
            }
            return;
        }

        const signal = beginOp();
        pendingScrubTargetRef.current = null;
        const isMobileOrBlob = !ctxRef.current.useStandbyDeck || ctxRef.current.videoSrc.startsWith('blob:');

        void (async () => {
            if (needsSeek || video.seeking) {
                engineStateRef.current = 'seeking';
                if (!video.paused) video.pause();
                seekStartedAtRef.current = performance.now();
                avDiagRef.current.lastSeekTargetSec = clampedTarget;
                await seekMediaElement(video, clampedTarget, { signal, toleranceSec: 0.045, timeoutMs: 4000 });
                if (signal.aborted) return;
            } else if (decoupled && !video.paused) {
                video.pause();
            }

            engineStateRef.current = 'priming';
            if (video.readyState < 3 || video.seeking) {
                await waitForMediaEvent(video, ["canplay", "canplaythrough"], {
                    signal,
                    timeoutMs: getCanPlayTimeoutMs(isMobileOrBlob),
                    predicate: () => !video.seeking && video.readyState >= 3,
                });
                if (signal.aborted) return;
            }

            const ctx = ctxRef.current;
            if (!ctx.isPlaying || ctx.isScrubbing || ctx.isOutro) {
                engineStateRef.current = 'idle';
                return;
            }

            if (seekStartedAtRef.current !== null) {
                avDiagRef.current.lastSeekDurationMs = Math.round(performance.now() - seekStartedAtRef.current);
                avDiagRef.current.readyStateAtPlay = video.readyState;
                seekStartedAtRef.current = null;
            }

            const launchedDecoupled = await launchDecoupledAudioMaster(video, signal);
            if (signal.aborted) return;

            if (!launchedDecoupled) {
                video.muted = ctxRef.current.effectiveMuted;
                video.playbackRate = 1;
                try {
                    await video.play();
                } catch {
                    return;
                }
                if (signal.aborted) return;
                engineStateRef.current = 'playing';
            }

            // Defer ambient canvas readback & React sync until AFTER A/V lock is established (`A7`)
            scheduleDeferredAmbientPaint(video, false);
            onTimeUpdateRef.current?.(currentTimeRef.current, getFiniteDuration(video) ?? 0);
        })();
    }, [beginOp, cancelActiveOp, isDecoupledActive, launchDecoupledAudioMaster, scheduleDeferredAmbientPaint, syncCompanionAudioToTime]);

    // Seamlessly hand off audio when `playbackProfile` switches mid-session
    useEffect(() => {
        const prev = prevPlaybackProfileRef.current;
        prevPlaybackProfileRef.current = playbackProfile;
        if (prev === playbackProfile || overlayOnly) return;
        const video = getActiveVideo();
        if (!video) return;
        const ctx = ctxRef.current;
        if (isDecoupledActive()) {
            video.muted = true;
            if (video.readyState >= 1) {
                if (ctx.isPlaying && !ctx.isScrubbing && !ctx.isOutro) {
                    seekAndSync(video, video.currentTime, true);
                } else {
                    syncCompanionAudioToTime(video.currentTime, true);
                }
            }
        } else if (prev === 'decoupled-audio-lock') {
            cancelActiveOp();
            pauseCompanionAudio();
            video.playbackRate = 1;
            video.muted = ctx.effectiveMuted;
            audioOutputRef.current = video;
            if (ctx.isPlaying && !ctx.isScrubbing && !ctx.isOutro && !video.paused) {
                engineStateRef.current = 'playing';
            }
        }
    }, [playbackProfile, overlayOnly, cancelActiveOp, getActiveVideo, isDecoupledActive, pauseCompanionAudio, seekAndSync, syncCompanionAudioToTime]);

    /** Swaps instantaneously to the pre-parked desktop standby deck (0ms seek latency) or falls back to `seekAndSync`. */
    const transitionToMediaTime = useCallback((outgoing: HTMLVideoElement, targetMediaTime: number, nextTimelineTime: number) => {
        currentTimeRef.current = nextTimelineTime;
        const standby = getStandbyVideo();
        if (standby && standby !== outgoing && isStandbyReadyAt(standby, targetMediaTime)) {
            cancelActiveOp();
            standby.style.transform = outgoing.style.transform;
            standby.style.opacity = '1';
            standby.style.zIndex = '2';
            outgoing.style.opacity = '0';
            outgoing.style.zIndex = '1';
            outgoing.muted = true;
            if (!outgoing.paused) outgoing.pause();

            activeDeckRef.current = activeDeckRef.current === 0 ? 1 : 0;
            activeVideoRef.current = standby;

            const ctx = ctxRef.current;
            const decoupled = isDecoupledActive() && Boolean(companionAudioRef.current);
            standby.muted = decoupled ? true : ctx.effectiveMuted;
            standby.playbackRate = 1;
            const { audioGain } = evaluateSceneTransition(ctx.draft, nextTimelineTime);
            standby.volume = clamp((ctx.draft.volume ?? 1) * audioGain, 0, 1);
            audioOutputRef.current = decoupled ? companionAudioRef.current : standby;

            if (ctx.isPlaying && !ctx.isScrubbing) {
                if (decoupled) {
                    const signal = beginOp();
                    void (async () => {
                        await launchDecoupledAudioMaster(standby, signal);
                        if (!signal.aborted) {
                            scheduleDeferredAmbientPaint(standby, false);
                            onTimeUpdateRef.current?.(nextTimelineTime, getFiniteDuration(standby) ?? 0);
                        }
                    })();
                } else {
                    engineStateRef.current = 'playing';
                    standby.play().catch(() => { /* ignore aborted play promise */ });
                    scheduleDeferredAmbientPaint(standby, false);
                    onTimeUpdateRef.current?.(nextTimelineTime, getFiniteDuration(standby) ?? 0);
                }
            }

            // Re-bind rVFC to the newly active deck immediately
            const prevHandle = rVfcHandleRef.current;
            if (prevHandle && typeof prevHandle.el.cancelVideoFrameCallback === 'function') {
                prevHandle.el.cancelVideoFrameCallback(prevHandle.id);
                rVfcHandleRef.current = null;
            }
            if (rVfcCallbackRef.current && typeof standby.requestVideoFrameCallback === 'function' && ctx.isPlaying) {
                rVfcHandleRef.current = { el: standby, id: standby.requestVideoFrameCallback(rVfcCallbackRef.current) };
            }

            cancelPreParkTimer();
            const schedulePrePark = () => {
                preParkTimerRef.current = null;
                if (activeVideoRef.current !== standby || !ctxRef.current.isPlaying) return;
                if (isCameraGlidingRef.current) {
                    preParkTimerRef.current = setTimeout(schedulePrePark, 500);
                    return;
                }
                preParkStandbyDeck(outgoing, getNextCutMediaTarget(ctxRef.current.draft, currentTimeRef.current, ctxRef.current.playbackMode === 'loop-angle'));
            };
            preParkTimerRef.current = setTimeout(schedulePrePark, 220);
            return true;
        }
        seekAndSync(outgoing, targetMediaTime, ctxRef.current.isPlaying);
        return false;
    }, [beginOp, cancelActiveOp, cancelPreParkTimer, companionAudioRef, getStandbyVideo, isDecoupledActive, launchDecoupledAudioMaster, scheduleDeferredAmbientPaint, seekAndSync]);

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
            cancelActiveOp();
            cancelPreParkTimer();
            pendingScrubTargetRef.current = null;
            pauseAllDecks(video, standby);
            const hookOffset = ctxRef.current.draft.scenes?.[0]?.clipStartOffset ?? 0;
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
            cancelActiveOp();
            cancelPreParkTimer();
            pauseAllDecks(video, standby);
            const vDur = getFiniteDuration(video);
            if (video.readyState < 1 || vDur === null) return;
            const clampedTarget = clampMediaTarget(wrapMediaTime(ctxRef.current.draft, currentTime, vDur), vDur);
            const useKeyframeSnap = ctxRef.current.playbackProfile !== 'standard';
            const scrubTarget = clampMediaTarget(resolveScrubSeekTarget(clampedTarget, ctxRef.current.keyframeTimes, useKeyframeSnap), vDur);
            const isMobileOrBlob = !ctxRef.current.useStandbyDeck || videoSrc.startsWith('blob:');
            const nowMs = performance.now();
            if (video.seeking || (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS)) {
                pendingScrubTargetRef.current = scrubTarget;
            } else if (Math.abs(video.currentTime - scrubTarget) > 0.045) {
                lastMobileScrubSeekAtRef.current = nowMs;
                pendingScrubTargetRef.current = null;
                video.currentTime = scrubTarget;
            }
            return;
        }

        if (action === 'pause-seek') {
            cancelPreParkTimer();
            cancelActiveOp();
            pauseAllDecks(video, standby);
            if (wasScrubbing) pendingScrubTargetRef.current = null;
            const vDur = getFiniteDuration(video);
            if (video.readyState < 1 || vDur === null) return;
            const targetMediaTime = wrapMediaTime(ctxRef.current.draft, currentTimeRef.current, vDur);
            const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
            // Avoid redundant 4K AV1 seek on Pause when liveClock is within 250ms of the already-paused frame (`A10`)
            const pauseTol = wasPlaying && !isExplicitSeek && !wasScrubbing ? 0.25 : 0.045;
            if (Math.abs(video.currentTime - clampedTarget) > pauseTol || video.seeking) {
                seekAndSync(video, targetMediaTime, false);
            } else if (isDecoupledActive()) {
                syncCompanionAudioToTime(video.currentTime, true);
            }
            return;
        }

        if (action === 'start-play') {
            if (wasScrubbing) pendingScrubTargetRef.current = null;
            const vDur = getFiniteDuration(video);
            if (video.readyState < 1 || vDur === null) return;
            const targetMediaTime = wrapMediaTime(ctxRef.current.draft, currentTimeRef.current, vDur);
            seekAndSync(video, targetMediaTime, true);
            preParkStandbyDeck(standby, getNextCutMediaTarget(ctxRef.current.draft, currentTimeRef.current, ctxRef.current.playbackMode === 'loop-angle'));
            return;
        }

        // action === 'explicit-play-seek'
        const vDur = getFiniteDuration(video);
        if (video.readyState < 1 || vDur === null) return;
        const targetMediaTime = wrapMediaTime(ctxRef.current.draft, currentTime, vDur);
        const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
        if (Math.abs(video.currentTime - clampedTarget) > 0.045 || video.seeking) {
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
        getActiveVideo,
        getStandbyVideo,
        isDecoupledActive,
        pauseAllDecks,
        cancelActiveOp,
        cancelPreParkTimer,
        syncCompanionAudioToTime,
        seekAndSync,
        transitionToMediaTime,
    ]);

    const syncTimelineTick = useCallback((video: HTMLVideoElement, mediaTime: number) => {
        const ctx = ctxRef.current;
        if (!onTimeUpdateRef.current || ctx.isOutro || engineStateRef.current !== 'playing' || video.seeking || video.paused) return;
        const activeDraft = ctx.draft;
        const activeTime = currentTimeRef.current;
        const { hasReHook, hookDur, rehookDur, preStoryDur: preSetupDur, hookOffset, rehookOffset, storyOffset: setupOffset } = getTimelineStructure(activeDraft.scenes || []);
        let nextTimelineTime: number;

        const isLoop = ctx.playbackMode === 'loop-angle';
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
            seekAndSync(video, setupOffset, ctx.isPlaying);
            nextTimelineTime = activeTime;
        } else {
            nextTimelineTime = mediaTimeToTimelineTime(activeDraft, mediaTime, activeTime, getFiniteDuration(video) ?? undefined);
            currentTimeRef.current = nextTimelineTime;
        }

        if (!didBoundarySeek) {
            paintAmbientCanvas(video);
            onTimeUpdateRef.current(nextTimelineTime, getFiniteDuration(video) ?? 0);
        }
    }, [paintAmbientCanvas, seekAndSync, transitionToMediaTime]);

    useEffect(() => {
        const video = getActiveVideo();
        if (!video || overlayOnly) return;
        let isMounted = true;

        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            if (!isMounted) return;
            const cur = getActiveVideo();
            if (!cur) return;

            if (engineStateRef.current === 'playing' && !ctxRef.current.isScrubbing && ctxRef.current.isPlaying && !cur.seeking && !cur.paused) {
                const masterMediaTime = applyVideoFollowerTick(cur, metadata.mediaTime);
                syncTimelineTick(cur, masterMediaTime);
            }
            const nextEl = getActiveVideo();
            if (nextEl && typeof nextEl.requestVideoFrameCallback === 'function' && ctxRef.current.isPlaying) {
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
    }, [isPlaying, isScrubbing, overlayOnly, applyVideoFollowerTick, getActiveVideo, syncTimelineTick]);

    const handleLoadedMetadata = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video)) return;
        if (video.videoWidth && video.videoHeight) onAspectDetectedRef.current(video.videoWidth / video.videoHeight);
        const vDur = getFiniteDuration(video);
        if (vDur === null) return;
        const ctx = ctxRef.current;
        const targetMediaTime = wrapMediaTime(ctx.draft, currentTimeRef.current, vDur);
        if (isDecoupledActive()) {
            video.muted = true;
            syncCompanionAudioToTime(targetMediaTime, !ctx.isPlaying);
        }
        if (ctx.isPlaying && !ctx.isScrubbing && !ctx.isOutro) {
            seekAndSync(video, targetMediaTime, true);
        } else {
            if (Math.abs(video.currentTime - targetMediaTime) > 0.08) video.currentTime = targetMediaTime;
            onTimeUpdateRef.current?.(currentTimeRef.current, vDur);
        }
        preParkStandbyDeck(getStandbyVideo(), getNextCutMediaTarget(ctx.draft, currentTimeRef.current, ctx.playbackMode === 'loop-angle'));
    }, [getActiveVideo, getStandbyVideo, isDecoupledActive, seekAndSync, syncCompanionAudioToTime]);

    const handleStandbyLoadedMetadata = useCallback(() => {
        const standby = getStandbyVideo();
        if (standby) {
            standby.style.opacity = activeDeckRef.current === 1 ? '1' : '0';
            standby.style.zIndex = activeDeckRef.current === 1 ? '2' : '1';
        }
        preParkStandbyDeck(standby, getNextCutMediaTarget(ctxRef.current.draft, currentTimeRef.current, ctxRef.current.playbackMode === 'loop-angle'));
    }, [getStandbyVideo]);

    const handleTimeUpdate = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        const ctx = ctxRef.current;
        if (!video || (e && e.currentTarget !== video) || ctx.isScrubbing || !ctx.isPlaying || typeof video.requestVideoFrameCallback === 'function') return;
        const masterTime = getRollingCompanionAudioTime() ?? video.currentTime;
        syncTimelineTick(video, masterTime);
    }, [getActiveVideo, getRollingCompanionAudioTime, syncTimelineTick]);

    const handleEnded = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video) || overlayOnly || ctxRef.current.isOutro) return;
        const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(ctxRef.current.draft.scenes || []);
        const t = currentTimeRef.current;
        const target = t < hookDur ? hookOffset : (hasReHook && t < preStoryDur ? rehookOffset : storyOffset);
        seekAndSync(video, target, ctxRef.current.isPlaying);
    }, [overlayOnly, getActiveVideo, seekAndSync]);

    return {
        videoRef,
        standbyVideoRef,
        companionAudioRef,
        activeVideoRef,
        audioOutputRef,
        engineStateRef,
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
        handleCompanionAudioEnded,
        handleCompanionAudioLoadedMetadata,
        refreshAmbientGlow,
        handleLoadedMetadata,
        handleStandbyLoadedMetadata,
        handleTimeUpdate,
        handleEnded,
    };
};
