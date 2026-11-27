"use client";

import { useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import type { Draft } from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";
import { DraftResolver } from "../utils/dataAccessors";
import { isSafeMediaUrl } from "../utils/domUtils";

const MAX_CACHE_ENTRIES = 64;
const ASSET_CACHE = new Map<string, { image: string; w: number; h: number }>();

const DEFAULT_IMAGE_FRAMING = {
    imageZoom: 100,
    snapMode: "height" as const,
    imagePosX: 50,
    imagePosY: 50,
};

const cacheAsset = (url: string, entry: { image: string; w: number; h: number }) => {
    if (ASSET_CACHE.size >= MAX_CACHE_ENTRIES && !ASSET_CACHE.has(url)) {
        const oldest = ASSET_CACHE.keys().next().value;
        if (oldest !== undefined) ASSET_CACHE.delete(oldest);
    }
    ASSET_CACHE.set(url, entry);
};

/**
 * Manages Carousel slide asset ingestion, remote proxy dimension resolution, and clearing.
 * Never revokes previous `blob:` URLs mid-session so `useEditorialState`'s Undo stack stays intact (`P72`).
 */
export const useAssetManager = (draft: Draft, onChange: (d: Draft) => void) => {
    const [resolving, setResolving] = useState(false);
    const activeRequests = useRef(new Set<string>());
    const inFlightImages = useRef(new Set<HTMLImageElement>());
    const slideGenRef = useRef(new Map<number, number>());
    const isMountedRef = useRef(true);
    const draftRef = useRef(draft);
    const onChangeRef = useRef(onChange);

    useLayoutEffect(() => {
        draftRef.current = draft;
        onChangeRef.current = onChange;
    });

    useEffect(() => {
        isMountedRef.current = true;
        const images = inFlightImages.current;
        return () => {
            isMountedRef.current = false;
            images.forEach((img) => { img.onload = null; img.onerror = null; img.src = ""; });
            images.clear();
        };
    }, []);

    const bumpSlideGen = (slideNum: number): number => {
        const next = (slideGenRef.current.get(slideNum) ?? 0) + 1;
        slideGenRef.current.set(slideNum, next);
        return next;
    };

    const applySlidePatch = (slideNum: number, image: string, imageWidth: number, imageHeight: number) => {
        onChangeRef.current(DraftResolver.patchSlide(slideNum, { image, imageWidth, imageHeight, ...DEFAULT_IMAGE_FRAMING }, draftRef.current));
    };

    const loadImageDimensions = (src: string): Promise<{ w: number; h: number } | null> =>
        new Promise((resolveImg) => {
            const img = new Image();
            inFlightImages.current.add(img);
            const done = (dims: { w: number; h: number } | null) => {
                img.onload = null;
                img.onerror = null;
                inFlightImages.current.delete(img);
                resolveImg(dims);
            };
            img.onload = () => done({ w: img.naturalWidth || img.width || 1080, h: img.naturalHeight || img.height || 1350 });
            img.onerror = () => done(null);
            img.src = src;
        });

    /** Proxies a remote image URL and records its natural dimensions. */
    const resolve = useCallback((url: string, slideNum: number) => {
        if (!url || url.startsWith("/api/proxy") || !isSafeMediaUrl(url, false)) return;

        const cached = ASSET_CACHE.get(url);
        if (cached) {
            bumpSlideGen(slideNum);
            applySlidePatch(slideNum, cached.image, cached.w, cached.h);
            return;
        }

        const reqKey = `${slideNum}:${url}`;
        if (activeRequests.current.has(reqKey)) return;
        const gen = bumpSlideGen(slideNum);
        activeRequests.current.add(reqKey);
        setResolving(true);

        const proxied = `/api/proxy/asset?url=${encodeURIComponent(url)}`;
        void loadImageDimensions(proxied).then((dims) => {
            activeRequests.current.delete(reqKey);
            if (isMountedRef.current) setResolving(activeRequests.current.size > 0);
            if (!dims) return;
            cacheAsset(url, { image: proxied, ...dims });
            if (isMountedRef.current && slideGenRef.current.get(slideNum) === gen) {
                applySlidePatch(slideNum, proxied, dims.w, dims.h);
            }
        });
    }, []);

    /** Reads a local image upload losslessly via Object URL and records natural dimensions. */
    const ingestFile = useCallback((file: File, slideNum: number) => {
        if (!file || file.size === 0) return;
        const gen = bumpSlideGen(slideNum);
        const objectUrl = URL.createObjectURL(file);

        const applyOrRevoke = (dims: { w: number; h: number } | null) => {
            if (!dims || !isMountedRef.current || slideGenRef.current.get(slideNum) !== gen) {
                revokeBlobUrl(objectUrl);
                return;
            }
            applySlidePatch(slideNum, objectUrl, dims.w || 1080, dims.h || 1350);
        };

        if (typeof createImageBitmap === "function") {
            void createImageBitmap(file)
                .then((bitmap) => {
                    try { applyOrRevoke({ w: bitmap.width, h: bitmap.height }); }
                    finally { bitmap.close(); }
                })
                .catch(() => loadImageDimensions(objectUrl).then(applyOrRevoke));
            return;
        }
        void loadImageDimensions(objectUrl).then(applyOrRevoke);
    }, []);

    /** Resets image and focal framing fields on a slide to defaults. */
    const clearAsset = useCallback((slideNum: number) => {
        bumpSlideGen(slideNum);
        applySlidePatch(slideNum, "", 0, 0);
    }, []);

    return { resolving, resolve, ingestFile, clearAsset };
};
