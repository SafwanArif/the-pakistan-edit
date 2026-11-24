import { VideoDraft, getTimelineStructure } from "../../../types/news";

/** Returns true when a timeline has non-contiguous clip offsets (Hook/Re-Hook/Story jumps) that benefit from a pre-parked standby deck. */
export const hasNonContiguousVideoCuts = (draft: VideoDraft): boolean => {
    const { hasReHook, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    return hasReHook || hookOffset > 0 || rehookOffset > 0 || storyOffset > 0;
};

/**
 * Enables the pre-parked standby deck on desktop for 0ms cuts while keeping mobile/touch devices
 * on a single warm `<video>` decoder so the mobile OS audio sink never suffers cold-unmute swap delay.
 */
export const shouldUseStandbyDeck = (draft: VideoDraft, isCompactOrTouch: boolean): boolean =>
    !isCompactOrTouch && hasNonContiguousVideoCuts(draft);

/** Safely clamps/wraps a source-media seek timestamp inside `[0, duration - 0.01]`. */
export const clampMediaTarget = (targetMediaTime: number, duration: number): number => {
    const vDur = Number.isFinite(duration) && duration > 0.05 ? duration : 10;
    return targetMediaTime >= vDur ? Math.max(0, vDur - 0.01) : Math.max(0, targetMediaTime % vDur);
};

/** Computes the next cut's source-media timestamp so the standby deck can pre-decode frame 0 ahead of time. */
export const getNextCutMediaTarget = (
    draft: VideoDraft,
    activeTime: number,
    isLoopAngle: boolean
): number => {
    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (activeTime < hookDur) {
        return isLoopAngle ? hookOffset : (hasReHook ? rehookOffset : storyOffset);
    }
    if (hasReHook && activeTime < preStoryDur) {
        return isLoopAngle ? rehookOffset : storyOffset;
    }
    return hookOffset;
};

/** Pre-parks a paused, muted standby `<video>` at `targetMediaTime` so the upcoming cut swaps with 0ms seek latency. */
export const preParkStandbyDeck = (standby: HTMLVideoElement | null, targetMediaTime: number): void => {
    if (!standby || standby.readyState < 1) return;
    const clamped = clampMediaTarget(targetMediaTime, standby.duration);
    standby.muted = true;
    if (!standby.paused) standby.pause();
    if (!standby.seeking && Math.abs(standby.currentTime - clamped) > 0.04) {
        standby.currentTime = clamped;
    }
};

/** Returns true if the standby deck has already decoded `targetMediaTime` and can swap in 0ms. */
export const isStandbyReadyAt = (standby: HTMLVideoElement | null, targetMediaTime: number): boolean => {
    if (!standby || standby.readyState < 2 || standby.seeking) return false;
    const clamped = clampMediaTarget(targetMediaTime, standby.duration);
    return Math.abs(standby.currentTime - clamped) <= 0.14;
};
