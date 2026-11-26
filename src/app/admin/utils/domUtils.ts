const restoreInputSelection = (el: HTMLInputElement | HTMLTextAreaElement, start: number, end: number) => {
    requestAnimationFrame(() => {
        if (document.contains(el)) {
            el.focus();
            el.setSelectionRange(start, end);
        }
    });
};

/** Inserts text at the active cursor position and restores selection focus. */
export const insertTextAtCursor = (fieldId: string, value: string, textToInsert: string, onUpdate: (newVal: string) => void) => {
    const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (el && typeof el.selectionStart === 'number') {
        const liveVal = el.value;
        const start = el.selectionStart;
        const end = el.selectionEnd ?? start;
        onUpdate(liveVal.substring(0, start) + textToInsert + liveVal.substring(end));
        const newPos = start + textToInsert.length;
        restoreInputSelection(el, newPos, newPos);
    } else {
        onUpdate(value ? value + " " + textToInsert : textToInsert);
    }
};

/**
 * Toggles inline formatting markers (e.g. ==...==, **...**) around the active text selection
 * to avoid duplicate nested markers. Slices live `el.value` so Android IME composition indices never drift.
 */
export const wrapSelectionWithSyntax = (fieldId: string, _value: string, syntaxOpen: string, syntaxClose: string, onUpdate: (newVal: string) => void) => {
    const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el || typeof el.selectionStart !== 'number' || typeof el.selectionEnd !== 'number') return;

    const liveVal = el.value;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selection = liveVal.substring(start, end);
    const lowerSelection = selection.toLowerCase();
    const lowerOpen = syntaxOpen.toLowerCase();
    const lowerClose = syntaxClose.toLowerCase();

    // 1. If selection ITSELF is wrapped in the markers, toggle them OFF
    if (selection.length >= syntaxOpen.length + syntaxClose.length && lowerSelection.startsWith(lowerOpen) && lowerSelection.endsWith(lowerClose)) {
        const innerText = selection.substring(syntaxOpen.length, selection.length - syntaxClose.length);
        onUpdate(liveVal.substring(0, start) + innerText + liveVal.substring(end));
        restoreInputSelection(el, start, start + innerText.length);
        return;
    }

    // 2. If the SURROUNDING text is the markers, toggle them OFF
    const prefix = liveVal.substring(0, start);
    const suffix = liveVal.substring(end);
    if (prefix.toLowerCase().endsWith(lowerOpen) && suffix.toLowerCase().startsWith(lowerClose)) {
        onUpdate(prefix.substring(0, prefix.length - syntaxOpen.length) + selection + suffix.substring(syntaxClose.length));
        restoreInputSelection(el, start - syntaxOpen.length, end - syntaxOpen.length);
        return;
    }

    // 3. Otherwise, toggle them ON
    onUpdate(prefix + syntaxOpen + selection + syntaxClose + suffix);
    restoreInputSelection(el, start + syntaxOpen.length, end + syntaxOpen.length);
};

/** Safely acquires pointer capture without throwing on synthetic/cancelled touch edges. */
export const safeSetPointerCapture = (el: Element | null, pointerId: number): void => {
    if (!el) return;
    try {
        el.setPointerCapture(pointerId);
    } catch { /* pointer already inactive or synthetic */ }
};

/** Safely releases pointer capture without throwing when capture was already lost by the browser. */
export const safeReleasePointerCapture = (el: Element | null, pointerId: number): void => {
    if (!el) return;
    try {
        if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
    } catch { /* capture already released */ }
};

export const isPrimaryPointer = (e: { pointerType: string; button: number }): boolean => e.pointerType !== "mouse" || e.button === 0;
export const isActivationKey = (key: string): boolean => key === "Enter" || key === " ";
export const stopEventPropagation = (e: { stopPropagation: () => void }): void => e.stopPropagation();

/** Validates media URLs before clearing/replacing loaded studio assets (rejects javascript: and garbage text). */
export const isSafeMediaUrl = (raw: string, allowDataOrBlob = false): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    if (/^https?:\/\/\S+$/i.test(trimmed)) return true;
    if (/^\/(?!\/)\S+$/.test(trimmed)) return true;
    if (allowDataOrBlob && (/^data:image\/[a-z0-9.+-]+;base64,/i.test(trimmed) || /^blob:/i.test(trimmed))) return true;
    return false;
};
