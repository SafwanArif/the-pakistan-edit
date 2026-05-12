import { useState, useEffect, useCallback, useRef } from 'react';
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
    const [historyState, setHistoryState] = useState<{ stack: Draft[], index: number }>({ stack: [], index: -1 });
    const historyTimeout = useRef<NodeJS.Timeout | null>(null);

    const commitToHistory = useCallback((draftToCommit: Draft) => {
        setHistoryState(prev => {
            const currentStack = prev.stack.slice(0, prev.index + 1);
            if (currentStack.length > 0 && JSON.stringify(currentStack[currentStack.length - 1]) === JSON.stringify(draftToCommit)) {
                return prev;
            }
            const newStack = [...currentStack, draftToCommit].slice(-15);
            return { stack: newStack, index: newStack.length - 1 };
        });
    }, []);

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
            setHistoryState({ stack: [draft], index: 0 });
            setIsMounted(true);
        };

        init();
    }, []);

    const updateDraft = useCallback(async (newDraft: Draft, immediateCommit = false) => {
        setActiveDraft(newDraft);
        await set('tpe_active_draft', newDraft);

        if (historyTimeout.current) clearTimeout(historyTimeout.current);

        if (immediateCommit) {
            commitToHistory(newDraft);
        } else {
            historyTimeout.current = setTimeout(() => {
                commitToHistory(newDraft);
            }, 1000);
        }
    }, [commitToHistory]);

    const undo = useCallback(async () => {
        setHistoryState(prev => {
            if (prev.index > 0) {
                const newIndex = prev.index - 1;
                const previousDraft = prev.stack[newIndex]!;
                setActiveDraft(previousDraft);
                set('tpe_active_draft', previousDraft);
                return { ...prev, index: newIndex };
            }
            return prev;
        });
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
    }, []);

    const redo = useCallback(async () => {
        setHistoryState(prev => {
            if (prev.index < prev.stack.length - 1) {
                const newIndex = prev.index + 1;
                const nextDraft = prev.stack[newIndex]!;
                setActiveDraft(nextDraft);
                set('tpe_active_draft', nextDraft);
                return { ...prev, index: newIndex };
            }
            return prev;
        });
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
    }, []);

    const updateStep = useCallback(async (step: number) => {
        setCurrentStep(step);
        await set('tpe_current_step', step);
    }, []);

    const resetState = useCallback(async () => {
        const defaultDraft = createDefaultDraft();
        setActiveDraft(defaultDraft);
        setCurrentStep(1);
        setHistoryState({ stack: [defaultDraft], index: 0 });
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        await set('tpe_active_draft', defaultDraft);
        await set('tpe_current_step', 1);
    }, []);

    return {
        isMounted,
        currentStep,
        setCurrentStep: updateStep,
        activeDraft,
        updateDraft,
        resetState,
        undo,
        redo,
        canUndo: historyState.index > 0,
        canRedo: historyState.index < historyState.stack.length - 1
    };
};
