"use client";

import { useState, useCallback, useEffect, useRef, type CSSProperties } from "react";
import dynamic from "next/dynamic";
import { get, set } from "idb-keyval";
import type { PostMode } from "@/types/news";
import { STORAGE_KEYS } from "./utils/storageKeys";

const CarouselStudio = dynamic(() => import("./components/CarouselStudio"), { ssr: false });
const VideoStudio = dynamic(() => import("./components/VideoStudio"), { ssr: false });

const CAPTURE_SURFACE_STYLE: CSSProperties = { position: 'fixed', insetInlineStart: '-5000px' };

/**
 * 2027 Institutional Command Center: AdminDashboard
 * Hydrates only the active studio mode (`carousel` or `video`) so inactive bundles and drafts never load.
 */
export default function AdminDashboard() {
    const [postMode, setPostMode] = useState<PostMode | null>(null);
    const postModeRef = useRef<PostMode | null>(null);

    useEffect(() => {
        let cancelled = false;
        const commit = (mode: PostMode) => {
            if (cancelled) return;
            postModeRef.current = mode;
            setPostMode(mode);
        };
        void get<PostMode>(STORAGE_KEYS.POST_MODE)
            .then((savedMode) => commit(savedMode === 'video' ? 'video' : 'carousel'))
            .catch(() => commit('carousel'));
        return () => { cancelled = true; };
    }, []);

    const handleSetPostMode = useCallback((mode: PostMode) => {
        if (postModeRef.current === mode) return;
        postModeRef.current = mode;
        setPostMode(mode);
        void set(STORAGE_KEYS.POST_MODE, mode).catch(() => {});
    }, []);

    if (!postMode) return null;

    return (
        <div className="dashboard-container">
            {postMode === 'carousel' ? (
                <CarouselStudio mode={postMode} onModeChange={handleSetPostMode} />
            ) : (
                <VideoStudio mode={postMode} onModeChange={handleSetPostMode} />
            )}
            <div id="export-capture-surface" aria-hidden="true" inert style={CAPTURE_SURFACE_STYLE} />
        </div>
    );
}
