import { Draft } from "../../../types/news";
import { produce } from "immer";

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

const resolveExtra = (fieldId: string): { type: string, idx: number } | null => {
    const match = fieldId.match(/extra-(heading|content|source)-(\d+)/);
    if (match && match[1] && match[2]) {
        const typeKey = match[1];
        const resolvedType = PATH_MAP[typeKey];
        if (resolvedType) {
            return { type: resolvedType, idx: parseInt(match[2], 10) };
        }
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
    return produce(draft, draft => {
        const extra = resolveExtra(fieldId);
        if (extra) {
            if (!draft.extraSlides) draft.extraSlides = [];
            if (!draft.extraSlides[extra.idx]) {
                draft.extraSlides[extra.idx] = { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" };
            }
            (draft.extraSlides as any)[extra.idx][extra.type] = newVal;
            return;
        }
        
        const assetMatch = fieldId.match(/slide-credit-(\d+)/);
        if (assetMatch && assetMatch[1]) {
            const slide = parseInt(assetMatch[1], 10);
            if (!draft.slideAssets) draft.slideAssets = {};
            if (!draft.slideAssets[slide]) draft.slideAssets[slide] = {};
            draft.slideAssets[slide].imageCredit = newVal;
            return;
        }
        
        (draft as any)[fieldId] = newVal;
    });
};

export const updateDraftPrefix = (fieldId: string, prefix: string, draft: Draft): Draft => {
    return produce(draft, draft => {
        const extra = resolveExtra(fieldId);
        if (extra) {
            if (!draft.extraSlides) draft.extraSlides = [];
            if (!draft.extraSlides[extra.idx]) {
                draft.extraSlides[extra.idx] = { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" };
            }
            (draft.extraSlides as any)[extra.idx].sourcePrefix = prefix;
            return;
        }
        
        const assetMatch = fieldId.match(/slide-credit-(\d+)/);
        if (assetMatch && assetMatch[1]) {
            const slide = parseInt(assetMatch[1], 10);
            if (!draft.slideAssets) draft.slideAssets = {};
            if (!draft.slideAssets[slide]) draft.slideAssets[slide] = {};
            draft.slideAssets[slide].creditPrefix = prefix;
            return;
        }
        
        const prefixField = fieldId === 'sourceName' ? 'sourcePrefix' : 'creditPrefix';
        (draft as any)[prefixField] = prefix;
    });
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
    return produce(draft, draft => {
        if (!draft.slideAssets) draft.slideAssets = {};
        if (!draft.slideAssets[slide]) draft.slideAssets[slide] = {};
        (draft.slideAssets[slide] as any)[field] = value;
    });
};
