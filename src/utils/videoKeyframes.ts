import type { VideoDraft, VideoFraming, VideoKeyframe } from "../types/news";
import { clamp, interpolateKeyframe, snapTimeToSourceFrame } from "./videoTimeline";

/**
 * Finds the parked keyframe at `time` (within `tolerance` seconds) and auto-infers whether
 * the playhead is sitting closer to a split SNAP keyframe's `PRE` or `POST` stop.
 */
export const findParkedKeyframe = (
    keyframes: readonly VideoKeyframe[] | undefined,
    time: number,
    tolerance = 0.05
): { index: number; inferredSide: "pre" | "post" | null } => {
    if (!keyframes?.length) return { index: -1, inferredSide: null };
    for (let i = 0; i < keyframes.length; i++) {
        const k = keyframes[i]!;
        const atPost = Math.abs(k.time - time) < tolerance;
        const preTime = k.easing === "snap" ? k.pre?.time : undefined;
        const atPre = preTime !== undefined && Math.abs(preTime - time) < tolerance;
        if (atPost || atPre) {
            if (k.easing === "snap" && preTime !== undefined && Math.abs(k.time - preTime) >= 0.01) {
                return {
                    index: i,
                    inferredSide: Math.abs(time - preTime) < Math.abs(time - k.time) ? "pre" : "post",
                };
            }
            return { index: i, inferredSide: null };
        }
    }
    return { index: -1, inferredSide: null };
};

/** Inserts or updates a keyframe at `activeDisplayTime`, deduplicating exact frame-snapped timestamp collisions. */
export const upsertKeyframe = (
    draft: VideoDraft,
    opts: {
        activeDisplayTime: number;
        existingIndex: number;
        effectiveEditSide: "pre" | "post";
        activeFraming: { zoom: number; posX: number; posY: number };
        isLetterboxActive: boolean;
        kind?: "smooth" | "snap";
    }
): { keyframes: VideoKeyframe[]; nextEditSide?: "pre" | "post" } => {
    const kind = opts.kind ?? "snap";
    const keyframes: VideoKeyframe[] = draft.keyframes ? [...draft.keyframes] : [];
    const sourceFps = draft.sourceFps ?? 30;
    const roundedTime = snapTimeToSourceFrame(opts.activeDisplayTime, sourceFps, draft.sourceFrameIndex);
    const nextPosY = opts.isLetterboxActive ? opts.activeFraming.posY : undefined;

    const targetIndex = opts.existingIndex >= 0
        ? opts.existingIndex
        : keyframes.findIndex((k) => Math.abs(k.time - roundedTime) < 0.001);

    if (targetIndex >= 0) {
        const curr = keyframes[targetIndex]!;
        keyframes[targetIndex] = curr.easing === "snap" && opts.effectiveEditSide === "pre"
            ? { ...curr, easing: "snap", pre: { ...curr.pre, zoom: opts.activeFraming.zoom, posX: opts.activeFraming.posX, posY: nextPosY } }
            : { ...curr, zoom: opts.activeFraming.zoom, posX: opts.activeFraming.posX, posY: nextPosY };
        return { keyframes };
    }

    const base = { zoom: opts.activeFraming.zoom, posX: opts.activeFraming.posX, posY: nextPosY };
    keyframes.push(
        kind === "snap"
            ? { id: `kf-${Date.now()}`, time: roundedTime, ...base, easing: "snap", pre: { ...base } }
            : { id: `kf-${Date.now()}`, time: roundedTime, ...base, easing: "smooth" }
    );
    keyframes.sort((a, b) => a.time - b.time);
    return { keyframes, nextEditSide: kind === "snap" ? "pre" : undefined };
};

/** Moves a keyframe's `PRE` or `POST` timestamp safely without inverting across adjacent keyframes. */
export const updateKeyframeTime = (
    draft: VideoDraft,
    opts: {
        existingIndex: number;
        nextRawTime: number;
        side: "pre" | "post";
        quantizeToFrame?: boolean;
        duration: number;
        defaultFraming: VideoFraming;
    }
): { keyframes: VideoKeyframe[]; seekTime: number } | null => {
    if (opts.existingIndex < 0 || !draft.keyframes?.[opts.existingIndex]) return null;
    const maxT = opts.duration > 0 ? opts.duration : Math.max(opts.nextRawTime, 60);
    const sourceFps = draft.sourceFps ?? 30;
    const hasVfrPts = Boolean(draft.sourceFrameIndex && !draft.sourceFrameIndex.cfr && draft.sourceFrameIndex.pts.length > 0);
    const clamped = opts.quantizeToFrame
        ? (hasVfrPts
            ? clamp(opts.nextRawTime, 0, maxT)
            : clamp(snapTimeToSourceFrame(opts.nextRawTime, sourceFps, draft.sourceFrameIndex), 0, maxT))
        : clamp(Math.round(opts.nextRawTime * 10000) / 10000, 0, maxT);

    const keyframes = [...draft.keyframes];
    const curr = keyframes[opts.existingIndex]!;
    const prevKfTime = opts.existingIndex > 0 ? (keyframes[opts.existingIndex - 1]?.time ?? 0) : 0;

    if (curr.easing === "snap" && opts.side === "pre") {
        const preClamped = clamp(clamped, Math.min(prevKfTime, curr.time), curr.time);
        const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), opts.defaultFraming);
        keyframes[opts.existingIndex] = { ...curr, easing: "snap", pre: { ...basePre, time: preClamped } };
        return { keyframes, seekTime: preClamped };
    }

    const postClamped = curr.easing === "snap" && curr.pre?.time !== undefined
        ? Math.max(curr.pre.time, clamped)
        : clamped;
    keyframes[opts.existingIndex] = { ...curr, time: postClamped };
    keyframes.sort((a, b) => a.time - b.time);
    return { keyframes, seekTime: postClamped };
};

/** Toggles a parked keyframe cleanly between `smooth` and `snap`, initializing `pre` on `GLIDE -> SNAP`. */
export const toggleKeyframeEasing = (
    draft: VideoDraft,
    existingIndex: number
): VideoKeyframe[] | null => {
    if (existingIndex < 0 || !draft.keyframes?.[existingIndex]) return null;
    const keyframes = [...draft.keyframes];
    const curr = keyframes[existingIndex]!;
    keyframes[existingIndex] = curr.easing === "snap"
        ? { ...curr, easing: "smooth", pre: undefined }
        : { ...curr, easing: "snap", pre: curr.pre ?? { zoom: curr.zoom, posX: curr.posX, posY: curr.posY } };
    return keyframes;
};

/** Updates zoom, pan X, or pos Y on a parked keyframe (honouring `PRE` vs `POST` and 4:5 fill/contain rules). */
export const updateKeyframeFraming = (
    draft: VideoDraft,
    opts: {
        existingIndex: number;
        effectiveEditSide: "pre" | "post";
        field: "zoom" | "posX" | "posY";
        val: number;
        activeFraming: { zoom: number; posX: number; posY: number };
        defaultFraming: VideoFraming;
        isTopBox45: boolean;
        isLetterboxActive: boolean;
    }
): VideoKeyframe[] | null => {
    if (opts.field === "posY" && !opts.isLetterboxActive) return null;
    if (opts.existingIndex < 0 || !draft.keyframes?.[opts.existingIndex]) return null;

    const keyframes = [...draft.keyframes];
    const curr = keyframes[opts.existingIndex]!;
    const nextZoom = opts.field === "zoom" ? opts.val : opts.activeFraming.zoom;
    const fillAfterChange = !opts.isTopBox45 || Math.round(nextZoom) >= 100;

    if (curr.easing === "snap" && opts.effectiveEditSide === "pre") {
        const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), opts.defaultFraming);
        const postMatchesPre = curr.zoom === basePre.zoom && curr.posX === basePre.posX && (curr.posY ?? 100) === (basePre.posY ?? 100);
        const nextPre = { ...basePre, [opts.field]: opts.val };
        const finalPre = fillAfterChange ? { time: curr.pre?.time, zoom: nextPre.zoom, posX: nextPre.posX } : nextPre;
        keyframes[opts.existingIndex] = postMatchesPre
            ? { ...curr, easing: "snap", zoom: finalPre.zoom, posX: finalPre.posX, posY: finalPre.posY, pre: finalPre }
            : { ...curr, easing: "snap", pre: finalPre };
    } else {
        const updated: VideoKeyframe = { ...curr, [opts.field]: opts.val };
        keyframes[opts.existingIndex] = fillAfterChange ? { ...updated, posY: undefined } : updated;
    }
    return keyframes;
};
