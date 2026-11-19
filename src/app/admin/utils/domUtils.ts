/** Inserts text at the active cursor position and restores selection focus. */
export const insertTextAtCursor = (fieldId: string, value: string, textToInsert: string, onUpdate: (newVal: string) => void) => {
    const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        const newVal = value.substring(0, start) + textToInsert + value.substring(end);
        onUpdate(newVal);
        
        requestAnimationFrame(() => {
            if (el && document.contains(el)) {
                el.focus();
                const newPos = start + textToInsert.length;
                el.setSelectionRange(newPos, newPos);
            }
        });
    } else {
        onUpdate(value ? value + " " + textToInsert : textToInsert);
    }
};

/**
 * Toggles inline formatting markers (e.g. ==...==, **...**) around the active text selection
 * to avoid duplicate nested markers.
 */
export const wrapSelectionWithSyntax = (fieldId: string, value: string, syntaxOpen: string, syntaxClose: string, onUpdate: (newVal: string) => void) => {
    const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const selection = value.substring(start, end);
        
        const lowerSelection = selection.toLowerCase();
        const lowerOpen = syntaxOpen.toLowerCase();
        const lowerClose = syntaxClose.toLowerCase();

        // 1. If selection ITSELF is wrapped in the markers, toggle them OFF
        if (lowerSelection.startsWith(lowerOpen) && lowerSelection.endsWith(lowerClose)) {
            const innerText = selection.substring(syntaxOpen.length, selection.length - syntaxClose.length);
            const newVal = value.substring(0, start) + innerText + value.substring(end);
            onUpdate(newVal);
            requestAnimationFrame(() => {
                if (el && document.contains(el)) {
                    el.focus();
                    el.setSelectionRange(start, start + innerText.length);
                }
            });
            return;
        }

        // 2. If the SURROUNDING text is the markers, toggle them OFF
        const prefix = value.substring(0, start);
        const suffix = value.substring(end);
        if (prefix.toLowerCase().endsWith(lowerOpen) && suffix.toLowerCase().startsWith(lowerClose)) {
            const newVal = prefix.substring(0, prefix.length - syntaxOpen.length) + selection + suffix.substring(syntaxClose.length);
            onUpdate(newVal);
            requestAnimationFrame(() => {
                if (el && document.contains(el)) {
                    el.focus();
                    el.setSelectionRange(start - syntaxOpen.length, end - syntaxOpen.length);
                }
            });
            return;
        }

        // 3. Otherwise, toggle them ON
        const newVal = prefix + syntaxOpen + selection + syntaxClose + suffix;
        onUpdate(newVal);
        
        requestAnimationFrame(() => {
            if (el && document.contains(el)) {
                el.focus();
                el.setSelectionRange(start + syntaxOpen.length, end + syntaxOpen.length);
            }
        });
    }
};
