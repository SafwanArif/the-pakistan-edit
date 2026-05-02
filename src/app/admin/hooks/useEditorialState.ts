import { useState, useEffect, useCallback } from 'react';
import { Draft, createDefaultDraft } from '../../../types/news';

/**
 * 2027 Institutional Engine: useEditorialState
 * Lightweight, high-fidelity state management with auto-migration.
 */
export const useEditorialState = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);
    const [activeDraft, setActiveDraft] = useState<Draft>(createDefaultDraft);

    useEffect(() => {
        setIsMounted(true);
        const savedDraft = localStorage.getItem('tpe_active_draft');
        if (savedDraft) {
            try {
                const parsed = JSON.parse(savedDraft);
                if (typeof parsed === 'object' && parsed !== null) {

                    setActiveDraft({ ...createDefaultDraft(), ...parsed });
                }
            } catch (e) {
                localStorage.removeItem('tpe_active_draft');
            }
        }
        const savedStep = localStorage.getItem('tpe_current_step');
        if (savedStep) setCurrentStep(parseInt(savedStep) || 1);
    }, []);

    const updateDraft = useCallback((newDraft: Draft) => {
        setActiveDraft(newDraft);
        localStorage.setItem('tpe_active_draft', JSON.stringify(newDraft));
    }, []);

    const updateStep = useCallback((step: number) => {
        setCurrentStep(step);
        localStorage.setItem('tpe_current_step', step.toString());
    }, []);

    return {
        isMounted,
        currentStep,
        setCurrentStep: updateStep,
        activeDraft,
        updateDraft,
        resetState: useCallback(() => { updateDraft(createDefaultDraft()); updateStep(1); }, [updateDraft, updateStep])
    };
};
