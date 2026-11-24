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
            onChangeRef.current(DraftResolver.patchSlide(slideNum, {
                image: cached.image, imageWidth: cached.w, imageHeight: cached.h,
                imageZoom: 100, snapMode: 'height', imagePosX: 50, imagePosY: 50,
            }, draftRef.current));
            return;
        }

        activeRequests.current.add(url); 
        setResolving(true);

        const proxied = `/api/proxy/asset?url=${encodeURIComponent(url)}`;
        const img = new Image();
        
        img.onload = () => {
            const w = img.naturalWidth || 1080;
            const h = img.naturalHeight || 1350;
            ASSET_CACHE[url] = { image: proxied, w, h };

            onChangeRef.current(DraftResolver.patchSlide(slideNum, {
                image: proxied, imageWidth: w, imageHeight: h,
                imageZoom: 100, snapMode: 'height', imagePosX: 50, imagePosY: 50,
            }, draftRef.current));
            
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
            onChangeRef.current(DraftResolver.patchSlide(slideNum, {
                image: objectUrl, imageWidth: w, imageHeight: h,
                imageZoom: 100, snapMode: 'height', imagePosX: 50, imagePosY: 50,
            }, draftRef.current));
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

    /** Resets image and focal framing fields on a slide to defaults and revokes any object URL. */
    const clearAsset = useCallback((slideNum: number) => {
        const prevUrl = DraftResolver.get(`slide-${slideNum}-image`, draftRef.current);
        if (typeof prevUrl === 'string' && prevUrl.startsWith('blob:')) {
            URL.revokeObjectURL(prevUrl);
        }
        onChangeRef.current(DraftResolver.patchSlide(slideNum, {
            image: '',
            imageWidth: 0,
            imageHeight: 0,
            imageZoom: 100,
            imagePosX: 50,
            imagePosY: 50,
            snapMode: 'height',
        }, draftRef.current));
    }, []);

    return { resolving, resolve, ingestFile, clearAsset };
};
