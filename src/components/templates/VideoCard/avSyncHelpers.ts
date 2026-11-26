/**
 * Pure playback/seek synchronization decision helpers for `useVideoElementSync`.
 * Keeps the single-coordinator state machine, real keyframe scrubbing, and audio-master
 * video-follower lock math directly unit-testable.
 */
import type { PlaybackSyncProfile } from "@/types/news";
import { clamp } from "@/types/news";
import { findNearestKeyframe } from "@/app/admin/utils/clientMediaInspector";

/** Explicit single-source playback engine state shared across `useVideoElementSync`, `useCompanionAudioLock`, and `useSmoothFramingLoop`. */
export type PlaybackEngineState = 'idle' | 'seeking' | 'priming' | 'playing' | 'buffering';

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

/**
 * Computes how muted `<video>` tracks `<audio>` during decoupled playback:
 * - `<= 50ms` drift: hold pure `1.0x` video rate.
 * - `50ms–500ms` drift: adjust ONLY muted `video.playbackRate` (`0.80x–1.25x`) — audio plays untouched with zero pitch shift.
 * - `> 500ms` persistent drift: re-lock fast `<audio>` (`<15ms` AAC seek) to the painted `videoFrameTimeSec`
 *   instead of seeking slow 4K `<video>` while `<audio>` keeps advancing.
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
            videoPlaybackRate: Math.round(clamp(1 - videoDriftSec * 0.85, 0.8, 1.25) * 1000) / 1000,
            driftSec: videoDriftSec,
        };
    }
    return {
        mode: 'snap-audio',
        videoPlaybackRate: 1,
        targetAudioTime: Math.max(0, videoFrameTimeSec),
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
