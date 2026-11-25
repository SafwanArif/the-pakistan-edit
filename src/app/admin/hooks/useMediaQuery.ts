import { useCallback, useSyncExternalStore } from "react";

const getServerSnapshot = () => false;

interface MediaQueryEntry {
    mql: MediaQueryList;
    listeners: Set<() => void>;
    handleChange: () => void;
}

const mediaQueryStore = new Map<string, MediaQueryEntry>();

const getOrCreateEntry = (query: string): MediaQueryEntry | null => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
    let entry = mediaQueryStore.get(query);
    if (!entry) {
        const mql = window.matchMedia(query);
        const listeners = new Set<() => void>();
        const handleChange = () => {
            listeners.forEach((fn) => fn());
        };
        entry = { mql, listeners, handleChange };
        mediaQueryStore.set(query, entry);
    }
    return entry;
};

/**
 * SSR-safe reactive CSS media-query hook backed by `useSyncExternalStore` and a shared singleton
 * `MediaQueryList` registry (at most 1 native `matchMedia` listener per distinct query app-wide).
 */
export const useMediaQuery = (query: string): boolean => {
    const subscribe = useCallback((onChange: () => void) => {
        const entry = getOrCreateEntry(query);
        if (!entry) return () => {};
        if (entry.listeners.size === 0) {
            entry.mql.addEventListener("change", entry.handleChange);
        }
        entry.listeners.add(onChange);
        return () => {
            entry.listeners.delete(onChange);
            if (entry.listeners.size === 0) {
                entry.mql.removeEventListener("change", entry.handleChange);
                mediaQueryStore.delete(query);
            }
        };
    }, [query]);

    const getSnapshot = useCallback(
        () => getOrCreateEntry(query)?.mql.matches ?? false,
        [query]
    );

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
