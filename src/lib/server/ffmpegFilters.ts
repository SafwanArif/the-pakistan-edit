import {
    VideoDraft,
    VideoKeyframe,
    TimelineScene,
    SUBTITLE_FONT_OPTIONS,
    getTopBoxOffsetY,
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

/** Resolves the global cosine glide interval `[gStart, gEnd, vStart, vEnd]` containing `globalT`, or `null` if constant. */
const resolveGlobalGlideSpan = (
    sortedKfs: VideoKeyframe[],
    globalT: number,
    fallback: { zoom?: number; posX?: number; posY?: number },
    selectValue: (f: { zoom: number; posX: number; posY: number }) => number
): { gStart: number; gEnd: number; vStart: number; vEnd: number } | null => {
    if (!sortedKfs.length) return null;
    const fb = { zoom: fallback.zoom ?? 100, posX: fallback.posX ?? 50, posY: fallback.posY ?? 100 };
    if (globalT >= sortedKfs[sortedKfs.length - 1]!.time) return null;

    let prev: VideoKeyframe = { id: '__base__', time: 0, ...fb };
    let next = sortedKfs[0]!;
    if (globalT < next.time) {
        if ((next.easing === 'snap' && next.pre) || next.time <= 0) return null;
    } else {
        for (let i = 0; i < sortedKfs.length - 1; i++) {
            if (globalT >= sortedKfs[i]!.time && globalT < sortedKfs[i + 1]!.time) {
                prev = sortedKfs[i]!;
                next = sortedKfs[i + 1]!;
                break;
            }
        }
    }

    if (next.easing === 'snap' && !next.pre) return null;
    const prevFraming = { zoom: prev.zoom, posX: prev.posX, posY: prev.posY ?? fb.posY };
    if (next.easing === 'snap' && next.pre) {
        const preTime = next.pre.time !== undefined
            ? Math.min(next.time, Math.max(prev.time, next.pre.time))
            : next.time;
        if (globalT >= preTime || preTime <= prev.time) return null;
        return {
            gStart: prev.time,
            gEnd: preTime,
            vStart: selectValue(prevFraming),
            vEnd: selectValue({ zoom: next.pre.zoom, posX: next.pre.posX, posY: next.pre.posY ?? fb.posY }),
        };
    }

    if (next.time <= prev.time) return null;
    return {
        gStart: prev.time,
        gEnd: next.time,
        vStart: selectValue(prevFraming),
        vEnd: selectValue({ zoom: next.zoom, posX: next.posX, posY: next.posY ?? fb.posY }),
    };
};

/**
 * Builds an exact piecewise FFmpeg `t` expression across keyframe intervals in a scene.
 * Preserves instant 1-frame snap/cut discontinuities (`if(lt(t, cutTime), prev, next)`)
 * and emits FFmpeg's native exact cosine curve with global phase continuity across scene cuts.
 */
const buildPiecewiseKeyframeExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number,
    selectValue: (f: { zoom: number; posX: number; posY: number }) => number,
    minDelta: number
): { isConstant: boolean; expr: string; minV: number; maxV: number } => {
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

        const midGlobal = sceneStart + (aT + bT) * 0.5;
        const glide = resolveGlobalGlideSpan(sortedKfs, midGlobal, fallback, selectValue);
        const segExpr = glide && Math.abs(glide.vEnd - glide.vStart) >= 0.0005
            ? `(${glide.vStart.toFixed(4)}+(${(glide.vEnd - glide.vStart).toFixed(4)})*0.5*(1-cos(PI*(t+(${(sceneStart - glide.gStart).toFixed(4)}))/${(glide.gEnd - glide.gStart).toFixed(4)})))`
            : `(${startVal.toFixed(4)}+(${(endVal - startVal).toFixed(4)})*0.5*(1-cos(PI*(t-${aT.toFixed(4)})/${span.toFixed(4)})))`;
        segments.push({ start: aT, end: bT, expr: segExpr, minV: Math.min(startVal, endVal), maxV: Math.max(startVal, endVal) });
    }

    const globalMin = Math.min(...segments.map((s) => s.minV));
    const globalMax = Math.max(...segments.map((s) => s.maxV));
    const endVal = selectValue(interpolateKeyframe(draft.keyframes, sceneStart + dur, fallback));
    if (globalMax - globalMin < minDelta && Math.abs(endVal - globalMin) < minDelta) {
        return { isConstant: true, expr: segments[0]!.expr, minV: globalMin, maxV: globalMax };
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
    return { isConstant: false, expr, minV: Math.min(globalMin, endVal), maxV: Math.max(globalMax, endVal) };
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
 * Builds a piecewise FFmpeg `t` expression for 4:5 effective scale (`>= 1.0`) across `0%..200%` zooms,
 * matching `useSmoothFramingLoop`'s `(1 + t*(scaleFill - 1)) * punchScale`.
 */
export const build45ScaleExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number,
    scaleFill: number
): { isConstant: boolean; expr: string; minV: number; maxV: number } =>
    buildPiecewiseKeyframeExpr(
        draft,
        sceneStart,
        dur,
        (f) => {
            const z = Math.min(200, Math.max(0, f.zoom ?? 0));
            const tz = Math.min(100, z) / 100;
            const punch = z > 100 ? z / 100 : 1;
            return (1.0 + tz * (scaleFill - 1.0)) * punch;
        },
        0.005
    );

/**
 * Builds a piecewise FFmpeg `t` expression for 4:5 letterbox container height (`hContain..canvasH`)
 * across `0%..100%` zooms.
 */
export const build45BoxHExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number,
    canvasH: number,
    hContain: number
): { isConstant: boolean; expr: string; minH: number; maxH: number } => {
    const res = buildPiecewiseKeyframeExpr(
        draft,
        sceneStart,
        dur,
        (f) => {
            const tz = Math.min(100, Math.max(0, f.zoom ?? 0)) / 100;
            return Math.min(canvasH, hContain + tz * (canvasH - hContain));
        },
        0.5
    );
    return { isConstant: res.isConstant, expr: res.expr, minH: res.minV, maxH: res.maxV };
};

/**
 * Builds an exact FFmpeg `t` expression for 4:5 vertical `topOffsetY` (px) across a scene,
 * returning both the expression and `[minY, maxY]` range for ambient spill buffer sizing.
 * When `dynamic45` is true, `boxHOrContainH` is treated as `hContain` and per-keyframe `boxH(zoom)` is computed dynamically.
 */
export const buildTopOffsetYExpr = (
    draft: VideoDraft,
    sceneStart: number,
    dur: number,
    canvasH: number,
    boxHOrContainH: number,
    dynamic45 = false
): { isConstant: boolean; expr: string; minY: number; maxY: number } => {
    const res = buildPiecewiseKeyframeExpr(
        draft,
        sceneStart,
        dur,
        (f) => {
            const boxH = dynamic45
                ? Math.min(canvasH, boxHOrContainH + (Math.min(100, Math.max(0, f.zoom ?? 0)) / 100) * (canvasH - boxHOrContainH))
                : boxHOrContainH;
            return getTopBoxOffsetY(f.posY, canvasH, boxH);
        },
        0.5
    );
    return { isConstant: res.isConstant, expr: res.expr, minY: res.minV, maxY: res.maxV };
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
    const step = 0.02;

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
