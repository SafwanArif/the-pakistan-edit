"use client";

import { useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

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

/**
 * Shared buffered text-editing hook for numeric & timecode inputs:
 * - Isolates `Escape` via `stopImmediatePropagation()` so parent drawers/HUDs stay open (`P71`)
 * - Guards synchronous blur-on-Escape with a cancel ref so cancelled edits never commit (`P16`)
 * - Auto-selects value on focus for effortless replacement (`P37`)
 */
export function useBufferedInput({
    onCommit,
    sanitize,
    onExit,
    resetKey,
    deferSelect = false,
}: UseBufferedInputOptions) {
    const [draftText, setDraftText] = useState<string | null>(null);
    const [prevResetKey, setPrevResetKey] = useState(resetKey);
    const cancelRef = useRef(false);

    if (resetKey !== prevResetKey) {
        setPrevResetKey(resetKey);
        if (draftText !== null) setDraftText(null);
    }

    const startEdit = (initialValue: string) => {
        cancelRef.current = false;
        setDraftText(initialValue);
    };

    const clearEdit = () => {
        cancelRef.current = false;
        setDraftText(null);
    };

    const handleFocus = (e: FocusEvent<HTMLInputElement>, initialValue?: string) => {
        cancelRef.current = false;
        if (initialValue !== undefined) setDraftText(initialValue);
        const el = e.currentTarget;
        if (deferSelect) {
            requestAnimationFrame(() => {
                if (document.activeElement === el) el.select();
            });
        } else {
            el.select();
        }
    };

    const handleChange = (raw: string) => {
        setDraftText(sanitize ? sanitize(raw) : raw);
    };

    const handleBlur = (e: FocusEvent<HTMLInputElement>) => {
        if (cancelRef.current) {
            cancelRef.current = false;
            setDraftText(null);
            return;
        }
        const raw = draftText ?? e.currentTarget.value;
        setDraftText(null);
        onCommit(raw);
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            e.currentTarget.blur();
            onExit?.();
        } else if (e.key === "Escape") {
            e.nativeEvent.stopImmediatePropagation();
            cancelRef.current = true;
            setDraftText(null);
            e.currentTarget.blur();
            onExit?.();
        }
    };

    return {
        draftText,
        isEditing: draftText !== null,
        startEdit,
        clearEdit,
        handleFocus,
        handleChange,
        handleBlur,
        handleKeyDown,
    };
}
