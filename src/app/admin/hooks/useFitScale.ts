"use client";

import { useCallback, useState } from "react";
import { observeElementResize } from "./useContainerScale";

/** Computes container-fit scale via React 19 ref cleanup with epsilon guarding (`P114`). */
export function useFitScale(targetWidth: number, targetHeight: number) {
    const [scale, setScale] = useState(0.4);

    const containerRef = useCallback((el: HTMLDivElement | null) => {
        if (!el || !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight) || targetWidth <= 0 || targetHeight <= 0) return;
        return observeElementResize(el, (width, height) => {
            if (width <= 0 || height <= 0) return;
            const fit = Math.min(Math.max(120, width - 24) / targetWidth, Math.max(120, height - 24) / targetHeight);
            setScale((prev) => (Math.abs(prev - fit) >= 0.0005 ? fit : prev));
        });
    }, [targetWidth, targetHeight]);

    return { containerRef, scale };
}
