import { useMemo } from 'react';
import { Draft } from '../../../types/news';
import { getEffectiveSlideAsset } from '../utils/dataAccessors';

/**
 * 2027 Institutional Standard: useNewsCardState
 * Centralized logic for resolving the display state of a NewsCard.
 * Clean separation of prefixes and text.
 */
export const useNewsCardState = (draft: Draft, step: number) => {
    return useMemo(() => {
        const asset = getEffectiveSlideAsset(step, draft);
        
        // 1. Resolve Narrative Content
        let heading = "";
        let content = "";
        let sourcePrefix = "";
        let sourceText = "";

        if (step === 1) {
            heading = draft.headline;
            content = "";
            sourcePrefix = "";
            sourceText = "";
        } else if (step === 2) {
            heading = "";
            content = draft.summary || "";
            sourcePrefix = draft.sourcePrefix || "";
            sourceText = draft.sourceName || "";
        } else {
            const index = step - 3;
            const extra = draft.extraSlides?.[index];
            heading = extra?.heading || draft.category;
            content = extra?.content || "";
            sourcePrefix = extra?.sourcePrefix || "";
            sourceText = extra?.sourceName || "";
        }

        return {
            heading,
            content,
            sourcePrefix,
            sourceText,
            photoPrefix: asset.creditPrefix || "",
            photoText: asset.imageCredit || "",
            asset,
            type: step === 1 ? 'bulletin' as const : 'narrative' as const
        };
    }, [draft, step]);
};
