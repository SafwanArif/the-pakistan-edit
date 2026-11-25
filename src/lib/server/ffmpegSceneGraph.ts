import { clamp, getDefaultVideoFraming, interpolateKeyframe, isSharedReHookScene, resolveAudioBoundaryModes, resolveSceneFade, type TimelineScene, type VideoDraft } from "../../types/news";
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

/** Returns true only when scene `i` needs a multi-frame PNG fade-in animation (`fade=t=in:st=0:d=0.22:alpha=1`). */
export const isAnimatedSceneOverlay = (draft: VideoDraft, scenes: TimelineScene[], index: number): boolean =>
    draft.enableMotion !== false && index === 0 && !isSharedReHookScene(scenes, index);

/** Builds the FFmpeg filtergraph stages for a single scene (4:5 ambient spill or 9:16/16:9 full bleed, fade, overlay, audio). */
export function buildSceneFilterStages(ctx: SceneFilterContext): { filters: string[]; vMap: string; aMap: string } {
    const {
        index: i, scenes, draft, start, duration: dur, width: W, height: H, targetFps,
        is45, isImage, srcWidth, srcHeight, srcHasAudio, srcIsHdr,
        mediaIdx, overlayIdx: ovIdx, customLoopVideoSource, customLoopAudioSource, loopTrim, aLoopTrim,
    } = ctx;

    const snapEven = (v: number) => Math.max(2, Math.round(v / 2) * 2);
    const buildAmbientSpillFilter = (
        inputPad: string,
        outputPad: string,
        cropH: number,
        cropY: number,
        blurW: number,
        spillH: number,
        preScale = ""
    ) => {
        const blurH = snapEven(Math.max(16, spillH / 4));
        const radius = Math.max(1, Math.min(7, Math.floor(Math.min(blurW, blurH) / 4)));
        return `[${inputPad}]${preScale}crop=${W}:${cropH}:0:${cropY},vflip,scale=${blurW}:${blurH}:flags=bilinear,boxblur=${radius}:2,scale=${W}:${spillH}:flags=bilinear,eq=brightness=-0.22:saturation=1.35[${outputPad}]`;
    };
    const filters: string[] = [];
    const posXExpr = buildPosXNormExpr(draft, start, dur);
    const zoomExpr = buildZoomFactorExpr(draft, start, dur);
    const vLabel = `v_base_${i}`;
    const vInputPad = customLoopVideoSource ? `[${customLoopVideoSource}]` : `[${mediaIdx}:v]`;
    const hdrTonemap = srcIsHdr
        ? ",zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable:desat=0,zscale=p=bt709:t=bt709:m=bt709:r=tv,format=yuv420p"
        : "";
    const mediaPrep = isImage
        ? `fps=${targetFps},setpts=PTS-STARTPTS`
        : `${loopTrim}fps=${targetFps},setpts=PTS-STARTPTS${hdrTonemap}`;
    const kenBurns45 = (boxH: number) => isImage
        ? `,scale=w='ceil(iw*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':h='ceil(ih*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':eval=frame:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})/2':y='(ih-${boxH})/2'`
        : '';
    const kenBurnsFull = isImage
        ? `,scale=w='ceil(iw*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':h='ceil(ih*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':eval=frame:flags=lanczos,crop=${W}:${H}:x='(iw-${W})/2':y='(ih-${H})/2'`
        : '';

    if (is45) {
        const vAR = srcWidth / Math.max(1, srcHeight);
        const hContain = Math.min(H, Math.round(W / vAR));
        const scaleFill = Math.max(1.0, H / Math.max(1, hContain));
        const scale45Info = build45ScaleExpr(draft, start, dur, scaleFill);
        const boxHInfo = build45BoxHExpr(draft, start, dur, H, hContain);
        const topYInfo = buildTopOffsetYExpr(draft, start, dur, H, hContain, true);
        const staticTopY = Math.round(topYInfo.minY);
        const needsTopSpill = topYInfo.maxY > 2;

        if (!boxHInfo.isConstant) {
            const kenBurnsFactor = isImage ? `*(1+0.04*min(1,t/${dur.toFixed(3)}))` : '';
            const fgScaleW = `ceil(${W}*(${scale45Info.expr})${kenBurnsFactor}/2)*2`;
            const fgScaleH = `ceil(${hContain}*(${scale45Info.expr})${kenBurnsFactor}/2)*2`;
            const fgOverlayX = `-(w-${W})*(${posXExpr})`;
            const fgOverlayY = `(${topYInfo.expr})-(h-(${boxHInfo.expr}))/2`;
            const blurW = snapEven(Math.max(32, W / 4));

            if (draft.enableAmbientBlur === false) {
                filters.push(`${vInputPad}${mediaPrep},scale=w='${fgScaleW}':h='${fgScaleH}':eval=frame:force_original_aspect_ratio=increase:flags=lanczos[fg_main_${i}]`);
                filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[canvas_${i}]`);
                filters.push(`[canvas_${i}][fg_main_${i}]overlay=x='${fgOverlayX}':y='${fgOverlayY}'[fg_placed_${i}]`);
                filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[bot_bar_${i}]`);
                filters.push(`[fg_placed_${i}][bot_bar_${i}]overlay=0:'(${topYInfo.expr})+(${boxHInfo.expr})'[${needsTopSpill ? `bot_masked_${i}` : vLabel}]`);
                if (needsTopSpill) {
                    filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[top_bar_${i}]`);
                    filters.push(`[bot_masked_${i}][top_bar_${i}]overlay=0:'(${topYInfo.expr})-${H}'[${vLabel}]`);
                }
            } else {
                const spillSrcH = Math.min(hContain, snapEven(hContain * 0.45));
                const bottomSpillH = snapEven(Math.max(2, H - Math.floor(topYInfo.minY) - Math.floor(boxHInfo.minH) + 2));
                const bottomSpillY = Math.max(0, hContain - spillSrcH);
                const preScale = `scale=${W}:${hContain}:force_original_aspect_ratio=increase:flags=bilinear,`;

                filters.push(`${vInputPad}${mediaPrep},split=${needsTopSpill ? 3 : 2}[fg_raw_${i}][bg_bot_raw_${i}]${needsTopSpill ? `[bg_top_raw_${i}]` : ''}`);
                filters.push(`[fg_raw_${i}]scale=w='${fgScaleW}':h='${fgScaleH}':eval=frame:force_original_aspect_ratio=increase:flags=lanczos[fg_main_${i}]`);
                filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[canvas_${i}]`);
                filters.push(`[canvas_${i}][fg_main_${i}]overlay=x='${fgOverlayX}':y='${fgOverlayY}'[fg_placed_${i}]`);
                filters.push(buildAmbientSpillFilter(`bg_bot_raw_${i}`, `bg_spill_${i}`, spillSrcH, bottomSpillY, blurW, bottomSpillH, preScale));
                filters.push(`[fg_placed_${i}][bg_spill_${i}]overlay=0:'max(0,(${topYInfo.expr})+(${boxHInfo.expr})-2)'[${needsTopSpill ? `bg_bot_ready_${i}` : vLabel}]`);
                if (needsTopSpill) {
                    const topSpillH = snapEven(Math.ceil(topYInfo.maxY) + 2);
                    filters.push(buildAmbientSpillFilter(`bg_top_raw_${i}`, `bg_top_spill_${i}`, spillSrcH, 0, blurW, topSpillH, preScale));
                    filters.push(`[bg_bot_ready_${i}][bg_top_spill_${i}]overlay=0:'(${topYInfo.expr})+2-${topSpillH}'[${vLabel}]`);
                }
            }
        } else {
            const boxH = Math.min(H, snapEven(boxHInfo.minH));
            const fgBox = zoomExpr
                ? `scale=${W}:${boxH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y=0,scale=w='ceil(${W}*${zoomExpr}/2)*2':h='ceil(${boxH}*${zoomExpr}/2)*2':eval=frame:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y='(ih-${boxH})/2'${kenBurns45(boxH)}`
                : `scale=${W}:${boxH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y=0${kenBurns45(boxH)}`;
            if (boxH < H - 2) {
                const fgOverlayY = topYInfo.isConstant ? String(staticTopY) : `'${topYInfo.expr}'`;
                if (draft.enableAmbientBlur === false) {
                    filters.push(`${vInputPad}${mediaPrep},${fgBox}[fg_main_${i}]`);
                    filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[canvas_${i}]`);
                    filters.push(`[canvas_${i}][fg_main_${i}]overlay=0:${fgOverlayY}[${vLabel}]`);
                } else {
                    const spillSrcH = Math.min(boxH, snapEven(boxH * 0.45));
                    const bottomSpillH = snapEven(H - Math.floor(topYInfo.minY) - boxH + 2);
                    const bottomSpillY = Math.max(0, boxH - spillSrcH);
                    const botOverlayY = topYInfo.isConstant ? String(Math.max(0, staticTopY + boxH - 2)) : `'max(0,(${topYInfo.expr})+${boxH}-2)'`;
                    const blurW = snapEven(Math.max(32, W / 4));

                    filters.push(`${vInputPad}${mediaPrep},${fgBox},split=${needsTopSpill ? 3 : 2}[fg_main_${i}][fg_src_${i}]${needsTopSpill ? `[fg_top_src_${i}]` : ''}`);
                    filters.push(buildAmbientSpillFilter(`fg_src_${i}`, `bg_spill_${i}`, spillSrcH, bottomSpillY, blurW, bottomSpillH));
                    filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[canvas_${i}]`);
                    filters.push(`[canvas_${i}][bg_spill_${i}]overlay=0:${botOverlayY}[bg_ready_${i}]`);
                    if (needsTopSpill) {
                        const topSpillH = snapEven(Math.ceil(topYInfo.maxY) + 2);
                        const topOverlayY = topYInfo.isConstant ? '0' : `'(${topYInfo.expr})+2-${topSpillH}'`;
                        filters.push(buildAmbientSpillFilter(`fg_top_src_${i}`, `bg_top_spill_${i}`, spillSrcH, 0, blurW, topSpillH));
                        filters.push(`[bg_ready_${i}][bg_top_spill_${i}]overlay=0:${topOverlayY}[bg_top_ready_${i}]`);
                        filters.push(`[bg_top_ready_${i}][fg_main_${i}]overlay=0:${fgOverlayY}[${vLabel}]`);
                    } else {
                        filters.push(`[bg_ready_${i}][fg_main_${i}]overlay=0:${fgOverlayY}[${vLabel}]`);
                    }
                }
            } else {
                filters.push(`${vInputPad}${mediaPrep},${fgBox}[${vLabel}]`);
            }
        }
    } else if (zoomExpr) {
        filters.push(`${vInputPad}${mediaPrep},scale=w='ceil(${W}*${zoomExpr}/2)*2':h='ceil(${H}*${zoomExpr}/2)*2':eval=frame:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='(iw-${W})*${posXExpr}':y='(ih-${H})/2'${kenBurnsFull}[${vLabel}]`);
    } else {
        const framing = interpolateKeyframe(draft.keyframes, start + dur * 0.5, getDefaultVideoFraming(draft, draft.aspectRatio));
        const zFactor = Math.max(1.0, (framing.zoom ?? 100) / 100);
        const sW = snapEven(W * zFactor);
        const sH = snapEven(H * zFactor);
        filters.push(`${vInputPad}${mediaPrep},scale=${sW}:${sH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='(iw-${W})*${posXExpr}':y='(ih-${H})/2'${kenBurnsFull}[${vLabel}]`);
    }

    const { inDur, outDur } = resolveSceneFade(scenes, i);
    const fadeColor = is45 ? "#080808" : "#050505";

    const fadeParts: string[] = [];
    if (inDur > 0.01) fadeParts.push(`fade=t=in:st=0:d=${inDur.toFixed(3)}:color=${fadeColor}`);
    if (outDur > 0.01) fadeParts.push(`fade=t=out:st=${Math.max(0, dur - outDur).toFixed(3)}:d=${outDur.toFixed(3)}:color=${fadeColor}`);
    const vFaded = fadeParts.length ? `v_fad_${i}` : vLabel;
    if (fadeParts.length) filters.push(`[${vLabel}]${fadeParts.join(",")}[${vFaded}]`);

    const ovScaleFlags = "lanczos+accurate_rnd+full_chroma_int";
    if (isAnimatedSceneOverlay(draft, scenes, i)) {
        filters.push(`[${ovIdx}:v]scale=${W}:${H}:flags=${ovScaleFlags},format=rgba,fade=t=in:st=0:d=0.22:alpha=1[ov_anim_${i}]`);
        filters.push(`[${vFaded}][ov_anim_${i}]overlay=0:0:format=auto:alpha=straight,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,settb=1/90000[v_sc_${i}]`);
    } else {
        // Static 1-frame PNG overlay decoded & Lanczos-scaled once, repeated across every video frame via eof_action=repeat
        filters.push(`[${ovIdx}:v]scale=${W}:${H}:flags=${ovScaleFlags},format=rgba[ov_sc_${i}]`);
        filters.push(`[${vFaded}][ov_sc_${i}]overlay=0:0:format=auto:alpha=straight:eof_action=repeat:repeatlast=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1,settb=1/90000[v_sc_${i}]`);
    }

    const aLabel = `a_sc_${i}`;
    const aInputPad = customLoopAudioSource ? `[${customLoopAudioSource}]` : `[${mediaIdx}:a]`;
    const vol = draft.isMuted ? 0 : clamp(draft.volume ?? 1, 0, 1);
    if (isImage || !srcHasAudio || vol === 0) {
        filters.push(`anullsrc=r=48000:cl=stereo:d=${dur.toFixed(3)}[${aLabel}]`);
    } else {
        const { inAudioMode, outAudioMode } = resolveAudioBoundaryModes(scenes, i, Boolean(draft.enableOutro));
        const aFades: string[] = [
            `${aLoopTrim}asetpts=PTS-STARTPTS`,
            `aresample=48000`,
            `aformat=channel_layouts=stereo`,
            ...buildAudioFadeFilters(vol, dur, inDur, outDur, inAudioMode, outAudioMode),
            `apad=whole_dur=${dur.toFixed(3)}`,
            `atrim=0:${dur.toFixed(3)}`,
        ];
        filters.push(`${aInputPad}${aFades.join(",")}[${aLabel}]`);
    }

    return { filters, vMap: `[v_sc_${i}]`, aMap: `[${aLabel}]` };
}
