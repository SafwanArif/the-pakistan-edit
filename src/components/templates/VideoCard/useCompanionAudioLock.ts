"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import { wrapMediaTime, type PlaybackSyncProfile, type VideoDraft } from "@/types/news";
import { isAbortError } from "@/app/admin/utils/exportEngine";
import { clampMediaTarget } from "./dualDeckHelpers";
import { computeEffectiveVolume } from "./videoCardGeometry";
import {
    AUDIO_MASTER_GRACE_MS,
    VIDEO_FOLLOW_RATE_INTERVAL_MS,
    VIDEO_FOLLOW_SNAP_COOLDOWN_MS,
    computeVideoToAudioClockAdjustment,
    type AvSyncDiagSnapshot,
    type PlaybackEngineState,
} from "./avSyncHelpers";
import {
    formatMediaError,
    safeSetMediaTime,
    seekMediaElement,
    waitForMediaEvent,
    waitForNextVideoFrame,
} from "./mediaAsyncHelpers";

export interface VideoSyncRuntimeCtx {
    draft: VideoDraft;
    videoSrc: string;
    isPlaying: boolean;
    isScrubbing: boolean;
    isOutro: boolean;
    playbackMode: 'play-all' | 'loop-angle';
    playbackProfile: PlaybackSyncProfile;
    effectiveMuted: boolean;
    useStandbyDeck: boolean;
    keyframeTimes?: number[];
}

interface UseCompanionAudioLockOptions {
    videoSrc: string;
    ctxRef: RefObject<VideoSyncRuntimeCtx>;
    currentTimeRef: RefObject<number>;
    audioOutputRef: RefObject<HTMLMediaElement | null>;
    avDiagRef: RefObject<AvSyncDiagSnapshot>;
    engineStateRef: RefObject<PlaybackEngineState>;
    getActiveVideo: () => HTMLVideoElement | null;
    releaseDetachedDeck: (el: HTMLMediaElement | null) => void;
}

const getSafeDuration = (el: HTMLMediaElement | null, fallback?: HTMLMediaElement | null): number => {
    if (el && Number.isFinite(el.duration) && el.duration > 0.05) return el.duration;
    if (fallback && Number.isFinite(fallback.duration) && fallback.duration > 0.05) return fallback.duration;
    return 10;
};

/**
 * Owns the decoupled pure-`.m4a` companion `<audio>` rail & `AbortSignal`-scoped Video-Follower Lock:
 * per-element gesture unlock (`A1`/`A12`), painted-frame launch (`A2`/`A3`/`A11`), and single `engineStateRef` (`A4`).
 */
export const useCompanionAudioLock = ({
    videoSrc, ctxRef, currentTimeRef, audioOutputRef, avDiagRef, engineStateRef, getActiveVideo, releaseDetachedDeck,
}: UseCompanionAudioLockOptions) => {
    const [failedVideoSrc, setFailedVideoSrc] = useState<string | null>(null);
    const isCompanionFallback = failedVideoSrc === videoSrc;

    const companionAudioRef = useRef<HTMLAudioElement>(null);
    const lastCompanionAudioElRef = useRef<HTMLAudioElement | null>(null);
    const unlockedAudioElsRef = useRef(new WeakSet<HTMLAudioElement>());
    const unlockPromiseRef = useRef<Promise<void> | null>(null);
    const companionAudioFailedRef = useRef(false);
    const audioMasterStartedAtRef = useRef(0);
    const lastVideoRateAdjustAtRef = useRef(0);
    const lastAudioSnapAtRef = useRef(0);
    const consecutiveSnapFramesRef = useRef(0);

    const resetDriftTrackers = useCallback(() => {
        audioMasterStartedAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
    }, []);

    const isDecoupledActive = useCallback(
        () => ctxRef.current.playbackProfile === 'decoupled-audio-lock' && !companionAudioFailedRef.current,
        [ctxRef]
    );
    const isAudioUnlocking = useCallback(() => unlockPromiseRef.current !== null, []);

    const pauseCompanionAudio = useCallback(() => {
        const audio = companionAudioRef.current;
        if (audio) {
            if (unlockPromiseRef.current) audio.muted = true;
            else if (!audio.paused) audio.pause();
        }
        resetDriftTrackers();
    }, [resetDriftTrackers]);

    const resetForNewSource = useCallback(() => {
        companionAudioFailedRef.current = false;
        unlockPromiseRef.current = null;
        lastVideoRateAdjustAtRef.current = 0;
        lastAudioSnapAtRef.current = 0;
        resetDriftTrackers();
        avDiagRef.current.companionAudioFallback = false;
        avDiagRef.current.videoBufferingPauses = 0;
        avDiagRef.current.audioSnaps = 0;
        avDiagRef.current.lastError = null;
    }, [avDiagRef, resetDriftTrackers]);

    const syncDetachedAudioRef = useCallback(() => {
        const prev = lastCompanionAudioElRef.current;
        lastCompanionAudioElRef.current = companionAudioRef.current;
        if (prev && prev !== companionAudioRef.current) releaseDetachedDeck(prev);
    }, [releaseDetachedDeck]);

    const releaseCompanionAudio = useCallback(() => {
        releaseDetachedDeck(lastCompanionAudioElRef.current);
    }, [releaseDetachedDeck]);

    const fallbackToNativeVideoAudio = useCallback((permanent = true) => {
        if (permanent) {
            companionAudioFailedRef.current = true;
            setFailedVideoSrc(ctxRef.current.videoSrc);
        }
        resetDriftTrackers();
        const audio = companionAudioRef.current;
        if (audio) {
            try { audio.pause(); audio.playbackRate = 1; } catch { /* ignore detached audio teardown error */ }
        }
        const video = getActiveVideo();
        if (video) {
            const ctx = ctxRef.current;
            video.playbackRate = 1;
            video.muted = ctx.effectiveMuted;
            video.volume = computeEffectiveVolume(ctx.draft, currentTimeRef.current);
            audioOutputRef.current = video;
        }
        avDiagRef.current.companionAudioActive = false;
        avDiagRef.current.companionAudioFallback = permanent;
    }, [audioOutputRef, avDiagRef, ctxRef, currentTimeRef, getActiveVideo, resetDriftTrackers]);

    const fallbackOnAudioPlayError = useCallback((err: unknown) => {
        avDiagRef.current.lastError = formatMediaError(err);
        fallbackToNativeVideoAudio(!(err instanceof DOMException && err.name === 'NotAllowedError'));
    }, [avDiagRef, fallbackToNativeVideoAudio]);

    const handleCompanionAudioError = useCallback(() => {
        avDiagRef.current.lastError = 'CompanionAudioMediaError';
        fallbackToNativeVideoAudio(true);
    }, [avDiagRef, fallbackToNativeVideoAudio]);

    /** Gracefully handles shorter audio tracks reaching EOF slightly before `<video>` (`A15`). */
    const handleCompanionAudioEnded = resetDriftTrackers;

    /** Synchronously primes `<audio>` (strictly muted) inside Play/Scrub-release gestures. */
    const unlockCompanionAudio = useCallback(() => {
        if (!isDecoupledActive()) return;
        const audio = companionAudioRef.current;
        if (!audio || unlockedAudioElsRef.current.has(audio) || unlockPromiseRef.current) return;
        audio.muted = true;
        const p = audio.play().then(() => {
            unlockedAudioElsRef.current.add(audio);
            if (unlockPromiseRef.current === p) audio.pause();
        }).catch(() => { /* real launch falls back to native audio if blocked */ }).finally(() => {
            if (unlockPromiseRef.current === p) unlockPromiseRef.current = null;
        });
        unlockPromiseRef.current = p;
    }, [isDecoupledActive]);

    const syncCompanionAudioToTime = useCallback((targetMediaTime: number, shouldPause: boolean) => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        if (shouldPause) {
            resetDriftTrackers();
            if (unlockPromiseRef.current) { audio.muted = true; return; }
            if (!audio.paused) audio.pause();
        }
        audio.playbackRate = 1;
        if (audio.readyState >= 1) {
            const clamped = clampMediaTarget(targetMediaTime, getSafeDuration(audio, getActiveVideo()));
            if (Math.abs(audio.currentTime - clamped) > 0.045) safeSetMediaTime(audio, clamped);
        }
    }, [getActiveVideo, isDecoupledActive, resetDriftTrackers]);

    const handleCompanionAudioLoadedMetadata = useCallback(() => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive() || engineStateRef.current === 'playing' || engineStateRef.current === 'priming') return;
        syncCompanionAudioToTime(wrapMediaTime(ctxRef.current.draft, currentTimeRef.current, getSafeDuration(getActiveVideo(), audio)), true);
    }, [ctxRef, currentTimeRef, engineStateRef, getActiveVideo, isDecoupledActive, syncCompanionAudioToTime]);

    /** Signal-scoped buffering & drift monitor: auto-cleans on `signal.abort` (`A2`, `A4`). */
    const attachMonitor = useCallback((video: HTMLVideoElement, audio: HTMLAudioElement, signal: AbortSignal) => {
        if (signal.aborted) return;
        const timer = setInterval(() => {
            const ctx = ctxRef.current;
            if (signal.aborted || !ctx.isPlaying || ctx.isScrubbing || ctx.isOutro || !isDecoupledActive()) {
                clearInterval(timer);
                return;
            }
            if (video.readyState < 3 && !video.seeking && engineStateRef.current === 'playing') {
                engineStateRef.current = 'buffering';
                avDiagRef.current.videoBufferingPauses += 1;
                if (!audio.paused) audio.pause();
                return;
            }
            if (engineStateRef.current === 'buffering' && video.readyState >= 3 && !video.seeking && !video.paused) {
                const audioDur = getSafeDuration(audio, video);
                if (audio.ended && video.currentTime >= audioDur - 0.08) {
                    engineStateRef.current = 'playing';
                    return;
                }
                const target = clampMediaTarget(video.currentTime, audioDur);
                if (audio.readyState >= 1 && Math.abs(audio.currentTime - target) > 0.045) safeSetMediaTime(audio, target);
                audioMasterStartedAtRef.current = performance.now();
                engineStateRef.current = 'playing';
                audio.play().catch((err: unknown) => { if (!signal.aborted && !isAbortError(err)) fallbackOnAudioPlayError(err); });
                return;
            }
            if (
                engineStateRef.current === 'playing' && !video.paused && !video.seeking && !audio.paused && !audio.seeking &&
                video.readyState >= 3 && audio.readyState >= 1 && audioMasterStartedAtRef.current > 0 &&
                performance.now() - audioMasterStartedAtRef.current >= AUDIO_MASTER_GRACE_MS
            ) {
                const drift = video.currentTime - audio.currentTime;
                avDiagRef.current.lastAudioDriftMs = Math.round(drift * 1000);
                if (Math.abs(drift) > 0.5 && performance.now() - lastAudioSnapAtRef.current >= VIDEO_FOLLOW_SNAP_COOLDOWN_MS) {
                    lastAudioSnapAtRef.current = performance.now();
                    avDiagRef.current.audioSnaps += 1;
                    video.playbackRate = 1;
                    safeSetMediaTime(audio, clampMediaTarget(video.currentTime, getSafeDuration(audio, video)));
                }
            }
        }, 250);
        signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    }, [avDiagRef, ctxRef, engineStateRef, fallbackOnAudioPlayError, isDecoupledActive]);

    /** Linear, `AbortSignal`-scoped Video-First Painted-Frame Launch (`A1`, `A2`, `A3`, `A11`). */
    const launchDecoupledAudioMaster = useCallback(async (video: HTMLVideoElement, signal: AbortSignal): Promise<boolean> => {
        const audio = companionAudioRef.current;
        if (!isDecoupledActive() || !audio) return false;

        const stopIfInactive = (): boolean => {
            const liveCtx = ctxRef.current;
            if (!liveCtx.isPlaying || liveCtx.isScrubbing || liveCtx.isOutro) {
                if (!video.paused) video.pause();
                if (!audio.paused) audio.pause();
                if (!signal.aborted) engineStateRef.current = 'idle';
                return true;
            }
            return signal.aborted;
        };

        const waitStep = async (promise: Promise<unknown>): Promise<boolean> => {
            await promise;
            return !stopIfInactive();
        };

        engineStateRef.current = 'priming';
        video.muted = true;
        video.playbackRate = 1;
        audio.playbackRate = 1;
        audio.volume = computeEffectiveVolume(ctxRef.current.draft, currentTimeRef.current);

        if (unlockPromiseRef.current && !(await waitStep(unlockPromiseRef.current))) return true;
        if (audio.readyState < 1 && !(await waitStep(waitForMediaEvent(audio, ["loadedmetadata", "canplay"], { signal, timeoutMs: 2500, predicate: () => audio.readyState >= 1 })))) return true;
        if (!audio.paused) audio.pause();
        if (audio.readyState >= 1) {
            const initialTarget = clampMediaTarget(video.currentTime, getSafeDuration(audio, video));
            if (!(await waitStep(seekMediaElement(audio, initialTarget, { signal, toleranceSec: 0.045, timeoutMs: 2000 })))) return true;
        }
        if (audio.readyState < 3 && !(await waitStep(waitForMediaEvent(audio, ["canplay", "canplaythrough"], { signal, timeoutMs: 2000, predicate: () => !audio.seeking && audio.readyState >= 3 })))) return true;

        try {
            await video.play();
        } catch (err: unknown) {
            if (!signal.aborted) {
                if (!isAbortError(err)) avDiagRef.current.lastError = formatMediaError(err);
                engineStateRef.current = 'idle';
            }
            return true;
        }
        if (stopIfInactive()) return true;

        let paintedTime = await waitForNextVideoFrame(video, { signal, timeoutMs: 2000 });
        if (stopIfInactive()) return true;
        if (paintedTime === null) {
            if (!(await waitStep(waitForMediaEvent(video, ["canplay", "canplaythrough", "playing"], { signal, timeoutMs: 2500, predicate: () => !video.seeking && video.readyState >= 3 })))) return true;
            paintedTime = (await waitForNextVideoFrame(video, { signal, timeoutMs: 1200 })) ?? video.currentTime;
            if (stopIfInactive()) return true;
        }

        const targetAudio = clampMediaTarget(paintedTime, getSafeDuration(audio, video));
        if (audio.readyState >= 1 && Math.abs(audio.currentTime - targetAudio) > 0.045) {
            const videoWasRolling = !video.paused;
            if (videoWasRolling) video.pause();
            if (!(await waitStep(seekMediaElement(audio, targetAudio, { signal, toleranceSec: 0.04, timeoutMs: 1200 })))) return true;
            if (videoWasRolling) {
                try {
                    await video.play();
                } catch (err: unknown) {
                    if (!signal.aborted) {
                        if (!isAbortError(err)) avDiagRef.current.lastError = formatMediaError(err);
                        engineStateRef.current = 'idle';
                    }
                    return true;
                }
                if (stopIfInactive() || video.paused) {
                    if (!signal.aborted && video.paused) engineStateRef.current = 'idle';
                    return true;
                }
            }
        }

        if (stopIfInactive()) return true;
        audio.muted = ctxRef.current.effectiveMuted;
        lastVideoRateAdjustAtRef.current = 0;
        resetDriftTrackers();
        audioOutputRef.current = audio;
        avDiagRef.current.companionAudioActive = true;
        avDiagRef.current.audioReadyStateAtPlay = audio.readyState;
        avDiagRef.current.lastError = null;

        try {
            await audio.play();
        } catch (err: unknown) {
            if (signal.aborted || isAbortError(err)) { stopIfInactive(); return true; }
            fallbackOnAudioPlayError(err);
            engineStateRef.current = video.paused ? 'idle' : 'playing';
            return true;
        }
        if (stopIfInactive()) return true;

        unlockedAudioElsRef.current.add(audio);
        if (audio.readyState < 3 && !(await waitStep(waitForMediaEvent(audio, ["playing", "canplay"], { signal, timeoutMs: 1000, predicate: () => !audio.paused && audio.readyState >= 3 })))) return true;
        audioMasterStartedAtRef.current = performance.now();
        engineStateRef.current = 'playing';
        attachMonitor(video, audio, signal);
        return true;
    }, [attachMonitor, audioOutputRef, avDiagRef, ctxRef, currentTimeRef, engineStateRef, fallbackOnAudioPlayError, isDecoupledActive, resetDriftTrackers]);

    /** Video-Follower Lock tick inside `rVFC`: pulls muted video rate under 500ms drift, fast-relocks `.m4a` above 500ms. */
    const applyVideoFollowerTick = useCallback((video: HTMLVideoElement, frameMediaTime: number): number => {
        const safeFrameTime = Number.isFinite(frameMediaTime) ? frameMediaTime : video.currentTime;
        const audio = companionAudioRef.current;
        const decoupled = isDecoupledActive();
        const audioRolling = Boolean(decoupled && engineStateRef.current === 'playing' && audio && audio.readyState >= 1 && !audio.paused && !audio.seeking);
        if (decoupled && audio && video.readyState >= 2 && engineStateRef.current === 'playing') {
            video.muted = true;
            const frameTime = clampMediaTarget(safeFrameTime, getSafeDuration(video));
            const nowMs = performance.now();
            if (audioRolling && audioMasterStartedAtRef.current > 0 && nowMs - audioMasterStartedAtRef.current >= AUDIO_MASTER_GRACE_MS) {
                const adj = computeVideoToAudioClockAdjustment(frameTime, audio.currentTime);
                avDiagRef.current.lastAudioDriftMs = Math.round(adj.driftSec * 1000);
                if (adj.mode === 'snap-audio') {
                    consecutiveSnapFramesRef.current += 1;
                    if (consecutiveSnapFramesRef.current >= 3 && nowMs - lastAudioSnapAtRef.current >= VIDEO_FOLLOW_SNAP_COOLDOWN_MS && adj.targetAudioTime !== undefined) {
                        consecutiveSnapFramesRef.current = 0;
                        lastAudioSnapAtRef.current = nowMs;
                        avDiagRef.current.audioSnaps += 1;
                        video.playbackRate = 1;
                        safeSetMediaTime(audio, clampMediaTarget(adj.targetAudioTime, getSafeDuration(audio, video)));
                    }
                } else {
                    consecutiveSnapFramesRef.current = 0;
                    if (nowMs - lastVideoRateAdjustAtRef.current >= VIDEO_FOLLOW_RATE_INTERVAL_MS && Math.abs(video.playbackRate - adj.videoPlaybackRate) > 0.004) {
                        lastVideoRateAdjustAtRef.current = nowMs;
                        video.playbackRate = adj.videoPlaybackRate;
                    }
                }
            }
        }
        return audioRolling && audio ? audio.currentTime : safeFrameTime;
    }, [avDiagRef, engineStateRef, isDecoupledActive]);

    const getRollingCompanionAudioTime = useCallback((): number | null => {
        const audio = companionAudioRef.current;
        return isDecoupledActive() && engineStateRef.current === 'playing' && audio && audio.readyState >= 1 && !audio.paused && !audio.seeking
            ? audio.currentTime : null;
    }, [engineStateRef, isDecoupledActive]);

    return {
        companionAudioRef, isCompanionFallback, isDecoupledActive, isAudioUnlocking,
        pauseCompanionAudio, resetForNewSource, syncDetachedAudioRef, releaseCompanionAudio,
        handleCompanionAudioError, handleCompanionAudioEnded, unlockCompanionAudio,
        syncCompanionAudioToTime, handleCompanionAudioLoadedMetadata,
        launchDecoupledAudioMaster, applyVideoFollowerTick, getRollingCompanionAudioTime,
    };
};
