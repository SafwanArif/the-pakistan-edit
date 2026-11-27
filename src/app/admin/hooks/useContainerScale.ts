"use client";

import { useCallback, useState } from "react";

/** Measures `el` synchronously and subscribes to `ResizeObserver` with initial-size deduplication (`P113`). */
export function observeElementResize(el: HTMLElement, onSize: (width: number, height: number) => void): () => void {
    let lastW = el.clientWidth;
    let lastH = el.clientHeight;
    onSize(lastW, lastH);
    if (typeof ResizeObserver === "undefined") return () => {};
    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const { width, height } = entry.contentRect;
            if (Math.abs(width - lastW) < 0.5 && Math.abs(height - lastH) < 0.5) continue;
            lastW = width;
            lastH = height;
            onSize(width, height);
        }
    });
    observer.observe(el);
    return () => observer.disconnect();
}

/** Measures container width via React 19 ref cleanup so conditionally mounted cards always attach (`P114`). */
export function useContainerScale(targetWidth: number) {
    const [scale, setScale] = useState(1);

    const ref = useCallback((el: HTMLDivElement | null) => {
        if (!el || !Number.isFinite(targetWidth) || targetWidth <= 0) return;
        return observeElementResize(el, (width) => {
            if (width <= 0) return;
            const next = width / targetWidth;
            setScale((prev) => (Math.abs(prev - next) >= 0.0005 ? next : prev));
        });
    }, [targetWidth]);

    return { ref, scale };
}
