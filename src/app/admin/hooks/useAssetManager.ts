import { useState, useRef, useCallback, useEffect } from 'react';
import { Draft } from '../../../types/news';
import { DraftResolver } from '../utils/dataAccessors';

// Session cache for proxied remote image dimensions
const ASSET_CACHE: Record<string, { image: string, w: number, h: number }> = {};

/**
 * Manages Carousel slide asset ingestion, remote proxy dimension resolution, and clearing.
 */
export const useAssetManager = (draft: Draft, onChange: (d: Draft) => void) => {
    const [resolving, setResolving] = useState(false);
    const activeRequests = useRef<Set<string>>(new Set());
    const draftRef = useRef(draft);
    const onChangeRef = useRef(onChange);

    useEffect(() => {
        draftRef.current = draft;
        onChangeRef.current = onChange;
    }, [draft, onChange]);

    /** Proxies a remote image URL and records its natural dimensions. */
    const resolve = useCallback((url: string, slideNum: number) => {
        if (!url || !url.startsWith('http') || url.startsWith('/api/proxy') || activeRequests.current.has(url)) return;

        if (ASSET_CACHE[url]) {
            const cached = ASSET_CACHE[url];
            const data = { image: cached.image, imageWidth: cached.w, imageHeight: cached.h, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
            let d = draftRef.current;
            Object.entries(data).forEach(([k, v]) => d = DraftResolver.set(`slide-${slideNum}-${k}`, v, d));
            onChangeRef.current(d);
            return;
        }

        activeRequests.current.add(url); 
        setResolving(true);

        const proxied = `/api/proxy/asset?url=${encodeURIComponent(url)}`;
        const img = new Image();
        
        img.onload = () => {
            const data = { image: proxied, imageWidth: img.naturalWidth || 1080, imageHeight: img.naturalHeight || 1350, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
            ASSET_CACHE[url] = { image: proxied, w: data.imageWidth, h: data.imageHeight };

            let d = draftRef.current;
            Object.entries(data).forEach(([k, v]) => d = DraftResolver.set(`slide-${slideNum}-${k}`, v, d));
            onChangeRef.current(d);
            
            setResolving(false); 
            activeRequests.current.delete(url);
        };

        img.onerror = () => { 
            setResolving(false); 
            activeRequests.current.delete(url); 
        };
        
        img.src = proxied;
    }, []);

    /** Reads a local image upload losslessly via Object URL and records natural dimensions. */
    const ingestFile = useCallback((file: File, slideNum: number) => {
        const prevUrl = DraftResolver.get(`slide-${slideNum}-image`, draftRef.current);
        if (typeof prevUrl === 'string' && prevUrl.startsWith('blob:')) {
            URL.revokeObjectURL(prevUrl);
        }
        const objectUrl = URL.createObjectURL(file);
        const applyImage = (w: number, h: number) => {
            const data = { image: objectUrl, imageWidth: w, imageHeight: h, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
            let d = draftRef.current;
            Object.entries(data).forEach(([k, v]) => d = DraftResolver.set(`slide-${slideNum}-${k}`, v, d));
            onChangeRef.current(d);
        };

        if (typeof createImageBitmap === 'function') {
            void createImageBitmap(file).then((bitmap) => {
                try {
                    applyImage(bitmap.width, bitmap.height);
                } finally {
                    bitmap.close();
                }
            }).catch(() => {
                const img = new Image();
                img.onload = () => applyImage(img.naturalWidth || img.width, img.naturalHeight || img.height);
                img.src = objectUrl;
            });
            return;
        }
        const img = new Image();
        img.onload = () => applyImage(img.naturalWidth || img.width, img.naturalHeight || img.height);
        img.src = objectUrl;
    }, []);

    /** Resets image and focal framing fields on a slide to defaults. */
    const clearAsset = useCallback((slideNum: number) => {
        const defaults: Record<string, string | number> = {
            image: '',
            imageWidth: 0,
            imageHeight: 0,
            imageZoom: 100,
            imagePosX: 50,
            imagePosY: 50,
            snapMode: 'height',
        };
        let d = draftRef.current;
        Object.entries(defaults).forEach(([field, val]) => {
            d = DraftResolver.set(`slide-${slideNum}-${field}`, val, d);
        });
        onChangeRef.current(d);
    }, []);

    return { resolving, resolve, ingestFile, clearAsset };
};
