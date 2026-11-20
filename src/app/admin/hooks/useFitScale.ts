import { useState, useLayoutEffect, useRef } from 'react';

/**
 * 2026 Professional NLE Studio Viewport Scaler
 * Computes container-fit scale pre-paint from ResizeObserver contentRect with epsilon guarding.
 */
export function useFitScale(targetWidth: number, targetHeight: number) {
    const [scale, setScale] = useState(0.4);
    const containerRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const applyDimensions = (width: number, height: number) => {
            if (width <= 0 || height <= 0) return;
            const availableW = Math.max(120, width - 24);
            const availableH = Math.max(120, height - 24);
            const fit = Math.min(availableW / targetWidth, availableH / targetHeight);
            setScale((prev) => (Math.abs(prev - fit) >= 0.0005 ? fit : prev));
        };

        applyDimensions(el.clientWidth, el.clientHeight);

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                applyDimensions(entry.contentRect.width, entry.contentRect.height);
            }
        });
        observer.observe(el);

        return () => observer.disconnect();
    }, [targetWidth, targetHeight]);

    return { containerRef, scale };
}
