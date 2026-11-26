import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Tracks active text selection across dashboard editorial inputs for the floating format popover.
 * Bails out synchronously with zero `rAF` scheduling when no `input-*` element is focused.
 */
export const useEditorialSelection = () => {
    const [selection, setSelection] = useState<{ 
        fieldId: string, 
        text: string, 
        x: number, 
        y: number,
        bottom: number,
        ribbonBottom: number | null
    } | null>(null);
    const hasSelectionRef = useRef(false);

    const checkSelection = useCallback(() => {
        const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (!activeEl || !activeEl.id?.startsWith('input-')) {
            if (hasSelectionRef.current) {
                hasSelectionRef.current = false;
                setSelection(null);
            }
            return;
        }

        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;

        if (start !== null && end !== null && start !== end) {
            const rect = activeEl.getBoundingClientRect();
            const ribbon = activeEl.closest('.command-ribbon');
            const ribbonBottom = ribbon ? Math.round(ribbon.getBoundingClientRect().bottom) : null;
            const fieldId = activeEl.id.replace('input-', '');
            const text = activeEl.value.substring(start, end);
            const x = rect.left + (rect.width / 2);
            const y = rect.top;
            const bottom = rect.bottom;
            hasSelectionRef.current = true;
            setSelection((prev) =>
                prev && prev.fieldId === fieldId && prev.text === text && prev.x === x && prev.y === y && prev.bottom === bottom && prev.ribbonBottom === ribbonBottom
                    ? prev
                    : { fieldId, text, x, y, bottom, ribbonBottom }
            );
        } else if (hasSelectionRef.current) {
            hasSelectionRef.current = false;
            setSelection(null);
        }
    }, []);

    useEffect(() => {
        let rafId: number | null = null;
        const schedule = () => {
            const activeEl = document.activeElement;
            if (!hasSelectionRef.current && (!activeEl || !activeEl.id?.startsWith('input-'))) {
                return;
            }
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;
                checkSelection();
            });
        };

        document.addEventListener('selectionchange', schedule);
        document.addEventListener('mouseup', schedule);
        document.addEventListener('focusout', schedule);
        const vv = window.visualViewport;
        const scheduleIfSelected = () => {
            if (hasSelectionRef.current) schedule();
        };
        vv?.addEventListener('resize', scheduleIfSelected);
        vv?.addEventListener('scroll', scheduleIfSelected);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            document.removeEventListener('selectionchange', schedule);
            document.removeEventListener('mouseup', schedule);
            document.removeEventListener('focusout', schedule);
            vv?.removeEventListener('resize', scheduleIfSelected);
            vv?.removeEventListener('scroll', scheduleIfSelected);
        };
    }, [checkSelection]);

    return { selection };
};
