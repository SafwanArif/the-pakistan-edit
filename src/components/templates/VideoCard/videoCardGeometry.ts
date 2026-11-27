import { clamp, evaluateSceneTransition, getTopBoxOffsetY, type VideoDraft, type VideoFraming, type VideoHeadlinePreset } from "@/types/news";

export interface AmbientCropRect { xFrac: number; wFrac: number; yFrac: number; hFrac: number; }
export interface AmbientVisibilityState { topVisible: boolean; botVisible: boolean; }
export interface Frame45Layout { H_cont: number; effScale: number; containerH: number; panX: number; topY: number; mediaY: number; botInset: number; }
export interface FullBleedLayout { coverW: number; coverH: number; finalScale: number; panX: number; }
interface CardDimensions { width: number; height: number; }

export const sanitizeAspect = (aspect: number): number => (Number.isFinite(aspect) && aspect > 0 ? aspect : 16 / 9);

/** Resolves initial post-rotation aspect from `sourceMediaInfo` so export & preview share identical 4:5 scrims (`P208`). */
export const getInitialMediaAspect = (draft: Pick<VideoDraft, 'sourceMediaInfo'>): number => {
    const info = draft.sourceMediaInfo;
    return info && info.width > 0 && info.height > 0 ? sanitizeAspect(info.width / info.height) : 16 / 9;
};

/** Evaluates linear gain with transition breath-dip clamped to `[0, 1]`. */
export const computeEffectiveVolume = (draft: VideoDraft, timelineTime: number): number =>
    clamp((draft.volume ?? 1) * evaluateSceneTransition(draft, timelineTime).audioGain, 0, 1);

export const computeKenBurnsMul = (isImage: boolean, time: number, sceneStart: number, sceneDuration: number): number => {
    if (!isImage) return 1;
    const elapsed = Number.isFinite(time) && Number.isFinite(sceneStart) ? time - sceneStart : 0;
    return 1 + 0.04 * clamp(elapsed / (Number.isFinite(sceneDuration) ? Math.max(sceneDuration, 0.1) : 0.1), 0, 1);
};

/** Single zero-allocation 4:5 Contain/Fill/Punch framing engine shared 1:1 between React & 120Hz `rAF` PLL. */
export const compute45FrameLayout = (
    dimensions: CardDimensions,
    aspect: number,
    framing: Partial<VideoFraming>,
    kenBurnsMul = 1,
    out?: Frame45Layout
): Frame45Layout => {
    const r = sanitizeAspect(aspect);
    const H_cont = Math.min(dimensions.height, dimensions.width / r);
    const scaleFill = Math.max(1.0, dimensions.height / H_cont);
    const z = clamp(framing.zoom ?? 0, 0, 200);
    const t = Math.min(100, z) / 100;
    const punchScale = z > 100 ? z / 100 : 1;
    const kb = Number.isFinite(kenBurnsMul) && kenBurnsMul > 0 ? kenBurnsMul : 1;
    const effScale = (1.0 + t * (scaleFill - 1.0)) * punchScale * kb;
    const containerH = H_cont + t * (dimensions.height - H_cont);
    const panX = (0.5 - (framing.posX ?? 50) / 100) * (effScale - 1) * dimensions.width;
    const topY = getTopBoxOffsetY(framing.posY, dimensions.height, containerH);
    const mediaY = topY - Math.max(0, H_cont * effScale - containerH) / 2;
    const botInset = Math.max(0, dimensions.height - topY - containerH);
    const target = out ?? { H_cont: 0, effScale: 1, containerH: 0, panX: 0, topY: 0, mediaY: 0, botInset: 0 };
    target.H_cont = H_cont;
    target.effScale = effScale;
    target.containerH = containerH;
    target.panX = panX;
    target.topY = topY;
    target.mediaY = mediaY;
    target.botInset = botInset;
    return target;
};

export const computeAmbientCropInto = (
    dimensions: CardDimensions,
    H_cont: number,
    containerH: number,
    effScale: number,
    panX: number,
    out: AmbientCropRect
): AmbientCropRect => {
    if (effScale <= 1) {
        out.xFrac = 0; out.wFrac = 1; out.yFrac = 0; out.hFrac = 1;
        return out;
    }
    const wFrac = Math.min(1, 1 / effScale);
    const hFrac = Math.min(1, containerH / Math.max(1, H_cont * effScale));
    out.xFrac = clamp(0.5 - panX / (dimensions.width * effScale) - wFrac / 2, 0, 1 - wFrac);
    out.wFrac = wFrac;
    out.yFrac = (1 - hFrac) / 2;
    out.hFrac = hFrac;
    return out;
};

export const computeFullBleedLayout = (
    dimensions: CardDimensions,
    aspect: number,
    framing: Partial<VideoFraming>,
    kenBurnsMul = 1,
    out?: FullBleedLayout
): FullBleedLayout => {
    const r = sanitizeAspect(aspect);
    const kb = Number.isFinite(kenBurnsMul) && kenBurnsMul > 0 ? kenBurnsMul : 1;
    const finalScale = Math.max(1.0, (framing.zoom ?? 100) / 100) * kb;
    const coverH = Math.max(dimensions.height, dimensions.width / r);
    const coverW = coverH * r;
    const panX = (0.5 - (framing.posX ?? 50) / 100) * Math.max(0, coverW * finalScale - dimensions.width);
    const target = out ?? { coverW: 0, coverH: 0, finalScale: 1, panX: 0 };
    target.coverW = coverW;
    target.coverH = coverH;
    target.finalScale = finalScale;
    target.panX = panX;
    return target;
};

export const resolvePresetLayout = (is45: boolean, is916: boolean, preset: VideoHeadlinePreset) => {
    if (is45) {
        if (preset === 'center') return { justify: 'center', top: '200px', bottom: '200px' };
        if (preset === 'top') return { justify: 'flex-start', top: '200px', bottom: '160px' };
        return { justify: 'flex-end', top: '160px', bottom: '200px' };
    }
    if (preset === 'center') return { justify: 'center', top: is916 ? '200px' : '100px', bottom: is916 ? '200px' : '100px' };
    if (preset === 'top') return { justify: 'flex-start', top: is916 ? '390px' : '260px', bottom: '140px' };
    return { justify: 'flex-end', top: is916 ? '200px' : '120px', bottom: is916 ? '460px' : '160px' };
};

export const resolveCaptionBottom = (is45: boolean, is916: boolean, ccPos: string): string => {
    if (is45) return ccPos === 'high' ? '255px' : ccPos === 'middle' ? '185px' : '115px';
    if (is916) return ccPos === 'high' ? '435px' : ccPos === 'middle' ? '340px' : '245px';
    return ccPos === 'high' ? '280px' : ccPos === 'middle' ? '215px' : '150px';
};
