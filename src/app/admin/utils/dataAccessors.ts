import { Draft } from "../../../types/news";

/**
 * 2027 Institutional Data Engine: Unified Property Resolver
 * Replaces manual path logic with dynamic schema mapping.
 */

const PATH_MAP: Record<string, string> = {
    'heading': 'heading',
    'content': 'content',
    'source': 'sourceName',
    'credit': 'imageCredit'
};

const resolveExtra = (fieldId: string) => {
    const match = fieldId.match(/extra-(heading|content|source)-(\d+)/);
    if (match && match[1] && match[2]) {
        const typeKey = match[1];
        return { type: PATH_MAP[typeKey], idx: parseInt(match[2], 10) };
    }
    return null;
};

export const getDraftValue = (fieldId: string, draft: Draft): string => {
    const extra = resolveExtra(fieldId);
    if (extra) return draft.extraSlides?.[extra.idx]?.[extra.type as keyof typeof draft.extraSlides[0]] || "";
    
    const assetMatch = fieldId.match(/slide-credit-(\d+)/);
    if (assetMatch && assetMatch[1]) return draft.slideAssets?.[parseInt(assetMatch[1], 10)]?.imageCredit || "";
    
    return (draft[fieldId as keyof Draft] as string) || "";
};

export const updateDraftValue = (fieldId: string, newVal: string, draft: Draft): Draft => {
    const extra = resolveExtra(fieldId);
    if (extra) {
        const slides = [...(draft.extraSlides || [])];
        const currentSlide = slides[extra.idx] || { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" };
        slides[extra.idx] = { ...currentSlide, [extra.type as any]: newVal };
        return { ...draft, extraSlides: slides };
    }
    
    const assetMatch = fieldId.match(/slide-credit-(\d+)/);
    if (assetMatch && assetMatch[1]) return updateSlideAsset(parseInt(assetMatch[1], 10), 'imageCredit', newVal, draft);
    
    return { ...draft, [fieldId]: newVal };
};

export const updateDraftPrefix = (fieldId: string, prefix: string, draft: Draft): Draft => {
    const extra = resolveExtra(fieldId);
    if (extra) {
        const slides = [...(draft.extraSlides || [])];
        const currentSlide = slides[extra.idx] || { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" };
        slides[extra.idx] = { ...currentSlide, sourcePrefix: prefix };
        return { ...draft, extraSlides: slides };
    }
    
    const assetMatch = fieldId.match(/slide-credit-(\d+)/);
    if (assetMatch && assetMatch[1]) return updateSlideAsset(parseInt(assetMatch[1], 10), 'creditPrefix', prefix, draft);
    
    const prefixField = fieldId === 'sourceName' ? 'sourcePrefix' : 'creditPrefix';
    return { ...draft, [prefixField]: prefix };
};

/**
 * Institutional Data Factory: 2027 Sequential Asset Inheritance
 */
export const getEffectiveSlideAsset = (slide: number, draft: Draft): any => {
    let result = {
        image: draft.image,
        scrim: draft.scrim ?? 0,
        imagePosX: draft.imagePosX ?? 50,
        imagePosY: draft.imagePosY ?? 50,
        imagePosY_Square: draft.imagePosY_Square ?? draft.imagePosY ?? 50,
        imageZoom: draft.imageZoom ?? 100,
        snapMode: draft.snapMode || 'height',
        imageWidth: draft.imageWidth,
        imageHeight: draft.imageHeight,
        imageCredit: draft.imageCredit,
        creditPrefix: draft.creditPrefix || "PHOTO:",
    };

    if (slide <= 1) return result;

    for (let i = 2; i <= slide; i++) {
        const specific = draft.slideAssets?.[i];
        const isNewImage = specific?.image !== undefined && specific.image !== result.image;
        const isInherited = !specific?.image;
        
        let defaultScrim = result.scrim;
        if (!specific || specific.scrim === undefined) {
            if (i === 2) defaultScrim = 35; 
            else if (i >= 3) defaultScrim = 45; 
        }

        result = {
            image: specific?.image || result.image,
            scrim: specific?.scrim ?? defaultScrim,
            imagePosX: specific?.imagePosX ?? result.imagePosX,
            imagePosY: specific?.imagePosY ?? result.imagePosY,
            imagePosY_Square: specific?.imagePosY_Square ?? result.imagePosY_Square,
            imageZoom: specific?.imageZoom ?? result.imageZoom,
            snapMode: specific?.snapMode || result.snapMode,
            imageWidth: specific?.imageWidth ?? result.imageWidth,
            imageHeight: specific?.imageHeight ?? result.imageHeight,
            imageCredit: (isNewImage) ? (specific?.imageCredit || "") : (isInherited ? "" : (specific?.imageCredit || "")),
            creditPrefix: (isNewImage) ? (specific?.creditPrefix || "PHOTO:") : (isInherited ? "PHOTO:" : (specific?.creditPrefix || "PHOTO:")),
        };
    }

    return result;
};

export const updateSlideAsset = (slide: number, field: string, value: any, draft: Draft): Draft => {
    const assets = { ...(draft.slideAssets || {}) };
    assets[slide] = { ...(assets[slide] || {}), [field]: value };
    return { ...draft, slideAssets: assets };
};
