"use client";

import { useState, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { get, set } from "idb-keyval";
import type { PostMode } from "@/types/news";
import { STORAGE_KEYS } from "./utils/storageKeys";

const CarouselStudio = dynamic(() => import("./components/CarouselStudio"), { ssr: false });
const VideoStudio = dynamic(() => import("./components/VideoStudio"), { ssr: false });

/**
 * 2027 Institutional Command Center: AdminDashboard
 * Hydrates only the active studio mode (`carousel` or `video`) so inactive bundles, IndexedDB drafts,
 * undo stacks, and video hardware streams never load or consume RAM in the background.
 */
export default function AdminDashboard() {
    const [postMode, setPostMode] = useState<PostMode | null>(null);

    useEffect(() => {
        let cancelled = false;
        void get<PostMode>(STORAGE_KEYS.POST_MODE)
            .then((savedMode) => {
                if (!cancelled) setPostMode(savedMode === 'video' ? 'video' : 'carousel');
            })
            .catch(() => {
                if (!cancelled) setPostMode('carousel');
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const handleSetPostMode = useCallback((mode: PostMode) => {
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
            <div id="export-capture-surface" aria-hidden="true" inert style={{ position: 'fixed', insetInlineStart: '-5000px' }} />
        </div>
    );
}
