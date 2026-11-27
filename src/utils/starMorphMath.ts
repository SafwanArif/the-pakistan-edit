import { clamp, finiteOr } from "./sceneTimeline";
import type { StarHoldFeel, StarSequenceMode, StarSpinCue, StarSpinMode } from "../types/news";

type EmblemShape = "dot" | "star" | "crescent";

export const DEFAULT_STAR_CUES: readonly StarSpinCue[] = [{ id: "star-0", time: 0 }];

export interface LogoMotionConfig {
    enableLogo?: boolean;
    enableWordmark?: boolean;
    starCues?: readonly StarSpinCue[];
    morphDuration?: number;
    holdDuration?: number;
    starScale?: number;
    spinMode?: StarSpinMode;
    sequence?: StarSequenceMode;
    holdFeel?: StarHoldFeel;
    previewNonce?: number;
}

interface EmblemCueState {
    shapeA: EmblemShape;
    shapeB: EmblemShape;
    mix: number;
    expandFactor: number;
    angleDeg: number;
}

export const easeOutQuart = (t: number): number => { const u = 1 - t; return 1 - u * u * u * u; };
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const clamp01 = (v: number): number => clamp(v, 0, 1);

export const CIRCLE_PATH_R3 = "M 0 -3 A 3 3 0 1 1 0 3 A 3 3 0 1 1 0 -3 Z";
const DOT_BASE_X = 32;
const DOT_BASE_Y = 39;
const DOT_RADIUS = 3;
const STAR_OUTER_RADIUS = 4.45;
const STAR_INNER_RADIUS = 1.70;
const CIRCLE_BEZIER_K = (4 / 3) * Math.tan(Math.PI / 20);
const SEG_COUNT = 10;

// Each 10-segment closed cubic Bézier shape is stored as 60 floats: 10 * [x, y, c1x, c1y, c2x, c2y]
const DOT_SHAPE = new Float64Array(SEG_COUNT * 6);
const STAR_SHAPE = new Float64Array(SEG_COUNT * 6);
const CRESCENT_SHAPE = new Float64Array(SEG_COUNT * 6);

const writeArcSegments = (
    buf: Float64Array, startSeg: number, cx: number, cy: number, radius: number, startAngle: number, step: number, k: number
) => {
    const h = radius * k;
    for (let s = 0; s < 5; s++) {
        const a0 = startAngle + s * step, a1 = startAngle + (s + 1) * step;
        const x0 = cx + radius * Math.cos(a0), y0 = cy + radius * Math.sin(a0);
        const x1 = cx + radius * Math.cos(a1), y1 = cy + radius * Math.sin(a1);
        const base = (startSeg + s) * 6;
        buf[base] = x0; buf[base + 1] = y0;
        buf[base + 2] = x0 - h * Math.sin(a0); buf[base + 3] = y0 + h * Math.cos(a0);
        buf[base + 4] = x1 + h * Math.sin(a1); buf[base + 5] = y1 - h * Math.cos(a1);
    }
};

const initBaseShapes = () => {
    const angles = Array.from({ length: SEG_COUNT }, (_, k) => -Math.PI / 2 + (k * Math.PI) / 5);
    const dotH = DOT_RADIUS * CIRCLE_BEZIER_K;
    for (let k = 0; k < SEG_COUNT; k++) {
        const j = (k + 1) % SEG_COUNT;
        const cosK = Math.cos(angles[k]!), sinK = Math.sin(angles[k]!);
        const cosJ = Math.cos(angles[j]!), sinJ = Math.sin(angles[j]!);
        const base = k * 6;

        DOT_SHAPE[base] = DOT_RADIUS * cosK; DOT_SHAPE[base + 1] = DOT_RADIUS * sinK;
        DOT_SHAPE[base + 2] = DOT_RADIUS * cosK - dotH * sinK; DOT_SHAPE[base + 3] = DOT_RADIUS * sinK + dotH * cosK;
        DOT_SHAPE[base + 4] = DOT_RADIUS * cosJ + dotH * sinJ; DOT_SHAPE[base + 5] = DOT_RADIUS * sinJ - dotH * cosJ;

        const rk = (k & 1) === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS;
        const rj = (j & 1) === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS;
        STAR_SHAPE[base] = rk * cosK; STAR_SHAPE[base + 1] = rk * sinK;
        STAR_SHAPE[base + 2] = rk * cosK; STAR_SHAPE[base + 3] = rk * sinK;
        STAR_SHAPE[base + 4] = rj * cosJ; STAR_SHAPE[base + 5] = rj * sinJ;
    }

    const R = STAR_OUTER_RADIUS, r = R * 0.86, d = R * 0.30, openAngle = -Math.PI / 4;
    const cx = d * Math.cos(openAngle), cy = d * Math.sin(openAngle);
    const theta = Math.acos(clamp((R * R + d * d - r * r) / (2 * R * d), -1, 1));
    const outerA = openAngle + theta, outerB = openAngle - theta;

    const innerB = Math.atan2(R * Math.sin(outerB) - cy, R * Math.cos(outerB) - cx);
    let innerA = Math.atan2(R * Math.sin(outerA) - cy, R * Math.cos(outerA) - cx);
    while (innerA > innerB) innerA -= Math.PI * 2;
    const innerStep = (innerA - innerB) / 5;
    writeArcSegments(CRESCENT_SHAPE, 0, cx, cy, r, innerB, innerStep, (4 / 3) * Math.tan(innerStep / 4));

    const outerStep = (outerB + Math.PI * 2 - outerA) / 5;
    writeArcSegments(CRESCENT_SHAPE, 5, 0, 0, R, outerA, outerStep, (4 / 3) * Math.tan(outerStep / 4));
};
initBaseShapes();

const getShapeBuffer = (shape: EmblemShape): Float64Array =>
    shape === "star" ? STAR_SHAPE : shape === "crescent" ? CRESCENT_SHAPE : DOT_SHAPE;

/** Morphs seamlessly between any two 10-segment emblem shapes (`dot`, `star`, `crescent`) with zero array allocations. */
export const buildLogoEmblemPath = (shapeA: EmblemShape, shapeB: EmblemShape, mix: number, scalePct = 100): string => {
    if (!Number.isFinite(mix)) return CIRCLE_PATH_R3;
    const t = clamp01(mix);
    if ((shapeA === "dot" && t <= 0.001) || (shapeB === "dot" && t >= 0.999) || (shapeA === "dot" && shapeB === "dot")) return CIRCLE_PATH_R3;
    const scaleMul = clamp(finiteOr(scalePct, 100), 50, 200) / 100;
    const sA = shapeA === "dot" ? 1 : scaleMul;
    const sB = shapeB === "dot" ? 1 : scaleMul;
    const bufA = getShapeBuffer(shapeA);
    const bufB = getShapeBuffer(shapeB);
    const inv = 1 - t;

    let d = `M ${(bufA[0]! * sA * inv + bufB[0]! * sB * t).toFixed(3)} ${(bufA[1]! * sA * inv + bufB[1]! * sB * t).toFixed(3)}`;
    for (let k = 0; k < SEG_COUNT; k++) {
        const b = k * 6, nb = ((k + 1) % SEG_COUNT) * 6;
        const c1x = (bufA[b + 2]! * sA * inv + bufB[b + 2]! * sB * t).toFixed(3);
        const c1y = (bufA[b + 3]! * sA * inv + bufB[b + 3]! * sB * t).toFixed(3);
        const c2x = (bufA[b + 4]! * sA * inv + bufB[b + 4]! * sB * t).toFixed(3);
        const c2y = (bufA[b + 5]! * sA * inv + bufB[b + 5]! * sB * t).toFixed(3);
        const xj = (bufA[nb]! * sA * inv + bufB[nb]! * sB * t).toFixed(3);
        const yj = (bufA[nb + 1]! * sA * inv + bufB[nb + 1]! * sB * t).toFixed(3);
        d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${xj} ${yj}`;
    }
    return `${d} Z`;
};

/** Returns SVG transform lifting the expanding emblem so its lowest point stays anchored on y=42. */
export const getStarDotTransform = (expandFactor: number, angleDeg: number, scalePct = 100): string => {
    const m = clamp01(finiteOr(expandFactor, 0));
    const safeAngle = finiteOr(angleDeg, 0);
    const scaleMul = clamp(finiteOr(scalePct, 100), 50, 200) / 100;
    const liftY = Math.max(0, (STAR_OUTER_RADIUS * scaleMul - DOT_RADIUS) * m);
    const base = liftY > 0.001 ? `translate(${DOT_BASE_X} ${(DOT_BASE_Y - liftY).toFixed(3)})` : `translate(${DOT_BASE_X} ${DOT_BASE_Y})`;
    return Math.abs(safeAngle) > 0.01 ? `${base} rotate(${safeAngle.toFixed(2)})` : base;
};

/** Returns the total duration in seconds of a single emblem cue for the chosen sequence mode. */
export const getCueTotalDuration = (morphDur: number, holdDur: number, sequence: StarSequenceMode = "star-crescent"): number => {
    if (!Number.isFinite(morphDur) || !Number.isFinite(holdDur) || morphDur <= 0 || holdDur < 0) return 0;
    return sequence === "star-crescent" ? morphDur * 3 + holdDur * 2 : morphDur * 2 + holdDur;
};

export const REST_CUE_STATE: Readonly<EmblemCueState> = Object.freeze({
    shapeA: "dot", shapeB: "dot", mix: 0, expandFactor: 0, angleDeg: 0,
});

const evalThreeBeat = (
    localElapsed: number, morphDur: number, holdDur: number, shape: "star" | "crescent", a1: number, a2: number, a3: number
): EmblemCueState => {
    if (localElapsed < morphDur) {
        const e = easeInOutCubic(localElapsed / morphDur);
        return { shapeA: "dot", shapeB: shape, mix: e, expandFactor: e, angleDeg: a1 * e };
    }
    if (localElapsed < morphDur + holdDur) {
        const u = holdDur > 0 ? (localElapsed - morphDur) / holdDur : 0;
        return { shapeA: shape, shapeB: shape, mix: 1, expandFactor: 1, angleDeg: a1 + (a2 - a1) * u };
    }
    const e = easeInOutCubic((localElapsed - morphDur - holdDur) / morphDur);
    return { shapeA: shape, shapeB: "dot", mix: e, expandFactor: 1 - e, angleDeg: a2 + (a3 - a2) * e };
};

/** Evaluates a single P. dot -> star (-> crescent) -> dot cue cycle. */
export const evaluateEmblemCue = (
    localElapsed: number, morphDur: number, holdDur: number,
    spinMode: StarSpinMode = "ccw", sequence: StarSequenceMode = "star-crescent", holdFeel: StarHoldFeel = "drift"
): EmblemCueState => {
    const total = getCueTotalDuration(morphDur, holdDur, sequence);
    if (!Number.isFinite(localElapsed) || total <= 0 || localElapsed <= 0 || localElapsed >= total) return REST_CUE_STATE;

    const dir = spinMode === "ccw" ? -1 : 1;
    const driftDeg = holdFeel === "still" ? 0 : (spinMode === "cw-2x" ? 24 : 18);

    if (sequence === "star-crescent") {
        const starTarget = spinMode === "cw-2x" ? 288 : (spinMode === "cw-1x" ? 144 : 126);
        const crescentCenter = spinMode === "cw-2x" ? 720 : 360;
        const a1 = dir * starTarget, a2 = a1 + dir * driftDeg;
        const a3 = dir * (crescentCenter - driftDeg * 0.5), a4 = dir * (crescentCenter + driftDeg * 0.5);
        const a5 = dir * (crescentCenter + (spinMode === "cw-2x" ? 288 : 144));
        const t1 = morphDur, t2 = t1 + holdDur, t3 = t2 + morphDur, t4 = t3 + holdDur;

        if (localElapsed < t1) { const e = easeInOutCubic(localElapsed / morphDur); return { shapeA: "dot", shapeB: "star", mix: e, expandFactor: e, angleDeg: a1 * e }; }
        if (localElapsed < t2) { const u = holdDur > 0 ? (localElapsed - t1) / holdDur : 0; return { shapeA: "star", shapeB: "star", mix: 1, expandFactor: 1, angleDeg: a1 + (a2 - a1) * u }; }
        if (localElapsed < t3) { const e = easeInOutCubic((localElapsed - t2) / morphDur); return { shapeA: "star", shapeB: "crescent", mix: e, expandFactor: 1, angleDeg: a2 + (a3 - a2) * e }; }
        if (localElapsed < t4) { const u = holdDur > 0 ? (localElapsed - t3) / holdDur : 0; return { shapeA: "crescent", shapeB: "crescent", mix: 1, expandFactor: 1, angleDeg: a3 + (a4 - a3) * u }; }
        const e = easeInOutCubic((localElapsed - t4) / morphDur);
        return { shapeA: "crescent", shapeB: "dot", mix: e, expandFactor: 1 - e, angleDeg: a4 + (a5 - a4) * e };
    }

    if (sequence === "crescent-only") {
        const crescentCenter = spinMode === "cw-2x" ? 720 : 360;
        return evalThreeBeat(
            localElapsed, morphDur, holdDur, "crescent",
            dir * (crescentCenter - driftDeg * 0.5),
            dir * (crescentCenter + driftDeg * 0.5),
            dir * (crescentCenter + (spinMode === "cw-2x" ? 288 : 144))
        );
    }

    const a1 = spinMode === "cw-1x" ? 144 : spinMode === "cw-2x" ? 288 : spinMode === "ccw" ? -126 : 126;
    const holdDelta = holdFeel === "still" ? 0 : (spinMode === "cw-2x" ? 72 : spinMode === "cw-1x" ? 0 : dir * 18);
    const a3 = spinMode === "cw-1x" ? 288 : spinMode === "cw-2x" ? 648 : spinMode === "ccw" ? -288 : 288;
    return evalThreeBeat(localElapsed, morphDur, holdDur, "star", a1, a1 + holdDelta, a3);
};

/** Resolves the active emblem cue state across all scheduled cues for the current playback time. */
export const getLogoEmblemState = (elapsed: number, cfg?: LogoMotionConfig): EmblemCueState => {
    if (!Number.isFinite(elapsed) || cfg?.enableLogo === false) return REST_CUE_STATE;
    const cues = cfg?.starCues ?? DEFAULT_STAR_CUES;
    if (!cues.length) return REST_CUE_STATE;
    const morphDur = clamp(finiteOr(cfg?.morphDuration, 0.45), 0.15, 2.0);
    const holdDur = clamp(finiteOr(cfg?.holdDuration, 0.5), 0, 5.0);
    const spinMode = cfg?.spinMode ?? "ccw";
    const sequence = cfg?.sequence ?? "star-crescent";
    const holdFeel = cfg?.holdFeel ?? "drift";
    const total = getCueTotalDuration(morphDur, holdDur, sequence);

    for (let i = 0; i < cues.length; i++) {
        const local = elapsed - cues[i]!.time;
        if (local >= 0.005 && local < total) return evaluateEmblemCue(local, morphDur, holdDur, spinMode, sequence, holdFeel);
    }
    return REST_CUE_STATE;
};
