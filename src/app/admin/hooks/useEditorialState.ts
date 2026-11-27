"use client";

import { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { Draft, createDefaultDraft } from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";
import { get, set } from "idb-keyval";
import { useDebouncedIdbSave } from "./useDebouncedIdbSave";
import { STORAGE_KEYS } from "../utils/storageKeys";

/** Preserves full URLs (`<= 128` chars, including UUID `blob:` URLs on any domain) while bounding Base64 strings (`P99`). */
export const fingerprintImage = (img?: string): string =>
    !img ? "" : img.length <= 128 ? img : `${img.length}:${img.slice(0, 32)}:${img.slice(-32)}`;

/** Sanitizes a hydrated IndexedDB Carousel draft, stripping expired `blob:` URLs and corrupted fields (`P96`, `P119`). */
export const sanitizeHydratedDraft = (savedDraft: unknown, base: Draft = createDefaultDraft()): Draft => {
    if (!savedDraft || typeof savedDraft !== "object") return base;
    const draft: Draft = { ...base, ...(savedDraft as Partial<Draft>) };
    if (draft.extraSlides && !Array.isArray(draft.extraSlides)) draft.extraSlides = [];
    if (draft.image?.startsWith("blob:")) {
        draft.image = "";
        draft.imageWidth = 0;
        draft.imageHeight = 0;
    }
    if (draft.slideAssets && typeof draft.slideAssets === "object") {
        const cleaned: NonNullable<Draft["slideAssets"]> = {};
        for (const [k, asset] of Object.entries(draft.slideAssets)) {
            if (!asset || typeof asset !== "object") continue;
            cleaned[Number(k)] = asset.image?.startsWith("blob:")
                ? { ...asset, image: "", imageWidth: 0, imageHeight: 0 }
                : asset;
        }
        draft.slideAssets = cleaned;
    } else {
        draft.slideAssets = undefined;
    }
    return draft;
};

/** Avoids serialising multi-megabyte Base64 images when comparing history snapshots. */
const getDraftFingerprint = (d: Draft): string =>
    JSON.stringify({
        ...d,
        image: fingerprintImage(d.image),
        slideAssets: d.slideAssets
            ? Object.fromEntries(
                  Object.entries(d.slideAssets)
                      .filter((entry): entry is [string, NonNullable<Draft["slideAssets"]>[number]] => Boolean(entry[1] && typeof entry[1] === "object"))
                      .map(([k, v]) => [k, { ...v, image: fingerprintImage(v.image) }])
              )
            : undefined,
    });

const revokeCarouselDraftBlobs = (drafts: Draft[]) => {
    const seen = new Set<string>();
    for (const d of drafts) {
        if (d.image?.startsWith("blob:")) seen.add(d.image);
        if (d.slideAssets) {
            for (const asset of Object.values(d.slideAssets)) {
                if (asset?.image?.startsWith("blob:")) seen.add(asset.image);
            }
        }
    }
    seen.forEach((url) => revokeBlobUrl(url));
};

const pushHistoryEntry = (prev: { stack: Draft[]; index: number }, draft: Draft) => {
    const base = prev.stack.slice(0, prev.index + 1);
    if (base.length > 0 && getDraftFingerprint(base[base.length - 1]!) === getDraftFingerprint(draft)) return prev;
    const stack = [...base, draft].slice(-15);
    return { stack, index: stack.length - 1 };
};

/** Local-first state hook with undo/redo history and IndexedDB persistence for Carousel drafts. */
export const useEditorialState = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [currentStep, setCurrentStep] = useState(1);
    const [activeDraft, setActiveDraft] = useState<Draft>(createDefaultDraft);
    const [historyState, setHistoryState] = useState<{ stack: Draft[]; index: number }>({ stack: [], index: -1 });
    const historyTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const historyRef = useRef(historyState);
    const activeDraftRef = useRef(activeDraft);
    const currentStepRef = useRef(currentStep);
    const hasUserMutatedRef = useRef(false);
    const hasStepMutatedRef = useRef(false);
    const { scheduleSave: scheduleDraftSave, saveNow: saveDraftNow } = useDebouncedIdbSave<Draft>(STORAGE_KEYS.ACTIVE_DRAFT);

    useLayoutEffect(() => {
        historyRef.current = historyState;
        activeDraftRef.current = activeDraft;
        currentStepRef.current = currentStep;
    });

    const syncState = useCallback((draft: Draft, history: { stack: Draft[]; index: number }) => {
        activeDraftRef.current = draft;
        historyRef.current = history;
        setActiveDraft(draft);
        setHistoryState(history);
    }, []);

    const commitToHistory = useCallback((draftToCommit: Draft) => {
        setHistoryState((prev) => {
            const next = pushHistoryEntry(prev, draftToCommit);
            historyRef.current = next;
            return next;
        });
    }, []);

    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            let draft = createDefaultDraft();
            let step = 1;
            try {
                const [savedDraft, savedStep] = await Promise.all([
                    get<Draft>(STORAGE_KEYS.ACTIVE_DRAFT),
                    get<number>(STORAGE_KEYS.CURRENT_STEP),
                ]);
                draft = sanitizeHydratedDraft(savedDraft, draft);
                if (typeof savedStep === "number" && Number.isFinite(savedStep) && savedStep >= 1) {
                    step = Math.trunc(savedStep);
                }
            } catch (err) {
                console.warn("EDITORIAL_HYDRATION_FAILED:", err);
            } finally {
                if (!cancelled) {
                    if (!hasUserMutatedRef.current) syncState(draft, { stack: [draft], index: 0 });
                    if (!hasStepMutatedRef.current) { currentStepRef.current = step; setCurrentStep(step); }
                    setIsMounted(true);
                }
            }
        };
        void init();
        return () => { cancelled = true; };
    }, [syncState]);

    useEffect(() => () => {
        if (historyTimeout.current) clearTimeout(historyTimeout.current);
        revokeCarouselDraftBlobs([...historyRef.current.stack, activeDraftRef.current]);
    }, []);

    const updateDraft = useCallback((newDraft: Draft, immediateCommit = false) => {
        hasUserMutatedRef.current = true;
        activeDraftRef.current = newDraft;
        setActiveDraft(newDraft);
        scheduleDraftSave(newDraft);

        if (historyTimeout.current) { clearTimeout(historyTimeout.current); historyTimeout.current = null; }
        if (immediateCommit) {
            commitToHistory(newDraft);
        } else {
            historyTimeout.current = setTimeout(() => {
                historyTimeout.current = null;
                commitToHistory(newDraft);
            }, 1000);
        }
    }, [commitToHistory, scheduleDraftSave]);

    const stepHistory = useCallback(async (delta: -1 | 1) => {
        let cur = historyRef.current;
        if (historyTimeout.current) {
            clearTimeout(historyTimeout.current);
            historyTimeout.current = null;
            // Flush pending typed edit onto history before stepping Undo so Redo can recover it (`P108`)
            if (delta === -1) cur = pushHistoryEntry(cur, activeDraftRef.current);
        }
        const nextIndex = cur.index + delta;
        if (nextIndex < 0 || nextIndex >= cur.stack.length) return;
        const targetDraft = cur.stack[nextIndex];
        if (!targetDraft) return;

        hasUserMutatedRef.current = true;
        syncState(targetDraft, { stack: cur.stack, index: nextIndex });
        await saveDraftNow(targetDraft);
    }, [saveDraftNow, syncState]);

    const undo = useCallback(() => stepHistory(-1), [stepHistory]);
    const redo = useCallback(() => stepHistory(1), [stepHistory]);

    const updateStep = useCallback(async (step: number) => {
        const safeStep = Number.isFinite(step) ? Math.max(1, Math.trunc(step)) : 1;
        hasStepMutatedRef.current = true;
        if (safeStep === currentStepRef.current) return;
        currentStepRef.current = safeStep;
        setCurrentStep(safeStep);
        try { await set(STORAGE_KEYS.CURRENT_STEP, safeStep); }
        catch (err) { console.warn("IDB_STEP_SAVE_FAILED:", err); }
    }, []);

    const resetState = useCallback(async () => {
        hasUserMutatedRef.current = true;
        hasStepMutatedRef.current = true;
        if (historyTimeout.current) { clearTimeout(historyTimeout.current); historyTimeout.current = null; }
        revokeCarouselDraftBlobs([...historyRef.current.stack, activeDraftRef.current]);
        const defaultDraft = createDefaultDraft();
        syncState(defaultDraft, { stack: [defaultDraft], index: 0 });
        currentStepRef.current = 1;
        setCurrentStep(1);
        await saveDraftNow(defaultDraft);
        try { await set(STORAGE_KEYS.CURRENT_STEP, 1); }
        catch (err) { console.warn("IDB_STEP_RESET_FAILED:", err); }
    }, [saveDraftNow, syncState]);

    return {
        isMounted, currentStep, setCurrentStep: updateStep, activeDraft, updateDraft, resetState, undo, redo,
        canUndo: historyState.index > 0,
        canRedo: historyState.index < historyState.stack.length - 1,
    };
};
