export interface SlideAsset {
    image?: string;
    imagePosX?: number;
    imagePosY?: number;
    imagePosY_Square?: number;
    imageZoom?: number;
    snapMode?: 'height' | 'width' | 'grid';
    imageWidth?: number;
    imageHeight?: number;
    scrim?: number;
    imageCredit?: string;
    creditPrefix?: string;
}

export interface Draft {
    headline: string;
    category: string;
    summary?: string;
    scrim?: number;
    // NOTE: Slide 3+ narrative content is strictly managed via extraSlides[n]
    sourceName?: string;
    sourcePrefix?: string;
    image?: string;
    imagePosX?: number;
    imagePosY?: number;
    imagePosY_Square?: number;
    imageZoom?: number;
    snapMode?: 'height' | 'width' | 'grid';
    imageWidth?: number;
    imageHeight?: number;
    imageCredit?: string;
    creditPrefix?: string;
    extraSlides: {
        heading: string;
        content: string;
        sourceName?: string;
        sourcePrefix?: string;
    }[];
    slideAssets?: Record<number, SlideAsset>;
}

/** 
 * Institutional Factory: Generates a pristine Draft with fail-safe defaults 
 */
export const createDefaultDraft = (): Draft => ({
    headline: "",
    category: "ECONOMY",
    summary: "",
    sourceName: "",
    sourcePrefix: "SOURCE:",
    image: "",
    imagePosX: 50,
    imagePosY: 50,
    imageZoom: 100,
    snapMode: 'height',
    imageCredit: "",
    creditPrefix: "PHOTO:",
    extraSlides: [
        { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" } // Slide 3 (Missing Context)
    ],
    slideAssets: {}
});

/**
 * Fail-safe Prefix Combiner: Sanitizes and joins editorial attribution strings.
 */
export const combinePrefix = (prefix: string | undefined, text: string | undefined): string => {
    const p = prefix?.trim()?.toUpperCase() || "";
    const t = text?.trim() || "";
    if (!t) return ""; 
    return p ? `${p} ${t}` : t;
};

/**
 * Robust Slide Counter: Deterministic calculation of export targets.
 */
export const getSlideCount = (draft: Draft): number => {
    let count = 1;
    if (draft.summary?.trim()) count = 2;
    // Slide 3 is the first extraSlide
    if (draft.extraSlides && draft.extraSlides.length > 0 && draft.extraSlides[0]?.content?.trim()) {
        count = 3;
        // Any slides beyond Slide 3
        if (draft.extraSlides.length > 1) {
            count += (draft.extraSlides.length - 1);
        }
    }
    return count;
};
