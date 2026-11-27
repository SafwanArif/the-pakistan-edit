"use client";

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

export interface UseBufferedInputOptions {
    /** Called on blur / Enter with the uncommitted text when edit was not cancelled. */
    onCommit: (raw: string) => void;
    /** Optional input sanitizer applied on each keystroke (e.g. digits-only). */
    sanitize?: (raw: string) => string;
    /** Optional callback invoked after Enter/Escape exits edit mode (e.g. restore focus). */
    onExit?: () => void;
    /** Optional key whose change discards any active draft buffer (e.g. switching cards). */
    resetKey?: string | number;
    /** Defer `.select()` to next animation frame when focus replaces display text (e.g. stripping `%`). */
    deferSelect?: boolean;
}

/** Shared buffered text-editing hook for numeric & timecode inputs (`P16`, `P37`, `P71`, `P83`). */
export function useBufferedInput({ onCommit, sanitize, onExit, resetKey, deferSelect = false }: UseBufferedInputOptions) {
    const [draftText, setDraftText] = useState<string | null>(null);
    const [prevResetKey, setPrevResetKey] = useState(resetKey);
    const cancelRef = useRef(false);
    const selectRafRef = useRef<number | null>(null);

    if (resetKey !== prevResetKey) {
        setPrevResetKey(resetKey);
        if (draftText !== null) setDraftText(null);
    }

    useEffect(() => () => {
        if (selectRafRef.current !== null) cancelAnimationFrame(selectRafRef.current);
    }, []);

    const startEdit = useCallback((initialValue: string) => {
        cancelRef.current = false;
        setDraftText(initialValue);
    }, []);

    const clearEdit = useCallback(() => {
        cancelRef.current = false;
        setDraftText(null);
    }, []);

    const handleFocus = (e: FocusEvent<HTMLInputElement>, initialValue?: string) => {
        cancelRef.current = false;
        if (initialValue !== undefined) setDraftText(initialValue);
        const el = e.currentTarget;
        if (deferSelect) {
            if (selectRafRef.current !== null) cancelAnimationFrame(selectRafRef.current);
            selectRafRef.current = requestAnimationFrame(() => {
                selectRafRef.current = null;
                if (document.activeElement === el) el.select();
            });
        } else {
            el.select();
        }
    };

    const handleChange = (raw: string) => setDraftText(sanitize ? sanitize(raw) : raw);

    const handleBlur = () => {
        if (cancelRef.current) { cancelRef.current = false; setDraftText(null); return; }
        if (draftText === null) return;
        const raw = draftText;
        setDraftText(null);
        onCommit(raw);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
            onExit?.();
        } else if (e.key === "Escape") {
            e.preventDefault();
            e.nativeEvent.stopImmediatePropagation();
            cancelRef.current = true;
            setDraftText(null);
            e.currentTarget.blur();
            onExit?.();
        }
    };

    return { draftText, isEditing: draftText !== null, startEdit, clearEdit, handleFocus, handleChange, handleBlur, handleKeyDown };
}
