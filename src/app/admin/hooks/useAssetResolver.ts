import { useState, useRef, useCallback } from 'react';
import { Draft } from '../../../types/news';
import { updateSlideAsset } from '../utils/dataAccessors';

// 🏛️ 2027 INSTITUTIONAL CACHE: Persists across component lifecycle
const ASSET_CACHE: Record<string, { image: string, w: number, h: number }> = {};

/**
 * 2027 Institutional Engine: useAssetResolver
 * Deterministic asset resolution with local caching and proxy handling.
 */
export const useAssetResolver = (draft: Draft, onChange: (d: Draft) => void) => {
    const [resolving, setResolving] = useState(false);
    const active = useRef<Set<string>>(new Set());

    const resolve = useCallback((url: string, slide?: number) => {
        if (!url || !url.startsWith('http') || url.startsWith('/api/proxy') || active.current.has(url)) return;

        // 1. Check Institutional Cache
        if (ASSET_CACHE[url]) {
            const cached = ASSET_CACHE[url];
            const data = { 
                image: cached.image, 
                imageWidth: cached.w, 
                imageHeight: cached.h, 
                imageZoom: 100, 
                snapMode: 'height' as const, 
                imagePosX: 50, 
                imagePosY: 50 
            };
            if (slide === undefined) onChange({ ...draft, ...data });
            else {
                let d = draft;
                Object.entries(data).forEach(([k, v]) => d = updateSlideAsset(slide, k, v, d));
                onChange(d);
            }
            return;
        }

        active.current.add(url); 
        setResolving(true);

        const proxied = `/api/proxy/asset?url=${encodeURIComponent(url)}`;
        const img = new Image();
        
        img.onload = () => {
            const data = { 
                image: proxied, 
                imageWidth: img.naturalWidth || 1080, 
                imageHeight: img.naturalHeight || 1350, 
                imageZoom: 100, 
                snapMode: 'height' as const, 
                imagePosX: 50, 
                imagePosY: 50 
            };

            // 🏛️ COMMIT TO CACHE
            ASSET_CACHE[url] = { image: proxied, w: data.imageWidth, h: data.imageHeight };

            if (slide === undefined) onChange({ ...draft, ...data });
            else {
                let d = draft;
                Object.entries(data).forEach(([k, v]) => d = updateSlideAsset(slide, k, v, d));
                onChange(d);
            }
            setResolving(false); 
            active.current.delete(url);
        };

        img.onerror = () => { 
            setResolving(false); 
            active.current.delete(url); 
        };
        
        img.src = proxied;
    }, [draft, onChange]);

    return { resolving, resolve };
};
