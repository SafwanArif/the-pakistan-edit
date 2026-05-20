import { Draft, SlideAsset } from "../../../types/news";

/**
 * 2027 Institutional Standard: DraftResolver
 * Centralized logic for structured path resolution within the Draft model.
 * Replaces iterative string-splitting and regex with deterministic field mapping.
 */
export const DraftResolver = {
    /**
     * Resolves a field value based on its semantic path.
     * Paths: 'headline', 'category', 'summary', 'slide-X-image', 'extra-X-heading', etc.
     */
    get: (path: string, draft: Draft): any => {
        if (!path) return "";
        
        // 1. Direct Properties
        if (['headline', 'category', 'summary', 'image', 'imageCredit', 'sourceName', 'sourcePrefix', 'creditPrefix'].includes(path)) {
            return (draft as any)[path];
        }

        // 2. Extra Slides (Angles)
        if (path.startsWith('extra-')) {
            const parts = path.split('-'); // extra-heading-0, extra-content-0, extra-source-0
            const index = parseInt(parts[2] || "0", 10);
            const field = parts[1];
            if (field === 'heading') return draft.extraSlides?.[index]?.heading || "";
            if (field === 'content') return draft.extraSlides?.[index]?.content || "";
            if (field === 'source') return draft.extraSlides?.[index]?.sourceName || "";
            if (field === 'sourcePrefix') return draft.extraSlides?.[index]?.sourcePrefix || "SOURCE:";
        }

        // 3. Slide Assets (Focal/Metatada)
        if (path.startsWith('slide-')) {
            const parts = path.split('-'); // slide-1-image, slide-2-imageCredit
            const slideNum = parseInt(parts[1] || "1", 10);
            const field = parts[2];
            
            if (!field) return "";

            if (slideNum === 1) {
                if (field === 'image') return draft.image;
                if (field === 'imageCredit') return draft.imageCredit;
                if (field === 'creditPrefix') return draft.creditPrefix;
                return (draft as any)[field];
            }

            return (draft.slideAssets?.[slideNum] as any)?.[field] || "";
        }

        return (draft as any)[path] || "";
    },

    /**
     * Updates a draft with a new value for a given path.
     */
    set: (path: string, value: any, draft: Draft): Draft => {
        const d = { ...draft };

        // 1. Direct Properties
        if (['headline', 'category', 'summary', 'image', 'imageCredit', 'sourceName', 'sourcePrefix', 'creditPrefix'].includes(path)) {
            (d as any)[path] = value;
            return d;
        }

        // 2. Extra Slides
        if (path.startsWith('extra-')) {
            const parts = path.split('-');
            const index = parseInt(parts[2] || "0", 10);
            const field = parts[1];
            if (!d.extraSlides) d.extraSlides = [];
            if (!d.extraSlides[index]) d.extraSlides[index] = { heading: '', content: '' };
            
            if (field === 'heading') d.extraSlides[index].heading = value;
            if (field === 'content') d.extraSlides[index].content = value;
            if (field === 'source') d.extraSlides[index].sourceName = value;
            if (field === 'sourcePrefix') d.extraSlides[index].sourcePrefix = value;
            return d;
        }

        // 3. Slide Assets
        if (path.startsWith('slide-')) {
            const parts = path.split('-');
            const slideNum = parseInt(parts[1] || "1", 10);
            const field = parts[2];
            if (!field) return d;

            if (slideNum === 1) {
                (d as any)[field === 'image' ? 'image' : field] = value;
                return d;
            }

            if (!d.slideAssets) d.slideAssets = {};
            if (!d.slideAssets[slideNum]) d.slideAssets[slideNum] = {};
            (d.slideAssets[slideNum] as any)[field] = value;
            return d;
        }

        (d as any)[path] = value;
        return d;
    }
};

/**
 * Legacy Adapters (For compatibility during refactor)
 */
export const getDraftValue = DraftResolver.get;
export const updateDraftValue = DraftResolver.set;

export const updateDraftPrefix = (field: string, prefix: string, draft: Draft): Draft => {
    const isCredit = field.includes('credit') || field.includes('Credit');
    const path = isCredit ? (field.includes('-') ? field.replace('imageCredit', 'creditPrefix') : 'creditPrefix') 
                          : (field.includes('-') ? field.replace('source', 'sourcePrefix').replace('Name', 'Prefix') : 'sourcePrefix');
    return DraftResolver.set(path, prefix, draft);
};

export const updateSlideAsset = (slide: number, field: string, value: any, draft: Draft): Draft => {
    return DraftResolver.set(`slide-${slide}-${field}`, value, draft);
};

/**
 * 2027 Institutional Resolver: getEffectiveSlideAsset
 * Handles inheritance chain for assets across slides.
 */
export const getEffectiveSlideAsset = (step: number, draft: Draft): SlideAsset => {
    const asset: SlideAsset = { ...draft.slideAssets?.[step] };
    
    // 1. Core Image Inheritance
    if (!asset.image) {
        asset.image = draft.image;
        asset.imageWidth = draft.imageWidth;
        asset.imageHeight = draft.imageHeight;
    }

    // 2. Metadata Inheritance
    asset.imageCredit = asset.imageCredit ?? draft.imageCredit;
    asset.creditPrefix = asset.creditPrefix ?? draft.creditPrefix;

    // 3. Focal & Opacity Inheritance (Only fallback if not explicitly set on this slide)
    asset.imageZoom = asset.imageZoom ?? draft.imageZoom;
    asset.imagePosX = asset.imagePosX ?? draft.imagePosX;
    asset.imagePosY = asset.imagePosY ?? draft.imagePosY;
    asset.imagePosY_Square = asset.imagePosY_Square ?? draft.imagePosY_Square;
    asset.snapMode = asset.snapMode ?? draft.snapMode;
    asset.scrim = asset.scrim ?? draft.scrim;

    return asset;
};
