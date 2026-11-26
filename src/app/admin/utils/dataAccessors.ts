import { Draft, SlideAsset, VideoDraft, getActiveSceneAtTime, isSharedReHookScene } from "@/types/news";

type CoreField = 'headline' | 'category' | 'summary' | 'image' | 'imageCredit' | 'sourceName' | 'sourcePrefix' | 'creditPrefix';
type ExtraSlideField = 'heading' | 'content' | 'source' | 'sourcePrefix';
type SlideAssetField = keyof SlideAsset;

const CORE_FIELDS = new Set<string>(['headline', 'category', 'summary', 'image', 'imageCredit', 'sourceName', 'sourcePrefix', 'creditPrefix']);
const EXTRA_SLIDE_PATH_RE = /^extra-([a-zA-Z]+)-(\d+)$/;
const SLIDE_ASSET_PATH_RE = /^slide-(\d+)-([a-zA-Z_]+)$/;
const VIDEO_PREFIX_RE = /^video-/;

type DraftPath = 
    | CoreField 
    | `extra-${ExtraSlideField}-${number}` 
    | `slide-${number}-${SlideAssetField}` 
    | string;

/**
 * Resolves and immutably updates structured paths within the Carousel Draft model.
 */
export const DraftResolver = {
    get: (path: DraftPath, draft: Draft): string | number | undefined => {
        if (!path) return "";
        
        if (CORE_FIELDS.has(path)) {
            return (draft[path as keyof Draft] as string | number | undefined) ?? "";
        }

        const extraMatch = (path as string).match(EXTRA_SLIDE_PATH_RE);
        if (extraMatch) {
            const field = extraMatch[1]! as ExtraSlideField;
            const index = parseInt(extraMatch[2]!, 10);
            const slide = draft.extraSlides?.[index];
            if (!slide) return "";
            if (field === 'heading') return slide.heading ?? "";
            if (field === 'content') return slide.content ?? "";
            if (field === 'source') return slide.sourceName ?? "";
            if (field === 'sourcePrefix') return slide.sourcePrefix || "SOURCE:";
        }

        const slideMatch = (path as string).match(SLIDE_ASSET_PATH_RE);
        if (slideMatch) {
            const slideNum = parseInt(slideMatch[1]!, 10);
            const field = slideMatch[2]! as SlideAssetField;
            
            if (slideNum === 1) {
                if (field === 'image') return draft.image ?? "";
                if (field === 'imageCredit') return draft.imageCredit ?? "";
                if (field === 'creditPrefix') return draft.creditPrefix ?? "";
                return (draft[field as keyof Draft] as string | number | undefined) ?? "";
            }

            return (draft.slideAssets?.[slideNum]?.[field] as string | number | undefined) ?? "";
        }

        return "";
    },

    set: (path: DraftPath, value: string | number, draft: Draft): Draft => {
        if (CORE_FIELDS.has(path)) {
            return { ...draft, [path]: value };
        }

        const extraMatch = (path as string).match(EXTRA_SLIDE_PATH_RE);
        if (extraMatch) {
            const field = extraMatch[1]! as ExtraSlideField;
            const index = parseInt(extraMatch[2]!, 10);
            const extraSlides = [...(draft.extraSlides || [])];
            const prev = extraSlides[index] || { heading: '', content: '' };
            const nextSlide = { ...prev };
            if (field === 'heading') nextSlide.heading = value as string;
            else if (field === 'content') nextSlide.content = value as string;
            else if (field === 'source') nextSlide.sourceName = value as string;
            else if (field === 'sourcePrefix') nextSlide.sourcePrefix = value as string;
            extraSlides[index] = nextSlide;
            return { ...draft, extraSlides };
        }

        const slideMatch = (path as string).match(SLIDE_ASSET_PATH_RE);
        if (slideMatch) {
            const slideNum = parseInt(slideMatch[1]!, 10);
            const field = slideMatch[2]! as SlideAssetField;

            if (slideNum === 1) {
                return { ...draft, [field]: value };
            }

            return {
                ...draft,
                slideAssets: {
                    ...(draft.slideAssets || {}),
                    [slideNum]: {
                        ...(draft.slideAssets?.[slideNum] || {}),
                        [field]: value,
                    },
                },
            };
        }

        return draft;
    },

    /** Atomically patches multiple asset/framing fields for a single Carousel slide in one immutable update. */
    patchSlide: (slideNum: number, patch: Partial<SlideAsset>, draft: Draft): Draft => {
        if (slideNum === 1) {
            return { ...draft, ...patch };
        }
        return {
            ...draft,
            slideAssets: {
                ...(draft.slideAssets || {}),
                [slideNum]: {
                    ...(draft.slideAssets?.[slideNum] || {}),
                    ...patch,
                },
            },
        };
    }
};

/**
 * Resolves effective per-slide asset and focal properties with Slide 1 fallback inheritance.
 */
export const getEffectiveSlideAsset = (step: number, draft: Draft): SlideAsset => {
    const asset: SlideAsset = { ...draft.slideAssets?.[step] };
    
    if (!asset.image) {
        asset.image = draft.image;
        asset.imageWidth = draft.imageWidth;
        asset.imageHeight = draft.imageHeight;
    }

    asset.imageCredit = asset.imageCredit ?? draft.imageCredit;
    asset.creditPrefix = asset.creditPrefix ?? draft.creditPrefix;

    asset.imageZoom = asset.imageZoom ?? draft.imageZoom;
    asset.imagePosX = asset.imagePosX ?? draft.imagePosX;
    asset.imagePosY = asset.imagePosY ?? draft.imagePosY;
    asset.imagePosY_Square = asset.imagePosY_Square ?? draft.imagePosY_Square;
    asset.snapMode = asset.snapMode ?? draft.snapMode;

    return asset;
};

/**
 * Resolves and immutably updates scene-aware fields within the VideoDraft model.
 */
export const VideoDraftResolver = {
    get: (path: string, draft: VideoDraft, currentTime: number = 0): string => {
        if (!path) return "";
        const cleanPath = path.replace(VIDEO_PREFIX_RE, '');
        const { scene, sceneIndex, isOutro } = getActiveSceneAtTime(draft, currentTime);
        const textScene = isSharedReHookScene(draft.scenes, sceneIndex) ? draft.scenes![0]! : scene;

        if (cleanPath === 'category') {
            return draft.category ?? "";
        }
        if (cleanPath === 'headline') {
            if (isOutro) return draft.outroCta ?? "";
            return textScene ? textScene.title : (draft.headline ?? "");
        }
        if (cleanPath === 'subtitle') {
            if (isOutro) return "";
            return textScene ? (textScene.subtitle ?? "") : (draft.subtitle ?? "");
        }
        if (cleanPath === 'sourceName') {
            return (scene && scene.sourceName) ? scene.sourceName : (draft.sourceName ?? "");
        }
        if (cleanPath === 'creditName') {
            return (scene && scene.creditName) ? scene.creditName : (draft.creditName ?? "");
        }
        if (cleanPath === 'outroCta') {
            return draft.outroCta ?? "";
        }

        return "";
    },

    set: (path: string, value: string, draft: VideoDraft, currentTime: number = 0): VideoDraft => {
        const cleanPath = path.replace(VIDEO_PREFIX_RE, '');
        const { scene, sceneIndex, isOutro } = getActiveSceneAtTime(draft, currentTime);

        if (cleanPath === 'category') return { ...draft, category: value };

        if (cleanPath === 'headline') {
            if (isOutro) return { ...draft, outroCta: value };
            const scenes = [...(draft.scenes || [])];
            const targetIdx = isSharedReHookScene(scenes, sceneIndex) ? 0 : sceneIndex;
            if (scenes[targetIdx]) scenes[targetIdx] = { ...scenes[targetIdx]!, title: value };
            return { ...draft, scenes, ...(targetIdx === 0 ? { headline: value } : {}) };
        }

        if (cleanPath === 'subtitle') {
            if (isOutro) return draft;
            const scenes = [...(draft.scenes || [])];
            const targetIdx = isSharedReHookScene(scenes, sceneIndex) ? 0 : sceneIndex;
            if (scenes[targetIdx]) scenes[targetIdx] = { ...scenes[targetIdx]!, subtitle: value };
            return { ...draft, scenes, ...(targetIdx === 0 ? { subtitle: value } : {}) };
        }

        if (cleanPath === 'sourceName') {
            if (scene?.sourceName) {
                const scenes = [...(draft.scenes || [])];
                if (scenes[sceneIndex]) scenes[sceneIndex] = { ...scenes[sceneIndex]!, sourceName: value };
                return { ...draft, scenes, ...(sceneIndex === 0 ? { sourceName: value } : {}) };
            }
            return { ...draft, sourceName: value };
        }

        if (cleanPath === 'creditName') {
            if (scene?.creditName) {
                const scenes = [...(draft.scenes || [])];
                if (scenes[sceneIndex]) scenes[sceneIndex] = { ...scenes[sceneIndex]!, creditName: value };
                return { ...draft, scenes, ...(sceneIndex === 0 ? { creditName: value } : {}) };
            }
            return { ...draft, creditName: value };
        }
        if (cleanPath === 'outroCta') return { ...draft, outroCta: value };

        return draft;
    }
};
