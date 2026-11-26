"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { PostMode, getTotalVideoDuration, getActiveSceneAtTime } from "@/types/news";
import { useVideoDraftState } from "../hooks/useVideoDraftState";
import { VideoDraftForm } from "./VideoDraftForm";
import { StudioVideoMonitor } from "./StudioVideoMonitor";
import { TimelineStoryboard } from "./TimelineStoryboard";
import { ExportOverlay } from "./ExportOverlay";
import { SelectionPopover } from "./SelectionPopover";

interface VideoStudioProps {
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
}

/**
 * Isolated Video Studio root — only hydrates Video IndexedDB, HTTP 206 stream probes, and dual-deck
 * playback when Video mode is active, and loads `videoExportEngine` strictly on export click.
 */
export default function VideoStudio({ mode, onModeChange }: VideoStudioProps) {
    const [exporting, setExporting] = useState<string | null>(null);
    const [isMobileScenesOpen, setIsMobileScenesOpen] = useState(false);
    const [isCardScrubbing, setIsCardScrubbing] = useState(false);
    const wasPlayingBeforeCardScrubRef = useRef(false);
    const audioUnlockRef = useRef<(() => void) | null>(null);
    const exportAbortRef = useRef<AbortController | null>(null);

    const {
        isMounted,
        videoDraft,
        updateVideoDraft,
        clearVideo,
        resetVideoDraft,
        isOptimisingVideo,
        ingestStatus,
        ingestVideoBlob,
        isPlaying,
        togglePlay,
        playbackMode,
        setPlaybackMode,
        currentTime,
        liveClock,
        seekNonce,
        seekTo,
        isMuted,
        syncTimeFromVideo,
    } = useVideoDraftState();

    const videoDraftRef = useRef(videoDraft);
    const isPlayingRef = useRef(isPlaying);
    useEffect(() => {
        videoDraftRef.current = videoDraft;
        isPlayingRef.current = isPlaying;
    }, [videoDraft, isPlaying]);

    const handleRegisterAudioUnlock = useCallback((unlock: (() => void) | null) => {
        audioUnlockRef.current = unlock;
    }, []);

    const handleTogglePlay = useCallback(() => {
        const willPlay = !isPlayingRef.current;
        isPlayingRef.current = willPlay;
        if (willPlay) audioUnlockRef.current?.();
        togglePlay();
    }, [togglePlay]);

    const handleCardScrubStart = useCallback(() => {
        setIsCardScrubbing(true);
        wasPlayingBeforeCardScrubRef.current = isPlayingRef.current;
        if (isPlayingRef.current) {
            isPlayingRef.current = false;
            togglePlay();
        }
    }, [togglePlay]);

    const handleCardScrubEnd = useCallback((finalTime: number) => {
        setIsCardScrubbing(false);
        seekTo(finalTime);
        if (wasPlayingBeforeCardScrubRef.current) {
            wasPlayingBeforeCardScrubRef.current = false;
            handleTogglePlay();
        }
    }, [seekTo, handleTogglePlay]);

    useEffect(() => () => {
        exportAbortRef.current?.abort();
    }, []);

    const handleCancelExport = useCallback(() => {
        exportAbortRef.current?.abort();
        exportAbortRef.current = null;
        setExporting(null);
    }, []);

    const handleExportVideoOverlay = useCallback(async () => {
        exportAbortRef.current?.abort();
        const controller = new AbortController();
        exportAbortRef.current = controller;
        const onStatus = (msg: string | null) => {
            if (!controller.signal.aborted) setExporting(msg);
        };
        try {
            const { runVideoOverlayExport } = await import("../utils/videoExportEngine");
            await runVideoOverlayExport(videoDraftRef.current, onStatus, controller.signal);
        } catch (e) {
            console.error("ADMIN_VIDEO_OVERLAY_EXPORT_INTERCEPT:", e);
        } finally {
            if (exportAbortRef.current === controller) exportAbortRef.current = null;
        }
    }, []);

    const handleExportVideoMP4 = useCallback(async () => {
        exportAbortRef.current?.abort();
        const controller = new AbortController();
        exportAbortRef.current = controller;
        const onStatus = (msg: string | null) => {
            if (!controller.signal.aborted) setExporting(msg);
        };
        try {
            const { runVideoMP4Export } = await import("../utils/videoExportEngine");
            await runVideoMP4Export(videoDraftRef.current, onStatus, controller.signal);
        } catch (e) {
            console.error("ADMIN_VIDEO_MP4_EXPORT_INTERCEPT:", e);
        } finally {
            if (exportAbortRef.current === controller) exportAbortRef.current = null;
        }
    }, []);

    const handleTogglePlaybackMode = useCallback(() => {
        setPlaybackMode((m) => (m === 'play-all' ? 'loop-angle' : 'play-all'));
    }, [setPlaybackMode]);
    const handleToggleMobileScenes = useCallback(() => setIsMobileScenesOpen((open) => !open), []);
    const handleCloseMobileScenes = useCallback(() => setIsMobileScenesOpen(false), []);

    const activeVideoScene = useMemo(
        () => getActiveSceneAtTime(videoDraft, currentTime),
        [videoDraft, currentTime]
    );
    const activeSceneTime = useMemo(() => {
        const scenes = videoDraft.scenes || [];
        let t = 0;
        for (let i = 0; i < activeVideoScene.sceneIndex && i < scenes.length; i++) {
            t += scenes[i]?.duration || 0;
        }
        return t + (activeVideoScene.isOutro ? 0.1 : 0);
    }, [videoDraft.scenes, activeVideoScene.sceneIndex, activeVideoScene.isOutro]);

    const totalVideoDuration = useMemo(() => getTotalVideoDuration(videoDraft), [videoDraft]);

    if (!isMounted) return null;

    return (
        <>
            <header className="command-ribbon">
                <div className="tpe-flex-row" style={{ flex: 1 }}>
                    <VideoDraftForm
                        draft={videoDraft}
                        onChange={updateVideoDraft}
                        onExportOverlay={handleExportVideoOverlay}
                        onExportMP4={handleExportVideoMP4}
                        onClearVideo={clearVideo}
                        onReset={resetVideoDraft}
                        onUploadVideo={ingestVideoBlob}
                        isExporting={!!exporting}
                        mode={mode}
                        onModeChange={onModeChange}
                        activeSceneIndex={activeVideoScene.sceneIndex}
                        isOutro={activeVideoScene.isOutro}
                    />
                </div>
            </header>

            {exporting && (
                <ExportOverlay
                    status={exporting}
                    onClose={() => setExporting(null)}
                    onCancel={handleCancelExport}
                />
            )}

            <main className="sandbox-grid">
                <div className="tpe-nle-split-pane">
                    {/* 🏛️ LEFT PANE: Dedicated Timeline Storyboard & Production Inspector */}
                    <TimelineStoryboard
                        draft={videoDraft}
                        onChange={updateVideoDraft}
                        currentTime={currentTime}
                        liveClock={liveClock}
                        isPlaying={isPlaying}
                        seekTo={seekTo}
                        onScrubStart={handleCardScrubStart}
                        onScrubEnd={handleCardScrubEnd}
                        playbackMode={playbackMode}
                        onTogglePlaybackMode={handleTogglePlaybackMode}
                        isMobileDrawerOpen={isMobileScenesOpen}
                        onCloseMobileDrawer={handleCloseMobileScenes}
                    />

                    {/* 🏛️ RIGHT PANE: Focused Program Monitor with Platform Switcher & Docked Transport */}
                    <StudioVideoMonitor
                        draft={videoDraft}
                        updateDraft={updateVideoDraft}
                        isPlaying={isPlaying}
                        togglePlay={handleTogglePlay}
                        onRegisterAudioUnlock={handleRegisterAudioUnlock}
                        playbackMode={playbackMode}
                        currentTime={currentTime}
                        liveClock={liveClock}
                        seekNonce={seekNonce}
                        duration={totalVideoDuration}
                        seekTo={seekTo}
                        isMuted={isMuted}
                        isLoadingStream={isOptimisingVideo}
                        ingestStatus={ingestStatus}
                        onTimeUpdate={syncTimeFromVideo}
                        isMobileScenesOpen={isMobileScenesOpen}
                        onToggleMobileScenes={handleToggleMobileScenes}
                        externalIsScrubbing={isCardScrubbing}
                    />
                </div>
            </main>

            <SelectionPopover
                postMode="video"
                videoDraft={videoDraft}
                onVideoChange={updateVideoDraft}
                activeSceneTime={activeSceneTime}
            />
        </>
    );
}
