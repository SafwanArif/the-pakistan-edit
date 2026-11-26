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
} from "./avSyncHelpers";

interface UseCompanionAudioLockOptions {
    videoSrc: string;
    videoSrcRef: RefObject<string>;
    playbackProfileRef: RefObject<PlaybackSyncProfile>;
    effectiveMutedRef: RefObject<boolean>;
    isPlayingRef: RefObject<boolean>;
    isScrubbingRef: RefObject<boolean>;
    isOutroRef: RefObject<boolean>;
    currentTimeRef: RefObject<number>;
    draftRef: RefObject<VideoDraft>;
    audioOutputRef: RefObject<HTMLMediaElement | null>;
    avDiagRef: RefObject<AvSyncDiagSnapshot>;
    playGateCleanupRef: RefObject<(() => void) | null>;
    cancelPlayGate: () => void;
    getActiveVideo: () => HTMLVideoElement | null;
    releaseDetachedDeck: (el: HTMLMediaElement | null) => void;
}

/**
 * Owns the decoupled companion `<audio>` master rail & Video-Follower Lock for high-risk
 * 4K AV1 / HEVC / long-GOP / fragmented / mobile `blob:` clips so `<audio>` plays uninterrupted
 * while muted `<video>` gently adjusts its rate or snaps only when drift exceeds 750ms.
 */
export const useCompanionAudioLock = ({
    videoSrc,
    videoSrcRef,
    playbackProfileRef,
    effectiveMutedRef,
    isPlayingRef,
    isScrubbingRef,
    isOutroRef,
    currentTimeRef,
    draftRef,
    audioOutputRef,
    avDiagRef,
    playGateCleanupRef,
    cancelPlayGate,
    getActiveVideo,
    releaseDetachedDeck,
}: UseCompanionAudioLockOptions) => {
    const [failedVideoSrc, setFailedVideoSrc] = useState<string | null>(null);
    const isCompanionFallback = failedVideoSrc === videoSrc;

    const companionAudioRef = useRef<HTMLAudioElement>(null);
    const lastCompanionAudioElRef = useRef<HTMLAudioElement | null>(null);
    const companionAudioFailedRef = useRef(false);
    const companionAudioUnlockedRef = useRef(false);
    const audioLaunchClaimedRef = useRef(false);
    const audioMasterStartedAtRef = useRef(0);
    const lastVideoRateAdjustAtRef = useRef(0);
    const lastVideoSnapAtRef = useRef(0);
    const consecutiveVideoSnapFramesRef = useRef(0);

    const isDecoupledActive = useCallback(
        () => playbackProfileRef.current === 'decoupled-audio-lock' && !companionAudioFailedRef.current,
        [playbackProfileRef]
    );

    const pauseCompanionAudio = useCallback(() => {
        const audio = companionAudioRef.current;
        if (audio && !audio.paused) audio.pause();
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        consecutiveVideoSnapFramesRef.current = 0;
    }, []);

    const resetForNewSource = useCallback(() => {
        companionAudioFailedRef.current = false;
        companionAudioUnlockedRef.current = false;
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        lastVideoRateAdjustAtRef.current = 0;
        lastVideoSnapAtRef.current = 0;
        consecutiveVideoSnapFramesRef.current = 0;
        avDiagRef.current.companionAudioFallback = false;
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
            } catch { /* ignore detached audio element teardown error */ }
        }
        const video = getActiveVideo();
        if (video) {
            video.playbackRate = 1;
            video.muted = effectiveMutedRef.current;
            audioOutputRef.current = video;
        }
        avDiagRef.current.companionAudioActive = false;
        avDiagRef.current.companionAudioFallback = true;
    }, [audioOutputRef, avDiagRef, effectiveMutedRef, getActiveVideo, videoSrcRef]);

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
    }, [effectiveMutedRef, isDecoupledActive, isPlayingRef, isScrubbingRef]);

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

    const handleCompanionAudioLoadedMetadata = useCallback(() => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        const vDur = getActiveVideo()?.duration || audio.duration || 10;
        const targetMediaTime = wrapMediaTime(draftRef.current, currentTimeRef.current, vDur);
        syncCompanionAudioToTime(targetMediaTime, !audioLaunchClaimedRef.current);
    }, [currentTimeRef, draftRef, getActiveVideo, isDecoupledActive, syncCompanionAudioToTime]);

    /** Audio-Master Launch: starts uninterrupted `<audio>` FIRST and releases muted `<video>` once `playing` opens. */
    const launchDecoupledAudioMaster = useCallback((video: HTMLVideoElement): boolean => {
        const audio = companionAudioRef.current;
        if (!isDecoupledActive() || !audio) return false;

        const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
        video.muted = true;
        video.playbackRate = 1;
        audio.playbackRate = 1;
        audio.muted = effectiveMutedRef.current;
        audio.volume = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);

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
                video.play().catch(() => { /* autoplay/abort guarded by play gate */ });
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
                        video.play().catch(() => { /* ignore aborted play retry */ });
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
        return true;
    }, [
        cancelPlayGate,
        currentTimeRef,
        draftRef,
        effectiveMutedRef,
        fallbackToNativeVideoAudio,
        isDecoupledActive,
        isOutroRef,
        isPlayingRef,
        isScrubbingRef,
        playGateCleanupRef,
    ]);

    /**
     * Video-Follower Lock tick run inside `rVFC`: keeps `<audio>` untouched and nudges muted `<video>` only.
     * Returns the authoritative master media time (`audio.currentTime` when decoupled audio is rolling, else `frameMediaTime`).
     */
    const applyVideoFollowerTick = useCallback((video: HTMLVideoElement, frameMediaTime: number): number => {
        const audio = companionAudioRef.current;
        const decoupled = isDecoupledActive();
        const audioRolling = decoupled && Boolean(audio) && audio!.readyState >= 1 && !audio!.paused && !audio!.seeking;
        if (decoupled && audio && video.readyState >= 2) {
            video.muted = true;
            const frameTime = clampMediaTarget(frameMediaTime, video.duration || 10);
            const nowMs = performance.now();
            if (
                audioRolling &&
                audioMasterStartedAtRef.current > 0 &&
                nowMs - audioMasterStartedAtRef.current >= AUDIO_MASTER_GRACE_MS
            ) {
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
                        video.playbackRate = 1;
                        video.currentTime = clampMediaTarget(adj.targetVideoTime, video.duration || 10);
                    }
                } else {
                    consecutiveVideoSnapFramesRef.current = 0;
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
    }, [avDiagRef, isDecoupledActive]);

    const getRollingCompanionAudioTime = useCallback((): number | null => {
        const audio = companionAudioRef.current;
        if (isDecoupledActive() && audio && audio.readyState >= 1 && !audio.paused && !audio.seeking) {
            return audio.currentTime;
        }
        return null;
    }, [isDecoupledActive]);

    return {
        companionAudioRef,
        isCompanionFallback,
        isDecoupledActive,
        pauseCompanionAudio,
        resetForNewSource,
        syncDetachedAudioRef,
        releaseCompanionAudio,
        handleCompanionAudioError,
        unlockCompanionAudio,
        syncCompanionAudioToTime,
        handleCompanionAudioLoadedMetadata,
        launchDecoupledAudioMaster,
        applyVideoFollowerTick,
        getRollingCompanionAudioTime,
    };
};
