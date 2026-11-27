"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { set } from "idb-keyval";

/**
 * Serialized, debounced IndexedDB persistence helper that flushes pending writes on
 * `pagehide`, mobile `visibilitychange` (`hidden`), and hook unmount so edits are never lost.
 */
export const useDebouncedIdbSave = <T,>(
    key: string,
    transform?: (value: T) => T,
    delayMs = 400
) => {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingRef = useRef<T | null>(null);
    const hasPendingRef = useRef(false);
    const transformRef = useRef(transform);
    const writeQueueRef = useRef<Promise<void>>(Promise.resolve());
    const safeDelay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 400;

    useLayoutEffect(() => {
        transformRef.current = transform;
    }, [transform]);

    const persist = useCallback((value: T): Promise<void> => {
        const run = async () => {
            try {
                const payload = transformRef.current ? transformRef.current(value) : value;
                await set(key, payload);
            } catch (err) {
                console.warn("IDB_SAVE_FAILED:", key, err);
            }
        };
        const next = writeQueueRef.current.then(run, run);
        writeQueueRef.current = next;
        return next;
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
        timerRef.current = setTimeout(flush, safeDelay);
    }, [flush, safeDelay]);

    const saveNow = useCallback(async (value: T) => {
        cancel();
        await persist(value);
    }, [cancel, persist]);

    useEffect(() => {
        const ac = new AbortController();
        const onVisibility = () => {
            if (document.visibilityState === "hidden") flush();
        };
        window.addEventListener("pagehide", flush, { signal: ac.signal });
        document.addEventListener("visibilitychange", onVisibility, { signal: ac.signal });
        return () => {
            ac.abort();
            flush();
        };
    }, [flush]);

    return { scheduleSave, saveNow, cancel, flush };
};
