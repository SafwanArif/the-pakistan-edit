import { useState, useRef, useCallback, useEffect } from 'react';
import { Draft } from '../../../types/news';
import { updateSlideAsset } from '../utils/dataAccessors';

/**
 * 2027 Institutional Engine: useAssetResolver
 */
export const useAssetResolver = (draft: Draft, onChange: (d: Draft) => void) => {
    const [resolving, setResolving] = useState(false);
    const active = useRef<Set<string>>(new Set());

    const resolve = useCallback((url: string, slide?: number) => {
        if (!url || !url.startsWith('http') || url.startsWith('/api/proxy') || active.current.has(url)) return;
        active.current.add(url); setResolving(true);
        const proxied = `/api/proxy/asset?url=${encodeURIComponent(url)}`;
        const img = new Image();
        img.onload = () => {
            const data = { image: proxied, imageWidth: img.naturalWidth || 1080, imageHeight: img.naturalHeight || 1350, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
            if (slide === undefined) onChange({ ...draft, ...data });
            else {
                let d = draft;
                Object.entries(data).forEach(([k, v]) => d = updateSlideAsset(slide, k, v, d));
                onChange(d);
            }
            setResolving(false); active.current.delete(url);
        };
        img.onerror = () => { setResolving(false); active.current.delete(url); };
        img.src = proxied;
    }, [draft, onChange]);

    return { resolving, resolve };
};
