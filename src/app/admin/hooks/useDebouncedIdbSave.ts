import { useCallback, useEffect, useRef } from 'react';
import { set } from 'idb-keyval';

/**
 * Debounced IndexedDB persistence helper that automatically flushes any pending
 * write on `pagehide` or hook unmount so edits made right before reload are never lost.
 */
export const useDebouncedIdbSave = <T,>(
    key: string,
    transform?: (value: T) => T,
    delayMs = 150
) => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<T | null>(null);
    const hasPendingRef = useRef(false);
    const transformRef = useRef(transform);

    useEffect(() => {
        transformRef.current = transform;
    }, [transform]);

    const persist = useCallback(async (value: T) => {
        try {
            const payload = transformRef.current ? transformRef.current(value) : value;
            await set(key, payload);
        } catch (err) {
            console.warn("IDB_SAVE_FAILED:", key, err);
        }
    }, [key]);

    const cancel = useCallback(() => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        hasPendingRef.current = false;
        pendingRef.current = null;
    }, []);

    const flush = useCallback(() => {
        if (!hasPendingRef.current) return;
        const latest = pendingRef.current as T;
        cancel();
        void persist(latest);
    }, [cancel, persist]);

    const scheduleSave = useCallback((value: T) => {
        pendingRef.current = value;
        hasPendingRef.current = true;
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (!hasPendingRef.current) return;
            const latest = pendingRef.current as T;
            hasPendingRef.current = false;
            pendingRef.current = null;
            void persist(latest);
        }, delayMs);
    }, [delayMs, persist]);

    const saveNow = useCallback(async (value: T) => {
        cancel();
        await persist(value);
    }, [cancel, persist]);

    useEffect(() => {
        window.addEventListener('pagehide', flush);
        return () => {
            window.removeEventListener('pagehide', flush);
            flush();
        };
    }, [flush]);

    return { scheduleSave, saveNow, cancel, flush };
};
