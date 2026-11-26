import { useCallback, useRef, useState, type RefObject } from "react";
import {
    clamp,
    evaluateSceneTransition,
    wrapMediaTime,
    type PlaybackSyncProfile,
    type VideoDraft,
} from "@/types/news";
import { clampMediaTarget } from "./dualDeckHelpers";
import {
    AUDIO_MASTER_GRACE_MS,
    VIDEO_FOLLOW_RATE_INTERVAL_MS,
    VIDEO_FOLLOW_SNAP_COOLDOWN_MS,
    computeVideoToAudioClockAdjustment,
    type AvSyncDiagSnapshot,
    type PlaybackEngineState,
} from "./avSyncHelpers";
import { seekMediaElement, waitForMediaEvent, waitForNextVideoFrame } from "./mediaAsyncHelpers";

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
 * - Per-DOM-element gesture unlock (`WeakSet<HTMLAudioElement>`) awaited cleanly before launch (`A1`, `A12`).
 * - Linear `AbortSignal`-scoped video-first painted-frame launch (`A2`, `A3`, `A11`).
 * - Single `engineStateRef` (`'idle' | 'seeking' | 'priming' | 'playing' | 'buffering'`) with zero leaked timers (`A4`).
 */
export const useCompanionAudioLock = ({
    videoSrc,
    ctxRef,
    currentTimeRef,
    audioOutputRef,
    avDiagRef,
    engineStateRef,
    getActiveVideo,
    releaseDetachedDeck,
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

    const isDecoupledActive = useCallback(
        () => ctxRef.current.playbackProfile === 'decoupled-audio-lock' && !companionAudioFailedRef.current,
        [ctxRef]
    );

    const isAudioUnlocking = useCallback(() => unlockPromiseRef.current !== null, []);

    const pauseCompanionAudio = useCallback(() => {
        const audio = companionAudioRef.current;
        if (audio) {
            if (unlockPromiseRef.current) {
                audio.muted = true;
            } else if (!audio.paused) {
                audio.pause();
            }
        }
        audioMasterStartedAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
    }, []);

    const resetForNewSource = useCallback(() => {
        companionAudioFailedRef.current = false;
        unlockPromiseRef.current = null;
        audioMasterStartedAtRef.current = 0;
        lastVideoRateAdjustAtRef.current = 0;
        lastAudioSnapAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
        avDiagRef.current.companionAudioFallback = false;
        avDiagRef.current.videoBufferingPauses = 0;
        avDiagRef.current.audioSnaps = 0;
        avDiagRef.current.lastError = null;
    }, [avDiagRef]);

    const syncDetachedAudioRef = useCallback(() => {
        const prevAudio = lastCompanionAudioElRef.current;
        lastCompanionAudioElRef.current = companionAudioRef.current;
        if (prevAudio && prevAudio !== companionAudioRef.current) {
            releaseDetachedDeck(prevAudio);
        }
    }, [releaseDetachedDeck]);

    const releaseCompanionAudio = useCallback(() => {
        releaseDetachedDeck(lastCompanionAudioElRef.current);
    }, [releaseDetachedDeck]);

    const fallbackToNativeVideoAudio = useCallback((permanent = true) => {
        if (permanent) {
            companionAudioFailedRef.current = true;
            setFailedVideoSrc(ctxRef.current.videoSrc);
        }
        audioMasterStartedAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
        const audio = companionAudioRef.current;
        if (audio) {
            try {
                audio.pause();
                audio.playbackRate = 1;
            } catch { /* ignore detached audio teardown error */ }
        }
        const video = getActiveVideo();
        if (video) {
            video.playbackRate = 1;
            video.muted = ctxRef.current.effectiveMuted;
            audioOutputRef.current = video;
        }
        avDiagRef.current.companionAudioActive = false;
        avDiagRef.current.companionAudioFallback = permanent;
    }, [audioOutputRef, avDiagRef, ctxRef, getActiveVideo]);

    const handleCompanionAudioError = useCallback(() => {
        avDiagRef.current.lastError = 'CompanionAudioMediaError';
        fallbackToNativeVideoAudio(true);
    }, [avDiagRef, fallbackToNativeVideoAudio]);

    /** Gracefully handles shorter audio tracks reaching EOF slightly before `<video>` (`A15`). */
    const handleCompanionAudioEnded = useCallback(() => {
        audioMasterStartedAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
    }, []);

    /** Synchronously primes the current `<audio>` DOM element (strictly muted) inside Play/Scrub-release gestures. */
    const unlockCompanionAudio = useCallback(() => {
        if (!isDecoupledActive()) return;
        const audio = companionAudioRef.current;
        if (!audio || unlockedAudioElsRef.current.has(audio) || unlockPromiseRef.current) return;
        audio.muted = true;
        const p = audio.play().then(() => {
            unlockedAudioElsRef.current.add(audio);
            audio.pause();
        }).catch(() => {
            /* real launch will fall back to native video audio if browser blocks playback */
        }).finally(() => {
            if (unlockPromiseRef.current === p) unlockPromiseRef.current = null;
        });
        unlockPromiseRef.current = p;
    }, [isDecoupledActive]);

    const syncCompanionAudioToTime = useCallback((targetMediaTime: number, shouldPause: boolean) => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        if (shouldPause) {
            audioMasterStartedAtRef.current = 0;
            consecutiveSnapFramesRef.current = 0;
            if (unlockPromiseRef.current) {
                audio.muted = true;
                return;
            }
            if (!audio.paused) audio.pause();
        }
        audio.playbackRate = 1;
        if (audio.readyState >= 1) {
            const clamped = clampMediaTarget(targetMediaTime, getSafeDuration(audio, getActiveVideo()));
            if (Math.abs(audio.currentTime - clamped) > 0.045) {
                audio.currentTime = clamped;
            }
        }
    }, [getActiveVideo, isDecoupledActive]);

    const handleCompanionAudioLoadedMetadata = useCallback(() => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive() || engineStateRef.current === 'playing' || engineStateRef.current === 'priming') return;
        const vDur = getSafeDuration(getActiveVideo(), audio);
        const targetMediaTime = wrapMediaTime(ctxRef.current.draft, currentTimeRef.current, vDur);
        syncCompanionAudioToTime(targetMediaTime, true);
    }, [ctxRef, currentTimeRef, engineStateRef, getActiveVideo, isDecoupledActive, syncCompanionAudioToTime]);

    /** Signal-scoped buffering & drift monitor: auto-cleans on `signal.abort` with zero leaked intervals (`A2`, `A4`). */
    const attachMonitor = useCallback((video: HTMLVideoElement, audio: HTMLAudioElement, signal: AbortSignal) => {
        if (signal.aborted) return;
        const timer = setInterval(() => {
            const ctx = ctxRef.current;
            if (signal.aborted || !ctx.isPlaying || ctx.isScrubbing || ctx.isOutro || !isDecoupledActive()) {
                clearInterval(timer);
                return;
            }
            // Pause `<audio>` whenever `<video>` starves (`readyState < 3`) so audio never sails ahead
            if (video.readyState < 3 && !video.seeking && engineStateRef.current === 'playing') {
                engineStateRef.current = 'buffering';
                avDiagRef.current.videoBufferingPauses += 1;
                if (!audio.paused) audio.pause();
                return;
            }
            if (engineStateRef.current === 'buffering' && video.readyState >= 3 && !video.seeking && !video.paused) {
                const target = clampMediaTarget(video.currentTime, getSafeDuration(audio, video));
                if (Math.abs(audio.currentTime - target) > 0.045) audio.currentTime = target;
                audioMasterStartedAtRef.current = performance.now();
                engineStateRef.current = 'playing';
                audio.play().catch(() => { /* ignore aborted resume */ });
                return;
            }
            // Backstop if `rVFC` stopped firing while both elements claim to be rolling
            if (
                engineStateRef.current === 'playing' &&
                !video.paused && !video.seeking && !audio.paused && !audio.seeking &&
                video.readyState >= 3 && audioMasterStartedAtRef.current > 0 &&
                performance.now() - audioMasterStartedAtRef.current >= AUDIO_MASTER_GRACE_MS
            ) {
                const drift = video.currentTime - audio.currentTime;
                avDiagRef.current.lastAudioDriftMs = Math.round(drift * 1000);
                if (Math.abs(drift) > 0.5 && performance.now() - lastAudioSnapAtRef.current >= VIDEO_FOLLOW_SNAP_COOLDOWN_MS) {
                    lastAudioSnapAtRef.current = performance.now();
                    avDiagRef.current.audioSnaps += 1;
                    video.playbackRate = 1;
                    audio.currentTime = clampMediaTarget(video.currentTime, getSafeDuration(audio, video));
                }
            }
        }, 250);
        signal.addEventListener("abort", () => clearInterval(timer), { once: true });
    }, [avDiagRef, ctxRef, engineStateRef, isDecoupledActive]);

    /**
     * Linear, `AbortSignal`-scoped Video-First Painted-Frame Launch:
     * 0. Awaits any in-flight gesture unlock (`A1`).
     * 1. Parks & buffers `.m4a` `<audio>` to `readyState >= 3` before starting `<video>`.
     * 2. Starts muted `<video>` and awaits its first real painted `rVFC` frame (`A11` — no blind 400ms launch).
     * 3. Micro-verifies alignment (`<= 45ms`, pausing `<video>` briefly if `<audio>` must seek) and releases `<audio>`.
     */
    const launchDecoupledAudioMaster = useCallback(async (video: HTMLVideoElement, signal: AbortSignal): Promise<boolean> => {
        const audio = companionAudioRef.current;
        if (!isDecoupledActive() || !audio) return false;

        engineStateRef.current = 'priming';
        const ctx = ctxRef.current;
        const { audioGain } = evaluateSceneTransition(ctx.draft, currentTimeRef.current);
        video.muted = true;
        video.playbackRate = 1;
        audio.playbackRate = 1;
        audio.volume = clamp((ctx.draft.volume ?? 1) * audioGain, 0, 1);

        // Step 0: Wait for any synchronous gesture unlock to finish & pause `<audio>` cleanly
        if (unlockPromiseRef.current) {
            await unlockPromiseRef.current;
            if (signal.aborted) return true;
        }

        // Step 1: Ensure `<audio>` metadata is loaded, then park & buffer to readyState >= 3
        if (audio.readyState < 1) {
            await waitForMediaEvent(audio, ["loadedmetadata", "canplay"], { signal, timeoutMs: 2500, predicate: () => audio.readyState >= 1 });
            if (signal.aborted) return true;
        }
        if (!audio.paused) audio.pause();
        const audioDur = getSafeDuration(audio, video);
        const initialTarget = clampMediaTarget(video.currentTime, audioDur);
        if (audio.readyState >= 1) {
            await seekMediaElement(audio, initialTarget, { signal, toleranceSec: 0.045, timeoutMs: 2000 });
            if (signal.aborted) return true;
        }
        if (audio.readyState < 3) {
            await waitForMediaEvent(audio, ["canplay", "canplaythrough"], {
                signal,
                timeoutMs: 2000,
                predicate: () => !audio.seeking && audio.readyState >= 3,
            });
            if (signal.aborted) return true;
        }

        // Step 2: Start muted `<video>` and await a REAL painted frame (never launch audio blindly while video is unbuffered)
        try {
            await video.play();
        } catch {
            return true;
        }
        if (signal.aborted) return true;

        let paintedTime = await waitForNextVideoFrame(video, { signal, timeoutMs: 2000 });
        if (signal.aborted) return true;
        if (paintedTime === null) {
            await waitForMediaEvent(video, ["canplay", "canplaythrough", "playing"], {
                signal,
                timeoutMs: 2500,
                predicate: () => !video.seeking && video.readyState >= 3,
            });
            if (signal.aborted) return true;
            paintedTime = (await waitForNextVideoFrame(video, { signal, timeoutMs: 1200 })) ?? video.currentTime;
            if (signal.aborted) return true;
        }

        // Step 3: Micro-align `<audio>` to painted frame; briefly hold `<video>` if `<audio>` must seek (`A11`)
        const targetAudio = clampMediaTarget(paintedTime, getSafeDuration(audio, video));
        if (audio.readyState >= 1 && Math.abs(audio.currentTime - targetAudio) > 0.045) {
            const videoWasRolling = !video.paused;
            if (videoWasRolling) video.pause();
            await seekMediaElement(audio, targetAudio, { signal, toleranceSec: 0.04, timeoutMs: 1200 });
            if (signal.aborted) return true;
            if (videoWasRolling) {
                await video.play().catch(() => { /* ignore aborted resume */ });
                if (signal.aborted) return true;
            }
        }

        // Step 4: Release `<audio>` locked to `<video>` and transition to `'playing'`
        const liveCtx = ctxRef.current;
        if (signal.aborted || !liveCtx.isPlaying || liveCtx.isScrubbing || liveCtx.isOutro) return true;
        audio.muted = liveCtx.effectiveMuted;
        audioMasterStartedAtRef.current = 0;
        lastVideoRateAdjustAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
        audioOutputRef.current = audio;
        avDiagRef.current.companionAudioActive = true;
        avDiagRef.current.audioReadyStateAtPlay = audio.readyState;
        avDiagRef.current.lastError = null;

        try {
            await audio.play();
        } catch (err) {
            if (signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return true;
            avDiagRef.current.lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
            const isPermanent = !(err instanceof DOMException && err.name === 'NotAllowedError');
            fallbackToNativeVideoAudio(isPermanent);
            if (!video.paused) engineStateRef.current = 'playing';
            return true;
        }
        if (signal.aborted) return true;

        unlockedAudioElsRef.current.add(audio);
        if (audio.readyState < 3) {
            await waitForMediaEvent(audio, ["playing", "canplay"], { signal, timeoutMs: 1000, predicate: () => !audio.paused && audio.readyState >= 3 });
            if (signal.aborted) return true;
        }
        audioMasterStartedAtRef.current = performance.now();
        engineStateRef.current = 'playing';
        attachMonitor(video, audio, signal);
        return true;
    }, [attachMonitor, audioOutputRef, avDiagRef, ctxRef, currentTimeRef, engineStateRef, fallbackToNativeVideoAudio, isDecoupledActive]);

    /**
     * Video-Follower Lock tick run inside `rVFC` strictly when `engineStateRef.current === 'playing'`:
     * keeps `<audio>` untouched under 500ms drift via muted `video.playbackRate` (0.80x–1.25x),
     * and fast-relocks `<audio>` (`<5ms` on `.m4a`) if drift persists >500ms.
     */
    const applyVideoFollowerTick = useCallback((video: HTMLVideoElement, frameMediaTime: number): number => {
        const audio = companionAudioRef.current;
        const decoupled = isDecoupledActive();
        const audioRolling = decoupled && engineStateRef.current === 'playing' && Boolean(audio) && audio!.readyState >= 1 && !audio!.paused && !audio!.seeking;
        if (decoupled && audio && video.readyState >= 2 && engineStateRef.current === 'playing') {
            video.muted = true;
            const frameTime = clampMediaTarget(frameMediaTime, getSafeDuration(video));
            const nowMs = performance.now();
            if (audioRolling && audioMasterStartedAtRef.current > 0 && nowMs - audioMasterStartedAtRef.current >= AUDIO_MASTER_GRACE_MS) {
                const adj = computeVideoToAudioClockAdjustment(frameTime, audio.currentTime);
                avDiagRef.current.lastAudioDriftMs = Math.round(adj.driftSec * 1000);

                if (adj.mode === 'snap-audio') {
                    consecutiveSnapFramesRef.current += 1;
                    if (
                        consecutiveSnapFramesRef.current >= 3 &&
                        nowMs - lastAudioSnapAtRef.current >= VIDEO_FOLLOW_SNAP_COOLDOWN_MS &&
                        adj.targetAudioTime !== undefined
                    ) {
                        consecutiveSnapFramesRef.current = 0;
                        lastAudioSnapAtRef.current = nowMs;
                        avDiagRef.current.audioSnaps += 1;
                        video.playbackRate = 1;
                        audio.currentTime = clampMediaTarget(adj.targetAudioTime, getSafeDuration(audio, video));
                    }
                } else {
                    consecutiveSnapFramesRef.current = 0;
                    if (
                        nowMs - lastVideoRateAdjustAtRef.current >= VIDEO_FOLLOW_RATE_INTERVAL_MS &&
                        Math.abs(video.playbackRate - adj.videoPlaybackRate) > 0.004
                    ) {
                        lastVideoRateAdjustAtRef.current = nowMs;
                        video.playbackRate = adj.videoPlaybackRate;
                    }
                }
            }
        }
        return audioRolling && audio ? audio.currentTime : frameMediaTime;
    }, [avDiagRef, engineStateRef, isDecoupledActive]);

    const getRollingCompanionAudioTime = useCallback((): number | null => {
        const audio = companionAudioRef.current;
        if (isDecoupledActive() && engineStateRef.current === 'playing' && audio && audio.readyState >= 1 && !audio.paused && !audio.seeking) {
            return audio.currentTime;
        }
        return null;
    }, [engineStateRef, isDecoupledActive]);

    return {
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
    };
};
