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
    const unlockPendingRef = useRef(false);
    const audioLaunchClaimedRef = useRef(false);
    const audioMasterStartedAtRef = useRef(0);
    const lastVideoRateAdjustAtRef = useRef(0);
    const lastAudioSnapAtRef = useRef(0);
    const consecutiveSnapFramesRef = useRef(0);

    const isDecoupledActive = useCallback(
        () => playbackProfileRef.current === 'decoupled-audio-lock' && !companionAudioFailedRef.current,
        [playbackProfileRef]
    );

    const pauseCompanionAudio = useCallback(() => {
        const audio = companionAudioRef.current;
        if (audio && !audio.paused && !unlockPendingRef.current) audio.pause();
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
    }, []);

    const resetForNewSource = useCallback(() => {
        companionAudioFailedRef.current = false;
        companionAudioUnlockedRef.current = false;
        unlockPendingRef.current = false;
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        lastVideoRateAdjustAtRef.current = 0;
        lastAudioSnapAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
        avDiagRef.current.companionAudioFallback = false;
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
            setFailedVideoSrc(videoSrcRef.current);
        }
        audioLaunchClaimedRef.current = false;
        audioMasterStartedAtRef.current = 0;
        consecutiveSnapFramesRef.current = 0;
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
        avDiagRef.current.companionAudioFallback = permanent;
    }, [audioOutputRef, avDiagRef, effectiveMutedRef, getActiveVideo, videoSrcRef]);

    const handleCompanionAudioError = useCallback(() => {
        avDiagRef.current.lastError = 'CompanionAudioMediaError';
        fallbackToNativeVideoAudio(true);
    }, [avDiagRef, fallbackToNativeVideoAudio]);

    /** Synchronously primes companion `<audio>` inside Play/Scrub-release gestures so mobile browsers allow async playback. */
    const unlockCompanionAudio = useCallback(() => {
        if (!isDecoupledActive()) return;
        const audio = companionAudioRef.current;
        if (!audio || companionAudioUnlockedRef.current || unlockPendingRef.current) return;
        const prevMuted = audio.muted;
        unlockPendingRef.current = true;
        audio.muted = true;
        audio.play().then(() => {
            unlockPendingRef.current = false;
            companionAudioUnlockedRef.current = true;
            if (!audioLaunchClaimedRef.current || !isPlayingRef.current || isScrubbingRef.current) {
                audio.pause();
            }
            audio.muted = effectiveMutedRef.current;
        }).catch(() => {
            unlockPendingRef.current = false;
            audio.muted = prevMuted;
        });
    }, [effectiveMutedRef, isDecoupledActive, isPlayingRef, isScrubbingRef]);

    const syncCompanionAudioToTime = useCallback((targetMediaTime: number, shouldPause: boolean) => {
        const audio = companionAudioRef.current;
        if (!audio || !isDecoupledActive()) return;
        if (shouldPause && !audio.paused && !unlockPendingRef.current) audio.pause();
        if (shouldPause) {
            audioLaunchClaimedRef.current = false;
            audioMasterStartedAtRef.current = 0;
            consecutiveSnapFramesRef.current = 0;
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

    /**
     * Video-First Painted-Frame Launch: parks `<audio>`, starts muted `<video>`, waits for `<video>`'s
     * first painted `rVFC` frame, then releases `<audio>` locked to that exact `metadata.mediaTime`.
     */
    const launchDecoupledAudioMaster = useCallback((video: HTMLVideoElement): boolean => {
        const audio = companionAudioRef.current;
        if (!isDecoupledActive() || !audio) return false;

        const { audioGain } = evaluateSceneTransition(draftRef.current, currentTimeRef.current);
        video.muted = true;
        video.playbackRate = 1;
        audio.playbackRate = 1;
        audio.muted = effectiveMutedRef.current;
        audio.volume = clamp((draftRef.current.volume ?? 1) * audioGain, 0, 1);

        const playAudioNow = () => {
            if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
            audio.muted = effectiveMutedRef.current;
            audioLaunchClaimedRef.current = true;
            audioMasterStartedAtRef.current = performance.now();
            lastVideoRateAdjustAtRef.current = 0;
            consecutiveSnapFramesRef.current = 0;
            audioOutputRef.current = audio;
            avDiagRef.current.companionAudioActive = true;
            avDiagRef.current.lastError = null;
            audio.play().catch((err) => {
                audioLaunchClaimedRef.current = false;
                if (err instanceof DOMException && err.name === 'AbortError') return;
                avDiagRef.current.lastError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
                // Keep split audio alive for future gestures on transient autoplay rejection
                const isPermanent = !(err instanceof DOMException && err.name === 'NotAllowedError');
                fallbackToNativeVideoAudio(isPermanent);
            });
        };

        const alignAndPlayAudio = (paintedMediaTime: number) => {
            cancelPlayGate();
            if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
            const audioDur = audio.duration || video.duration || 10;
            const targetAudio = clampMediaTarget(paintedMediaTime, audioDur);
            if (audio.readyState >= 1 && Math.abs(audio.currentTime - targetAudio) > 0.05) {
                audio.currentTime = targetAudio;
            }
            if (audio.seeking) {
                const onSeeked = () => {
                    playGateCleanupRef.current = null;
                    playAudioNow();
                };
                playGateCleanupRef.current = () => audio.removeEventListener('seeked', onSeeked);
                audio.addEventListener('seeked', onSeeked, { once: true });
            } else {
                playAudioNow();
            }
        };

        const startVideoThenLockAudio = () => {
            cancelPlayGate();
            if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
            let locked = false;
            let rVfcId: number | null = null;
            let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

            const cleanupLock = () => {
                if (fallbackTimer !== null) { clearTimeout(fallbackTimer); fallbackTimer = null; }
                if (rVfcId !== null && typeof video.cancelVideoFrameCallback === 'function') {
                    video.cancelVideoFrameCallback(rVfcId);
                    rVfcId = null;
                }
                video.removeEventListener('playing', onVideoPlayingFallback);
            };
            const lockAt = (mediaTime: number) => {
                if (locked) return;
                locked = true;
                cleanupLock();
                alignAndPlayAudio(mediaTime);
            };
            const onVideoPlayingFallback = () => {
                if (fallbackTimer === null) {
                    fallbackTimer = setTimeout(() => lockAt(video.currentTime), 600);
                }
            };

            playGateCleanupRef.current = cleanupLock;
            video.play().then(() => {
                if (locked || !isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
                if (typeof video.requestVideoFrameCallback === 'function') {
                    rVfcId = video.requestVideoFrameCallback((_now, meta) => lockAt(meta.mediaTime));
                    fallbackTimer = setTimeout(() => lockAt(video.currentTime), 600);
                } else {
                    lockAt(video.currentTime);
                }
            }).catch(() => { /* ignore aborted play promise */ });
            video.addEventListener('playing', onVideoPlayingFallback, { once: true });
        };

        const parkAudioAndLaunch = () => {
            cancelPlayGate();
            if (!isPlayingRef.current || isScrubbingRef.current || isOutroRef.current) return;
            if (audio.readyState >= 1) {
                const clampedAudio = clampMediaTarget(video.currentTime, audio.duration || video.duration || 10);
                if (Math.abs(audio.currentTime - clampedAudio) > 0.05) audio.currentTime = clampedAudio;
            }
            if (audio.seeking) {
                const onAudioSeeked = () => {
                    playGateCleanupRef.current = null;
                    startVideoThenLockAudio();
                };
                playGateCleanupRef.current = () => audio.removeEventListener('seeked', onAudioSeeked);
                audio.addEventListener('seeked', onAudioSeeked, { once: true });
            } else {
                startVideoThenLockAudio();
            }
        };

        if (audio.readyState < 1) {
            const metaTimer = setTimeout(parkAudioAndLaunch, 1500);
            const onAudioMeta = () => parkAudioAndLaunch();
            playGateCleanupRef.current = () => {
                clearTimeout(metaTimer);
                audio.removeEventListener('loadedmetadata', onAudioMeta);
                audio.removeEventListener('canplay', onAudioMeta);
            };
            audio.addEventListener('loadedmetadata', onAudioMeta, { once: true });
            audio.addEventListener('canplay', onAudioMeta, { once: true });
        } else {
            parkAudioAndLaunch();
        }
        return true;
    }, [
        audioOutputRef,
        avDiagRef,
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
     * Video-Follower Lock tick run inside `rVFC`: keeps `<audio>` untouched under 500ms drift via muted
     * `video.playbackRate` (0.80x–1.25x), and re-locks fast `<audio>` (`<15ms`) if drift persists past 500ms.
     */
    const applyVideoFollowerTick = useCallback((video: HTMLVideoElement, frameMediaTime: number): number => {
        const audio = companionAudioRef.current;
        const decoupled = isDecoupledActive();
        const audioRolling = decoupled && Boolean(audio) && audio!.readyState >= 1 && !audio!.paused && !audio!.seeking;
        if (decoupled && audio && video.readyState >= 2 && audioLaunchClaimedRef.current) {
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

                if (adj.mode === 'snap-audio') {
                    consecutiveSnapFramesRef.current += 1;
                    if (
                        consecutiveSnapFramesRef.current >= 3 &&
                        nowMs - lastAudioSnapAtRef.current >= VIDEO_FOLLOW_SNAP_COOLDOWN_MS &&
                        adj.targetAudioTime !== undefined
                    ) {
                        consecutiveSnapFramesRef.current = 0;
                        lastAudioSnapAtRef.current = nowMs;
                        video.playbackRate = 1;
                        audio.currentTime = clampMediaTarget(adj.targetAudioTime, audio.duration || video.duration || 10);
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
