import { getTopBoxOffsetY, interpolateKeyframe, resolveSceneFadeDurations, type TimelineScene, type VideoDraft } from "../../types/news";
import { AudioBoundaryFadeMode, buildAudioFadeFilters, buildPosXNormExpr, buildZoomFactorExpr } from "./ffmpegFilters";

interface SceneFilterContext {
    index: number;
    scene: TimelineScene;
    scenes: TimelineScene[];
    draft: VideoDraft;
    start: number;
    duration: number;
    width: number;
    height: number;
    targetFps: number;
    is45: boolean;
    isImage: boolean;
    hasReHook: boolean;
    setupIdx: number;
    srcWidth: number;
    srcHeight: number;
    srcHasAudio: boolean;
    mediaIdx: number;
    overlayIdx: number;
    customLoopVideoSource: string | null;
    customLoopAudioSource: string | null;
    loopTrim: string;
    aLoopTrim: string;
}

/** Builds the FFmpeg filtergraph stages for a single scene (4:5 ambient spill or 9:16/1:1 full bleed, fade, overlay, audio). */
export function buildSceneFilterStages(ctx: SceneFilterContext): { filters: string[]; vMap: string; aMap: string } {
    const {
        index: i, scene: s, scenes, draft, start, duration: dur, width: W, height: H, targetFps,
        is45, isImage, hasReHook, setupIdx, srcWidth, srcHeight, srcHasAudio,
        mediaIdx, overlayIdx: ovIdx, customLoopVideoSource, customLoopAudioSource, loopTrim, aLoopTrim,
    } = ctx;

    const filters: string[] = [];
    const framing = interpolateKeyframe(draft.keyframes, start + dur * 0.5, { zoom: draft.zoom, posX: draft.posX });
    const posXExpr = buildPosXNormExpr(draft, start, dur);
    const zoomExpr = buildZoomFactorExpr(draft, start, dur);
    const vLabel = `v_base_${i}`;
    const vInputPad = customLoopVideoSource ? `[${customLoopVideoSource}]` : `[${mediaIdx}:v]`;
    const mediaPrep = isImage
        ? `fps=${targetFps},setpts=PTS-STARTPTS`
        : `${loopTrim}fps=${targetFps},setpts=PTS-STARTPTS`;
    const kenBurns45 = (boxH: number) => isImage
        ? `,scale=w='ceil(iw*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':h='ceil(ih*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':eval=frame:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})/2':y='(ih-${boxH})/2'`
        : '';
    const kenBurnsFull = isImage
        ? `,scale=w='ceil(iw*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':h='ceil(ih*(1+0.04*min(1,t/${dur.toFixed(3)}))/2)*2':eval=frame:flags=lanczos,crop=${W}:${H}:x='(iw-${W})/2':y='(ih-${H})/2'`
        : '';

    if (is45) {
        const vAR = isImage ? (W / H) : (srcWidth / Math.max(1, srcHeight));
        const hContain = Math.min(H, Math.round(W / vAR));
        const tZoom = Math.min(100, Math.max(0, framing.zoom ?? 0)) / 100;
        const boxH = Math.max(2, Math.round(hContain + tZoom * (H - hContain)));
        const fgBox = zoomExpr
            ? `scale=${W}:${boxH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y=0,scale=w='ceil(${W}*${zoomExpr}/2)*2':h='ceil(${boxH}*${zoomExpr}/2)*2':eval=frame:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y='(ih-${boxH})/2'${kenBurns45(boxH)}`
            : `scale=${W}:${boxH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${boxH}:x='(iw-${W})*${posXExpr}':y=0${kenBurns45(boxH)}`;
        const topOffsetY = getTopBoxOffsetY(draft.posY, H, boxH);
        if (boxH < H - 2) {
            const spillSrcH = Math.max(2, Math.round(boxH * 0.45));
            const bottomSpillH = Math.max(2, H - (topOffsetY + boxH) + 2);
            const bottomSpillY = Math.max(0, boxH - spillSrcH);
            filters.push(`${vInputPad}${mediaPrep},${fgBox},split=${topOffsetY > 2 ? 3 : 2}[fg_main_${i}][fg_src_${i}]${topOffsetY > 2 ? `[fg_top_src_${i}]` : ''}`);
            filters.push(`[fg_src_${i}]crop=${W}:${spillSrcH}:0:${bottomSpillY},vflip,scale=${W}:${bottomSpillH}:flags=lanczos,boxblur=26:2,eq=brightness=-0.22:saturation=1.35[bg_spill_${i}]`);
            filters.push(`color=c=#080808:s=${W}x${H}:d=${dur.toFixed(3)}:r=${targetFps}[canvas_${i}]`);
            filters.push(`[canvas_${i}][bg_spill_${i}]overlay=0:${Math.max(0, topOffsetY + boxH - 2)}[bg_ready_${i}]`);
            if (topOffsetY > 2) {
                filters.push(`[fg_top_src_${i}]crop=${W}:${spillSrcH}:0:0,vflip,scale=${W}:${topOffsetY + 2}:flags=lanczos,boxblur=26:2,eq=brightness=-0.22:saturation=1.35[bg_top_spill_${i}]`);
                filters.push(`[bg_ready_${i}][bg_top_spill_${i}]overlay=0:0[bg_top_ready_${i}]`);
                filters.push(`[bg_top_ready_${i}][fg_main_${i}]overlay=0:${topOffsetY}[${vLabel}]`);
            } else {
                filters.push(`[bg_ready_${i}][fg_main_${i}]overlay=0:${topOffsetY}[${vLabel}]`);
            }
        } else {
            filters.push(`${vInputPad}${mediaPrep},${fgBox}[${vLabel}]`);
        }
    } else if (zoomExpr) {
        filters.push(`${vInputPad}${mediaPrep},scale=w='ceil(${W}*${zoomExpr}/2)*2':h='ceil(${H}*${zoomExpr}/2)*2':eval=frame:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='(iw-${W})*${posXExpr}':y='(ih-${H})/2'${kenBurnsFull}[${vLabel}]`);
    } else {
        const zFactor = Math.max(1.0, (framing.zoom ?? 100) / 100);
        const sW = Math.round(W * zFactor);
        const sH = Math.round(H * zFactor);
        filters.push(`${vInputPad}${mediaPrep},scale=${sW}:${sH}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}:x='(iw-${W})*${posXExpr}':y='(ih-${H})/2'${kenBurnsFull}[${vLabel}]`);
    }

    const resolvedFade = resolveSceneFadeDurations(scenes, i);
    const inOn = s.fadeIn ?? (i === setupIdx || (hasReHook && i === 1));
    const outOn = s.fadeOut ?? (i === 0 || (hasReHook && i === 1));
    const inDur = inOn ? Math.min(resolvedFade.inDur, dur * 0.5) : 0;
    const outDur = outOn ? Math.min(resolvedFade.outDur, dur * 0.5) : 0;
    const fadeColor = is45 ? "#080808" : "#050505";

    const fadeParts: string[] = [];
    if (inDur > 0.01) fadeParts.push(`fade=t=in:st=0:d=${inDur.toFixed(3)}:color=${fadeColor}`);
    if (outDur > 0.01) fadeParts.push(`fade=t=out:st=${Math.max(0, dur - outDur).toFixed(3)}:d=${outDur.toFixed(3)}:color=${fadeColor}`);
    const vFaded = fadeParts.length ? `v_fad_${i}` : vLabel;
    if (fadeParts.length) filters.push(`[${vLabel}]${fadeParts.join(",")}[${vFaded}]`);

    const isSharedReHook = Boolean(s.id.startsWith("rehook-") && s.shareHookText !== false);
    if (draft.enableMotion !== false && i === 0 && !isSharedReHook) {
        filters.push(`[${ovIdx}:v]scale=${W}:${H}:flags=lanczos,format=rgba,fade=t=in:st=0:d=0.22:alpha=1[ov_anim_${i}]`);
        filters.push(`[${vFaded}][ov_anim_${i}]overlay=0:0:format=auto,format=yuv420p,setsar=1[v_sc_${i}]`);
    } else {
        filters.push(`[${ovIdx}:v]scale=${W}:${H}:flags=lanczos[ov_sc_${i}]`);
        filters.push(`[${vFaded}][ov_sc_${i}]overlay=0:0:format=auto,format=yuv420p,setsar=1[v_sc_${i}]`);
    }

    const aLabel = `a_sc_${i}`;
    const aInputPad = customLoopAudioSource ? `[${customLoopAudioSource}]` : `[${mediaIdx}:a]`;
    const vol = draft.isMuted ? 0 : Math.max(0, Math.min(1, draft.volume ?? 1));
    if (isImage || !srcHasAudio || vol === 0) {
        filters.push(`anullsrc=r=48000:cl=stereo:d=${dur.toFixed(3)}[${aLabel}]`);
    } else {
        const prevHasAudio = i > 0 && scenes[i - 1]?.mediaType !== "image";
        const prevFadeOut = i > 0 ? (scenes[i - 1]?.fadeOut ?? (i - 1 === 0 || (hasReHook && i - 1 === 1))) : false;
        const nextHasAudio = i < scenes.length - 1 && scenes[i + 1]?.mediaType !== "image";
        const nextFadeIn = i < scenes.length - 1 ? (scenes[i + 1]?.fadeIn ?? (i + 1 === setupIdx || (hasReHook && i + 1 === 1))) : false;
        const inAudioMode: AudioBoundaryFadeMode = i === 0 || !prevHasAudio ? "full" : (inOn && prevFadeOut ? "breath" : "declick");
        const outAudioMode: AudioBoundaryFadeMode = (i === scenes.length - 1 && !draft.enableOutro) || (i < scenes.length - 1 && !nextHasAudio)
            ? "full"
            : (outOn && (i === scenes.length - 1 || nextFadeIn) ? "breath" : "declick");
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
