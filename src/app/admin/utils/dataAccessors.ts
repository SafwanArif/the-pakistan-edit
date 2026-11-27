import { Draft, SlideAsset, TimelineScene, VideoDraft, getActiveSceneAtTime, isSharedReHookScene } from "@/types/news";

type CoreField = "headline" | "category" | "summary" | "image" | "imageCredit" | "sourceName" | "sourcePrefix" | "creditPrefix";
type ExtraSlideField = "heading" | "content" | "source" | "sourcePrefix";
type SlideAssetField = keyof SlideAsset;

const CORE_FIELDS = new Set<string>(["headline", "category", "summary", "image", "imageCredit", "sourceName", "sourcePrefix", "creditPrefix"]);
const SLIDE_ASSET_FIELDS = new Set<string>(["image", "imageWidth", "imageHeight", "imageCredit", "creditPrefix", "imageZoom", "imagePosX", "imagePosY", "imagePosY_Square", "snapMode"]);
const EXTRA_SLIDE_PATH_RE = /^extra-([a-zA-Z]+)-(\d+)$/;
const SLIDE_ASSET_PATH_RE = /^slide-(\d+)-([a-zA-Z_]+)$/;
const VIDEO_PREFIX_RE = /^video-/;

const EXTRA_FIELD_KEY: Record<ExtraSlideField, "heading" | "content" | "sourceName" | "sourcePrefix"> = {
    heading: "heading",
    content: "content",
    source: "sourceName",
    sourcePrefix: "sourcePrefix",
};

type DraftPath = CoreField | `extra-${ExtraSlideField}-${number}` | `slide-${number}-${SlideAssetField}` | string;

const normalizeSlideNum = (n: number): number | null =>
    Number.isFinite(n) && n >= 1 ? Math.trunc(n) : null;

const patchSceneAt = (
    draft: VideoDraft,
    index: number,
    patch: Partial<TimelineScene>,
    rootPatch?: Partial<VideoDraft>
): VideoDraft => {
    const scenes = [...(draft.scenes || [])];
    if (scenes[index]) scenes[index] = { ...scenes[index]!, ...patch };
    return { ...draft, scenes, ...rootPatch };
};

const patchSceneFieldOrRoot = (
    draft: VideoDraft,
    scene: TimelineScene | null | undefined,
    sceneIndex: number,
    field: "sourceName" | "creditName",
    value: string
): VideoDraft =>
    scene?.[field]
        ? patchSceneAt(draft, sceneIndex, { [field]: value }, sceneIndex === 0 ? { [field]: value } : undefined)
        : { ...draft, [field]: value };

/** Resolves and immutably updates structured paths within the Carousel Draft model. */
export const DraftResolver = {
    get: (path: DraftPath, draft: Draft): string | number | undefined => {
        if (!path) return "";
        if (CORE_FIELDS.has(path)) return (draft[path as keyof Draft] as string | number | undefined) ?? "";

        const extraMatch = path.match(EXTRA_SLIDE_PATH_RE);
        if (extraMatch) {
            const field = extraMatch[1]!;
            const slide = draft.extraSlides?.[parseInt(extraMatch[2]!, 10)];
            if (!slide || !Object.hasOwn(EXTRA_FIELD_KEY, field)) return "";
            const prop = EXTRA_FIELD_KEY[field as ExtraSlideField];
            return prop === "sourcePrefix" ? (slide.sourcePrefix || "SOURCE:") : (slide[prop] ?? "");
        }

        const slideMatch = path.match(SLIDE_ASSET_PATH_RE);
        if (slideMatch) {
            const slideNum = normalizeSlideNum(parseInt(slideMatch[1]!, 10));
            const field = slideMatch[2]!;
            if (slideNum === null || !SLIDE_ASSET_FIELDS.has(field)) return "";
            if (slideNum === 1) return (draft[field as keyof Draft] as string | number | undefined) ?? "";
            return (draft.slideAssets?.[slideNum]?.[field as SlideAssetField] as string | number | undefined) ?? "";
        }
        return "";
    },

    set: (path: DraftPath, value: string | number, draft: Draft): Draft => {
        if (CORE_FIELDS.has(path)) return { ...draft, [path]: value };

        const extraMatch = path.match(EXTRA_SLIDE_PATH_RE);
        if (extraMatch) {
            const field = extraMatch[1]!;
            const index = parseInt(extraMatch[2]!, 10);
            if (!Object.hasOwn(EXTRA_FIELD_KEY, field)) return draft;
            const extraSlides = [...(draft.extraSlides || [])];
            if (index < 0 || index > extraSlides.length) return draft;
            extraSlides[index] = { ...(extraSlides[index] || { heading: "", content: "" }), [EXTRA_FIELD_KEY[field as ExtraSlideField]]: value as string };
            return { ...draft, extraSlides };
        }

        const slideMatch = path.match(SLIDE_ASSET_PATH_RE);
        if (slideMatch) {
            const slideNum = normalizeSlideNum(parseInt(slideMatch[1]!, 10));
            const field = slideMatch[2]!;
            if (slideNum === null || !SLIDE_ASSET_FIELDS.has(field)) return draft;
            return DraftResolver.patchSlide(slideNum, { [field]: value } as Partial<SlideAsset>, draft);
        }
        return draft;
    },

    /** Atomically patches multiple asset/framing fields for a single Carousel slide in one immutable update. */
    patchSlide: (slideNum: number, patch: Partial<SlideAsset>, draft: Draft): Draft => {
        const safeSlide = normalizeSlideNum(slideNum);
        if (safeSlide === null) return draft;
        if (safeSlide === 1) return { ...draft, ...patch };
        return {
            ...draft,
            slideAssets: {
                ...(draft.slideAssets || {}),
                [safeSlide]: { ...(draft.slideAssets?.[safeSlide] || {}), ...patch },
            },
        };
    },
};

/** Resolves effective per-slide asset and focal properties with Slide 1 fallback inheritance (`P127`). */
export const getEffectiveSlideAsset = (step: number, draft: Draft): SlideAsset => {
    const safeStep = normalizeSlideNum(step) ?? 1;
    const asset: SlideAsset = safeStep === 1 ? {} : { ...draft.slideAssets?.[safeStep] };

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

/** Resolves and immutably updates scene-aware fields within the VideoDraft model. */
export const VideoDraftResolver = {
    get: (path: string, draft: VideoDraft, currentTime = 0): string => {
        if (!path) return "";
        const cleanPath = path.replace(VIDEO_PREFIX_RE, "");
        const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
        const { scene, sceneIndex, isOutro } = getActiveSceneAtTime(draft, safeTime);
        const textScene = isSharedReHookScene(draft.scenes, sceneIndex) ? (draft.scenes?.[0] ?? scene) : scene;

        if (cleanPath === "category") return draft.category ?? "";
        if (cleanPath === "headline") return isOutro ? (draft.outroCta ?? "") : (textScene ? textScene.title : (draft.headline ?? ""));
        if (cleanPath === "subtitle") return isOutro ? "" : (textScene ? (textScene.subtitle ?? "") : (draft.subtitle ?? ""));
        if (cleanPath === "sourceName") return scene?.sourceName || (draft.sourceName ?? "");
        if (cleanPath === "creditName") return scene?.creditName || (draft.creditName ?? "");
        if (cleanPath === "outroCta") return draft.outroCta ?? "";
        return "";
    },

    set: (path: string, value: string, draft: VideoDraft, currentTime = 0): VideoDraft => {
        const cleanPath = path.replace(VIDEO_PREFIX_RE, "");
        const safeTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
        const { scene, sceneIndex, isOutro } = getActiveSceneAtTime(draft, safeTime);

        if (cleanPath === "category") return { ...draft, category: value };
        if (cleanPath === "outroCta") return { ...draft, outroCta: value };
        if (cleanPath === "headline") {
            if (isOutro) return { ...draft, outroCta: value };
            const targetIdx = isSharedReHookScene(draft.scenes, sceneIndex) ? 0 : sceneIndex;
            return patchSceneAt(draft, targetIdx, { title: value }, targetIdx === 0 ? { headline: value } : undefined);
        }
        if (cleanPath === "subtitle") {
            if (isOutro) return draft;
            const targetIdx = isSharedReHookScene(draft.scenes, sceneIndex) ? 0 : sceneIndex;
            return patchSceneAt(draft, targetIdx, { subtitle: value }, targetIdx === 0 ? { subtitle: value } : undefined);
        }
        if (cleanPath === "sourceName" || cleanPath === "creditName") {
            return patchSceneFieldOrRoot(draft, scene, sceneIndex, cleanPath, value);
        }
        return draft;
    },
};
