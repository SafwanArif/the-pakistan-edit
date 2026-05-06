import { useState, useEffect, useCallback } from 'react';
import { Draft, createDefaultDraft } from '../../../types/news';
import { get, set, del } from 'idb-keyval';

/**
 * 2027 Institutional Engine: useEditorialState
 * Lightweight, high-fidelity state management with Local-First persistence (IndexedDB).
 */
export const useEditorialState = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);
    const [activeDraft, setActiveDraft] = useState<Draft>(createDefaultDraft());

    useEffect(() => {
        const init = async () => {
            let draft = createDefaultDraft();
            let step = 1;

            // 1. Check for Legacy localStorage data (Migration)
            const legacyDraft = localStorage.getItem('tpe_active_draft');
            const legacyStep = localStorage.getItem('tpe_current_step');

            if (legacyDraft) {
                try {
                    const parsed = JSON.parse(legacyDraft);
                    if (typeof parsed === 'object' && parsed !== null) {
                        draft = { ...draft, ...parsed };
                        // Move to IndexedDB and clean up
                        await set('tpe_active_draft', draft);
                        localStorage.removeItem('tpe_active_draft');
                    }
                } catch (e) {
                    localStorage.removeItem('tpe_active_draft');
                }
            } else {
                // 2. Load from IndexedDB
                const savedDraft = await get<Draft>('tpe_active_draft');
                if (savedDraft) draft = { ...draft, ...savedDraft };
            }

            if (legacyStep) {
                step = parseInt(legacyStep) || 1;
                await set('tpe_current_step', step);
                localStorage.removeItem('tpe_current_step');
            } else {
                const savedStep = await get<number>('tpe_current_step');
                if (savedStep) step = savedStep;
            }

            setActiveDraft(draft);
            setCurrentStep(step);
            setIsMounted(true);
        };

        init();
    }, []);

    const updateDraft = useCallback(async (newDraft: Draft) => {
        setActiveDraft(newDraft);
        await set('tpe_active_draft', newDraft);
    }, []);

    const updateStep = useCallback(async (step: number) => {
        setCurrentStep(step);
        await set('tpe_current_step', step);
    }, []);

    const resetState = useCallback(async () => {
        const defaultDraft = createDefaultDraft();
        setActiveDraft(defaultDraft);
        setCurrentStep(1);
        await set('tpe_active_draft', defaultDraft);
        await set('tpe_current_step', 1);
    }, []);

    return {
        isMounted,
        currentStep,
        setCurrentStep: updateStep,
        activeDraft,
        updateDraft,
        resetState
    };
};
