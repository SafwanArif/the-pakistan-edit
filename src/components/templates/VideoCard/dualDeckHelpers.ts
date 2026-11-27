import { VideoDraft, getTimelineStructure } from "@/types/news";
import { safeSetMediaTime } from "./mediaAsyncHelpers";

/**
 * Enables the pre-parked standby deck on desktop for non-contiguous Hook/Re-Hook/Story cuts while keeping
 * mobile/touch devices on a single warm `<video>` decoder so the mobile OS audio sink avoids cold-unmute swap delay.
 */
export const shouldUseStandbyDeck = (draft: VideoDraft, isCompactOrTouch: boolean): boolean => {
    if (isCompactOrTouch) return false;
    const { hasReHook, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    return hasReHook || hookOffset > 0 || rehookOffset > 0 || storyOffset > 0;
};

/** Safely clamps/wraps a source-media seek timestamp inside `[0, duration - 0.01]`. */
export const clampMediaTarget = (targetMediaTime: number, duration: number): number => {
    if (!Number.isFinite(targetMediaTime) || targetMediaTime <= 0) return 0;
    const vDur = Number.isFinite(duration) && duration > 0.05 ? duration : 10;
    return targetMediaTime >= vDur ? Math.max(0, vDur - 0.01) : Math.max(0, targetMediaTime % vDur);
};

/** Computes the next cut's source-media timestamp so the standby deck can pre-decode frame 0 ahead of time. */
export const getNextCutMediaTarget = (
    draft: VideoDraft,
    activeTime: number,
    isLoopAngle: boolean
): number => {
    const safeActiveTime = Number.isFinite(activeTime) ? Math.max(0, activeTime) : 0;
    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (safeActiveTime < hookDur) return isLoopAngle ? hookOffset : (hasReHook ? rehookOffset : storyOffset);
    if (hasReHook && safeActiveTime < preStoryDur) return isLoopAngle ? rehookOffset : storyOffset;
    return hookOffset;
};

/** Pre-parks a paused, muted standby `<video>` at `targetMediaTime` so the upcoming cut swaps with 0ms seek latency. */
export const preParkStandbyDeck = (standby: HTMLVideoElement | null, targetMediaTime: number): void => {
    if (!standby || standby.readyState < 1) return;
    const clamped = clampMediaTarget(targetMediaTime, standby.duration);
    standby.muted = true;
    if (!standby.paused) standby.pause();
    if (!standby.seeking && Math.abs(standby.currentTime - clamped) > 0.04) {
        safeSetMediaTime(standby, clamped);
    }
};

/** Returns true if the standby deck has already decoded `targetMediaTime` and can swap in 0ms. */
export const isStandbyReadyAt = (standby: HTMLVideoElement | null, targetMediaTime: number): boolean => {
    if (!standby || standby.readyState < 2 || standby.seeking) return false;
    const clamped = clampMediaTarget(targetMediaTime, standby.duration);
    return Math.abs(standby.currentTime - clamped) <= 0.14;
};
