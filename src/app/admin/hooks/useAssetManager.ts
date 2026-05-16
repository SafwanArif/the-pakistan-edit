import { useState, useRef, useCallback } from 'react';
import { Draft } from '../../../types/news';
import { DraftResolver } from '../utils/dataAccessors';

// 🏛️ 2027 INSTITUTIONAL CACHE
const ASSET_CACHE: Record<string, { image: string, w: number, h: number }> = {};

/**
 * 2027 Institutional Engine: useAssetManager
 * Centralized logic for all asset ingestion (Upload, Link, Proxy, Cache).
 */
export const useAssetManager = (draft: Draft, onChange: (d: Draft) => void) => {
    const [resolving, setResolving] = useState(false);
    const activeRequests = useRef<Set<string>>(new Set());

    /**
     * Resolves metadata for a URL (Proxy + Dimensions)
     */
    const resolve = useCallback((url: string, slideNum: number) => {
        if (!url || !url.startsWith('http') || url.startsWith('/api/proxy') || activeRequests.current.has(url)) return;

        // 1. Check Institutional Cache
        if (ASSET_CACHE[url]) {
            const cached = ASSET_CACHE[url];
            const data = { image: cached.image, imageWidth: cached.w, imageHeight: cached.h, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
            let d = draft;
            Object.entries(data).forEach(([k, v]) => d = DraftResolver.set(`slide-${slideNum}-${k}`, v, d));
            onChange(d);
            return;
        }

        activeRequests.current.add(url); 
        setResolving(true);

        const proxied = `/api/proxy/asset?url=${encodeURIComponent(url)}`;
        const img = new Image();
        
        img.onload = () => {
            const data = { image: proxied, imageWidth: img.naturalWidth || 1080, imageHeight: img.naturalHeight || 1350, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
            ASSET_CACHE[url] = { image: proxied, w: data.imageWidth, h: data.imageHeight };

            let d = draft;
            Object.entries(data).forEach(([k, v]) => d = DraftResolver.set(`slide-${slideNum}-${k}`, v, d));
            onChange(d);
            
            setResolving(false); 
            activeRequests.current.delete(url);
        };

        img.onerror = () => { 
            setResolving(false); 
            activeRequests.current.delete(url); 
        };
        
        img.src = proxied;
    }, [draft, onChange]);

    /**
     * Handles local file uploads
     */
    const ingestFile = useCallback((file: File, slideNum: number) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const img = new Image();
            img.onload = () => {
                const data = { image: reader.result as string, imageWidth: img.width, imageHeight: img.height, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
                let d = draft;
                Object.entries(data).forEach(([k, v]) => d = DraftResolver.set(`slide-${slideNum}-${k}`, v, d));
                onChange(d);
            };
            img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
    }, [draft, onChange]);

    /**
     * Clears an asset from a slide
     */
    const clearAsset = useCallback((slideNum: number) => {
        const fields = ['image', 'imageWidth', 'imageHeight', 'imageZoom', 'imagePosX', 'imagePosY', 'snapMode', 'scrim'];
        let d = draft;
        fields.forEach(f => d = DraftResolver.set(`slide-${slideNum}-${f}`, undefined, d));
        onChange(d);
    }, [draft, onChange]);

    return { resolving, resolve, ingestFile, clearAsset };
};
