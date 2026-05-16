import { useState, useEffect, useCallback, useRef } from 'react';
import { Draft, createDefaultDraft } from '../../../types/news';
import { get, set } from 'idb-keyval';

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
    const saveTimeout = useRef<NodeJS.Timeout | null>(null);

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

            // 🏛️ 2027 ENGINE: LOAD FROM PERSISTENCE (IndexedDB)
            const savedDraft = await get<Draft>('tpe_active_draft');
            if (savedDraft) draft = { ...draft, ...savedDraft };

            const savedStep = await get<number>('tpe_current_step');
            if (savedStep) step = savedStep;

            setActiveDraft(draft);
            setCurrentStep(step);
            setHistoryState({ stack: [draft], index: 0 });
            setIsMounted(true);
        };

        init();
    }, []);

    const updateDraft = useCallback(async (newDraft: Draft, immediateCommit = false) => {
        setActiveDraft(newDraft);

        // 🏛️ 2027 PERFORMANCE: THROTTLED PERSISTENCE
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(async () => {
            await set('tpe_active_draft', newDraft);
        }, 150);

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
