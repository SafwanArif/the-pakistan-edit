import { useEffect, useRef } from "react";

/**
 * 2027 Institutional Hook: useClickOutside
 * Standardized event listener for closing popovers and trays.
 */
export const useClickOutside = (handler: () => void, ignoreSelector?: string) => {
    const ref = useRef<HTMLDivElement>(null);
    const handlerRef = useRef(handler);
    useEffect(() => {
        handlerRef.current = handler;
    });

    useEffect(() => {
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
        document.addEventListener("touchstart", listener);
        document.addEventListener("keydown", onKeyDown);

        return () => {
            document.removeEventListener("mousedown", listener);
            document.removeEventListener("touchstart", listener);
            document.removeEventListener("keydown", onKeyDown);
        };
    }, [ignoreSelector]);

    return ref;
};
