import { useEffect, useRef } from "react";

/**
 * 2027 Institutional Hook: useClickOutside
 * Standardized event listener for closing popovers and trays.
 */
export const useClickOutside = (handler: () => void) => {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const listener = (event: MouseEvent | TouchEvent) => {
            if (!ref.current || ref.current.contains(event.target as Node)) {
                return;
            }
            handler();
        };

        document.addEventListener("mousedown", listener);
        document.addEventListener("touchstart", listener);

        return () => {
            document.removeEventListener("mousedown", listener);
            document.removeEventListener("touchstart", listener);
        };
    }, [handler]);

    return ref;
};
