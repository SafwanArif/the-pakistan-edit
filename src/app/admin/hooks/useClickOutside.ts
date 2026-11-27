"use client";

import { useEffect, useEffectEvent, useRef } from "react";

export type CloseReason = "outside" | "escape";

const escapeStack: Array<() => void> = [];
const handleGlobalEscape = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
    escapeStack[escapeStack.length - 1]?.();
};

/** Closes popovers on outside pointerdown or LIFO Escape; attaches zero listeners when disabled. */
export const useClickOutside = (handler: (reason?: CloseReason) => void, ignoreSelector?: string, enabled = true) => {
    const ref = useRef<HTMLDivElement>(null);

    const onPointerDown = useEffectEvent((event: PointerEvent) => {
        const el = ref.current;
        if (!el || document.querySelector("dialog[open]")) return;
        const target = event.target;
        if (event.composedPath().includes(el) || (target instanceof Node && el.contains(target))) return;
        const elTarget = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
        if (ignoreSelector && elTarget?.closest(ignoreSelector)) return;
        handler("outside");
    });

    const onEscape = useEffectEvent(() => handler("escape"));

    useEffect(() => {
        if (!enabled) return;
        const ac = new AbortController();
        const escapeEntry = () => onEscape();
        document.addEventListener("pointerdown", onPointerDown, { signal: ac.signal });
        if (escapeStack.push(escapeEntry) === 1) document.addEventListener("keydown", handleGlobalEscape);

        return () => {
            ac.abort();
            const idx = escapeStack.indexOf(escapeEntry);
            if (idx !== -1) escapeStack.splice(idx, 1);
            if (escapeStack.length === 0) document.removeEventListener("keydown", handleGlobalEscape);
        };
    }, [enabled]);

    return ref;
};
