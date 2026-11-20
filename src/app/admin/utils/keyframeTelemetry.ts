import { clamp, type VideoKeyframe } from "../../../types/news";

interface TelemetryTint {
    color: string;
    background: string;
    borderColor: string;
}

const PRE_COLOR = "var(--ui-pre)";

const NEUTRAL: TelemetryTint = {
    color: "var(--ui-text-dim)",
    background: "rgba(255,255,255,0.03)",
    borderColor: "var(--ui-border)",
};

const makeTint = (color: string): TelemetryTint => ({
    color,
    background: `color-mix(in oklch, ${color} 10%, transparent)`,
    borderColor: `color-mix(in oklch, ${color} 45%, transparent)`,
});

/** Returns continuous camera-state tint for the live framing telemetry pill. Pass boolean `isParkedSnap` or numeric index into `keyframes`. */
export function getKeyframeTelemetryTint(
    keyframes: VideoKeyframe[] | undefined,
    time: number,
    editSide: "pre" | "post",
    parkedIndexOrSnap: number | boolean,
    preSorted = false
): TelemetryTint {
    if (!keyframes?.length) return NEUTRAL;
    const sorted = preSorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time);

    const isParkedSnap = typeof parkedIndexOrSnap === "boolean"
        ? parkedIndexOrSnap
        : parkedIndexOrSnap >= 0 && keyframes[parkedIndexOrSnap]?.easing === "snap";
    if (isParkedSnap && editSide === "pre") {
        return makeTint(PRE_COLOR);
    }

    const first = sorted[0]!;
    if (time < first.time) {
        if (first.easing === "snap" && first.pre?.time !== undefined && time >= first.pre.time) {
            return makeTint(PRE_COLOR);
        }
        return NEUTRAL;
    }

    for (let i = 0; i < sorted.length - 1; i++) {
        const prev = sorted[i]!;
        const next = sorted[i + 1]!;
        if (time >= prev.time && time <= next.time) {
            if (next.easing === "snap") {
                if (next.pre?.time !== undefined && time >= next.pre.time) {
                    return makeTint(PRE_COLOR);
                }
                return makeTint(prev.easing === "snap" ? PRE_COLOR : "var(--ui-accent)");
            }
            if (prev.easing === "snap") {
                const span = Math.max(0.001, next.time - prev.time);
                const pct = Math.round(clamp((time - prev.time) / span, 0, 1) * 10) * 10;
                return makeTint(`color-mix(in oklch, var(--ui-accent) ${pct}%, ${PRE_COLOR})`);
            }
            return makeTint("var(--ui-accent)");
        }
    }

    return makeTint("var(--ui-accent)");
}

export interface KeyframeJumpStop {
    time: number;
    side: "pre" | "post";
}

/** Resolves ordered prev/next keyframe jump targets (including split PRE/POST stops and wrap-around). */
export function resolveKeyframeJumpStop(
    keyframes: VideoKeyframe[] | undefined,
    activeTime: number,
    direction: "prev" | "next",
    tolerance = 0.06
): KeyframeJumpStop | null {
    if (!keyframes?.length) return null;
    const sorted = [...keyframes].sort((a, b) => a.time - b.time);
    const stops: KeyframeJumpStop[] = [];
    for (const k of sorted) {
        if (k.easing === "snap" && k.pre?.time !== undefined && k.pre.time < k.time - 0.01) {
            stops.push({ time: k.pre.time, side: "pre" });
            stops.push({ time: k.time, side: "post" });
        } else if (k.easing === "snap") {
            stops.push({ time: k.time, side: "pre" });
        } else {
            stops.push({ time: k.time, side: "post" });
        }
    }
    stops.sort((a, b) => a.time - b.time);
    if (!stops.length) return null;
    return direction === "prev"
        ? ([...stops].reverse().find((s) => s.time < activeTime - tolerance) ?? stops[stops.length - 1] ?? null)
        : (stops.find((s) => s.time > activeTime + tolerance) ?? stops[0] ?? null);
}
