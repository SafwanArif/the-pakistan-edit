"use client";

import { useMemo } from "react";
import type { Draft } from "@/types/news";
import { getEffectiveSlideAsset } from "../utils/dataAccessors";

/** Resolves normalized headline, body, credit, and asset display state for a Carousel slide. */
export const useNewsCardState = (draft: Draft, step: number) =>
    useMemo(() => {
        const safeStep = Number.isFinite(step) ? Math.max(1, Math.trunc(step)) : 1;
        const asset = getEffectiveSlideAsset(safeStep, draft);
        const shared = {
            photoPrefix: asset.creditPrefix || "PHOTO:",
            photoText: asset.imageCredit || "",
            asset,
            type: safeStep === 1 ? ("bulletin" as const) : ("narrative" as const),
        };

        if (safeStep === 1) {
            return { heading: draft.headline, content: "", sourcePrefix: "", sourceText: "", ...shared };
        }
        if (safeStep === 2) {
            return {
                heading: "",
                content: draft.summary || "",
                sourcePrefix: draft.sourcePrefix || "SOURCE:",
                sourceText: draft.sourceName || "",
                ...shared,
            };
        }
        const extra = draft.extraSlides?.[safeStep - 3];
        return {
            heading: extra?.heading || draft.category,
            content: extra?.content || "",
            sourcePrefix: extra?.sourcePrefix || "SOURCE:",
            sourceText: extra?.sourceName || "",
            ...shared,
        };
    }, [draft, step]);
