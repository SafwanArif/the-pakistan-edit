import {
    AudioBoundaryFadeMode, clamp, VideoDraft, TimelineScene, SUBTITLE_FONT_OPTIONS,
    getTopBoxOffsetY, interpolateKeyframe, resolveKeyframeSpan, getDefaultSubtitleFontSize, getDefaultVideoFraming,
} from "@/types/news";
import { projectSubtitlesToTimeline } from "@/utils/subtitleTimeline";

const formatAssTime = (sec: number): string => {
    const csTotal = Math.round((Number.isFinite(sec) ? Math.max(0, sec) : 0) * 100);
    const h = Math.floor(csTotal / 360000);
    const m = Math.floor((csTotal % 360000) / 6000);
    const s = Math.floor((csTotal % 6000) / 100);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(csTotal % 100).padStart(2, "0")}`;
};

const escapeAssText = (text: string): string =>
    text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");

/** Escapes a local file path for FFmpeg's `ass=` filter argument (cross-platform Windows/POSIX). */
export const escapeFfmpegFilterPath = (filePath: string): string =>
    filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

const compute45BoxHeight = (zoom: number | undefined, canvasH: number, hContain: number): number =>
    Math.min(canvasH, hContain + (clamp(Number.isFinite(zoom) ? zoom! : 0, 0, 100) / 100) * (canvasH - hContain));

/** Builds an exact piecewise FFmpeg `t` expression across keyframe intervals in a scene. */
const buildPiecewiseKeyframeExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number,
    selectValue: (f: { zoom: number; posX: number; posY: number }) => number,
    minDelta: number
): { isConstant: boolean; expr: string; minV: number; maxV: number } => {
    const safeDur = Number.isFinite(dur) && dur > 0 ? dur : 0.001;
    const fallback = getDefaultVideoFraming(draft, draft.aspectRatio);
    const boundaries: number[] = [0];
    const sortedKfs = (draft.keyframes || []).filter((kf) => Number.isFinite(kf.time)).sort((a, b) => a.time - b.time);

    const pushBoundary = (localT: number) => {
        if (localT > 0.001 && localT < safeDur - 0.001 && localT - boundaries[boundaries.length - 1]! > 0.001) {
            boundaries.push(localT);
        }
    };
    for (const kf of sortedKfs) {
        if (kf.easing === 'snap' && kf.pre?.time !== undefined && Number.isFinite(kf.pre.time) && kf.pre.time < kf.time) {
            pushBoundary(kf.pre.time - sceneStart);
        }
        pushBoundary(kf.time - sceneStart);
    }
    boundaries.push(safeDur);

    const segments: { end: number; expr: string; minV: number; maxV: number; isConst: boolean }[] = [];
    let globalMin = Infinity;
    let globalMax = -Infinity;

    for (let i = 0; i < boundaries.length - 1; i++) {
        const aT = boundaries[i]!;
        const bT = boundaries[i + 1]!;
        const span = Math.max(0.001, bT - aT);
        const startVal = selectValue(interpolateKeyframe(sortedKfs, sceneStart + aT + Math.min(0.0005, span * 0.1), fallback));
        const endVal = selectValue(interpolateKeyframe(sortedKfs, sceneStart + bT - Math.min(0.0005, span * 0.1), fallback));
        const isConst = Math.abs(endVal - startVal) < 0.0005;

        let expr: string;
        if (isConst) {
            expr = startVal.toFixed(4);
        } else {
            const resolved = resolveKeyframeSpan(sortedKfs, sceneStart + (aT + bT) * 0.5, fallback);
            const gStartVal = resolved.kind === 'glide' ? selectValue(resolved.start) : startVal;
            const gEndVal = resolved.kind === 'glide' ? selectValue(resolved.end) : endVal;
            if (resolved.kind === 'glide' && Math.abs(gEndVal - gStartVal) >= 0.0005) {
                const gSpan = Math.max(0.001, resolved.gEnd - resolved.gStart);
                expr = `(${gStartVal.toFixed(4)}+(${(gEndVal - gStartVal).toFixed(4)})*0.5*(1-cos(PI*(t+(${(sceneStart - resolved.gStart).toFixed(4)}))/${gSpan.toFixed(4)})))`;
            } else {
                expr = `(${startVal.toFixed(4)}+(${(endVal - startVal).toFixed(4)})*0.5*(1-cos(PI*(t-${aT.toFixed(4)})/${span.toFixed(4)})))`;
            }
        }
        const minV = isConst ? startVal : Math.min(startVal, endVal);
        const maxV = isConst ? startVal : Math.max(startVal, endVal);
        if (minV < globalMin) globalMin = minV;
        if (maxV > globalMax) globalMax = maxV;

        const prev = segments[segments.length - 1];
        if (isConst && prev?.isConst && prev.expr === expr) prev.end = bT;
        else segments.push({ end: bT, expr, minV, maxV, isConst });
    }

    const endVal = selectValue(interpolateKeyframe(sortedKfs, sceneStart + safeDur, fallback));
    if (globalMax - globalMin < minDelta && Math.abs(endVal - globalMin) < minDelta) {
        return { isConstant: true, expr: segments[0]!.expr, minV: globalMin, maxV: globalMax };
    }

    let expr = endVal.toFixed(4);
    for (let i = segments.length - 1; i >= 0; i--) {
        const seg = segments[i]!;
        if (i === segments.length - 1 && seg.isConst && Math.abs(endVal - seg.minV) < 0.0005) { expr = seg.expr; continue; }
        expr = `if(lt(t,${seg.end.toFixed(3)}),${seg.expr},${expr})`;
    }
    return { isConstant: false, expr, minV: Math.min(globalMin, endVal), maxV: Math.max(globalMax, endVal) };
};

/** Builds a piecewise FFmpeg `t` expression for `posXNorm` (`0..1`) across a scene. */
export const buildPosXNormExpr = (draft: VideoDraft, sceneStart: number, dur: number): string =>
    buildPiecewiseKeyframeExpr(draft, sceneStart, dur, (f) => clamp((Number.isFinite(f.posX) ? f.posX : 50) / 100, 0, 1), 0.003).expr;

/** Builds a piecewise FFmpeg `t` expression for `zoomFactor` (`>= 1.0`), or `null` when constant. */
export const buildZoomFactorExpr = (draft: VideoDraft, sceneStart: number, dur: number): string | null => {
    const res = buildPiecewiseKeyframeExpr(draft, sceneStart, dur, (f) => Math.max(1.0, (Number.isFinite(f.zoom) ? f.zoom : 100) / 100), 0.005);
    return res.isConstant ? null : res.expr;
};

/** Builds a piecewise FFmpeg `t` expression for 4:5 effective scale (`>= 1.0`) across `0%..200%` zooms. */
export const build45ScaleExpr = (draft: VideoDraft, sceneStart: number, dur: number, scaleFill: number) =>
    buildPiecewiseKeyframeExpr(draft, sceneStart, dur, (f) => {
        const z = clamp(Number.isFinite(f.zoom) ? f.zoom : 0, 0, 200);
        return (1.0 + (Math.min(100, z) / 100) * (scaleFill - 1.0)) * (z > 100 ? z / 100 : 1);
    }, 0.005);

/** Builds a piecewise FFmpeg `t` expression for 4:5 letterbox container height (`hContain..canvasH`). */
export const build45BoxHExpr = (draft: VideoDraft, sceneStart: number, dur: number, canvasH: number, hContain: number) => {
    const res = buildPiecewiseKeyframeExpr(draft, sceneStart, dur, (f) => compute45BoxHeight(f.zoom, canvasH, hContain), 0.5);
    return { isConstant: res.isConstant, expr: res.expr, minH: res.minV, maxH: res.maxV };
};

/** Builds an exact FFmpeg `t` expression for 4:5 vertical `topOffsetY` (px) and its `[minY, maxY]` range. */
export const buildTopOffsetYExpr = (draft: VideoDraft, sceneStart: number, dur: number, canvasH: number, boxHOrContainH: number, dynamic45 = false) => {
    const res = buildPiecewiseKeyframeExpr(draft, sceneStart, dur, (f) => {
        const boxH = dynamic45 ? compute45BoxHeight(f.zoom, canvasH, boxHOrContainH) : boxHOrContainH;
        return getTopBoxOffsetY(f.posY, canvasH, boxH);
    }, 0.5);
    return { isConstant: res.isConstant, expr: res.expr, minY: res.minV, maxY: res.maxV };
};

const ASS_MARGIN_V = {
    "4:5": { bottom: 115, middle: 185, high: 255 },
    "9:16": { bottom: 245, middle: 340, high: 435 },
    "16:9": { bottom: 150, middle: 215, high: 280 },
} as const;

const ASS_BACKDROP_PRESETS: Record<string, readonly [string, string, number, number, number]> = {
    none: ["&H80000000", "&H00000000", 1, 1, 0.5],
    shadow: ["&H20000000", "&H90000000", 1, 2.6, 2.2],
    glass: ["&H78080808", "&H78080808", 3, 14, 0],
    pill: ["&H24080808", "&HC8080808", 3, 14, 0],
};

/** Generates an `.ass` subtitle script aligned to exported timeline scene boundaries. */
export const buildAssSubtitles = (
    draft: VideoDraft, scenes: TimelineScene[], bounds: { start: number; end: number }[],
    W: number, H: number, is45: boolean, is916: boolean, masterDuration: number
): string | null => {
    if (!draft.subtitles?.length) return null;
    const projected = projectSubtitlesToTimeline(draft, { scenes, bounds, masterDuration, minCueDuration: 0.08 });
    if (!projected.length) return null;

    const ccPos = draft.subtitlePosition === "high" || draft.subtitlePosition === "middle" ? draft.subtitlePosition : "bottom";
    const marginV = ASS_MARGIN_V[is45 ? "4:5" : is916 ? "9:16" : "16:9"][ccPos];
    const rawFontSize = draft.subtitleFontSize;
    const fontSize = rawFontSize !== undefined && Number.isFinite(rawFontSize) && rawFontSize > 0
        ? Math.round(rawFontSize)
        : getDefaultSubtitleFontSize(draft.aspectRatio);
    const fontName = SUBTITLE_FONT_OPTIONS[draft.subtitleFont || "plus-jakarta"]?.assName || "Plus Jakarta Sans";
    const [outlineColor, backColor, borderStyle, outline, shadow] =
        ASS_BACKDROP_PRESETS[draft.subtitleBackdrop || "pill"] ?? ASS_BACKDROP_PRESETS.pill!;
    const playResX = Number.isFinite(W) && W > 0 ? Math.round(W) : 1080;
    const playResY = Number.isFinite(H) && H > 0 ? Math.round(H) : 1920;

    return [
        "[Script Info]",
        "ScriptType: v4.00+",
        `PlayResX: ${playResX}`,
        `PlayResY: ${playResY}`,
        "WrapStyle: 2",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        `Style: Default,${fontName},${fontSize},&H00FFFFFF,&H00FFFFFF,${outlineColor},${backColor},-1,0,0,0,100,100,0.4,0,${borderStyle},${outline},${shadow},2,60,140,${marginV},1`,
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
        ...projected.map((cue) => `Dialogue: 0,${formatAssTime(cue.start)},${formatAssTime(cue.end)},Default,,0,0,0,,${escapeAssText(cue.text)}`),
        "",
    ].join("\n");
};

/** Builds FFmpeg audio fade filters (`full` equal-power hsin, `breath` -12dB J-cut dip, `declick` 15ms micro-ramp). */
export const buildAudioFadeFilters = (
    vol: number, dur: number, inDur: number, outDur: number,
    inMode: AudioBoundaryFadeMode, outMode: AudioBoundaryFadeMode
): string[] => {
    const safeVol = Number.isFinite(vol) ? clamp(vol, 0, 2) : 1;
    const safeDur = Number.isFinite(dur) && dur > 0 ? dur : 0;
    const safeIn = Number.isFinite(inDur) && inDur > 0 ? inDur : 0;
    const safeOut = Number.isFinite(outDur) && outDur > 0 ? outDur : 0;
    const filters: string[] = Math.abs(safeVol - 1) >= 0.001 ? [`volume=${safeVol.toFixed(3)}`] : [];

    if (inMode === "full" && safeIn > 0.01) {
        filters.push(`afade=t=in:st=0:d=${safeIn.toFixed(3)}:curve=hsin`);
    } else if (inMode === "breath" && safeIn > 0.01) {
        filters.push(`volume='0.25+0.75*(1-pow(0.5*(1+cos(PI*min(1,t/${safeIn.toFixed(3)}))),2))':eval=frame:enable='lt(t,${safeIn.toFixed(3)})'`);
    } else if (inMode === "declick" && safeDur > 0.05) {
        filters.push(`afade=t=in:st=0:d=0.015:curve=hsin`);
    }

    if (outMode === "full" && safeOut > 0.01) {
        filters.push(`afade=t=out:st=${Math.max(0, safeDur - safeOut).toFixed(3)}:d=${safeOut.toFixed(3)}:curve=hsin`);
    } else if (outMode === "breath" && safeOut > 0.01) {
        const outStart = Math.max(0, safeDur - safeOut).toFixed(3);
        filters.push(`volume='0.25+0.75*(1-pow(0.5*(1-cos(PI*max(0,min(1,(t-${outStart})/${safeOut.toFixed(3)})))),2))':eval=frame:enable='gte(t,${outStart})'`);
    } else if (outMode === "declick" && safeDur > 0.05) {
        filters.push(`afade=t=out:st=${Math.max(0, safeDur - 0.015).toFixed(3)}:d=0.015:curve=hsin`);
    }

    return filters;
};
