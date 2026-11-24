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

        const listener = (event: PointerEvent) => {
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

        document.addEventListener("pointerdown", listener);
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("pointerdown", listener);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [ignoreSelector, enabled]);

    return ref;
};
