import {
    clamp,
    DEFAULT_STAR_CUES,
    type StarHoldFeel,
    type StarSequenceMode,
    type StarSpinCue,
    type StarSpinMode,
} from "../types/news";

export type EmblemShape = "dot" | "star" | "crescent";

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

export interface EmblemCueState {
    shapeA: EmblemShape;
    shapeB: EmblemShape;
    mix: number;
    expandFactor: number;
    angleDeg: number;
}

export const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);
export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
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
// where (x, y) is anchor k and (c1, c2) are the outgoing/incoming control points for segment k -> (k+1)%10.
const DOT_SHAPE = new Float64Array(SEG_COUNT * 6);
const STAR_SHAPE = new Float64Array(SEG_COUNT * 6);
const CRESCENT_SHAPE = new Float64Array(SEG_COUNT * 6);

const initBaseShapes = () => {
    // 1. Circular dot (radius = 3) & 5-point Pakistan Flag star (unit scalePct = 100)
    const angles = Array.from({ length: SEG_COUNT }, (_, k) => -Math.PI / 2 + (k * Math.PI) / 5);
    for (let k = 0; k < SEG_COUNT; k++) {
        const j = (k + 1) % SEG_COUNT;
        const ak = angles[k]!;
        const aj = angles[j]!;
        const cosK = Math.cos(ak);
        const sinK = Math.sin(ak);
        const cosJ = Math.cos(aj);
        const sinJ = Math.sin(aj);

        const dotH = DOT_RADIUS * CIRCLE_BEZIER_K;
        const base = k * 6;
        DOT_SHAPE[base] = DOT_RADIUS * cosK;
        DOT_SHAPE[base + 1] = DOT_RADIUS * sinK;
        DOT_SHAPE[base + 2] = DOT_RADIUS * cosK - dotH * sinK;
        DOT_SHAPE[base + 3] = DOT_RADIUS * sinK + dotH * cosK;
        DOT_SHAPE[base + 4] = DOT_RADIUS * cosJ + dotH * sinJ;
        DOT_SHAPE[base + 5] = DOT_RADIUS * sinJ - dotH * cosJ;

        const rk = (k & 1) === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS;
        const rj = (j & 1) === 0 ? STAR_OUTER_RADIUS : STAR_INNER_RADIUS;
        const sxk = rk * cosK;
        const syk = rk * sinK;
        const sxj = rj * cosJ;
        const syj = rj * sinJ;
        STAR_SHAPE[base] = sxk;
        STAR_SHAPE[base + 1] = syk;
        STAR_SHAPE[base + 2] = sxk;
        STAR_SHAPE[base + 3] = syk;
        STAR_SHAPE[base + 4] = sxj;
        STAR_SHAPE[base + 5] = syj;
    }

    // 2. Authentic Pakistan Flag crescent (opening toward upper-right -45deg, outer radius = STAR_OUTER_RADIUS)
    // Segments 0..4 trace the inner concave arc from top horn B (-99deg) to right horn A (+9deg);
    // Segments 5..9 trace the outer convex belly clockwise from horn A (+9deg) through +135deg back to horn B (+261deg).
    const R = STAR_OUTER_RADIUS;
    const r = R * 0.86;
    const d = R * 0.30;
    const openAngle = -Math.PI / 4; // upper-right opening (-45deg in SVG Y-down coords)
    const cx = d * Math.cos(openAngle);
    const cy = d * Math.sin(openAngle);
    const cosTheta = (R * R + d * d - r * r) / (2 * R * d);
    const theta = Math.acos(clamp(cosTheta, -1, 1));

    const outerA = openAngle + theta; // right horn (~+9.3deg)
    const outerB = openAngle - theta; // top horn (~-99.3deg)
    const hornAx = R * Math.cos(outerA);
    const hornAy = R * Math.sin(outerA);
    const hornBx = R * Math.cos(outerB);
    const hornBy = R * Math.sin(outerB);

    const innerB = Math.atan2(hornBy - cy, hornBx - cx);
    let innerA = Math.atan2(hornAy - cy, hornAx - cx);
    // Ensure inner arc sweeps counter-clockwise (decreasing angle) from innerB -> innerA through the hollow side
    while (innerA > innerB) innerA -= Math.PI * 2;
    const innerStep = (innerA - innerB) / 5; // negative angle step
    const innerK = (4 / 3) * Math.tan(innerStep / 4);

    for (let s = 0; s < 5; s++) {
        const a0 = innerB + s * innerStep;
        const a1 = innerB + (s + 1) * innerStep;
        const x0 = cx + r * Math.cos(a0);
        const y0 = cy + r * Math.sin(a0);
        const x1 = cx + r * Math.cos(a1);
        const y1 = cy + r * Math.sin(a1);
        const h = r * innerK;
        const base = s * 6;
        CRESCENT_SHAPE[base] = x0;
        CRESCENT_SHAPE[base + 1] = y0;
        CRESCENT_SHAPE[base + 2] = x0 - h * Math.sin(a0);
        CRESCENT_SHAPE[base + 3] = y0 + h * Math.cos(a0);
        CRESCENT_SHAPE[base + 4] = x1 + h * Math.sin(a1);
        CRESCENT_SHAPE[base + 5] = y1 - h * Math.cos(a1);
    }

    const outerEnd = outerB + Math.PI * 2; // clockwise around lower-left belly back to horn B
    const outerStep = (outerEnd - outerA) / 5; // positive angle step (~+50.3deg)
    const outerK = (4 / 3) * Math.tan(outerStep / 4);

    for (let s = 0; s < 5; s++) {
        const a0 = outerA + s * outerStep;
        const a1 = outerA + (s + 1) * outerStep;
        const x0 = R * Math.cos(a0);
        const y0 = R * Math.sin(a0);
        const x1 = R * Math.cos(a1);
        const y1 = R * Math.sin(a1);
        const h = R * outerK;
        const base = (5 + s) * 6;
        CRESCENT_SHAPE[base] = x0;
        CRESCENT_SHAPE[base + 1] = y0;
        CRESCENT_SHAPE[base + 2] = x0 - h * Math.sin(a0);
        CRESCENT_SHAPE[base + 3] = y0 + h * Math.cos(a0);
        CRESCENT_SHAPE[base + 4] = x1 + h * Math.sin(a1);
        CRESCENT_SHAPE[base + 5] = y1 - h * Math.cos(a1);
    }
};
initBaseShapes();

const getShapeBuffer = (shape: EmblemShape): Float64Array =>
    shape === "star" ? STAR_SHAPE : shape === "crescent" ? CRESCENT_SHAPE : DOT_SHAPE;

/** Morphs seamlessly between any two 10-segment emblem shapes (`dot`, `star`, `crescent`) with zero array allocations. */
export const buildLogoEmblemPath = (
    shapeA: EmblemShape,
    shapeB: EmblemShape,
    mix: number,
    scalePct = 100
): string => {
    const t = clamp01(mix);
    if ((shapeA === "dot" && t <= 0.001) || (shapeB === "dot" && t >= 0.999) || (shapeA === "dot" && shapeB === "dot")) {
        return CIRCLE_PATH_R3;
    }
    const scaleMul = clamp(scalePct, 50, 200) / 100;
    const sA = shapeA === "dot" ? 1 : scaleMul;
    const sB = shapeB === "dot" ? 1 : scaleMul;
    const bufA = getShapeBuffer(shapeA);
    const bufB = getShapeBuffer(shapeB);
    const inv = 1 - t;

    const x0 = (bufA[0]! * sA * inv + bufB[0]! * sB * t).toFixed(3);
    const y0 = (bufA[1]! * sA * inv + bufB[1]! * sB * t).toFixed(3);
    let d = `M ${x0} ${y0}`;
    for (let k = 0; k < SEG_COUNT; k++) {
        const b = k * 6;
        const nb = ((k + 1) % SEG_COUNT) * 6;
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

/** Morphs the R=3 circular dot (m=0) into a sharp 5-point Pakistan Flag star (m=1). */
export const buildDotStarMorphPath = (morph: number, scalePct = 100): string =>
    buildLogoEmblemPath("dot", "star", morph, scalePct);

/**
 * Returns the SVG transform for the P. dot/star/crescent, lifting its center upward as it expands
 * so its lowest point stays anchored on the y=42 baseline and never pushes down into PAKISTAN EDIT.
 */
export const getStarDotTransform = (expandFactor: number, angleDeg: number, scalePct = 100): string => {
    const m = clamp01(expandFactor);
    const scaleMul = clamp(scalePct, 50, 200) / 100;
    const currentOuterR = DOT_RADIUS + (STAR_OUTER_RADIUS * scaleMul - DOT_RADIUS) * m;
    const liftY = Math.max(0, currentOuterR - DOT_RADIUS);
    const base = liftY > 0.001
        ? `translate(${DOT_BASE_X} ${(DOT_BASE_Y - liftY).toFixed(3)})`
        : `translate(${DOT_BASE_X} ${DOT_BASE_Y})`;
    return Math.abs(angleDeg) > 0.01 ? `${base} rotate(${angleDeg.toFixed(2)})` : base;
};

/** Returns the total duration in seconds of a single emblem cue for the chosen sequence mode. */
export const getCueTotalDuration = (
    morphDur: number,
    holdDur: number,
    sequence: StarSequenceMode = "star-crescent"
): number => (sequence === "star-crescent" ? morphDur * 3 + holdDur * 2 : morphDur * 2 + holdDur);

export const REST_CUE_STATE: EmblemCueState = {
    shapeA: "dot",
    shapeB: "dot",
    mix: 0,
    expandFactor: 0,
    angleDeg: 0,
};

/** Evaluates a single P. dot -> star (-> crescent) -> dot cue cycle with configurable spin direction, sequence, and hold feel. */
export const evaluateEmblemCue = (
    localElapsed: number,
    morphDur: number,
    holdDur: number,
    spinMode: StarSpinMode = "ccw",
    sequence: StarSequenceMode = "star-crescent",
    holdFeel: StarHoldFeel = "drift"
): EmblemCueState => {
    const total = getCueTotalDuration(morphDur, holdDur, sequence);
    if (localElapsed <= 0 || localElapsed >= total) return REST_CUE_STATE;

    const dir = spinMode === "ccw" ? -1 : 1;
    const driftDeg = holdFeel === "still" ? 0 : (spinMode === "cw-2x" ? 24 : 18);

    if (sequence === "star-crescent") {
        // 5 beats: Dot->Star | Star Hold | Star->Crescent (lands on authentic 0deg mod 360) | Crescent Hold | Crescent->Dot
        const starTarget = spinMode === "cw-2x" ? 288 : (spinMode === "cw-1x" ? 144 : 126);
        const crescentCenter = spinMode === "cw-2x" ? 720 : 360;
        const a1 = dir * starTarget;
        const a2 = a1 + dir * driftDeg;
        const a3 = dir * (crescentCenter - driftDeg * 0.5);
        const a4 = dir * (crescentCenter + driftDeg * 0.5);
        const a5 = dir * (crescentCenter + (spinMode === "cw-2x" ? 288 : 144));

        const t1 = morphDur;
        const t2 = t1 + holdDur;
        const t3 = t2 + morphDur;
        const t4 = t3 + holdDur;

        if (localElapsed < t1) {
            const e = easeInOutCubic(localElapsed / morphDur);
            return { shapeA: "dot", shapeB: "star", mix: e, expandFactor: e, angleDeg: a1 * e };
        }
        if (localElapsed < t2) {
            const u = holdDur > 0 ? (localElapsed - t1) / holdDur : 0;
            return { shapeA: "star", shapeB: "star", mix: 1, expandFactor: 1, angleDeg: a1 + (a2 - a1) * u };
        }
        if (localElapsed < t3) {
            const e = easeInOutCubic((localElapsed - t2) / morphDur);
            return { shapeA: "star", shapeB: "crescent", mix: e, expandFactor: 1, angleDeg: a2 + (a3 - a2) * e };
        }
        if (localElapsed < t4) {
            const u = holdDur > 0 ? (localElapsed - t3) / holdDur : 0;
            return { shapeA: "crescent", shapeB: "crescent", mix: 1, expandFactor: 1, angleDeg: a3 + (a4 - a3) * u };
        }
        const e = easeInOutCubic((localElapsed - t4) / morphDur);
        return { shapeA: "crescent", shapeB: "dot", mix: e, expandFactor: 1 - e, angleDeg: a4 + (a5 - a4) * e };
    }

    if (sequence === "crescent-only") {
        // 3 beats: Dot->Crescent (lands on authentic 0deg mod 360) | Crescent Hold | Crescent->Dot
        const crescentCenter = spinMode === "cw-2x" ? 720 : 360;
        const a1 = dir * (crescentCenter - driftDeg * 0.5);
        const a2 = dir * (crescentCenter + driftDeg * 0.5);
        const a3 = dir * (crescentCenter + (spinMode === "cw-2x" ? 288 : 144));

        if (localElapsed < morphDur) {
            const e = easeInOutCubic(localElapsed / morphDur);
            return { shapeA: "dot", shapeB: "crescent", mix: e, expandFactor: e, angleDeg: a1 * e };
        }
        if (localElapsed < morphDur + holdDur) {
            const u = holdDur > 0 ? (localElapsed - morphDur) / holdDur : 0;
            return { shapeA: "crescent", shapeB: "crescent", mix: 1, expandFactor: 1, angleDeg: a1 + (a2 - a1) * u };
        }
        const e = easeInOutCubic((localElapsed - morphDur - holdDur) / morphDur);
        return { shapeA: "crescent", shapeB: "dot", mix: e, expandFactor: 1 - e, angleDeg: a2 + (a3 - a2) * e };
    }

    // star-only: Dot -> Star -> Dot
    const a1 = spinMode === "cw-1x" ? 144 : spinMode === "cw-2x" ? 288 : spinMode === "ccw" ? -126 : 126;
    const holdDelta = holdFeel === "still" ? 0 : (spinMode === "cw-2x" ? 72 : spinMode === "cw-1x" ? 0 : dir * 18);
    const a2 = a1 + holdDelta;
    const a3 = spinMode === "cw-1x" ? 288 : spinMode === "cw-2x" ? 648 : spinMode === "ccw" ? -288 : 288;

    if (localElapsed < morphDur) {
        const e = easeInOutCubic(localElapsed / morphDur);
        return { shapeA: "dot", shapeB: "star", mix: e, expandFactor: e, angleDeg: a1 * e };
    }
    if (localElapsed < morphDur + holdDur) {
        const u = holdDur > 0 ? (localElapsed - morphDur) / holdDur : 0;
        return { shapeA: "star", shapeB: "star", mix: 1, expandFactor: 1, angleDeg: a1 + (a2 - a1) * u };
    }
    const e = easeInOutCubic((localElapsed - morphDur - holdDur) / morphDur);
    return { shapeA: "star", shapeB: "dot", mix: e, expandFactor: 1 - e, angleDeg: a2 + (a3 - a2) * e };
};

/** Legacy wrapper evaluating a single star-only spin cycle. */
export const evaluateSingleCueSpin = (
    localElapsed: number,
    morphDur: number,
    holdDur: number,
    spinMode: StarSpinMode
): { morph: number; angleDeg: number } => {
    const st = evaluateEmblemCue(localElapsed, morphDur, holdDur, spinMode, "star-only", "drift");
    return { morph: st.expandFactor, angleDeg: st.angleDeg };
};

/** Resolves the active emblem cue state across all scheduled cues for the current playback time. */
export const getLogoEmblemState = (elapsed: number, cfg?: LogoMotionConfig): EmblemCueState => {
    if (cfg?.enableLogo === false) return REST_CUE_STATE;
    const cues = cfg?.starCues ?? DEFAULT_STAR_CUES;
    if (!cues.length) return REST_CUE_STATE;
    const morphDur = clamp(cfg?.morphDuration ?? 0.45, 0.15, 2.0);
    const holdDur = clamp(cfg?.holdDuration ?? 0.5, 0, 5.0);
    const spinMode = cfg?.spinMode ?? "ccw";
    const sequence = cfg?.sequence ?? "star-crescent";
    const holdFeel = cfg?.holdFeel ?? "drift";
    const total = getCueTotalDuration(morphDur, holdDur, sequence);

    for (let i = 0; i < cues.length; i++) {
        const local = elapsed - cues[i]!.time;
        if (local >= 0.005 && local < total) {
            return evaluateEmblemCue(local, morphDur, holdDur, spinMode, sequence, holdFeel);
        }
    }
    return REST_CUE_STATE;
};

/** Legacy wrapper returning star morph (0..1) and rotation angle for the current elapsed playback time. */
export const getStarAnimState = (elapsed: number, cfg?: LogoMotionConfig): { morph: number; angleDeg: number } => {
    const st = getLogoEmblemState(elapsed, { ...cfg, sequence: cfg?.sequence ?? "star-only" });
    return { morph: st.expandFactor, angleDeg: st.angleDeg };
};
