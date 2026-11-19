import { useState, useEffect, useCallback, useRef } from 'react';
import { Draft, createDefaultDraft } from '../../../types/news';
import { get, set } from 'idb-keyval';

const fingerprintImage = (img?: string) => (img ? `${img.length}:${img.slice(0, 32)}` : '');

/** Avoids serialising multi-megabyte Base64 images when comparing history snapshots. */
const getDraftFingerprint = (d: Draft): string =>
    JSON.stringify({
        ...d,
        image: fingerprintImage(d.image),
        slideAssets: d.slideAssets
            ? Object.fromEntries(
                  Object.entries(d.slideAssets).map(([k, v]) => [k, { ...v, image: fingerprintImage(v.image) }])
              )
            : undefined,
    });

/**
 * Local-first state hook with undo/redo history and IndexedDB persistence for Carousel drafts.
 */
export const useEditorialState = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);
    const [activeDraft, setActiveDraft] = useState<Draft>(createDefaultDraft());
    const [historyState, setHistoryState] = useState<{ stack: Draft[], index: number }>({ stack: [], index: -1 });
    const historyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    const commitToHistory = useCallback((draftToCommit: Draft) => {
        setHistoryState(prev => {
            const currentStack = prev.stack.slice(0, prev.index + 1);
            if (
                currentStack.length > 0 &&
                getDraftFingerprint(currentStack[currentStack.length - 1]!) === getDraftFingerprint(draftToCommit)
            ) {
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

    useEffect(() => () => {
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
    }, []);

    const updateDraft = useCallback(async (newDraft: Draft, immediateCommit = false) => {
        setActiveDraft(newDraft);

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
        if (historyState.index <= 0) return;
        const newIndex = historyState.index - 1;
        const previousDraft = historyState.stack[newIndex];
        if (!previousDraft) return;

        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);

        setHistoryState(prev => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
        setActiveDraft(previousDraft);
        await set('tpe_active_draft', previousDraft);
    }, [historyState]);

    const redo = useCallback(async () => {
        if (historyState.index >= historyState.stack.length - 1) return;
        const newIndex = historyState.index + 1;
        const nextDraft = historyState.stack[newIndex];
        if (!nextDraft) return;

        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);

        setHistoryState(prev => (prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev));
        setActiveDraft(nextDraft);
        await set('tpe_active_draft', nextDraft);
    }, [historyState]);

    const updateStep = useCallback(async (step: number) => {
        setCurrentStep(step);
        await set('tpe_current_step', step);
    }, []);

    const resetState = useCallback(async () => {
        const defaultDraft = createDefaultDraft();
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        setActiveDraft(defaultDraft);
        setCurrentStep(1);
        setHistoryState({ stack: [defaultDraft], index: 0 });
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
