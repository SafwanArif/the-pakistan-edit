import { useState, useLayoutEffect, useRef } from 'react';

/** Measures container width pre-paint so scaled preview cards never flash unscaled on mount. */
export function useContainerScale(targetWidth: number) {
    const [scale, setScale] = useState(1);
    const ref = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = ref.current;
        if (!el || targetWidth <= 0) return;

        const applyWidth = (width: number) => {
            if (width <= 0) return;
            const next = width / targetWidth;
            setScale((prev) => (Math.abs(prev - next) >= 0.0005 ? next : prev));
        };

        applyWidth(el.clientWidth);

        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                applyWidth(entry.contentRect.width);
            }
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, [targetWidth]);

    return { ref, scale };
}
