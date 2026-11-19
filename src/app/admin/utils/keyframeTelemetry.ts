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

/** Returns continuous camera-state tint for the live framing telemetry pill. */
export function getKeyframeTelemetryTint(
    keyframes: VideoKeyframe[] | undefined,
    time: number,
    editSide: "pre" | "post",
    parkedIndex: number,
    preSorted = false
): TelemetryTint {
    if (!keyframes?.length) return NEUTRAL;
    const sorted = preSorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time);

    if (parkedIndex >= 0 && keyframes[parkedIndex]?.easing === "snap" && editSide === "pre") {
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
                const pct = Math.round(clamp((time - prev.time) / span, 0, 1) * 100);
                return makeTint(`color-mix(in oklch, var(--ui-accent) ${pct}%, ${PRE_COLOR})`);
            }
            return makeTint("var(--ui-accent)");
        }
    }

    return makeTint("var(--ui-accent)");
}
