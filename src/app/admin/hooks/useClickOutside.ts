import { useEffect, useLayoutEffect, useRef } from "react";

export type CloseReason = "outside" | "escape";

const escapeStack: Array<() => void> = [];

const handleGlobalEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    const topHandler = escapeStack[escapeStack.length - 1];
    if (topHandler) {
        topHandler();
    }
};

/**
 * Standardized event listener for closing popovers and trays.
 * Attaches zero global listeners when disabled and dispatches Escape strictly LIFO
 * so nested popovers close one layer at a time.
 */
export const useClickOutside = (
    handler: (reason?: CloseReason) => void,
    ignoreSelector?: string,
    enabled = true
) => {
    const ref = useRef<HTMLDivElement>(null);
    const handlerRef = useRef(handler);
    useLayoutEffect(() => {
        handlerRef.current = handler;
    }, [handler]);

    useEffect(() => {
        if (!enabled) return;

        const listener = (event: PointerEvent) => {
            const target = event.target;
            if (!ref.current || (target instanceof Node && ref.current.contains(target))) {
                return;
            }
            if (ignoreSelector && target instanceof Element && target.closest(ignoreSelector)) {
                return;
            }
            handlerRef.current("outside");
        };

        const onEscape = () => {
            handlerRef.current("escape");
        };

        document.addEventListener("pointerdown", listener);
        escapeStack.push(onEscape);
        if (escapeStack.length === 1) {
            document.addEventListener("keydown", handleGlobalEscape);
        }

        return () => {
            document.removeEventListener("pointerdown", listener);
            const idx = escapeStack.indexOf(onEscape);
            if (idx !== -1) {
                escapeStack.splice(idx, 1);
            }
            if (escapeStack.length === 0) {
                document.removeEventListener("keydown", handleGlobalEscape);
            }
        };
    }, [ignoreSelector, enabled]);

    return ref;
};
