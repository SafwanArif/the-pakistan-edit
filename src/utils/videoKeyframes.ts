import type { VideoDraft, VideoFraming, VideoKeyframe } from "../types/news";
import { generateShortId } from "./idUtils";
import { clamp, finiteOr } from "./sceneTimeline";
import { interpolateKeyframe, snapTimeToSourceFrame } from "./videoTimeline";

/** Finds the closest parked keyframe at `time` (within `tolerance`) and infers SNAP `PRE` vs `POST`. */
export const findParkedKeyframe = (
    keyframes: readonly VideoKeyframe[] | undefined, time: number, tolerance = 0.05
): { index: number; inferredSide: "pre" | "post" | null } => {
    if (!keyframes?.length || !Number.isFinite(time)) return { index: -1, inferredSide: null };
    let bestIdx = -1, bestDist = tolerance, bestSide: "pre" | "post" | null = null;

    for (let i = 0; i < keyframes.length; i++) {
        const k = keyframes[i]!;
        const postDist = Math.abs(k.time - time);
        const preTime = k.easing === "snap" ? k.pre?.time : undefined;
        const preDist = preTime !== undefined && Number.isFinite(preTime) ? Math.abs(preTime - time) : Infinity;
        const minDist = Math.min(postDist, preDist);
        if (minDist < bestDist) {
            bestDist = minDist;
            bestIdx = i;
            bestSide = k.easing === "snap" && preTime !== undefined && Number.isFinite(preTime) && Math.abs(k.time - preTime) >= 0.01
                ? (preDist < postDist ? "pre" : "post")
                : null;
        }
    }
    return { index: bestIdx, inferredSide: bestSide };
};

/** Inserts or updates a keyframe at `activeDisplayTime`, deduplicating exact frame-snapped timestamp collisions. */
export const upsertKeyframe = (
    draft: VideoDraft,
    opts: {
        activeDisplayTime: number; existingIndex: number; effectiveEditSide: "pre" | "post";
        activeFraming: { zoom: number; posX: number; posY: number }; isLetterboxActive: boolean; kind?: "smooth" | "snap";
    }
): { keyframes: VideoKeyframe[]; nextEditSide?: "pre" | "post" } => {
    const kind = opts.kind ?? "snap";
    const keyframes: VideoKeyframe[] = draft.keyframes ? [...draft.keyframes] : [];
    const roundedTime = snapTimeToSourceFrame(opts.activeDisplayTime, draft.sourceFps ?? 30, draft.sourceFrameIndex);
    const zoom = finiteOr(opts.activeFraming.zoom, 100);
    const posX = finiteOr(opts.activeFraming.posX, 50);
    const nextPosY = opts.isLetterboxActive ? finiteOr(opts.activeFraming.posY, 100) : undefined;

    const targetIndex = opts.existingIndex >= 0 && opts.existingIndex < keyframes.length
        ? opts.existingIndex
        : keyframes.findIndex((k) => Math.abs(k.time - roundedTime) < 0.001);

    if (targetIndex >= 0) {
        const curr = keyframes[targetIndex]!;
        keyframes[targetIndex] = curr.easing === "snap" && opts.effectiveEditSide === "pre"
            ? { ...curr, easing: "snap", pre: { ...curr.pre, zoom, posX, posY: nextPosY } }
            : { ...curr, zoom, posX, posY: nextPosY };
        return { keyframes };
    }

    const base = { zoom, posX, posY: nextPosY };
    const id = `kf-${generateShortId()}`;
    keyframes.push(kind === "snap" ? { id, time: roundedTime, ...base, easing: "snap", pre: { ...base } } : { id, time: roundedTime, ...base, easing: "smooth" });
    keyframes.sort((a, b) => a.time - b.time);
    return { keyframes, nextEditSide: kind === "snap" ? "pre" : undefined };
};

/** Moves a keyframe's `PRE` or `POST` timestamp safely without inverting across adjacent keyframes. */
export const updateKeyframeTime = (
    draft: VideoDraft,
    opts: { existingIndex: number; nextRawTime: number; side: "pre" | "post"; quantizeToFrame?: boolean; duration: number; defaultFraming: VideoFraming }
): { keyframes: VideoKeyframe[]; seekTime: number } | null => {
    if (opts.existingIndex < 0 || !draft.keyframes?.[opts.existingIndex] || !Number.isFinite(opts.nextRawTime)) return null;
    const maxT = Number.isFinite(opts.duration) && opts.duration > 0 ? opts.duration : Math.max(opts.nextRawTime, 60);
    const hasVfrPts = Boolean(draft.sourceFrameIndex && !draft.sourceFrameIndex.cfr && draft.sourceFrameIndex.pts.length > 0);
    const clamped = opts.quantizeToFrame
        ? (hasVfrPts ? clamp(opts.nextRawTime, 0, maxT) : clamp(snapTimeToSourceFrame(opts.nextRawTime, draft.sourceFps ?? 30, draft.sourceFrameIndex), 0, maxT))
        : clamp(Math.round(opts.nextRawTime * 10000) / 10000, 0, maxT);

    const keyframes = [...draft.keyframes];
    const curr = keyframes[opts.existingIndex]!;
    const prevKfTime = opts.existingIndex > 0 ? finiteOr(keyframes[opts.existingIndex - 1]?.time, 0) : 0;

    if (curr.easing === "snap" && opts.side === "pre") {
        const preClamped = clamp(clamped, Math.min(prevKfTime, curr.time), curr.time);
        const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), opts.defaultFraming);
        keyframes[opts.existingIndex] = { ...curr, easing: "snap", pre: { ...basePre, time: preClamped } };
        return { keyframes, seekTime: preClamped };
    }

    const postClamped = curr.easing === "snap" && curr.pre?.time !== undefined && Number.isFinite(curr.pre.time) ? Math.max(curr.pre.time, clamped) : clamped;
    keyframes[opts.existingIndex] = { ...curr, time: postClamped };
    keyframes.sort((a, b) => a.time - b.time);
    for (let i = 0; i < keyframes.length; i++) {
        const k = keyframes[i]!;
        if (k.easing === "snap" && k.pre?.time !== undefined && Number.isFinite(k.pre.time)) {
            const minPre = i > 0 ? keyframes[i - 1]!.time : 0;
            const boundedPre = clamp(k.pre.time, Math.min(minPre, k.time), k.time);
            if (boundedPre !== k.pre.time) keyframes[i] = { ...k, pre: { ...k.pre, time: boundedPre } };
        }
    }
    return { keyframes, seekTime: postClamped };
};

/** Toggles a parked keyframe cleanly between `smooth` and `snap`, initializing `pre` on `GLIDE -> SNAP`. */
export const toggleKeyframeEasing = (draft: VideoDraft, existingIndex: number): VideoKeyframe[] | null => {
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
        existingIndex: number; effectiveEditSide: "pre" | "post"; field: "zoom" | "posX" | "posY"; val: number;
        activeFraming: { zoom: number; posX: number; posY: number }; defaultFraming: VideoFraming;
        isTopBox45: boolean; isLetterboxActive: boolean;
    }
): VideoKeyframe[] | null => {
    if (!Number.isFinite(opts.val) || (opts.field === "posY" && !opts.isLetterboxActive)) return null;
    if (opts.existingIndex < 0 || !draft.keyframes?.[opts.existingIndex]) return null;

    const keyframes = [...draft.keyframes];
    const curr = keyframes[opts.existingIndex]!;
    const nextZoom = opts.field === "zoom" ? opts.val : opts.activeFraming.zoom;
    const fillAfterChange = !opts.isTopBox45 || Math.round(nextZoom) >= 100;

    if (curr.easing === "snap" && opts.effectiveEditSide === "pre") {
        const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), opts.defaultFraming);
        const postMatchesPre = curr.zoom === basePre.zoom && curr.posX === basePre.posX && (curr.posY ?? 100) === (basePre.posY ?? 100);
        const nextPre = { ...basePre, [opts.field]: opts.val };
        const finalPre = fillAfterChange
            ? { ...(curr.pre?.time !== undefined ? { time: curr.pre.time } : {}), zoom: nextPre.zoom, posX: nextPre.posX }
            : nextPre;
        keyframes[opts.existingIndex] = postMatchesPre
            ? { ...curr, easing: "snap", zoom: finalPre.zoom, posX: finalPre.posX, posY: finalPre.posY, pre: finalPre }
            : { ...curr, easing: "snap", pre: finalPre };
    } else {
        const updated: VideoKeyframe = { ...curr, [opts.field]: opts.val };
        keyframes[opts.existingIndex] = fillAfterChange ? { ...updated, posY: undefined } : updated;
    }
    return keyframes;
};
