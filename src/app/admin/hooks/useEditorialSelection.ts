import { useState, useEffect, useCallback } from 'react';

/**
 * Tracks active text selection across dashboard editorial inputs for the floating format popover.
 */
export const useEditorialSelection = () => {
    const [selection, setSelection] = useState<{ 
        fieldId: string, 
        text: string, 
        x: number, 
        y: number,
        bottom: number
    } | null>(null);

    const checkSelection = useCallback(() => {
        const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
        if (!activeEl || !activeEl.id?.startsWith('input-')) {
            setSelection((prev) => (prev === null ? prev : null));
            return;
        }

        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;

        if (start !== null && end !== null && start !== end) {
            const rect = activeEl.getBoundingClientRect();
            const fieldId = activeEl.id.replace('input-', '');
            const text = activeEl.value.substring(start, end);
            const x = rect.left + (rect.width / 2);
            const y = rect.top;
            const bottom = rect.bottom;
            setSelection((prev) =>
                prev && prev.fieldId === fieldId && prev.text === text && prev.x === x && prev.y === y && prev.bottom === bottom
                    ? prev
                    : { fieldId, text, x, y, bottom }
            );
        } else {
            setSelection((prev) => (prev === null ? prev : null));
        }
    }, []);

    useEffect(() => {
        let rafId: number | null = null;
        const schedule = () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                rafId = null;
                checkSelection();
            });
        };

        document.addEventListener('selectionchange', schedule);
        document.addEventListener('mouseup', schedule);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            document.removeEventListener('selectionchange', schedule);
            document.removeEventListener('mouseup', schedule);
        };
    }, [checkSelection]);

    const clearSelection = useCallback(() => setSelection(null), []);

    return { selection, clearSelection };
};
