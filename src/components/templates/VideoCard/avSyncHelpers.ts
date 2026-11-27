/**
 * Pure playback/seek synchronization decision helpers for `useVideoElementSync`.
 * Keeps the single-coordinator state machine, boundary cuts, keyframe scrubbing,
 * and audio-master video-follower lock math directly unit-testable.
 */
import { clamp, getTimelineStructure, type PlaybackSyncProfile, type VideoDraft } from "@/types/news";
import { findNearestKeyframe } from "@/app/admin/utils/clientMediaInspector";

/** Explicit single-source playback engine state shared across `useVideoElementSync`, `useCompanionAudioLock`, and `useSmoothFramingLoop`. */
export type PlaybackEngineState = 'idle' | 'seeking' | 'priming' | 'playing' | 'buffering';

type PlaybackSyncAction = 'outro' | 'scrub' | 'pause-seek' | 'start-play' | 'explicit-play-seek' | 'noop';

interface PlaybackSyncTransitionInput {
    isOutro: boolean;
    isScrubbing: boolean;
    isPlaying: boolean;
    wasPlaying: boolean;
    wasScrubbing: boolean;
    isExplicitSeek: boolean;
}

/** Classifies each React commit into strictly ONE `<video>` sync action so scrub releases never double-seek. */
export const resolvePlaybackSyncAction = (input: PlaybackSyncTransitionInput): PlaybackSyncAction => {
    if (input.isOutro) return 'outro';
    if (input.isScrubbing) return 'scrub';
    if (!input.isPlaying) return 'pause-seek';
    if (!input.wasPlaying || input.wasScrubbing) return 'start-play';
    if (input.isExplicitSeek) return 'explicit-play-seek';
    return 'noop';
};

export type BoundaryCutDecision =
    | { kind: 'transition'; nextTimelineTime: number; targetMediaTime: number }
    | { kind: 'realign'; targetMediaTime: number }
    | null;

/** Evaluates Hook / Re-Hook / Story non-contiguous boundary transitions & Story underflow guards. */
export const resolveBoundaryCut = (
    draft: VideoDraft,
    activeTime: number,
    mediaTime: number,
    isLoop: boolean
): BoundaryCutDecision => {
    const { hasReHook, hookDur, rehookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (hasReHook && activeTime < hookDur && mediaTime >= hookOffset + hookDur - 0.022) {
        return { kind: 'transition', nextTimelineTime: isLoop ? 0 : hookDur, targetMediaTime: isLoop ? hookOffset : rehookOffset };
    }
    if (hasReHook && activeTime >= hookDur && activeTime < preStoryDur && mediaTime >= rehookOffset + rehookDur - 0.022) {
        return { kind: 'transition', nextTimelineTime: isLoop ? hookDur : preStoryDur, targetMediaTime: isLoop ? rehookOffset : storyOffset };
    }
    if (!hasReHook && (hookOffset > 0 || storyOffset > 0) && activeTime < hookDur && mediaTime >= hookOffset + hookDur - 0.022) {
        return { kind: 'transition', nextTimelineTime: isLoop ? 0 : hookDur, targetMediaTime: isLoop ? hookOffset : storyOffset };
    }
    if (storyOffset > 0 && activeTime >= preStoryDur && mediaTime < storyOffset - 0.15) {
        return { kind: 'realign', targetMediaTime: storyOffset };
    }
    return null;
};

/** `canplay` priming ceiling: 350ms desktop HTTP 206 vs 2500ms mobile/`blob:` long-GOP decoders. */
export const getCanPlayTimeoutMs = (isMobileOrBlob: boolean): number => (isMobileOrBlob ? 2500 : 350);

/** Active-drag mobile/`blob:` scrub throttle interval (ms) to avoid backlogging long-GOP hardware decoders. */
export const MOBILE_SCRUB_THROTTLE_MS = 100;

/** Snaps active drag targets onto the nearest parsed IDR keyframe (`stss`) when long-GOP keyframe scrubbing is enabled. */
export const resolveScrubSeekTarget = (
    targetSec: number,
    keyframeTimes: readonly number[] | undefined,
    useKeyframeSnap: boolean
): number => {
    const safe = Math.max(0, Number.isFinite(targetSec) ? targetSec : 0);
    return useKeyframeSnap ? (findNearestKeyframe(keyframeTimes, safe) ?? safe) : safe;
};

const VIDEO_FOLLOW_DEADBAND_SEC = 0.05;
const VIDEO_FOLLOW_HARD_SNAP_SEC = 0.5;
export const AUDIO_MASTER_GRACE_MS = 350;
export const VIDEO_FOLLOW_RATE_INTERVAL_MS = 180;
export const VIDEO_FOLLOW_SNAP_COOLDOWN_MS = 1500;

interface VideoFollowAdjustment {
    mode: 'hold' | 'pull' | 'snap-audio';
    videoPlaybackRate: number;
    targetAudioTime?: number;
    driftSec: number;
}

/** Computes muted `<video>` tracking against `<audio>`: hold `<= 50ms`, rate-pull `50–500ms`, relock `> 500ms`. */
export const computeVideoToAudioClockAdjustment = (
    videoFrameTimeSec: number,
    audioMasterTimeSec: number
): VideoFollowAdjustment => {
    if (!Number.isFinite(videoFrameTimeSec) || !Number.isFinite(audioMasterTimeSec)) {
        return { mode: 'hold', videoPlaybackRate: 1, driftSec: 0 };
    }
    const videoDriftSec = videoFrameTimeSec - audioMasterTimeSec;
    const absDrift = Math.abs(videoDriftSec);
    if (absDrift <= VIDEO_FOLLOW_DEADBAND_SEC) return { mode: 'hold', videoPlaybackRate: 1, driftSec: videoDriftSec };
    if (absDrift <= VIDEO_FOLLOW_HARD_SNAP_SEC) {
        return { mode: 'pull', videoPlaybackRate: Math.round(clamp(1 - videoDriftSec * 0.85, 0.8, 1.25) * 1000) / 1000, driftSec: videoDriftSec };
    }
    return { mode: 'snap-audio', videoPlaybackRate: 1, targetAudioTime: Math.max(0, videoFrameTimeSec), driftSec: videoDriftSec };
};

export interface AvSyncDiagSnapshot {
    profile: PlaybackSyncProfile;
    companionAudioActive: boolean;
    companionAudioFallback: boolean;
    lastAudioDriftMs: number;
    lastSeekTargetSec: number;
    lastSeekDurationMs: number;
    readyStateAtPlay: number;
    audioReadyStateAtPlay: number;
    videoBufferingPauses: number;
    audioSnaps: number;
    lastError: string | null;
}

export const createInitialAvSyncDiag = (): AvSyncDiagSnapshot => ({
    profile: 'standard',
    companionAudioActive: false,
    companionAudioFallback: false,
    lastAudioDriftMs: 0,
    lastSeekTargetSec: 0,
    lastSeekDurationMs: 0,
    readyStateAtPlay: 0,
    audioReadyStateAtPlay: 0,
    videoBufferingPauses: 0,
    audioSnaps: 0,
    lastError: null,
});
