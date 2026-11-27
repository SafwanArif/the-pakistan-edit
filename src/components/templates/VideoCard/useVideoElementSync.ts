"use client";

import { useRef, useEffect, useLayoutEffect, useCallback, useMemo, type SyntheticEvent } from "react";
import { VideoDraft, wrapMediaTime, mediaTimeToTimelineTime, getTimelineStructure, type PlaybackSyncProfile } from "@/types/news";
import { isAbortError } from "@/app/admin/utils/exportEngine";
import { computeEffectiveVolume, type AmbientCropRect, type AmbientVisibilityState } from "./videoCardGeometry";
import { clampMediaTarget, getNextCutMediaTarget, isStandbyReadyAt, preParkStandbyDeck } from "./dualDeckHelpers";
import { useAmbientCanvasPainter } from "./useAmbientCanvasPainter";
import { useCompanionAudioLock, type VideoSyncRuntimeCtx } from "./useCompanionAudioLock";
import { clearTimerRef, setDeckVisibility, useDualDeckLifecycle } from "./useDualDeckLifecycle";
import {
    MOBILE_SCRUB_THROTTLE_MS,
    createInitialAvSyncDiag,
    getCanPlayTimeoutMs,
    resolveBoundaryCut,
    resolvePlaybackSyncAction,
    resolveScrubSeekTarget,
    type AvSyncDiagSnapshot,
    type PlaybackEngineState,
} from "./avSyncHelpers";
import { formatMediaError, getFiniteDuration, safeSetMediaTime, seekMediaElement, waitForMediaEvent } from "./mediaAsyncHelpers";

interface UseVideoElementSyncOptions {
    draft: VideoDraft;
    videoSrc: string;
    hasVideoElement?: boolean;
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
    ambientBlurActive?: boolean;
    ambientCrop?: AmbientCropRect;
    ambientVisibility?: AmbientVisibilityState;
    onTimeUpdate?: (current: number, duration: number) => void;
    onAspectDetected: (aspect: number) => void;
}

const DEFAULT_AMBIENT_CROP: AmbientCropRect = { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 };
const DEFAULT_AMBIENT_VISIBILITY: AmbientVisibilityState = { topVisible: false, botVisible: true };

const isMobileOrBlobCtx = (ctx: Pick<VideoSyncRuntimeCtx, 'useStandbyDeck' | 'videoSrc'>): boolean =>
    !ctx.useStandbyDeck || ctx.videoSrc.startsWith('blob:');

/**
 * Synchronises dual-deck `<video>` playback + pure-`.m4a` companion `<audio>` rail with studio timeline state
 * via a single `AbortController`-scoped 5-state engine (`idle | seeking | priming | playing | buffering`).
 */
export const useVideoElementSync = ({
    draft,
    videoSrc,
    hasVideoElement = Boolean(videoSrc),
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
    ambientBlurActive = false,
    ambientCrop = DEFAULT_AMBIENT_CROP,
    ambientVisibility = DEFAULT_AMBIENT_VISIBILITY,
    onTimeUpdate,
    onAspectDetected,
}: UseVideoElementSyncOptions) => {
    const audioOutputRef = useRef<HTMLMediaElement | null>(null);
    const engineStateRef = useRef<PlaybackEngineState>('idle');
    const opAbortRef = useRef<AbortController | null>(null);
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

    const ctxRef = useRef<VideoSyncRuntimeCtx>({
        draft, videoSrc, isPlaying, isScrubbing, isOutro, playbackMode,
        playbackProfile, effectiveMuted, useStandbyDeck, keyframeTimes,
    });
    const currentTimeRef = useRef(currentTime);
    const onTimeUpdateRef = useRef(onTimeUpdate);
    const onAspectDetectedRef = useRef(onAspectDetected);

    const {
        videoRef, standbyVideoRef, activeVideoRef, activeDeckRef, rVfcHandleRef, rVfcCallbackRef,
        getActiveVideo, getStandbyVideo, releaseDetachedDeck, cancelRvfc, scheduleRvfc,
        syncMountedDecks, resetDecksToPrimary, releaseAllVideoDecks,
    } = useDualDeckLifecycle(ctxRef);

    const {
        companionAudioRef, isCompanionFallback, isDecoupledActive, isAudioUnlocking,
        pauseCompanionAudio, resetForNewSource, syncDetachedAudioRef, releaseCompanionAudio,
        handleCompanionAudioError, handleCompanionAudioEnded, unlockCompanionAudio,
        syncCompanionAudioToTime, handleCompanionAudioLoadedMetadata,
        launchDecoupledAudioMaster, applyVideoFollowerTick, getRollingCompanionAudioTime,
    } = useCompanionAudioLock({
        videoSrc, ctxRef, currentTimeRef, audioOutputRef, avDiagRef, engineStateRef, getActiveVideo, releaseDetachedDeck,
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

    const pauseAllDecks = useCallback((video: HTMLVideoElement | null, standby: HTMLVideoElement | null) => {
        if (video) {
            video.playbackRate = 1;
            if (!video.paused) video.pause();
        }
        if (standby && !standby.paused) standby.pause();
        pauseCompanionAudio();
    }, [pauseCompanionAudio]);

    const preParkNextCut = useCallback((deck?: HTMLVideoElement | null) => {
        const ctx = ctxRef.current;
        preParkStandbyDeck(
            deck === undefined ? getStandbyVideo() : deck,
            getNextCutMediaTarget(ctx.draft, currentTimeRef.current, ctx.playbackMode === 'loop-angle')
        );
    }, [getStandbyVideo]);

    /** Plays a `<video>` natively with consistent `AbortSignal` / `engineStateRef` / diagnostic error handling. */
    const playVideoDirect = useCallback(async (video: HTMLVideoElement, signal: AbortSignal): Promise<boolean> => {
        video.muted = ctxRef.current.effectiveMuted;
        video.playbackRate = 1;
        try {
            await video.play();
        } catch (err: unknown) {
            if (!signal.aborted) {
                if (!isAbortError(err)) avDiagRef.current.lastError = formatMediaError(err);
                engineStateRef.current = 'idle';
            }
            return false;
        }
        if (signal.aborted) return false;
        engineStateRef.current = 'playing';
        return true;
    }, []);

    useEffect(() => {
        const g = globalThis as { __TPE_AV_DIAG__?: AvSyncDiagSnapshot };
        const diag = avDiagRef.current;
        g.__TPE_AV_DIAG__ = diag;
        return () => { if (g.__TPE_AV_DIAG__ === diag) delete g.__TPE_AV_DIAG__; };
    }, []);

    // Sync refs before paint so `useSmoothFramingLoop`'s `useLayoutEffect` reads fresh `audioOutputRef` & `engineStateRef`
    useLayoutEffect(() => {
        Object.assign(ctxRef.current, {
            draft, videoSrc, isPlaying, isScrubbing, isOutro, playbackMode,
            playbackProfile, effectiveMuted, useStandbyDeck, keyframeTimes,
        });
        onTimeUpdateRef.current = onTimeUpdate;
        onAspectDetectedRef.current = onAspectDetected;

        syncMountedDecks(useStandbyDeck);
        syncDetachedAudioRef();

        const decoupled = isDecoupledActive() && Boolean(companionAudioRef.current);
        audioOutputRef.current = decoupled ? companionAudioRef.current : (activeVideoRef.current ?? videoRef.current);
        avDiagRef.current.profile = playbackProfile;
        avDiagRef.current.companionAudioActive = decoupled;
    });

    const { ambientCropRef, ambientVisibilityRef, ambientCanvases, paintAmbientCanvas } = useAmbientCanvasPainter({
        videoSrc, ambientBlurActive, ambientCrop, ambientVisibility, enableAmbientBlur: draft.enableAmbientBlur,
        ctxRef, isCameraGlidingRef, isHeavyVideo: playbackProfile !== 'standard', getActiveVideo,
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
        clearTimerRef(preParkTimerRef);
        clearTimerRef(standbySyncTimerRef);
        pendingScrubTargetRef.current = null;
        releaseAllVideoDecks();
        releaseCompanionAudio();
    }, [cancelActiveOp, releaseAllVideoDecks, releaseCompanionAudio]);

    // Reset active deck & abort in-flight ops whenever `videoSrc` changes (`A6`, `A12`, `P198`)
    useEffect(() => {
        cancelActiveOp();
        clearTimerRef(preParkTimerRef);
        clearTimerRef(standbySyncTimerRef);
        pendingScrubTargetRef.current = null;
        seekStartedAtRef.current = null;
        wasPlayingRef.current = false;
        resetForNewSource();
        resetDecksToPrimary();
    }, [videoSrc, cancelActiveOp, resetDecksToPrimary, resetForNewSource]);

    // Pure timing signature (excludes non-timing `shareHookText`, fixing `A8`)
    const scenesTimingKey = useMemo(
        () => (draft.scenes || []).map((s) => `${s.id}:${s.duration}:${s.clipStartOffset ?? ''}:${s.mediaUrl ?? ''}:${s.mediaType ?? ''}`).join('|'),
        [draft.scenes]
    );

    // Keep desktop standby deck freshly pre-parked whenever Hook/Re-Hook/Story offsets or durations change
    useEffect(() => {
        clearTimerRef(standbySyncTimerRef);
        if (!useStandbyDeck || isScrubbing || isOutro) return;
        standbySyncTimerRef.current = setTimeout(() => {
            standbySyncTimerRef.current = null;
            preParkNextCut();
        }, 180);
        return () => clearTimerRef(standbySyncTimerRef);
    }, [useStandbyDeck, isScrubbing, isOutro, scenesTimingKey, playbackMode, preParkNextCut]);

    useEffect(() => {
        const video = getActiveVideo();
        const audio = companionAudioRef.current;
        const decoupled = isDecoupledActive() && Boolean(audio);
        const targetVol = computeEffectiveVolume(ctxRef.current.draft, currentTimeRef.current);
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
    }, [effectiveMuted, draft.volume, isPlaying, playbackProfile, isCompanionFallback, hasVideoElement, videoSrc, useStandbyDeck, companionAudioRef, getActiveVideo, getStandbyVideo, isAudioUnlocking, isDecoupledActive]);

    const refreshAmbientGlow = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video)) return;
        const ctx = ctxRef.current;
        const isMobileOrBlob = isMobileOrBlobCtx(ctx);
        if (!(ctx.isScrubbing && isMobileOrBlob) && !(ctx.isPlaying && !ctx.isScrubbing)) {
            scheduleDeferredAmbientPaint(video, true);
        }
        const pending = pendingScrubTargetRef.current;
        if (pending !== null && video.readyState >= 1 && !ctx.isPlaying && !video.seeking && engineStateRef.current === 'idle') {
            if (ctx.isScrubbing) {
                const nowMs = performance.now();
                if (isMobileOrBlob && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS) return;
                pendingScrubTargetRef.current = null;
                if (Math.abs(video.currentTime - pending) > 0.045) {
                    lastMobileScrubSeekAtRef.current = nowMs;
                    safeSetMediaTime(video, pending);
                }
            } else {
                pendingScrubTargetRef.current = null;
                if (Math.abs(video.currentTime - pending) > 0.045) safeSetMediaTime(video, pending);
                if (isDecoupledActive()) syncCompanionAudioToTime(pending, true);
            }
        }
    }, [getActiveVideo, isDecoupledActive, scheduleDeferredAmbientPaint, syncCompanionAudioToTime]);

    /** Single linear `AbortSignal`-scoped seek & playback orchestrator (`A7`). */
    const seekAndSync = useCallback((video: HTMLVideoElement, targetMediaTime: number, shouldPlay: boolean) => {
        const vDur = getFiniteDuration(video, ctxRef.current.draft);
        if (video.readyState < 1 || vDur === null) return;

        const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
        const needsSeek = Math.abs(video.currentTime - clampedTarget) > (shouldPlay ? 0.08 : 0.045);
        const decoupled = isDecoupledActive();

        video.playbackRate = 1;
        if (decoupled) {
            video.muted = true;
            syncCompanionAudioToTime(clampedTarget, true);
        }

        if (!shouldPlay) {
            cancelActiveOp();
            if (!video.paused) video.pause();
            if (video.seeking) pendingScrubTargetRef.current = clampedTarget;
            else {
                pendingScrubTargetRef.current = null;
                if (needsSeek) safeSetMediaTime(video, clampedTarget);
            }
            return;
        }

        const signal = beginOp();
        pendingScrubTargetRef.current = null;
        const isMobileOrBlob = isMobileOrBlobCtx(ctxRef.current);

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
            if (!launchedDecoupled && !(await playVideoDirect(video, signal))) return;

            scheduleDeferredAmbientPaint(video, false);
            onTimeUpdateRef.current?.(currentTimeRef.current, getFiniteDuration(video, ctxRef.current.draft) ?? 0);
        })();
    }, [beginOp, cancelActiveOp, isDecoupledActive, launchDecoupledAudioMaster, playVideoDirect, scheduleDeferredAmbientPaint, syncCompanionAudioToTime]);

    // Seamlessly hand off audio when `playbackProfile` switches mid-session
    useEffect(() => {
        const prev = prevPlaybackProfileRef.current;
        prevPlaybackProfileRef.current = playbackProfile;
        if (prev === playbackProfile) return;
        const video = getActiveVideo();
        if (!video) return;
        const ctx = ctxRef.current;
        if (isDecoupledActive()) {
            video.muted = true;
            if (video.readyState >= 1) {
                if (ctx.isPlaying && !ctx.isScrubbing && !ctx.isOutro) seekAndSync(video, video.currentTime, true);
                else syncCompanionAudioToTime(video.currentTime, true);
            }
        } else if (prev === 'decoupled-audio-lock') {
            cancelActiveOp();
            pauseCompanionAudio();
            video.playbackRate = 1;
            video.muted = ctx.effectiveMuted;
            audioOutputRef.current = video;
            if (ctx.isPlaying && !ctx.isScrubbing && !ctx.isOutro && !video.paused) engineStateRef.current = 'playing';
        }
    }, [playbackProfile, cancelActiveOp, getActiveVideo, isDecoupledActive, pauseCompanionAudio, seekAndSync, syncCompanionAudioToTime]);

    /** Swaps instantaneously to the pre-parked desktop standby deck (0ms seek latency) or falls back to `seekAndSync`. */
    const transitionToMediaTime = useCallback((outgoing: HTMLVideoElement, targetMediaTime: number, nextTimelineTime: number) => {
        currentTimeRef.current = nextTimelineTime;
        const standby = getStandbyVideo();
        if (standby && standby !== outgoing && isStandbyReadyAt(standby, targetMediaTime)) {
            cancelActiveOp();
            standby.style.transform = outgoing.style.transform;
            setDeckVisibility(standby, true);
            setDeckVisibility(outgoing, false);
            outgoing.muted = true;
            if (!outgoing.paused) outgoing.pause();

            activeDeckRef.current = activeDeckRef.current === 0 ? 1 : 0;
            activeVideoRef.current = standby;

            const ctx = ctxRef.current;
            const decoupled = isDecoupledActive() && Boolean(companionAudioRef.current);
            standby.muted = decoupled ? true : ctx.effectiveMuted;
            standby.playbackRate = 1;
            standby.volume = computeEffectiveVolume(ctx.draft, nextTimelineTime);
            audioOutputRef.current = decoupled ? companionAudioRef.current : standby;

            if (ctx.isPlaying && !ctx.isScrubbing) {
                if (decoupled) {
                    const signal = beginOp();
                    void (async () => {
                        const launched = await launchDecoupledAudioMaster(standby, signal);
                        if (signal.aborted) return;
                        if (!launched && !(await playVideoDirect(standby, signal))) return;
                        scheduleDeferredAmbientPaint(standby, false);
                        onTimeUpdateRef.current?.(nextTimelineTime, getFiniteDuration(standby, ctxRef.current.draft) ?? 0);
                    })();
                } else {
                    engineStateRef.current = 'playing';
                    standby.play().catch((err: unknown) => {
                        if (!isAbortError(err) && activeVideoRef.current === standby) {
                            avDiagRef.current.lastError = formatMediaError(err);
                            engineStateRef.current = 'idle';
                        }
                    });
                    scheduleDeferredAmbientPaint(standby, false);
                    onTimeUpdateRef.current?.(nextTimelineTime, getFiniteDuration(standby, ctxRef.current.draft) ?? 0);
                }
            }

            scheduleRvfc(standby);

            clearTimerRef(preParkTimerRef);
            const schedulePrePark = () => {
                preParkTimerRef.current = null;
                if (activeVideoRef.current !== standby || !ctxRef.current.isPlaying) return;
                if (isCameraGlidingRef.current) {
                    preParkTimerRef.current = setTimeout(schedulePrePark, 500);
                    return;
                }
                preParkNextCut(outgoing);
            };
            preParkTimerRef.current = setTimeout(schedulePrePark, 220);
            return true;
        }
        seekAndSync(outgoing, targetMediaTime, ctxRef.current.isPlaying);
        return false;
    }, [activeDeckRef, activeVideoRef, beginOp, cancelActiveOp, companionAudioRef, getStandbyVideo, isDecoupledActive, launchDecoupledAudioMaster, playVideoDirect, preParkNextCut, scheduleDeferredAmbientPaint, scheduleRvfc, seekAndSync]);

    // Single unified playback & seek coordinator
    useEffect(() => {
        const video = getActiveVideo();
        const standby = getStandbyVideo();
        const isExplicitSeek = seekNonce !== lastSeekNonceRef.current;
        lastSeekNonceRef.current = seekNonce;

        if (!video) {
            wasPlayingRef.current = false;
            wasScrubbingRef.current = isScrubbing;
            return;
        }

        const wasPlaying = wasPlayingRef.current;
        const wasScrubbing = wasScrubbingRef.current;
        wasPlayingRef.current = isPlaying;
        wasScrubbingRef.current = isScrubbing;

        const action = resolvePlaybackSyncAction({ isOutro, isScrubbing, isPlaying, wasPlaying, wasScrubbing, isExplicitSeek });

        if (action === 'outro') {
            wasPlayingRef.current = false;
            cancelActiveOp();
            clearTimerRef(preParkTimerRef);
            pendingScrubTargetRef.current = null;
            pauseAllDecks(video, standby);
            const vDur = getFiniteDuration(video, ctxRef.current.draft);
            if (video.readyState >= 1 && vDur !== null) {
                const clampedHookOffset = clampMediaTarget(ctxRef.current.draft.scenes?.[0]?.clipStartOffset ?? 0, vDur);
                if (Math.abs(video.currentTime - clampedHookOffset) > 0.08) safeSetMediaTime(video, clampedHookOffset);
                if (isDecoupledActive()) syncCompanionAudioToTime(clampedHookOffset, true);
            }
            return;
        }

        if (action === 'noop') return;
        if (action === 'scrub' || action === 'pause-seek' || isExplicitSeek || wasScrubbing) currentTimeRef.current = currentTime;

        const vDur = getFiniteDuration(video, ctxRef.current.draft);

        if (action === 'scrub') {
            cancelActiveOp();
            clearTimerRef(preParkTimerRef);
            pauseAllDecks(video, standby);
            if (video.readyState < 1 || vDur === null) return;
            const clampedTarget = clampMediaTarget(wrapMediaTime(ctxRef.current.draft, currentTime, vDur), vDur);
            const scrubTarget = clampMediaTarget(resolveScrubSeekTarget(clampedTarget, ctxRef.current.keyframeTimes, ctxRef.current.playbackProfile !== 'standard'), vDur);
            const nowMs = performance.now();
            if (video.seeking || (isMobileOrBlobCtx(ctxRef.current) && nowMs - lastMobileScrubSeekAtRef.current < MOBILE_SCRUB_THROTTLE_MS)) {
                pendingScrubTargetRef.current = scrubTarget;
            } else if (Math.abs(video.currentTime - scrubTarget) > 0.045) {
                lastMobileScrubSeekAtRef.current = nowMs;
                pendingScrubTargetRef.current = null;
                safeSetMediaTime(video, scrubTarget);
            }
            return;
        }

        if (action === 'pause-seek') {
            clearTimerRef(preParkTimerRef);
            cancelActiveOp();
            pauseAllDecks(video, standby);
            if (wasScrubbing) pendingScrubTargetRef.current = null;
            if (video.readyState < 1 || vDur === null) return;
            const targetMediaTime = wrapMediaTime(ctxRef.current.draft, currentTimeRef.current, vDur);
            const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
            const pauseTol = wasPlaying && !isExplicitSeek && !wasScrubbing ? 0.25 : 0.045;
            if (Math.abs(video.currentTime - clampedTarget) > pauseTol || video.seeking) seekAndSync(video, targetMediaTime, false);
            else if (isDecoupledActive()) syncCompanionAudioToTime(video.currentTime, true);
            return;
        }

        if (video.readyState < 1 || vDur === null) return;

        if (action === 'start-play') {
            if (wasScrubbing) pendingScrubTargetRef.current = null;
            seekAndSync(video, wrapMediaTime(ctxRef.current.draft, currentTimeRef.current, vDur), true);
            preParkNextCut(standby);
            return;
        }

        const targetMediaTime = wrapMediaTime(ctxRef.current.draft, currentTime, vDur);
        const clampedTarget = clampMediaTarget(targetMediaTime, vDur);
        if (Math.abs(video.currentTime - clampedTarget) > 0.045 || video.seeking) {
            transitionToMediaTime(video, targetMediaTime, currentTime);
        }
    }, [
        currentTime, seekNonce, isPlaying, isScrubbing, isOutro, hasVideoElement, videoSrc, scenesTimingKey,
        getActiveVideo, getStandbyVideo, isDecoupledActive, pauseAllDecks, cancelActiveOp, preParkNextCut, syncCompanionAudioToTime, seekAndSync, transitionToMediaTime,
    ]);

    const syncTimelineTick = useCallback((video: HTMLVideoElement, mediaTime: number) => {
        const ctx = ctxRef.current;
        if (!Number.isFinite(mediaTime) || !onTimeUpdateRef.current || ctx.isOutro || engineStateRef.current !== 'playing' || video.seeking || video.paused) return;
        const activeDraft = ctx.draft;
        const activeTime = currentTimeRef.current;
        const cut = resolveBoundaryCut(activeDraft, activeTime, mediaTime, ctx.playbackMode === 'loop-angle');
        const vDur = getFiniteDuration(video, activeDraft);

        let nextTimelineTime = activeTime;
        let didBoundarySeek = false;
        if (cut?.kind === 'transition') {
            nextTimelineTime = cut.nextTimelineTime;
            currentTimeRef.current = nextTimelineTime;
            didBoundarySeek = !transitionToMediaTime(video, cut.targetMediaTime, nextTimelineTime);
        } else if (cut?.kind === 'realign') {
            didBoundarySeek = true;
            seekAndSync(video, cut.targetMediaTime, ctx.isPlaying);
        } else {
            nextTimelineTime = mediaTimeToTimelineTime(activeDraft, mediaTime, activeTime, vDur ?? undefined);
            currentTimeRef.current = nextTimelineTime;
        }

        if (!didBoundarySeek) {
            paintAmbientCanvas(video);
            onTimeUpdateRef.current(nextTimelineTime, vDur ?? 0);
        }
    }, [paintAmbientCanvas, seekAndSync, transitionToMediaTime]);

    useEffect(() => {
        const video = getActiveVideo();
        if (!video) return;
        let isMounted = true;

        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
            rVfcHandleRef.current = null;
            if (!isMounted) return;
            const cur = getActiveVideo();
            if (!cur) return;
            if (engineStateRef.current === 'playing' && !ctxRef.current.isScrubbing && ctxRef.current.isPlaying && !cur.seeking && !cur.paused) {
                syncTimelineTick(cur, applyVideoFollowerTick(cur, metadata.mediaTime));
            }
            if (!rVfcHandleRef.current) scheduleRvfc(getActiveVideo());
        };
        rVfcCallbackRef.current = onFrame;

        if (isPlaying && !isScrubbing) scheduleRvfc(video);
        return () => {
            isMounted = false;
            rVfcCallbackRef.current = null;
            cancelRvfc();
        };
    }, [isPlaying, isScrubbing, hasVideoElement, videoSrc, applyVideoFollowerTick, cancelRvfc, getActiveVideo, rVfcCallbackRef, rVfcHandleRef, scheduleRvfc, syncTimelineTick]);

    const handleLoadedMetadata = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video)) return;
        if (video.videoWidth && video.videoHeight) onAspectDetectedRef.current(video.videoWidth / video.videoHeight);
        const ctx = ctxRef.current;
        const vDur = getFiniteDuration(video, ctx.draft);
        if (vDur === null) return;
        const clampedTarget = clampMediaTarget(wrapMediaTime(ctx.draft, currentTimeRef.current, vDur), vDur);
        if (isDecoupledActive()) {
            video.muted = true;
            syncCompanionAudioToTime(clampedTarget, !ctx.isPlaying);
        }
        if (ctx.isPlaying && !ctx.isScrubbing && !ctx.isOutro) {
            seekAndSync(video, clampedTarget, true);
        } else {
            if (Math.abs(video.currentTime - clampedTarget) > 0.08) safeSetMediaTime(video, clampedTarget);
            onTimeUpdateRef.current?.(currentTimeRef.current, vDur);
        }
        preParkNextCut();
    }, [getActiveVideo, isDecoupledActive, preParkNextCut, seekAndSync, syncCompanionAudioToTime]);

    const handleStandbyLoadedMetadata = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const el = e?.currentTarget ?? standbyVideoRef.current;
        if (!el) return;
        if (el === getActiveVideo()) { handleLoadedMetadata(e); return; }
        setDeckVisibility(el, false);
        preParkNextCut(el);
    }, [getActiveVideo, handleLoadedMetadata, preParkNextCut, standbyVideoRef]);

    const handleTimeUpdate = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        const ctx = ctxRef.current;
        if (!video || (e && e.currentTarget !== video) || ctx.isScrubbing || !ctx.isPlaying || typeof video.requestVideoFrameCallback === 'function') return;
        syncTimelineTick(video, getRollingCompanionAudioTime() ?? video.currentTime);
    }, [getActiveVideo, getRollingCompanionAudioTime, syncTimelineTick]);

    const handleEnded = useCallback((e?: SyntheticEvent<HTMLVideoElement>) => {
        const video = getActiveVideo();
        if (!video || (e && e.currentTarget !== video) || ctxRef.current.isOutro) return;
        const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(ctxRef.current.draft.scenes || []);
        const t = currentTimeRef.current;
        const rawTarget = t < hookDur ? hookOffset : (hasReHook && t < preStoryDur ? rehookOffset : storyOffset);
        const vDur = getFiniteDuration(video, ctxRef.current.draft);
        const target = vDur !== null && rawTarget >= vDur - 0.05 ? (rawTarget % vDur >= vDur - 0.05 ? 0 : rawTarget % vDur) : rawTarget;
        seekAndSync(video, target, ctxRef.current.isPlaying);
    }, [getActiveVideo, seekAndSync]);

    return {
        videoRef, standbyVideoRef, companionAudioRef, activeVideoRef, audioOutputRef,
        engineStateRef, currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef,
        ambientCanvases, isCompanionFallback, unlockCompanionAudio,
        handleCompanionAudioError, handleCompanionAudioEnded, handleCompanionAudioLoadedMetadata,
        refreshAmbientGlow, handleLoadedMetadata, handleStandbyLoadedMetadata, handleTimeUpdate, handleEnded,
    };
};
