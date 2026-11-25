/**
 * Pure playback/seek synchronization decision helpers for `useVideoElementSync`.
 * Keeps the single-coordinator state machine and post-seek `rVFC` A/V skew guard directly unit-testable.
 */

export type PlaybackSyncAction =
    | 'outro'
    | 'scrub'
    | 'pause-seek'
    | 'start-play'
    | 'explicit-play-seek'
    | 'noop';

export interface PlaybackSyncTransitionInput {
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

/**
 * Uses `video.fastSeek()` during active scrubbing across all sources (including `blob:` and local streams)
 * so dragging through long-GOP 4K AV1 decodes 1 keyframe per tick instead of up to 125 frames.
 * Exact frame-accurate seeking runs strictly once on scrub release.
 */
export const shouldUseFastSeekDuringScrub = (hasFastSeek: boolean): boolean => hasFastSeek;

export interface PostSeekAuditState {
    startedAtMs: number;
    consecutiveSkewFrames: number;
    maxObservedSkewSec: number;
    recovered: boolean;
}

export interface PostSeekAuditEvaluation {
    active: boolean;
    shouldRecover: boolean;
    skewSec: number;
}

export const POST_SEEK_AUDIT_WINDOW_MS = 2200;
export const POST_SEEK_SKEW_THRESHOLD_SEC = 0.35;
export const POST_SEEK_SKEW_FRAMES_REQUIRED = 3;

export const createPostSeekAudit = (nowMs: number): PostSeekAuditState => ({
    startedAtMs: nowMs,
    consecutiveSkewFrames: 0,
    maxObservedSkewSec: 0,
    recovered: false,
});

/**
 * Evaluates Chromium's audio master clock (`video.currentTime`) against the actual painted
 * video frame PTS (`rVFC` `metadata.mediaTime`) during the post-seek settle window.
 * Triggers at most ONE keyframe-lock recovery per seek if sustained skew exceeds 350ms for 3 frames.
 */
export const evaluatePostSeekAvSkew = (
    audit: PostSeekAuditState,
    nowMs: number,
    audioClockSec: number,
    renderedFrameSec: number
): PostSeekAuditEvaluation => {
    const skewSec = Math.abs(audioClockSec - renderedFrameSec);
    if (skewSec > audit.maxObservedSkewSec) {
        audit.maxObservedSkewSec = skewSec;
    }

    if (nowMs - audit.startedAtMs > POST_SEEK_AUDIT_WINDOW_MS) {
        return { active: false, shouldRecover: false, skewSec };
    }

    if (skewSec > POST_SEEK_SKEW_THRESHOLD_SEC) {
        audit.consecutiveSkewFrames += 1;
    } else {
        audit.consecutiveSkewFrames = 0;
    }

    if (!audit.recovered && audit.consecutiveSkewFrames >= POST_SEEK_SKEW_FRAMES_REQUIRED) {
        audit.recovered = true;
        return { active: false, shouldRecover: true, skewSec };
    }

    return { active: true, shouldRecover: false, skewSec };
};

export interface AvSyncDiagSnapshot {
    lastSeekTargetSec: number;
    lastSeekDurationMs: number;
    readyStateAtPlay: number;
    maxPostSeekSkewSec: number;
    recoveryCount: number;
    lastRecoveryAtMs: number | null;
}

export const createInitialAvSyncDiag = (): AvSyncDiagSnapshot => ({
    lastSeekTargetSec: 0,
    lastSeekDurationMs: 0,
    readyStateAtPlay: 0,
    maxPostSeekSkewSec: 0,
    recoveryCount: 0,
    lastRecoveryAtMs: null,
});
