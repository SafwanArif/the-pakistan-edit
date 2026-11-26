import { useEffect, useLayoutEffect, useRef } from "react";

export type CloseReason = "outside" | "escape";

const escapeStack: Array<() => void> = [];
const handleGlobalEscape = (e: KeyboardEvent) => {
    if (e.key === "Escape") escapeStack[escapeStack.length - 1]?.();
};

/** Closes popovers on outside pointerdown or LIFO Escape; attaches zero listeners when disabled. */
export const useClickOutside = (handler: (reason?: CloseReason) => void, ignoreSelector?: string, enabled = true) => {
    const ref = useRef<HTMLDivElement>(null);
    const handlerRef = useRef(handler);
    useLayoutEffect(() => { handlerRef.current = handler; }, [handler]);

    useEffect(() => {
        if (!enabled) return;
        const onPointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!ref.current || (target instanceof Node && ref.current.contains(target))) return;
            if (ignoreSelector && target instanceof Element && target.closest(ignoreSelector)) return;
            handlerRef.current("outside");
        };
        const onEscape = () => handlerRef.current("escape");

        document.addEventListener("pointerdown", onPointerDown);
        if (escapeStack.push(onEscape) === 1) document.addEventListener("keydown", handleGlobalEscape);

        return () => {
            document.removeEventListener("pointerdown", onPointerDown);
            const idx = escapeStack.indexOf(onEscape);
            if (idx !== -1) escapeStack.splice(idx, 1);
            if (escapeStack.length === 0) document.removeEventListener("keydown", handleGlobalEscape);
        };
    }, [ignoreSelector, enabled]);

    return ref;
};
