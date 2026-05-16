/**
 * 2027 Institutional Utility: insertTextAtCursor
 * Standardized logic for injecting emojis or formatting into input fields.
 */
export const insertTextAtCursor = (fieldId: string, value: string, textToInsert: string, onUpdate: (newVal: string) => void) => {
    const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement;
    if (el && typeof el.selectionStart === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        const newVal = value.substring(0, start) + textToInsert + value.substring(end);
        onUpdate(newVal);
        
        // Return focus and reposition cursor
        setTimeout(() => {
            if (el && document.contains(el)) {
                el.focus();
                const newPos = start + textToInsert.length;
                el.setSelectionRange(newPos, newPos);
            }
        }, 0);
    } else {
        // Fallback for non-input contexts
        onUpdate(value ? value + " " + textToInsert : textToInsert);
    }
};

/**
 * 2027 Institutional Utility: wrapSelectionWithSyntax
 * Standardized logic for bold/italic/gold formatting tags.
 */
export const wrapSelectionWithSyntax = (fieldId: string, value: string, syntax: string, onUpdate: (newVal: string) => void) => {
    const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement;
    if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const selection = value.substring(start, end);
        const newVal = value.substring(0, start) + syntax + selection + syntax + value.substring(end);
        onUpdate(newVal);
        
        setTimeout(() => {
            if (el && document.contains(el)) {
                el.focus();
                el.setSelectionRange(start + syntax.length, end + syntax.length);
            }
        }, 0);
    }
};
