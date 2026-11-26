import type { SourceFrameIndex, VideoDraft, VideoKeyframe } from "../types/news";
import { clamp, getTimelineStructure } from "./sceneTimeline";

/** Parses `HH:MM:SS(.frac)`, `MM:SS(.frac)`, or raw seconds into a non-negative number of seconds. */
export const parseTimeInput = (raw: string): number | null => {
    const clean = raw.trim();
    if (!clean) return null;
    if (clean.includes(':')) {
        const parts = clean.split(':');
        if (parts.length !== 2 && parts.length !== 3) return null;
        if (parts.some((p) => p.trim() === '')) return null;
        const nums = parts.map((p) => Number(p.trim()));
        if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
        return nums.length === 3
            ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]!
            : nums[0]! * 60 + nums[1]!;
    }
    const val = Number(clean);
    return Number.isFinite(val) && val >= 0 ? val : null;
};

interface ResolvedFraming {
    zoom: number;
    posX: number;
    posY: number;
}

type KeyframeSpan =
    | { kind: 'constant'; framing: ResolvedFraming }
    | { kind: 'glide'; gStart: number; gEnd: number; start: ResolvedFraming; end: ResolvedFraming };

interface MutableKeyframeSpan {
    kind: 'constant' | 'glide';
    gStart: number;
    gEnd: number;
    startZoom: number;
    startPosX: number;
    startPosY: number;
    endZoom: number;
    endPosX: number;
    endPosY: number;
}

const SCRATCH_SPAN: MutableKeyframeSpan = {
    kind: 'constant',
    gStart: 0,
    gEnd: 0,
    startZoom: 100,
    startPosX: 50,
    startPosY: 100,
    endZoom: 100,
    endPosX: 50,
    endPosY: 100,
};

const writeConstantSpan = (out: MutableKeyframeSpan, zoom: number, posX: number, posY: number): void => {
    out.kind = 'constant';
    out.startZoom = zoom;
    out.startPosX = posX;
    out.startPosY = posY;
};

/**
 * Single-source zero-allocation interval resolver shared by 120Hz `interpolateKeyframeInto`,
 * `interpolateKeyframe`, and server-side FFmpeg curve generation (`resolveKeyframeSpan`).
 * Holds the letterbox endpoint's `posY` across `FILL (>=100%) <-> CONTAIN (<100%)` glides.
 */
const resolveKeyframeSpanInto = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fbZoom: number,
    fbX: number,
    fbY: number,
    out: MutableKeyframeSpan
): void => {
    const safeTime = Number.isFinite(currentTime) ? currentTime : 0;

    if (!keyframes || keyframes.length === 0) {
        writeConstantSpan(out, fbZoom, fbX, fbY);
        return;
    }

    let alreadySorted = true;
    for (let i = 1; i < keyframes.length; i++) {
        if (keyframes[i]!.time < keyframes[i - 1]!.time) {
            alreadySorted = false;
            break;
        }
    }
    const sorted = alreadySorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time);

    const last = sorted[sorted.length - 1]!;
    if (safeTime >= last.time) {
        writeConstantSpan(out, last.zoom, last.posX, last.posY ?? fbY);
        return;
    }

    let prevTime = 0;
    let prevZoom = fbZoom;
    let prevPosX = fbX;
    let prevPosY = fbY;
    let next = sorted[0]!;
    if (safeTime < next.time) {
        if (next.easing === 'snap' && next.pre) {
            writeConstantSpan(out, next.pre.zoom, next.pre.posX, next.pre.posY ?? fbY);
            return;
        }
        if (next.time <= 0) {
            writeConstantSpan(out, next.zoom, next.posX, next.posY ?? fbY);
            return;
        }
    } else if (sorted.length > 6) {
        let lo = 0;
        let hi = sorted.length - 2;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (sorted[mid]!.time <= safeTime) lo = mid;
            else hi = mid - 1;
        }
        const p = sorted[lo]!;
        prevTime = p.time;
        prevZoom = p.zoom;
        prevPosX = p.posX;
        prevPosY = p.posY ?? fbY;
        next = sorted[lo + 1]!;
    } else {
        for (let i = 0; i < sorted.length - 1; i++) {
            if (safeTime >= sorted[i]!.time && safeTime < sorted[i + 1]!.time) {
                const p = sorted[i]!;
                prevTime = p.time;
                prevZoom = p.zoom;
                prevPosX = p.posX;
                prevPosY = p.posY ?? fbY;
                next = sorted[i + 1]!;
                break;
            }
        }
    }

    if (next.time <= prevTime || (next.easing === 'snap' && !next.pre)) {
        writeConstantSpan(out, prevZoom, prevPosX, prevPosY);
        return;
    }
    if (safeTime >= next.time) {
        writeConstantSpan(out, next.zoom, next.posX, next.posY ?? fbY);
        return;
    }

    let gEnd = next.time;
    let targetZoom = next.zoom;
    let targetPosX = next.posX;
    let targetPosY = next.posY ?? fbY;
    const preTarget = next.easing === 'snap' ? next.pre : undefined;
    if (preTarget) {
        const preTime = preTarget.time !== undefined
            ? Math.min(next.time, Math.max(prevTime, preTarget.time))
            : next.time;
        const preY = preTarget.posY ?? fbY;
        if (safeTime >= preTime) {
            writeConstantSpan(out, preTarget.zoom, preTarget.posX, preY);
            return;
        }
        gEnd = preTime;
        targetZoom = preTarget.zoom;
        targetPosX = preTarget.posX;
        targetPosY = preY;
    }

    if (gEnd <= prevTime) {
        writeConstantSpan(out, targetZoom, targetPosX, targetPosY);
        return;
    }

    out.kind = 'glide';
    out.gStart = prevTime;
    out.gEnd = gEnd;
    out.startZoom = prevZoom;
    out.startPosX = prevPosX;
    out.startPosY = prevZoom >= 100 && targetZoom < 100 ? targetPosY : prevPosY;
    out.endZoom = targetZoom;
    out.endPosX = targetPosX;
    out.endPosY = prevZoom < 100 && targetZoom >= 100 ? prevPosY : targetPosY;
};

/**
 * Canonical keyframe interval resolver for FFmpeg curve generation (`ffmpegFilters.ts`) and tests.
 */
export const resolveKeyframeSpan = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): KeyframeSpan => {
    resolveKeyframeSpanInto(
        keyframes,
        currentTime,
        fallback?.zoom ?? 100,
        fallback?.posX ?? 50,
        fallback?.posY ?? 100,
        SCRATCH_SPAN
    );
    if (SCRATCH_SPAN.kind === 'constant') {
        return {
            kind: 'constant',
            framing: { zoom: SCRATCH_SPAN.startZoom, posX: SCRATCH_SPAN.startPosX, posY: SCRATCH_SPAN.startPosY },
        };
    }
    return {
        kind: 'glide',
        gStart: SCRATCH_SPAN.gStart,
        gEnd: SCRATCH_SPAN.gEnd,
        start: { zoom: SCRATCH_SPAN.startZoom, posX: SCRATCH_SPAN.startPosX, posY: SCRATCH_SPAN.startPosY },
        end: { zoom: SCRATCH_SPAN.endZoom, posX: SCRATCH_SPAN.endPosX, posY: SCRATCH_SPAN.endPosY },
    };
};

/**
 * Zero-allocation 120Hz keyframe interpolator writing directly into `out`.
 * Keeps exact cosine parity with `resolveKeyframeSpan` & `interpolateKeyframe` while avoiding ~360 heap allocations/sec.
 */
export const interpolateKeyframeInto = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback: ResolvedFraming,
    out: ResolvedFraming
): ResolvedFraming => {
    const safeTime = Number.isFinite(currentTime) ? currentTime : 0;
    resolveKeyframeSpanInto(keyframes, safeTime, fallback.zoom, fallback.posX, fallback.posY, SCRATCH_SPAN);
    if (SCRATCH_SPAN.kind === 'constant') {
        out.zoom = SCRATCH_SPAN.startZoom;
        out.posX = SCRATCH_SPAN.startPosX;
        out.posY = SCRATCH_SPAN.startPosY;
        return out;
    }
    const t = clamp((safeTime - SCRATCH_SPAN.gStart) / (SCRATCH_SPAN.gEnd - SCRATCH_SPAN.gStart), 0, 1);
    const smoothT = (1 - Math.cos(t * Math.PI)) / 2;
    out.zoom = SCRATCH_SPAN.startZoom + (SCRATCH_SPAN.endZoom - SCRATCH_SPAN.startZoom) * smoothT;
    out.posX = SCRATCH_SPAN.startPosX + (SCRATCH_SPAN.endPosX - SCRATCH_SPAN.startPosX) * smoothT;
    out.posY = SCRATCH_SPAN.startPosY + (SCRATCH_SPAN.endPosY - SCRATCH_SPAN.startPosY) * smoothT;
    return out;
};

/**
 * Smoothly interpolates Zoom, Pan X, and Pos Y across time-based keyframes.
 * Uses smooth cosine easing for organic camera gliding without abrupt cuts.
 */
export const interpolateKeyframe = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): ResolvedFraming =>
    interpolateKeyframeInto(
        keyframes,
        currentTime,
        { zoom: fallback?.zoom ?? 100, posX: fallback?.posX ?? 50, posY: fallback?.posY ?? 100 },
        { zoom: 100, posX: 50, posY: 100 }
    );

/** Formats seconds as compact `MM:SS.d` for studio transport, scrubbers, and pills. */
export const formatTimecode = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0";
    const tenths = Math.round(seconds * 10);
    const m = Math.floor(tenths / 600);
    const s = Math.floor((tenths % 600) / 10);
    const dec = tenths % 10;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${dec}`;
};

/** Formats seconds as high-precision `MM:SS.ssss` for frame-level keyframe editing. */
export const formatPreciseTimecode = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00.0000";
    const tenThousandths = Math.round(seconds * 10000);
    const m = Math.floor(tenThousandths / 600000);
    const s = Math.floor((tenThousandths % 600000) / 10000);
    const decimals = tenThousandths % 10000;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${decimals.toString().padStart(4, '0')}`;
};

/** Snaps a timestamp to the nearest source PTS (for VFR clips) or uniform frame grid (for CFR clips). */
export const snapTimeToSourceFrame = (
    time: number,
    fps: number,
    sourceFrameIndex?: SourceFrameIndex
): number => {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
    if (sourceFrameIndex && !sourceFrameIndex.cfr && sourceFrameIndex.pts.length > 0) {
        let lo = 0;
        let hi = sourceFrameIndex.pts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sourceFrameIndex.pts[mid]! < safeTime) lo = mid + 1;
            else hi = mid;
        }
        const curr = sourceFrameIndex.pts[lo]!;
        const prev = lo > 0 ? sourceFrameIndex.pts[lo - 1]! : curr;
        return Math.max(0, Math.abs(prev - safeTime) <= Math.abs(curr - safeTime) ? prev : curr);
    }
    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
    return Math.max(0, Math.round(safeTime * safeFps) / safeFps);
};

/** Moves from an exact manual time to the adjacent source frame in the requested direction. */
export const nudgeTimeToFrame = (
    time: number,
    deltaFrames: number,
    fps: number,
    sourceFrameIndex?: SourceFrameIndex
): number => {
    const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
    const safeDelta = Number.isFinite(deltaFrames) ? Math.trunc(deltaFrames) : 0;
    if (safeDelta === 0) return snapTimeToSourceFrame(safeTime, fps, sourceFrameIndex);

    if (sourceFrameIndex && !sourceFrameIndex.cfr && sourceFrameIndex.pts.length > 0) {
        const pts = sourceFrameIndex.pts;
        const eps = 1e-6;
        if (safeDelta > 0) {
            // Find largest index with pts[idx] <= safeTime + eps (or -1 if before first frame)
            let lo = 0;
            let hi = pts.length - 1;
            let anchor = -1;
            while (lo <= hi) {
                const mid = (lo + hi) >> 1;
                if (pts[mid]! <= safeTime + eps) {
                    anchor = mid;
                    lo = mid + 1;
                } else {
                    hi = mid - 1;
                }
            }
            const nextIndex = clamp(anchor + safeDelta, 0, pts.length - 1);
            return Math.max(0, pts[nextIndex]!);
        }
        // safeDelta < 0: find smallest index with pts[idx] >= safeTime - eps (or pts.length if past last frame)
        let lo = 0;
        let hi = pts.length - 1;
        let anchor = pts.length;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (pts[mid]! >= safeTime - eps) {
                anchor = mid;
                hi = mid - 1;
            } else {
                lo = mid + 1;
            }
        }
        const nextIndex = clamp(anchor + safeDelta, 0, pts.length - 1);
        return Math.max(0, pts[nextIndex]!);
    }

    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
    const scaled = safeTime * safeFps;
    const epsilon = 1e-7;
    const frameIndex = safeDelta > 0
        ? Math.floor(scaled + epsilon) + safeDelta
        : Math.ceil(scaled - epsilon) + safeDelta;
    return Math.max(0, frameIndex / safeFps);
};

/**
 * Maps timeline timecode (seconds) to the underlying video clip timestamp,
 * accounting for cold-open teaser hook in-points before resetting Scene 02 to 00:00.0.
 */
export const timelineTimeToMediaTime = (draft: VideoDraft, timelineTime: number): number => {
    const scenes = draft.scenes && draft.scenes.length > 0 ? draft.scenes : [];
    if (scenes.length === 0) return timelineTime;

    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;

    if (hasCustomJump) {
        if (timelineTime < hookDur) return hookOffset + timelineTime;
        if (hasReHook && timelineTime < preStoryDur) return rehookOffset + (timelineTime - hookDur);
        return storyOffset + (timelineTime - preStoryDur);
    }

    return timelineTime;
};

/** Wraps timeline-mapped media time within [storyOffset, clipDuration] for Story+ so pre-Story footage never replays. */
export const wrapMediaTime = (draft: VideoDraft, timelineTime: number, clipDuration: number): number => {
    const raw = timelineTimeToMediaTime(draft, timelineTime);
    if (!clipDuration || clipDuration <= 0) return raw;
    const { preStoryDur, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (timelineTime >= preStoryDur && storyOffset > 0 && storyOffset < clipDuration - 0.5) {
        const span = Math.max(0.5, clipDuration - storyOffset);
        return storyOffset + (Math.max(0, raw - storyOffset) % span);
    }
    return raw % clipDuration;
};

/**
 * Maps a native video media timestamp back to timeline currentTime,
 * tracking loop iterations when the source clip is shorter than the timeline.
 */
export const mediaTimeToTimelineTime = (
    draft: VideoDraft,
    mediaTime: number,
    currentTimelineTime: number,
    actualClipDuration?: number
): number => {
    const scenes = draft.scenes && draft.scenes.length > 0 ? draft.scenes : [];
    if (scenes.length === 0) return mediaTime;

    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;

    if (hasCustomJump && currentTimelineTime < hookDur) {
        if (Math.abs(currentTimelineTime - hookDur) < 0.25) {
            const nextOffset = hasReHook ? rehookOffset : storyOffset;
            if (Math.abs(mediaTime - nextOffset) < 0.35 && Math.abs(mediaTime - (hookOffset + hookDur)) > 0.4) {
                return hookDur + Math.max(0, mediaTime - nextOffset);
            }
        }
        return clamp(mediaTime - hookOffset, 0, hookDur);
    }
    if (hasReHook && currentTimelineTime >= hookDur && currentTimelineTime < preStoryDur) {
        if (Math.abs(currentTimelineTime - hookDur) < 0.25 && Math.abs(mediaTime - (hookOffset + hookDur)) < 0.35 && Math.abs(mediaTime - rehookOffset) > 0.4) {
            return hookDur;
        }
        if (Math.abs(currentTimelineTime - preStoryDur) < 0.25 && Math.abs(mediaTime - storyOffset) < 0.35 && Math.abs(mediaTime - (rehookOffset + (preStoryDur - hookDur))) > 0.4) {
            return preStoryDur + Math.max(0, mediaTime - storyOffset);
        }
        return clamp(hookDur + Math.max(0, mediaTime - rehookOffset), hookDur, preStoryDur);
    }

    if (hasCustomJump && Math.abs(currentTimelineTime - preStoryDur) < 0.25) {
        const prevEndMedia = hasReHook ? (rehookOffset + (preStoryDur - hookDur)) : (hookOffset + hookDur);
        if (Math.abs(mediaTime - prevEndMedia) < 0.5 && Math.abs(mediaTime - storyOffset) > 0.5) {
            return preStoryDur;
        }
    }

    const baseOffset = hasCustomJump ? preStoryDur : 0;
    const relMedia = hasCustomJump && storyOffset > 0 ? Math.max(0, mediaTime - storyOffset) : mediaTime;
    const prevNarrativeTime = Math.max(0, currentTimelineTime - baseOffset);
    const liveDur = actualClipDuration && Number.isFinite(actualClipDuration) && actualClipDuration > 1 ? actualClipDuration : 0;
    const draftDur = draft.videoDuration && Number.isFinite(draft.videoDuration) && draft.videoDuration > 1 ? draft.videoDuration : 0;
    const rawClipDur = liveDur || draftDur;
    const clipDur = rawClipDur > 0 ? Math.max(1, rawClipDur - (hasCustomJump ? storyOffset : 0)) : 0;

    if (clipDur > 0) {
        let loopIndex = Math.floor(prevNarrativeTime / clipDur);
        const posInLoop = prevNarrativeTime % clipDur;
        if (posInLoop > clipDur - 0.8 && relMedia < 0.8) {
            loopIndex += 1;
        }
        return baseOffset + loopIndex * clipDur + relMedia;
    }

    return baseOffset + relMedia;
};
