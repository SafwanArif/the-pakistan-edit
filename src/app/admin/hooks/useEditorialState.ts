import { useState, useEffect, useCallback, useRef } from 'react';
import { Draft, createDefaultDraft } from '@/types/news';
import { get, set } from 'idb-keyval';
import { useDebouncedIdbSave } from './useDebouncedIdbSave';
import { STORAGE_KEYS } from '../utils/storageKeys';

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
    const { scheduleSave: scheduleDraftSave, saveNow: saveDraftNow } = useDebouncedIdbSave<Draft>(STORAGE_KEYS.ACTIVE_DRAFT);

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
        let cancelled = false;
        const init = async () => {
            let draft = createDefaultDraft();
            let step = 1;

            const savedDraft = await get<Draft>(STORAGE_KEYS.ACTIVE_DRAFT);
            if (savedDraft) {
                draft = { ...draft, ...savedDraft };
                // Ephemeral object URLs do not survive page reloads; strip dead blob: refs cleanly
                if (draft.image?.startsWith('blob:')) {
                    draft.image = '';
                    draft.imageWidth = 0;
                    draft.imageHeight = 0;
                }
                if (draft.slideAssets) {
                    const cleanedAssets: NonNullable<Draft['slideAssets']> = {};
                    for (const [k, asset] of Object.entries(draft.slideAssets)) {
                        cleanedAssets[Number(k)] = asset.image?.startsWith('blob:')
                            ? { ...asset, image: '', imageWidth: 0, imageHeight: 0 }
                            : asset;
                    }
                    draft.slideAssets = cleanedAssets;
                }
            }

            const savedStep = await get<number>(STORAGE_KEYS.CURRENT_STEP);
            if (savedStep) step = savedStep;

            if (cancelled) return;
            setActiveDraft(draft);
            setCurrentStep(step);
            setHistoryState({ stack: [draft], index: 0 });
            setIsMounted(true);
        };

        void init();
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => () => {
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
    }, []);

    const updateDraft = useCallback(async (newDraft: Draft, immediateCommit = false) => {
        setActiveDraft(newDraft);
        scheduleDraftSave(newDraft);

        if (historyTimeout.current) clearTimeout(historyTimeout.current);

        if (immediateCommit) {
            commitToHistory(newDraft);
        } else {
            historyTimeout.current = setTimeout(() => {
                commitToHistory(newDraft);
            }, 1000);
        }
    }, [commitToHistory, scheduleDraftSave]);

    const undo = useCallback(async () => {
        if (historyState.index <= 0) return;
        const newIndex = historyState.index - 1;
        const previousDraft = historyState.stack[newIndex];
        if (!previousDraft) return;

        if (historyTimeout.current) clearTimeout(historyTimeout.current);

        setHistoryState(prev => (prev.index > 0 ? { ...prev, index: prev.index - 1 } : prev));
        setActiveDraft(previousDraft);
        await saveDraftNow(previousDraft);
    }, [historyState, saveDraftNow]);

    const redo = useCallback(async () => {
        if (historyState.index >= historyState.stack.length - 1) return;
        const newIndex = historyState.index + 1;
        const nextDraft = historyState.stack[newIndex];
        if (!nextDraft) return;

        if (historyTimeout.current) clearTimeout(historyTimeout.current);

        setHistoryState(prev => (prev.index < prev.stack.length - 1 ? { ...prev, index: prev.index + 1 } : prev));
        setActiveDraft(nextDraft);
        await saveDraftNow(nextDraft);
    }, [historyState, saveDraftNow]);

    const updateStep = useCallback(async (step: number) => {
        setCurrentStep(step);
        await set(STORAGE_KEYS.CURRENT_STEP, step);
    }, []);

    const resetState = useCallback(async () => {
        const defaultDraft = createDefaultDraft();
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        setActiveDraft(defaultDraft);
        setCurrentStep(1);
        setHistoryState({ stack: [defaultDraft], index: 0 });
        await saveDraftNow(defaultDraft);
        await set(STORAGE_KEYS.CURRENT_STEP, 1);
    }, [saveDraftNow]);

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
