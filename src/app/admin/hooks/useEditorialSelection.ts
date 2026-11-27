"use client";

import { useState, useEffect, useRef } from "react";

interface EditorialSelection {
    fieldId: string;
    text: string;
    x: number;
    y: number;
    bottom: number;
    ribbonBottom: number | null;
}

const isEditorialInput = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
    (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.id.startsWith("input-");

/**
 * Tracks active text selection across dashboard editorial inputs for the floating format popover.
 * Bails out synchronously with zero `rAF` scheduling on collapsed caret moves (`P118`).
 */
export const useEditorialSelection = () => {
    const [selection, setSelection] = useState<EditorialSelection | null>(null);
    const hasSelectionRef = useRef(false);

    useEffect(() => {
        let rafId: number | null = null;
        const clear = () => {
            if (!hasSelectionRef.current) return;
            hasSelectionRef.current = false;
            setSelection(null);
        };

        const checkSelection = () => {
            if (document.querySelector("dialog[open]")) { clear(); return; }
            const activeEl = document.activeElement;
            if (!isEditorialInput(activeEl)) { clear(); return; }

            const start = activeEl.selectionStart;
            const end = activeEl.selectionEnd;
            if (typeof start === "number" && typeof end === "number" && start !== end) {
                const rect = activeEl.getBoundingClientRect();
                const ribbon = activeEl.closest(".command-ribbon");
                const ribbonBottom = ribbon ? Math.round(ribbon.getBoundingClientRect().bottom) : null;
                const fieldId = activeEl.id.slice("input-".length);
                const text = activeEl.value.substring(start, end);
                const x = Math.round(rect.left + rect.width / 2);
                const y = Math.round(rect.top);
                const bottom = Math.round(rect.bottom);
                hasSelectionRef.current = true;
                setSelection((prev) =>
                    prev && prev.fieldId === fieldId && prev.text === text && prev.x === x && prev.y === y && prev.bottom === bottom && prev.ribbonBottom === ribbonBottom
                        ? prev
                        : { fieldId, text, x, y, bottom, ribbonBottom }
                );
            } else {
                clear();
            }
        };

        const schedule = () => {
            const activeEl = document.activeElement;
            if (!hasSelectionRef.current && (!isEditorialInput(activeEl) || activeEl.selectionStart === activeEl.selectionEnd)) {
                return;
            }
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;
                checkSelection();
            });
        };
        const scheduleIfSelected = () => { if (hasSelectionRef.current) schedule(); };

        const ac = new AbortController();
        const { signal } = ac;
        document.addEventListener("selectionchange", schedule, { signal });
        document.addEventListener("mouseup", schedule, { signal });
        document.addEventListener("focusout", schedule, { signal });
        document.addEventListener("scroll", scheduleIfSelected, { capture: true, passive: true, signal });
        window.addEventListener("resize", scheduleIfSelected, { signal });
        window.visualViewport?.addEventListener("resize", scheduleIfSelected, { signal });
        window.visualViewport?.addEventListener("scroll", scheduleIfSelected, { signal });

        return () => {
            ac.abort();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, []);

    return { selection };
};
