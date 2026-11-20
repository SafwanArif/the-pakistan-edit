import { useEffect, useRef } from "react";

/**
 * 2027 Institutional Hook: useClickOutside
 * Standardized event listener for closing popovers and trays — attaches zero global listeners when disabled.
 */
export const useClickOutside = (handler: () => void, ignoreSelector?: string, enabled = true) => {
    const ref = useRef<HTMLDivElement>(null);
    const handlerRef = useRef(handler);
    useEffect(() => {
        handlerRef.current = handler;
    });

    useEffect(() => {
        if (!enabled) return;

        const listener = (event: MouseEvent | TouchEvent) => {
            const target = event.target as HTMLElement | null;
            if (!ref.current || ref.current.contains(target)) {
                return;
            }
            if (ignoreSelector && target?.closest(ignoreSelector)) {
                return;
            }
            handlerRef.current();
        };

        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") handlerRef.current();
        };

        document.addEventListener("mousedown", listener);
        document.addEventListener("touchstart", listener, { passive: true });
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("mousedown", listener);
            document.removeEventListener("touchstart", listener);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [ignoreSelector, enabled]);

    return ref;
};
