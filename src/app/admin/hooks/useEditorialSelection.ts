import { useState, useEffect, useCallback } from 'react';

/**
 * 2027 Institutional Standard: useEditorialSelection
 * Centralized selection engine to replace redundant local listeners.
 * Orchestrates the "Global Selection Popover" state.
 */
export const useEditorialSelection = () => {
    const [selection, setSelection] = useState<{ 
        fieldId: string, 
        text: string, 
        x: number, 
        y: number 
    } | null>(null);

    const checkSelection = useCallback(() => {
        const activeEl = document.activeElement as HTMLInputElement | HTMLTextAreaElement;
        if (!activeEl || !activeEl.id?.startsWith('input-')) {
            setSelection(null);
            return;
        }

        const start = activeEl.selectionStart;
        const end = activeEl.selectionEnd;

        if (start !== null && end !== null && start !== end) {
            const rect = activeEl.getBoundingClientRect();
            // 🏛️ 2027 Position Logic: Center of selection bottom
            setSelection({
                fieldId: activeEl.id.replace('input-', ''),
                text: activeEl.value.substring(start, end),
                x: rect.left + (rect.width / 2),
                y: rect.bottom + window.scrollY
            });
        } else {
            setSelection(null);
        }
    }, []);

    useEffect(() => {
        document.addEventListener('mouseup', checkSelection);
        document.addEventListener('keyup', checkSelection);
        document.addEventListener('touchend', checkSelection);
        
        return () => {
            document.removeEventListener('mouseup', checkSelection);
            document.removeEventListener('keyup', checkSelection);
            document.removeEventListener('touchend', checkSelection);
        };
    }, [checkSelection]);

    return { selection, clearSelection: () => setSelection(null) };
};
