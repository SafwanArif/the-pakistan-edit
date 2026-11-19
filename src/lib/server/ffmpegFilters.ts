import {
    VideoDraft,
    TimelineScene,
    SUBTITLE_FONT_OPTIONS,
    interpolateKeyframe,
    timelineTimeToMediaTime,
    wrapMediaTime,
    getDefaultSubtitleFontSize,
    findSubtitleAtMediaTime,
} from "../../types/news";

const formatAssTime = (sec: number): string => {
    const clamped = Math.max(0, sec);
    const csTotal = Math.round(clamped * 100);
    const h = Math.floor(csTotal / 360000);
    const m = Math.floor((csTotal % 360000) / 6000);
    const s = Math.floor((csTotal % 6000) / 100);
    const cs = csTotal % 100;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
};

const escapeAssText = (text: string): string =>
    text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");

/** Escapes a local file path for FFmpeg's `ass=` filter argument (cross-platform Windows/POSIX). */
export const escapeFfmpegFilterPath = (filePath: string): string =>
    filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

/**
 * Builds an exact piecewise FFmpeg `t` expression across keyframe intervals in a scene.
 * Preserves instant 1-frame snap/cut discontinuities (`if(lt(t, cutTime), prev, next)`)
 * while smoothly subdividing cosine-eased glides.
 */
const buildPiecewiseKeyframeExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number,
    selectValue: (f: { zoom: number; posX: number; posY: number }) => number,
    minDelta: number
): { isConstant: boolean; expr: string } => {
    const fallback = { zoom: draft.zoom, posX: draft.posX, posY: draft.posY };
    const boundaries: number[] = [0];
    const sortedKfs = [...(draft.keyframes || [])].sort((a, b) => a.time - b.time);
    for (const kf of sortedKfs) {
        if (kf.easing === 'snap' && kf.pre?.time !== undefined && kf.pre.time < kf.time) {
            const preLocalT = kf.pre.time - sceneStart;
            if (preLocalT > 0.001 && preLocalT < dur - 0.001 && preLocalT - boundaries[boundaries.length - 1]! > 0.001) {
                boundaries.push(preLocalT);
            }
        }
        const localT = kf.time - sceneStart;
        if (localT > 0.001 && localT < dur - 0.001) {
            if (localT - boundaries[boundaries.length - 1]! > 0.001) {
                boundaries.push(localT);
            }
        }
    }
    boundaries.push(dur);

    const segments: { start: number; end: number; expr: string; minV: number; maxV: number }[] = [];
    for (let i = 0; i < boundaries.length - 1; i++) {
        const aT = boundaries[i]!;
        const bT = boundaries[i + 1]!;
        const span = Math.max(0.001, bT - aT);
        const startVal = selectValue(interpolateKeyframe(draft.keyframes, sceneStart + aT + Math.min(0.0005, span * 0.1), fallback));
        const endVal = selectValue(interpolateKeyframe(draft.keyframes, sceneStart + bT - Math.min(0.0005, span * 0.1), fallback));

        if (Math.abs(endVal - startVal) < 0.0005) {
            segments.push({ start: aT, end: bT, expr: startVal.toFixed(4), minV: startVal, maxV: startVal });
            continue;
        }

        const subSamples = 4;
        for (let s = 0; s < subSamples; s++) {
            const subA = aT + (span * s) / subSamples;
            const subB = aT + (span * (s + 1)) / subSamples;
            const subDt = Math.max(0.001, subB - subA);
            const vA = s === 0 ? startVal : selectValue(interpolateKeyframe(draft.keyframes, sceneStart + subA, fallback));
            const vB = s === subSamples - 1 ? endVal : selectValue(interpolateKeyframe(draft.keyframes, sceneStart + subB, fallback));
            const segExpr = Math.abs(vB - vA) < 0.0005
                ? vA.toFixed(4)
                : `(${vA.toFixed(4)}+(${(vB - vA).toFixed(4)})*(t-${subA.toFixed(3)})/${subDt.toFixed(3)})`;
            segments.push({ start: subA, end: subB, expr: segExpr, minV: Math.min(vA, vB), maxV: Math.max(vA, vB) });
        }
    }

    const globalMin = Math.min(...segments.map((s) => s.minV));
    const globalMax = Math.max(...segments.map((s) => s.maxV));
    const endVal = selectValue(interpolateKeyframe(draft.keyframes, sceneStart + dur, fallback));
    if (globalMax - globalMin < minDelta && Math.abs(endVal - globalMin) < minDelta) {
        return { isConstant: true, expr: segments[0]!.expr };
    }

    let expr = endVal.toFixed(4);
    for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i]!;
        if (i === segments.length - 1 && Math.abs(seg.maxV - seg.minV) < 0.0005 && Math.abs(endVal - seg.minV) < 0.0005) {
            expr = seg.expr;
            continue;
        }
        expr = `if(lt(t,${seg.end.toFixed(3)}),${seg.expr},${expr})`;
    }
    return { isConstant: false, expr };
};

/**
 * Builds a piecewise FFmpeg `t` expression for `posXNorm` (`0..1`) across a scene
 * when keyframes move horizontally, or a static decimal string when constant.
 */
export const buildPosXNormExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number
): string => buildPiecewiseKeyframeExpr(
    draft,
    sceneStart,
    dur,
    (f) => Math.max(0, Math.min(1, (f.posX ?? 50) / 100)),
    0.003
).expr;

/**
 * Builds a piecewise FFmpeg `t` expression for `zoomFactor` (`>= 1.0`) when zoom keyframes
 * vary across a 9:16/1:1 scene, or returns `null` when zoom is constant.
 */
export const buildZoomFactorExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number
): string | null => {
    const res = buildPiecewiseKeyframeExpr(
        draft,
        sceneStart,
        dur,
        (f) => Math.max(1.0, (f.zoom ?? 100) / 100),
        0.005
    );
    return res.isConstant ? null : res.expr;
};

/**
 * Generates an `.ass` subtitle script aligned to the exported timeline's exact scene boundaries
 * and `showSubtitles` / `subtitlePosition` / `subtitleFontSize` settings.
 */
export const buildAssSubtitles = (
    draft: VideoDraft,
    scenes: TimelineScene[],
    bounds: { start: number; end: number }[],
    W: number,
    H: number,
    is45: boolean,
    is916: boolean,
    masterDuration: number
): string | null => {
    const subs = draft.subtitles || [];
    if (!subs.length) return null;

    const ccPos = draft.subtitlePosition || "bottom";
    const fontSize = draft.subtitleFontSize ?? getDefaultSubtitleFontSize(draft.aspectRatio);
    const fontName = SUBTITLE_FONT_OPTIONS[draft.subtitleFont || "plus-jakarta"]?.assName || "Plus Jakarta Sans";
    const marginV = is45
        ? (ccPos === "high" ? 255 : ccPos === "middle" ? 185 : 115)
        : (is916
            ? (ccPos === "high" ? 435 : ccPos === "middle" ? 340 : 245)
            : (ccPos === "high" ? 280 : ccPos === "middle" ? 215 : 150));
    const backdrop = draft.subtitleBackdrop || "pill";
    const assStyle = backdrop === "none"
        ? `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H80000000,&H00000000,-1,0,0,0,100,100,0.4,0,1,1,0.5,2,60,140,${marginV},1`
        : backdrop === "shadow"
            ? `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H20000000,&H90000000,-1,0,0,0,100,100,0.4,0,1,2.6,2.2,2,60,140,${marginV},1`
            : backdrop === "glass"
                ? `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H78080808,&H78080808,-1,0,0,0,100,100,0.4,0,3,14,0,2,60,140,${marginV},1`
                : `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,&H24080808,&HC8080808,-1,0,0,0,100,100,0.4,0,3,14,0,2,60,140,${marginV},1`;

    const events: string[] = [];
    const step = 0.1;

    for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i]!;
        const b = bounds[i]!;
        const captionsOn = sc.showSubtitles ?? (draft.showSubtitles !== false);
        if (!captionsOn) continue;

        let activeText = "";
        let cueStart = b.start;

        for (let t = b.start; t <= b.end + 0.001; t += step) {
            const clampedT = Math.min(b.end, t);
            const hasCustomMedia = Boolean(sc.mediaUrl) || sc.mediaType === "image";
            const mediaT = hasCustomMedia
                ? (sc.clipStartOffset ?? 0) + (clampedT - b.start)
                : (masterDuration > 0
                    ? wrapMediaTime(draft, clampedT, masterDuration)
                    : timelineTimeToMediaTime(draft, clampedT));
            const seg = clampedT < b.end ? findSubtitleAtMediaTime(subs, mediaT) : undefined;
            const nextText = seg?.text.trim() || "";

            if (nextText !== activeText) {
                if (activeText && clampedT - cueStart >= 0.08) {
                    events.push(`Dialogue: 0,${formatAssTime(cueStart)},${formatAssTime(clampedT)},Default,,0,0,0,,${escapeAssText(activeText)}`);
                }
                activeText = nextText;
                cueStart = clampedT;
            }
        }
    }

    if (!events.length) return null;

    return [
        "[Script Info]",
        "ScriptType: v4.00+",
        `PlayResX: ${W}`,
        `PlayResY: ${H}`,
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        assStyle,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ...events,
        "",
    ].join("\n");
};

export type AudioBoundaryFadeMode = "full" | "breath" | "declick" | "none";

/**
 * Builds FFmpeg audio fade filters:
 * - `'full'`: equal-power `afade=curve=hsin` (`0.0 <-> 1.0`) for timeline start/end or silent neighbors
 * - `'breath'`: raised-cosine `-12 dB` (`0.25`) J-cut breath dip across symmetric internal boundaries
 * - `'declick'`: 15ms `afade=curve=hsin` micro-ramp preventing waveform splice pops on hard cuts
 */
export const buildAudioFadeFilters = (
    vol: number,
    dur: number,
    inDur: number,
    outDur: number,
    inMode: AudioBoundaryFadeMode,
    outMode: AudioBoundaryFadeMode
): string[] => {
    const filters: string[] = [`volume=${vol.toFixed(3)}`];

    if (inMode === "full" && inDur > 0.01) {
        filters.push(`afade=t=in:st=0:d=${inDur.toFixed(3)}:curve=hsin`);
    } else if (inMode === "breath" && inDur > 0.01) {
        filters.push(`volume='0.25+0.75*(1-pow(0.5*(1+cos(PI*min(1,t/${inDur.toFixed(3)}))),2))':eval=frame:enable='lt(t,${inDur.toFixed(3)})'`);
    } else if (inMode === "declick" && dur > 0.05) {
        filters.push(`afade=t=in:st=0:d=0.015:curve=hsin`);
    }

    if (outMode === "full" && outDur > 0.01) {
        const outStart = Math.max(0, dur - outDur);
        filters.push(`afade=t=out:st=${outStart.toFixed(3)}:d=${outDur.toFixed(3)}:curve=hsin`);
    } else if (outMode === "breath" && outDur > 0.01) {
        const outStart = Math.max(0, dur - outDur);
        filters.push(`volume='0.25+0.75*(1-pow(0.5*(1-cos(PI*max(0,min(1,(t-${outStart.toFixed(3)})/${outDur.toFixed(3)})))),2))':eval=frame:enable='gte(t,${outStart.toFixed(3)})'`);
    } else if (outMode === "declick" && dur > 0.05) {
        filters.push(`afade=t=out:st=${Math.max(0, dur - 0.015).toFixed(3)}:d=0.015:curve=hsin`);
    }

    return filters;
};
