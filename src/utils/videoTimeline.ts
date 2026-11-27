import type { SourceFrameIndex, VideoDraft, VideoKeyframe } from "../types/news";
import { clamp, finiteOr, getTimelineStructure } from "./sceneTimeline";

/** Parses `HH:MM:SS(.frac)`, `MM:SS(.frac)`, or raw seconds into a non-negative number of seconds. */
export const parseTimeInput = (raw: string): number | null => {
    const clean = raw.trim();
    if (!clean) return null;
    if (clean.includes(":")) {
        const parts = clean.split(":");
        if ((parts.length !== 2 && parts.length !== 3) || parts.some((p) => p.trim() === "")) return null;
        const nums = parts.map((p) => Number(p.trim()));
        if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
        return nums.length === 3 ? nums[0]! * 3600 + nums[1]! * 60 + nums[2]! : nums[0]! * 60 + nums[1]!;
    }
    const val = Number(clean);
    return Number.isFinite(val) && val >= 0 ? val : null;
};

interface ResolvedFraming { zoom: number; posX: number; posY: number; }

type KeyframeSpan =
    | { kind: "constant"; framing: ResolvedFraming }
    | { kind: "glide"; gStart: number; gEnd: number; start: ResolvedFraming; end: ResolvedFraming };

interface MutableKeyframeSpan {
    kind: "constant" | "glide";
    gStart: number; gEnd: number;
    startZoom: number; startPosX: number; startPosY: number;
    endZoom: number; endPosX: number; endPosY: number;
}

const SCRATCH_SPAN: MutableKeyframeSpan = {
    kind: "constant", gStart: 0, gEnd: 0,
    startZoom: 100, startPosX: 50, startPosY: 100,
    endZoom: 100, endPosX: 50, endPosY: 100,
};

const writeConstantSpan = (out: MutableKeyframeSpan, zoom: number, posX: number, posY: number): void => {
    out.kind = "constant";
    out.startZoom = zoom;
    out.startPosX = posX;
    out.startPosY = posY;
};

/** Single-source zero-allocation interval resolver shared by 120Hz preview and server FFmpeg curves. */
const resolveKeyframeSpanInto = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fbZoom: number, fbX: number, fbY: number,
    out: MutableKeyframeSpan
): void => {
    const safeTime = finiteOr(currentTime, 0);
    if (!keyframes?.length) { writeConstantSpan(out, fbZoom, fbX, fbY); return; }

    let alreadySorted = true;
    let hasNonFinite = false;
    for (let i = 0; i < keyframes.length; i++) {
        const t = keyframes[i]!.time;
        if (!Number.isFinite(t)) { hasNonFinite = true; break; }
        if (i > 0 && t < keyframes[i - 1]!.time) alreadySorted = false;
    }
    const sorted = hasNonFinite
        ? keyframes.filter((k) => Number.isFinite(k.time)).sort((a, b) => a.time - b.time)
        : (alreadySorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time));
    if (!sorted.length) { writeConstantSpan(out, fbZoom, fbX, fbY); return; }

    const last = sorted[sorted.length - 1]!;
    if (safeTime >= last.time) {
        writeConstantSpan(out, finiteOr(last.zoom, fbZoom), finiteOr(last.posX, fbX), finiteOr(last.posY, fbY));
        return;
    }

    let prevTime = 0, prevZoom = fbZoom, prevPosX = fbX, prevPosY = fbY;
    let next = sorted[0]!;
    if (safeTime < next.time) {
        if (next.easing === "snap" && next.pre) {
            writeConstantSpan(out, finiteOr(next.pre.zoom, fbZoom), finiteOr(next.pre.posX, fbX), finiteOr(next.pre.posY, fbY));
            return;
        }
        if (next.time <= 0) {
            writeConstantSpan(out, finiteOr(next.zoom, fbZoom), finiteOr(next.posX, fbX), finiteOr(next.posY, fbY));
            return;
        }
    } else {
        let prevIdx = -1;
        if (sorted.length > 6) {
            let lo = 0, hi = sorted.length - 2;
            while (lo < hi) {
                const mid = (lo + hi + 1) >> 1;
                if (sorted[mid]!.time <= safeTime) lo = mid;
                else hi = mid - 1;
            }
            prevIdx = lo;
        } else {
            for (let i = 0; i < sorted.length - 1; i++) {
                if (safeTime >= sorted[i]!.time && safeTime < sorted[i + 1]!.time) { prevIdx = i; break; }
            }
        }
        if (prevIdx >= 0) {
            const p = sorted[prevIdx]!;
            prevTime = p.time;
            prevZoom = finiteOr(p.zoom, fbZoom);
            prevPosX = finiteOr(p.posX, fbX);
            prevPosY = finiteOr(p.posY, fbY);
            next = sorted[prevIdx + 1]!;
        }
    }

    if (next.time <= prevTime || (next.easing === "snap" && !next.pre)) {
        writeConstantSpan(out, prevZoom, prevPosX, prevPosY);
        return;
    }
    if (safeTime >= next.time) {
        writeConstantSpan(out, finiteOr(next.zoom, fbZoom), finiteOr(next.posX, fbX), finiteOr(next.posY, fbY));
        return;
    }

    let gEnd = next.time;
    let targetZoom = finiteOr(next.zoom, fbZoom), targetPosX = finiteOr(next.posX, fbX), targetPosY = finiteOr(next.posY, fbY);
    const preTarget = next.easing === "snap" ? next.pre : undefined;
    if (preTarget) {
        const preTime = preTarget.time !== undefined && Number.isFinite(preTarget.time)
            ? clamp(preTarget.time, prevTime, next.time)
            : next.time;
        const preZ = finiteOr(preTarget.zoom, fbZoom), preX = finiteOr(preTarget.posX, fbX), preY = finiteOr(preTarget.posY, fbY);
        if (safeTime >= preTime) { writeConstantSpan(out, preZ, preX, preY); return; }
        gEnd = preTime; targetZoom = preZ; targetPosX = preX; targetPosY = preY;
    }

    if (gEnd <= prevTime) { writeConstantSpan(out, targetZoom, targetPosX, targetPosY); return; }

    out.kind = "glide";
    out.gStart = prevTime; out.gEnd = gEnd;
    out.startZoom = prevZoom; out.startPosX = prevPosX;
    out.startPosY = prevZoom >= 100 && targetZoom < 100 ? targetPosY : prevPosY;
    out.endZoom = targetZoom; out.endPosX = targetPosX;
    out.endPosY = prevZoom < 100 && targetZoom >= 100 ? prevPosY : targetPosY;
};

/** Canonical keyframe interval resolver for FFmpeg curve generation (`ffmpegFilters.ts`) and tests. */
export const resolveKeyframeSpan = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): KeyframeSpan => {
    resolveKeyframeSpanInto(keyframes, currentTime, finiteOr(fallback?.zoom, 100), finiteOr(fallback?.posX, 50), finiteOr(fallback?.posY, 100), SCRATCH_SPAN);
    return SCRATCH_SPAN.kind === "constant"
        ? { kind: "constant", framing: { zoom: SCRATCH_SPAN.startZoom, posX: SCRATCH_SPAN.startPosX, posY: SCRATCH_SPAN.startPosY } }
        : {
            kind: "glide", gStart: SCRATCH_SPAN.gStart, gEnd: SCRATCH_SPAN.gEnd,
            start: { zoom: SCRATCH_SPAN.startZoom, posX: SCRATCH_SPAN.startPosX, posY: SCRATCH_SPAN.startPosY },
            end: { zoom: SCRATCH_SPAN.endZoom, posX: SCRATCH_SPAN.endPosX, posY: SCRATCH_SPAN.endPosY },
        };
};

/** Zero-allocation 120Hz keyframe interpolator writing directly into `out`. */
export const interpolateKeyframeInto = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback: ResolvedFraming,
    out: ResolvedFraming
): ResolvedFraming => {
    const safeTime = finiteOr(currentTime, 0);
    resolveKeyframeSpanInto(keyframes, safeTime, finiteOr(fallback.zoom, 100), finiteOr(fallback.posX, 50), finiteOr(fallback.posY, 100), SCRATCH_SPAN);
    if (SCRATCH_SPAN.kind === "constant") {
        out.zoom = SCRATCH_SPAN.startZoom; out.posX = SCRATCH_SPAN.startPosX; out.posY = SCRATCH_SPAN.startPosY;
        return out;
    }
    const t = clamp((safeTime - SCRATCH_SPAN.gStart) / (SCRATCH_SPAN.gEnd - SCRATCH_SPAN.gStart), 0, 1);
    const smoothT = (1 - Math.cos(t * Math.PI)) / 2;
    out.zoom = SCRATCH_SPAN.startZoom + (SCRATCH_SPAN.endZoom - SCRATCH_SPAN.startZoom) * smoothT;
    out.posX = SCRATCH_SPAN.startPosX + (SCRATCH_SPAN.endPosX - SCRATCH_SPAN.startPosX) * smoothT;
    out.posY = SCRATCH_SPAN.startPosY + (SCRATCH_SPAN.endPosY - SCRATCH_SPAN.startPosY) * smoothT;
    return out;
};

/** Smoothly interpolates Zoom, Pan X, and Pos Y across time-based keyframes using cosine easing. */
export const interpolateKeyframe = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): ResolvedFraming =>
    interpolateKeyframeInto(
        keyframes, currentTime,
        { zoom: finiteOr(fallback?.zoom, 100), posX: finiteOr(fallback?.posX, 50), posY: finiteOr(fallback?.posY, 100) },
        { zoom: 100, posX: 50, posY: 100 }
    );

const formatScaledTimecode = (seconds: number, scale: number, fracDigits: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return `00:00.${"0".repeat(fracDigits)}`;
    const units = Math.round(seconds * scale);
    const perMin = 60 * scale;
    return `${String(Math.floor(units / perMin)).padStart(2, "0")}:${String(Math.floor((units % perMin) / scale)).padStart(2, "0")}.${String(units % scale).padStart(fracDigits, "0")}`;
};

/** Formats seconds as compact `MM:SS.d` for studio transport, scrubbers, and pills. */
export const formatTimecode = (seconds: number): string => formatScaledTimecode(seconds, 10, 1);

/** Formats seconds as high-precision `MM:SS.ssss` for frame-level keyframe editing. */
export const formatPreciseTimecode = (seconds: number): string => formatScaledTimecode(seconds, 10_000, 4);

/** Snaps a timestamp to the nearest source PTS (for VFR clips) or uniform frame grid (for CFR clips). */
export const snapTimeToSourceFrame = (time: number, fps: number, sourceFrameIndex?: SourceFrameIndex): number => {
    const safeTime = Math.max(0, finiteOr(time, 0));
    if (sourceFrameIndex && !sourceFrameIndex.cfr && sourceFrameIndex.pts.length > 0) {
        const pts = sourceFrameIndex.pts;
        let lo = 0, hi = pts.length - 1;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid]! < safeTime) lo = mid + 1; else hi = mid; }
        const curr = pts[lo]!, prev = lo > 0 ? pts[lo - 1]! : curr;
        return Math.max(0, Math.abs(prev - safeTime) <= Math.abs(curr - safeTime) ? prev : curr);
    }
    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
    return Math.max(0, Math.round(safeTime * safeFps) / safeFps);
};

/** Moves from an exact manual time to the adjacent source frame in the requested direction. */
export const nudgeTimeToFrame = (time: number, deltaFrames: number, fps: number, sourceFrameIndex?: SourceFrameIndex): number => {
    const safeTime = Math.max(0, finiteOr(time, 0));
    const safeDelta = Number.isFinite(deltaFrames) ? Math.trunc(deltaFrames) : 0;
    if (safeDelta === 0) return snapTimeToSourceFrame(safeTime, fps, sourceFrameIndex);

    if (sourceFrameIndex && !sourceFrameIndex.cfr && sourceFrameIndex.pts.length > 0) {
        const pts = sourceFrameIndex.pts;
        let lo = 0, hi = pts.length - 1, anchor = safeDelta > 0 ? -1 : pts.length;
        while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            if (safeDelta > 0) { if (pts[mid]! <= safeTime + 1e-6) { anchor = mid; lo = mid + 1; } else hi = mid - 1; }
            else { if (pts[mid]! >= safeTime - 1e-6) { anchor = mid; hi = mid - 1; } else lo = mid + 1; }
        }
        return Math.max(0, pts[clamp(anchor + safeDelta, 0, pts.length - 1)]!);
    }

    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
    const scaled = safeTime * safeFps;
    return Math.max(0, (safeDelta > 0 ? Math.floor(scaled + 1e-7) + safeDelta : Math.ceil(scaled - 1e-7) + safeDelta) / safeFps);
};

/** Maps timeline timecode (seconds) to the underlying video clip timestamp. */
export const timelineTimeToMediaTime = (draft: VideoDraft, timelineTime: number): number => {
    const safeT = Math.max(0, finiteOr(timelineTime, 0));
    const scenes = draft.scenes?.length ? draft.scenes : [];
    if (!scenes.length) return safeT;
    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    if (hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook) {
        if (safeT < hookDur) return hookOffset + safeT;
        if (hasReHook && safeT < preStoryDur) return rehookOffset + (safeT - hookDur);
        return storyOffset + (safeT - preStoryDur);
    }
    return safeT;
};

/** Wraps timeline-mapped media time within [storyOffset, clipDuration] for Story+ so pre-Story footage never replays. */
export const wrapMediaTime = (draft: VideoDraft, timelineTime: number, clipDuration: number): number => {
    const safeT = Math.max(0, finiteOr(timelineTime, 0));
    const raw = timelineTimeToMediaTime(draft, safeT);
    if (!Number.isFinite(clipDuration) || clipDuration <= 0) return raw;
    const { preStoryDur, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (safeT >= preStoryDur && storyOffset > 0 && storyOffset < clipDuration - 0.5) {
        return storyOffset + (Math.max(0, raw - storyOffset) % Math.max(0.5, clipDuration - storyOffset));
    }
    return Math.max(0, raw) % clipDuration;
};

/** Maps a native video media timestamp back to timeline currentTime, tracking loop iterations on shorter clips. */
export const mediaTimeToTimelineTime = (
    draft: VideoDraft, mediaTime: number, currentTimelineTime: number, actualClipDuration?: number
): number => {
    const safeMedia = Math.max(0, finiteOr(mediaTime, 0));
    const safeCurrent = Math.max(0, finiteOr(currentTimelineTime, 0));
    const scenes = draft.scenes?.length ? draft.scenes : [];
    if (!scenes.length) return safeMedia;

    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;

    if (hasCustomJump && safeCurrent < hookDur) {
        if (Math.abs(safeCurrent - hookDur) < 0.25) {
            const nextOffset = hasReHook ? rehookOffset : storyOffset;
            if (Math.abs(safeMedia - nextOffset) < 0.35 && Math.abs(safeMedia - (hookOffset + hookDur)) > 0.4) {
                return hookDur + Math.max(0, safeMedia - nextOffset);
            }
        }
        return clamp(safeMedia - hookOffset, 0, hookDur);
    }
    if (hasReHook && safeCurrent >= hookDur && safeCurrent < preStoryDur) {
        if (Math.abs(safeCurrent - hookDur) < 0.25 && Math.abs(safeMedia - (hookOffset + hookDur)) < 0.35 && Math.abs(safeMedia - rehookOffset) > 0.4) return hookDur;
        if (Math.abs(safeCurrent - preStoryDur) < 0.25 && Math.abs(safeMedia - storyOffset) < 0.35 && Math.abs(safeMedia - (rehookOffset + (preStoryDur - hookDur))) > 0.4) {
            return preStoryDur + Math.max(0, safeMedia - storyOffset);
        }
        return clamp(hookDur + Math.max(0, safeMedia - rehookOffset), hookDur, preStoryDur);
    }
    if (hasCustomJump && Math.abs(safeCurrent - preStoryDur) < 0.25) {
        const prevEndMedia = hasReHook ? (rehookOffset + (preStoryDur - hookDur)) : (hookOffset + hookDur);
        if (Math.abs(safeMedia - prevEndMedia) < 0.5 && Math.abs(safeMedia - storyOffset) > 0.5) return preStoryDur;
    }

    const baseOffset = hasCustomJump ? preStoryDur : 0;
    const relMedia = hasCustomJump && storyOffset > 0 ? Math.max(0, safeMedia - storyOffset) : safeMedia;
    const prevNarrativeTime = Math.max(0, safeCurrent - baseOffset);
    const liveDur = actualClipDuration && Number.isFinite(actualClipDuration) && actualClipDuration > 1 ? actualClipDuration : 0;
    const draftDur = draft.videoDuration && Number.isFinite(draft.videoDuration) && draft.videoDuration > 1 ? draft.videoDuration : 0;
    const rawClipDur = liveDur || draftDur;
    const clipDur = rawClipDur > 0 ? Math.max(1, rawClipDur - (hasCustomJump ? storyOffset : 0)) : 0;

    if (clipDur > 0) {
        let loopIndex = Math.floor(prevNarrativeTime / clipDur);
        if (prevNarrativeTime % clipDur > clipDur - 0.8 && relMedia < 0.8) loopIndex += 1;
        return baseOffset + loopIndex * clipDur + relMedia;
    }
    return baseOffset + relMedia;
};
