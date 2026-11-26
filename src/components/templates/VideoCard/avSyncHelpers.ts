/**
 * Pure playback/seek synchronization decision helpers for `useVideoElementSync`.
 * Keeps the single-coordinator state machine, real keyframe scrubbing, and audio-master
 * video-follower lock math directly unit-testable.
 */
import type { PlaybackSyncProfile } from "@/types/news";
import { clamp } from "@/types/news";
import { findNearestKeyframe } from "@/app/admin/utils/clientMediaInspector";

type PlaybackSyncAction =
    | 'outro'
    | 'scrub'
    | 'pause-seek'
    | 'start-play'
    | 'explicit-play-seek'
    | 'noop';

interface PlaybackSyncTransitionInput {
    isOutro: boolean;
    isScrubbing: boolean;
    isPlaying: boolean;
    wasPlaying: boolean;
    wasScrubbing: boolean;
    isExplicitSeek: boolean;
}

/**
 * Classifies each React commit into strictly ONE `<video>` sync action so scrub releases
 * never issue competing duplicate seeks and discrete-gated Story playback never snaps backward
 * to a frozen `currentTime` prop.
 */
export const resolvePlaybackSyncAction = ({
    isOutro,
    isScrubbing,
    isPlaying,
    wasPlaying,
    wasScrubbing,
    isExplicitSeek,
}: PlaybackSyncTransitionInput): PlaybackSyncAction => {
    if (isOutro) return 'outro';
    if (isScrubbing) return 'scrub';
    if (!isPlaying) return 'pause-seek';
    if (!wasPlaying || wasScrubbing) return 'start-play';
    if (isExplicitSeek) return 'explicit-play-seek';
    return 'noop';
};

/**
 * Returns the `canplay` priming ceiling before playback starts:
 * - Desktop HTTP 206 streams settle rapidly (`350ms`).
 * - Mobile / `blob:` streams (e.g. 4K AV1 5s-GOP) receive up to `2500ms` so the decoder
 *   finishes buffering future frames (`readyState >= 3`) before the audio clock begins.
 */
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
    if (!useKeyframeSnap) return safe;
    return findNearestKeyframe(keyframeTimes, safe) ?? safe;
};

const VIDEO_FOLLOW_DEADBAND_SEC = 0.12;
const VIDEO_FOLLOW_HARD_SNAP_SEC = 0.75;
export const AUDIO_MASTER_GRACE_MS = 600;
export const VIDEO_FOLLOW_RATE_INTERVAL_MS = 250;
export const VIDEO_FOLLOW_SNAP_COOLDOWN_MS = 3000;

interface VideoFollowAdjustment {
    mode: 'hold' | 'pull' | 'snap-video';
    videoPlaybackRate: number;
    targetVideoTime?: number;
    driftSec: number;
}

/**
 * Computes how the muted `<video>` element gently tracks the uninterrupted companion `<audio>` master clock:
 * - `<= 120ms` drift: hold pure `1.0x` video rate.
 * - `120ms–750ms` drift: adjust ONLY `video.playbackRate` (`0.92x–1.08x`) — audio is never slowed, pitched, or cut.
 * - `> 750ms` drift: snap ONLY `video.currentTime` cleanly to `audioMasterTimeSec` (audio plays continuously).
 */
export const computeVideoToAudioClockAdjustment = (
    videoFrameTimeSec: number,
    audioMasterTimeSec: number
): VideoFollowAdjustment => {
    const videoDriftSec = videoFrameTimeSec - audioMasterTimeSec;
    const absDrift = Math.abs(videoDriftSec);
    if (absDrift <= VIDEO_FOLLOW_DEADBAND_SEC) {
        return { mode: 'hold', videoPlaybackRate: 1, driftSec: videoDriftSec };
    }
    if (absDrift <= VIDEO_FOLLOW_HARD_SNAP_SEC) {
        return {
            mode: 'pull',
            videoPlaybackRate: Math.round(clamp(1 - videoDriftSec * 0.35, 0.92, 1.08) * 1000) / 1000,
            driftSec: videoDriftSec,
        };
    }
    return {
        mode: 'snap-video',
        videoPlaybackRate: 1,
        targetVideoTime: Math.max(0, audioMasterTimeSec),
        driftSec: videoDriftSec,
    };
};

export interface AvSyncDiagSnapshot {
    profile: PlaybackSyncProfile;
    companionAudioActive: boolean;
    companionAudioFallback: boolean;
    lastAudioDriftMs: number;
    lastSeekTargetSec: number;
    lastSeekDurationMs: number;
    readyStateAtPlay: number;
}

export const createInitialAvSyncDiag = (): AvSyncDiagSnapshot => ({
    profile: 'standard',
    companionAudioActive: false,
    companionAudioFallback: false,
    lastAudioDriftMs: 0,
    lastSeekTargetSec: 0,
    lastSeekDurationMs: 0,
    readyStateAtPlay: 0,
});
