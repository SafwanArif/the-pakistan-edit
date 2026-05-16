import { useMemo } from 'react';
import { Draft, SlideAsset, combinePrefix } from '../../../types/news';
import { getEffectiveSlideAsset } from '../utils/dataAccessors';

/**
 * 2027 Institutional Standard: useNewsCardState
 * Centralized logic for resolving the display state of a NewsCard.
 * Handles fallbacks, prefix combination, and focal resolution.
 */
export const useNewsCardState = (draft: Draft, step: number) => {
    return useMemo(() => {
        const asset = getEffectiveSlideAsset(step, draft);
        
        // 1. Resolve Narrative Content
        let heading = "";
        let content = "";
        let source = "";

        if (step === 1) {
            heading = draft.headline;
            content = "";
            source = "";
        } else if (step === 2) {
            heading = draft.category;
            content = draft.summary || "";
            source = combinePrefix(draft.sourcePrefix, draft.sourceName);
        } else {
            const index = step - 3;
            const extra = draft.extraSlides?.[index];
            heading = extra?.heading || draft.category;
            content = extra?.content || "";
            source = combinePrefix(extra?.sourcePrefix, extra?.sourceName);
        }

        // 2. Resolve Asset Metadata
        const photo = combinePrefix(asset.creditPrefix, asset.imageCredit);

        return {
            heading,
            content,
            source,
            photo,
            asset,
            type: step === 1 ? 'bulletin' as const : 'narrative' as const
        };
    }, [draft, step]);
};
