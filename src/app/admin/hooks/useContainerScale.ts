import { useState, useEffect, useRef } from 'react';

export function useContainerScale(targetWidth: number) {
    const [scale, setScale] = useState(1);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!ref.current) return;
        const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
                setScale(entry.contentRect.width / targetWidth);
            }
        });
        observer.observe(ref.current);
        return () => observer.disconnect();
    }, [targetWidth]);

    return { ref, scale };
}
