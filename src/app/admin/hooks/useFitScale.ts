import { useState, useEffect, useRef } from 'react';

/**
 * 2026 Professional NLE Studio Viewport Scaler
 * Computes container-fit scale (like object-fit: contain)
 * so vertical (9:16), portrait (4:5), and square (1:1) video canvases
 * fit 100% within the available screen width AND height without overflowing.
 */
export function useFitScale(targetWidth: number, targetHeight: number) {
    const [scale, setScale] = useState(0.4);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateScale = () => {
            const rect = el.getBoundingClientRect();
            // Provide a comfortable 24px padding margin around the card
            const availableW = Math.max(120, rect.width - 24);
            const availableH = Math.max(120, rect.height - 24);

            const sW = availableW / targetWidth;
            const sH = availableH / targetHeight;

            // Constrain scale so card fits completely within both axes
            const fit = Math.min(sW, sH);
            setScale(fit);
        };

        updateScale();

        const observer = new ResizeObserver(() => {
            updateScale();
        });
        observer.observe(el);

        return () => {
            observer.disconnect();
        };
    }, [targetWidth, targetHeight]);

    return { containerRef, scale };
}
