import { clamp, getDefaultVideoFraming, interpolateKeyframe, isSharedReHookScene, resolveAudioBoundaryModes, resolveSceneFade, type TimelineScene, type VideoDraft } from "@/types/news";
import { build45BoxHExpr, build45ScaleExpr, buildAudioFadeFilters, buildPosXNormExpr, buildTopOffsetYExpr, buildZoomFactorExpr } from "./ffmpegFilters";

interface SceneFilterContext {
    index: number;
    scenes: TimelineScene[];
    draft: VideoDraft;
    start: number;
    duration: number;
    width: number;
    height: number;
    targetFps: number;
    is45: boolean;
    isImage: boolean;
    srcWidth: number;
    srcHeight: number;
    srcHasAudio: boolean;
    srcIsHdr?: boolean;
    mediaIdx: number;
    overlayIdx: number;
    customLoopVideoSource: string | null;
    customLoopAudioSource: string | null;
    loopTrim: string;
    aLoopTrim: string;
}

const OV_SCALE_FLAGS = "lanczos+accurate_rnd+full_chroma_int";
const OVERLAY_OUTPUT_TAIL = "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,settb=1/90000";
const HDR_TONEMAP = ",zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p";

const snapEven = (v: number) => Math.max(2, Math.round(v / 2) * 2);

const buildAmbientSpillFilter = (
    W: number, inputPad: string, outputPad: string, cropH: number, cropY: number, blurW: number, spillH: number, preScale = ""
) => {
    const blurH = snapEven(Math.max(16, spillH / 4));
    const radius = clamp(Math.floor(Math.min(blurW, blurH) / 4), 1, 7);
    return `[${inputPad}]${preScale}crop=${W}:${cropH}:0:${cropY},vflip,scale=${blurW}:${blurH}:flags=bilinear,boxblur=${radius}:2,scale=${W}:${spillH}:flags=bilinear,eq=brightness=-0.22:saturation=1.35[${outputPad}]`;
};

/** Returns true only when scene `i` needs a multi-frame PNG fade-in animation (`fade=t=in:st=0:d=0.22:alpha=1`). */
export const isAnimatedSceneOverlay = (draft: VideoDraft, scenes: TimelineScene[], index: number): boolean =>
    draft.enableMotion !== false && index === 0 && !isSharedReHookScene(scenes, index);

/** Builds the FFmpeg filtergraph stages for a single scene (4:5 ambient spill or 9:16/16:9 full bleed, fade, overlay, audio). */
export function buildSceneFilterStages(ctx: SceneFilterContext): { filters: string[]; vMap: string; aMap: string } {
    const {
        index: i, scenes, draft, start, duration, width: W, height: H, targetFps,
        is45, isImage, srcWidth, srcHeight, srcHasAudio, srcIsHdr,
        mediaIdx, overlayIdx: ovIdx, customLoopVideoSource, customLoopAudioSource, loopTrim, aLoopTrim,
    } = ctx;

    const dur = Math.max(0.05, Number.isFinite(duration) ? duration : 0.05);
    const durStr = dur.toFixed(3);
    const safeSrcW = Number.isFinite(srcWidth) && srcWidth > 0 ? srcWidth : W;
    const safeSrcH = Number.isFinite(srcHeight) && srcHeight > 0 ? srcHeight : H;
    const matte = `color=c=#080808:s=${W}x${H}:d=${durStr}:r=${targetFps}`;

    const filters: string[] = [];
    const posXExpr = buildPosXNormExpr(draft, start, dur);
    const zoomExpr = buildZoomFactorExpr(draft, start, dur);
    const vLabel = `v_base_${i}`;
    const vInputPad = customLoopVideoSource ? `[${customLoopVideoSource}]` : `[${mediaIdx}:v]`;
    const mediaPrep = isImage
        ? `fps=${targetFps},setpts=PTS-STARTPTS`
        : `${loopTrim}fps=${targetFps},setpts=PTS-STARTPTS${srcIsHdr ? HDR_TONEMAP : ""}`;
    const kenBurns = (cropH: number) => isImage
        ? `,scale=w='ceil(iw*(1+0.04*min(1,t/${durStr}))/2)*2':h='ceil(ih*(1+0.04*min(1,t/${durStr}))/2)*2':eval=frame:flags=lanczos,crop=${W}:${cropH}:x='(iw-${W})/2':y='(ih-${cropH})/2'`
        : "";

    if (is45) {
        const hContain = Math.min(H, Math.round(W / (safeSrcW / safeSrcH)));
        const scaleFill = Math.max(1.0, H / Math.max(1, hContain));
        const scale45Info = build45ScaleExpr(draft, start, dur, scaleFill);
        const boxHInfo = build45BoxHExpr(draft, start, dur, H, hContain);
        const topYInfo = buildTopOffsetYExpr(draft, start, dur, H, hContain, true);
        const staticTopY = Math.round(topYInfo.minY);
        const needsTopSpill = topYInfo.maxY > 2;
        const blurW = snapEven(Math.max(32, W / 4));

        if (!boxHInfo.isConstant) {
            const kb = isImage ? `*(1+0.04*min(1,t/${durStr}))` : "";
            const fgScale = `scale=w='ceil(${W}*(${scale45Info.expr})${kb}/2)*2':h='ceil(${hContain}*(${scale45Info.expr})${kb}/2)*2':eval=frame:force_original_aspect_ratio=increase:flags=lanczos`;
            const fgOverlay = `overlay=x='-(w-${W})*(${posXExpr})':y='(${topYInfo.expr})-(h-(${boxHInfo.expr}))/2'`;

            if (draft.enableAmbientBlur === false) {
                filters.push(`${vInputPad}${mediaPrep},${fgScale}[fg_main_${i}]`, `${matte}[canvas_${i}]`, `[canvas_${i}][fg_main_${i}]${fgOverlay}[fg_placed_${i}]`);
                filters.push(`${matte}[bot_bar_${i}]`, `[fg_placed_${i}][bot_bar_${i}]overlay=0:'(${topYInfo.expr})+(${boxHInfo.expr})'[${needsTopSpill ? `bot_masked_${i}` : vLabel}]`);
                if (needsTopSpill) filters.push(`${matte}[top_bar_${i}]`, `[bot_masked_${i}][top_bar_${i}]overlay=0:'(${topYInfo.expr})-${H}'[${vLabel}]`);
            } else {
                const spillSrcH = Math.min(hContain, snapEven(hContain * 0.45));
                const bottomSpillH = snapEven(Math.max(2, H - Math.floor(topYInfo.minY) - Math.floor(boxHInfo.minH) + 2));
                const preScale = `scale=${W}:${hContain}:force_original_aspect_ratio=increase:flags=bilinear,`;
                filters.push(
                    `${vInputPad}${mediaPrep},split=${needsTopSpill ? 3 : 2}[fg_raw_${i}][bg_bot_raw_${i}]${needsTopSpill ? `[bg_top_raw_${i}]` : ""}`,
                    `[fg_raw_${i}]${fgScale}[fg_main_${i}]`,
                    `${matte}[canvas_${i}]`,
                    `[canvas_${i}][fg_main_${i}]${fgOverlay}[fg_placed_${i}]`,
                    buildAmbientSpillFilter(W, `bg_bot_raw_${i}`, `bg_spill_${i}`, spillSrcH, Math.max(0, hContain - spillSrcH), blurW, bottomSpillH, preScale),
                    `[fg_placed_${i}][bg_spill_${i}]overlay=0:'max(0,(${topYInfo.expr})+(${boxHInfo.expr})-2)'[${needsTopSpill ? `bg_bot_ready_${i}` : vLabel}]`,
                );
                if (needsTopSpill) {
                    const topSpillH = snapEven(Math.ceil(topYInfo.maxY) + 2);
                    filters.push(
                        buildAmbientSpillFilter(W, `bg_top_raw_${i}`, `bg_top_spill_${i}`, spillSrcH, 0, blurW, topSpillH, preScale),
                        `[bg_bot_ready_${i}][bg_top_spill_${i}]overlay=0:'(${topYInfo.expr})+2-${topSpillH}'[${vLabel}]`,
                    );
                }
            }
        } else {
            const boxH = Math.min(H, snapEven(boxHInfo.minH));
            const staticFraming = interpolateKeyframe(draft.keyframes, start + dur * 0.5, getDefaultVideoFraming(draft, draft.aspectRatio));
            const staticZFactor = Math.max(1.0, (Number.isFinite(staticFraming.zoom) ? staticFraming.zoom : 0) / 100);
            const scalePart = zoomExpr
                ? `scale=w='ceil(${W}*${zoomExpr}/2)*2':h='ceil(${boxH}*${zoomExpr}/2)*2':eval=frame:force_original_aspect_ratio=increase:flags=lanczos`
                : staticZFactor > 1.005
                    ? `scale=${snapEven(W * staticZFactor)}:${snapEven(boxH * staticZFactor)}:force_original_aspect_ratio=increase:flags=lanczos`
                    : `scale=${W}:${boxH}:force_original_aspect_ratio=increase:flags=lanczos`;
            const fgBox = `${scalePart},crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y='(ih-${boxH})/2'${kenBurns(boxH)}`;

            if (boxH < H - 2) {
                const fgOverlayY = topYInfo.isConstant ? String(staticTopY) : `'${topYInfo.expr}'`;
                if (draft.enableAmbientBlur === false) {
                    filters.push(`${vInputPad}${mediaPrep},${fgBox}[fg_main_${i}]`, `${matte}[canvas_${i}]`, `[canvas_${i}][fg_main_${i}]overlay=0:${fgOverlayY}[${vLabel}]`);
                } else {
                    const spillSrcH = Math.min(boxH, snapEven(boxH * 0.45));
                    const bottomSpillH = snapEven(Math.max(2, H - Math.floor(topYInfo.minY) - boxH + 2));
                    const botOverlayY = topYInfo.isConstant ? String(Math.max(0, staticTopY + boxH - 2)) : `'max(0,(${topYInfo.expr})+${boxH}-2)'`;
                    filters.push(
                        `${vInputPad}${mediaPrep},${fgBox},split=${needsTopSpill ? 3 : 2}[fg_main_${i}][fg_src_${i}]${needsTopSpill ? `[fg_top_src_${i}]` : ""}`,
                        buildAmbientSpillFilter(W, `fg_src_${i}`, `bg_spill_${i}`, spillSrcH, Math.max(0, boxH - spillSrcH), blurW, bottomSpillH),
                        `${matte}[canvas_${i}]`,
                        `[canvas_${i}][bg_spill_${i}]overlay=0:${botOverlayY}[bg_ready_${i}]`,
                    );
                    if (needsTopSpill) {
                        const topSpillH = snapEven(Math.ceil(topYInfo.maxY) + 2);
                        const topOverlayY = topYInfo.isConstant ? "0" : `'(${topYInfo.expr})+2-${topSpillH}'`;
                        filters.push(
                            buildAmbientSpillFilter(W, `fg_top_src_${i}`, `bg_top_spill_${i}`, spillSrcH, 0, blurW, topSpillH),
                            `[bg_ready_${i}][bg_top_spill_${i}]overlay=0:${topOverlayY}[bg_top_ready_${i}]`,
                            `[bg_top_ready_${i}][fg_main_${i}]overlay=0:${fgOverlayY}[${vLabel}]`,
                        );
                    } else {
                        filters.push(`[bg_ready_${i}][fg_main_${i}]overlay=0:${fgOverlayY}[${vLabel}]`);
                    }
                }
            } else {
                filters.push(`${vInputPad}${mediaPrep},${fgBox}[${vLabel}]`);
            }
        }
    } else if (zoomExpr) {
        filters.push(`${vInputPad}${mediaPrep},scale=w='ceil(${W}*${zoomExpr}/2)*2':h='ceil(${H}*${zoomExpr}/2)*2':eval=frame:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='(iw-${W})*${posXExpr}':y='(ih-${H})/2'${kenBurns(H)}[${vLabel}]`);
    } else {
        const framing = interpolateKeyframe(draft.keyframes, start + dur * 0.5, getDefaultVideoFraming(draft, draft.aspectRatio));
        const zFactor = Math.max(1.0, (Number.isFinite(framing.zoom) ? framing.zoom : 100) / 100);
        filters.push(`${vInputPad}${mediaPrep},scale=${snapEven(W * zFactor)}:${snapEven(H * zFactor)}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='(iw-${W})*${posXExpr}':y='(ih-${H})/2'${kenBurns(H)}[${vLabel}]`);
    }

    const { inDur, outDur } = resolveSceneFade(scenes, i);
    const fadeColor = is45 ? "#080808" : "#050505";
    const fadeParts: string[] = [];
    if (inDur > 0.01) fadeParts.push(`fade=t=in:st=0:d=${inDur.toFixed(3)}:color=${fadeColor}`);
    if (outDur > 0.01) fadeParts.push(`fade=t=out:st=${Math.max(0, dur - outDur).toFixed(3)}:d=${outDur.toFixed(3)}:color=${fadeColor}`);
    const vFaded = fadeParts.length ? `v_fad_${i}` : vLabel;
    if (fadeParts.length) filters.push(`[${vLabel}]${fadeParts.join(",")}[${vFaded}]`);

    if (isAnimatedSceneOverlay(draft, scenes, i)) {
        filters.push(
            `[${ovIdx}:v]scale=${W}:${H}:flags=${OV_SCALE_FLAGS},format=rgba,fade=t=in:st=0:d=0.22:alpha=1[ov_anim_${i}]`,
            `[${vFaded}][ov_anim_${i}]overlay=0:0:format=auto:alpha=straight,${OVERLAY_OUTPUT_TAIL}[v_sc_${i}]`,
        );
    } else {
        filters.push(
            `[${ovIdx}:v]scale=${W}:${H}:flags=${OV_SCALE_FLAGS},format=rgba[ov_sc_${i}]`,
            `[${vFaded}][ov_sc_${i}]overlay=0:0:format=auto:alpha=straight:eof_action=repeat:repeatlast=1,${OVERLAY_OUTPUT_TAIL}[v_sc_${i}]`,
        );
    }

    const aLabel = `a_sc_${i}`;
    const aInputPad = customLoopAudioSource ? `[${customLoopAudioSource}]` : `[${mediaIdx}:a]`;
    const vol = draft.isMuted ? 0 : clamp(Number.isFinite(draft.volume) ? draft.volume! : 1, 0, 1);
    if (isImage || !srcHasAudio || vol === 0) {
        filters.push(`anullsrc=r=48000:cl=stereo:d=${durStr}[${aLabel}]`);
    } else {
        const { inAudioMode, outAudioMode } = resolveAudioBoundaryModes(scenes, i, Boolean(draft.enableOutro));
        const aFades = [
            `${aLoopTrim}asetpts=PTS-STARTPTS`, `aresample=48000`, `aformat=channel_layouts=stereo`,
            ...buildAudioFadeFilters(vol, dur, inDur, outDur, inAudioMode, outAudioMode),
            `apad=whole_dur=${durStr}`, `atrim=0:${durStr}`,
        ];
        filters.push(`${aInputPad}${aFades.join(",")}[${aLabel}]`);
    }

    return { filters, vMap: `[v_sc_${i}]`, aMap: `[${aLabel}]` };
}
