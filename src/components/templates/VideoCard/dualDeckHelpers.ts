import { VideoDraft, getTimelineStructure } from "../../../types/news";

/** Returns true when a timeline has non-contiguous clip offsets (Hook/Re-Hook/Story jumps) that benefit from a pre-parked standby deck. */
export const hasNonContiguousVideoCuts = (draft: VideoDraft): boolean => {
    const { hasReHook, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    return hasReHook || hookOffset > 0 || rehookOffset > 0 || storyOffset > 0;
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
    const vDur = Number.isFinite(standby.duration) && standby.duration > 0.05 ? standby.duration : 10;
    const clamped = targetMediaTime >= vDur ? Math.max(0, vDur - 0.01) : Math.max(0, targetMediaTime % vDur);
    standby.muted = true;
    if (!standby.paused) standby.pause();
    if (!standby.seeking && Math.abs(standby.currentTime - clamped) > 0.04) {
        standby.currentTime = clamped;
    }
};

/** Returns true if the standby deck has already decoded `targetMediaTime` and can swap in 0ms. */
export const isStandbyReadyAt = (standby: HTMLVideoElement | null, targetMediaTime: number): boolean => {
    if (!standby || standby.readyState < 2 || standby.seeking) return false;
    const vDur = Number.isFinite(standby.duration) && standby.duration > 0.05 ? standby.duration : 10;
    const clamped = targetMediaTime >= vDur ? Math.max(0, vDur - 0.01) : Math.max(0, targetMediaTime % vDur);
    return Math.abs(standby.currentTime - clamped) <= 0.14;
};
