import { useCallback, useSyncExternalStore } from "react";

const getServerSnapshot = () => false;

/**
 * SSR-safe reactive CSS media-query hook backed by `useSyncExternalStore`.
 * Shares browser matchMedia notifications with zero hydration mismatch or manual resize listeners.
 */
export const useMediaQuery = (query: string): boolean => {
    const subscribe = useCallback((onChange: () => void) => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
        const mql = window.matchMedia(query);
        mql.addEventListener("change", onChange);
        return () => mql.removeEventListener("change", onChange);
    }, [query]);

    const getSnapshot = useCallback(
        () => (typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query).matches : false),
        [query]
    );

    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
