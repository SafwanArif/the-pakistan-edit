"use client";

import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { PostMode, getTotalVideoDuration, getActiveSceneAtTime } from "@/types/news";
import { useVideoDraftState } from "../hooks/useVideoDraftState";
import { setExportStatus } from "../utils/exportEngine";
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
    const [exportStatus, setExportStatusState] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const [isMobileScenesOpen, setIsMobileScenesOpen] = useState(false);
    const [isCardScrubbing, setIsCardScrubbing] = useState(false);
    const [cardScrubTime, setCardScrubTime] = useState<number | null>(null);
    const wasPlayingBeforeCardScrubRef = useRef(false);
    const isCardScrubbingRef = useRef(false);
    const audioUnlockRef = useRef<(() => void) | null>(null);
    const exportAbortRef = useRef<AbortController | null>(null);

    const {
        isMounted,
        videoDraft,
        companionAudioUrl,
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
    useLayoutEffect(() => {
        videoDraftRef.current = videoDraft;
        isPlayingRef.current = isPlaying;
        isCardScrubbingRef.current = isCardScrubbing;
    });

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
        isCardScrubbingRef.current = true;
        setIsCardScrubbing(true);
        wasPlayingBeforeCardScrubRef.current = isPlayingRef.current;
        if (isPlayingRef.current) {
            isPlayingRef.current = false;
            togglePlay();
        }
    }, [togglePlay]);

    const handleCardScrubEnd = useCallback((finalTime: number) => {
        isCardScrubbingRef.current = false;
        setCardScrubTime(null);
        setIsCardScrubbing(false);
        seekTo(finalTime);
        if (wasPlayingBeforeCardScrubRef.current) {
            wasPlayingBeforeCardScrubRef.current = false;
            if (!isPlayingRef.current) handleTogglePlay();
        }
    }, [seekTo, handleTogglePlay]);

    useEffect(() => () => {
        exportAbortRef.current?.abort();
    }, []);

    const handleCloseExport = useCallback(() => {
        setExportStatus(setExportStatusState, null);
    }, []);

    const handleCancelExport = useCallback(() => {
        exportAbortRef.current?.abort();
        exportAbortRef.current = null;
        setIsExporting(false);
        setExportStatus(setExportStatusState, null);
    }, []);

    const runExport = useCallback(async (kind: 'overlay' | 'mp4') => {
        exportAbortRef.current?.abort();
        const controller = new AbortController();
        exportAbortRef.current = controller;
        setIsExporting(true);
        const onStatus = (msg: string | null) => {
            if (!controller.signal.aborted) setExportStatusState(msg);
        };
        try {
            const mod = await import("../utils/videoExportEngine");
            if (kind === 'overlay') {
                await mod.runVideoOverlayExport(videoDraftRef.current, onStatus, controller.signal);
            } else {
                await mod.runVideoMP4Export(videoDraftRef.current, onStatus, controller.signal);
            }
        } catch (err) {
            console.error(kind === 'overlay' ? "VIDEO_OVERLAY_EXPORT_ERROR:" : "VIDEO_MP4_EXPORT_ERROR:", err);
            if (!controller.signal.aborted) {
                setExportStatus(onStatus, `Export Error: ${err instanceof Error ? err.message : "Export failed"}`, 4000);
            }
        } finally {
            if (exportAbortRef.current === controller) {
                exportAbortRef.current = null;
                setIsExporting(false);
            }
        }
    }, []);

    const handleExportVideoOverlay = useCallback(() => void runExport('overlay'), [runExport]);
    const handleExportVideoMP4 = useCallback(() => void runExport('mp4'), [runExport]);

    const handleTogglePlaybackMode = useCallback(() => {
        setPlaybackMode((m) => (m === 'play-all' ? 'loop-angle' : 'play-all'));
    }, [setPlaybackMode]);
    const handleToggleMobileScenes = useCallback(() => setIsMobileScenesOpen((open) => !open), []);
    const handleCloseMobileScenes = useCallback(() => {
        setIsMobileScenesOpen(false);
        if (isCardScrubbingRef.current) {
            isCardScrubbingRef.current = false;
            setCardScrubTime(null);
            setIsCardScrubbing(false);
            if (wasPlayingBeforeCardScrubRef.current) {
                wasPlayingBeforeCardScrubRef.current = false;
                if (!isPlayingRef.current) handleTogglePlay();
            }
        }
    }, [handleTogglePlay]);

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
    const activeCompanionAudioUrl = videoDraft.videoUrl?.startsWith("blob:") ? companionAudioUrl : undefined;
    const isOverlayOpen = Boolean(exportStatus);

    if (!isMounted) return null;

    return (
        <>
            <header className="command-ribbon" inert={isOverlayOpen}>
                <div className="tpe-flex-row">
                    <VideoDraftForm
                        draft={videoDraft}
                        onChange={updateVideoDraft}
                        onExportOverlay={handleExportVideoOverlay}
                        onExportMP4={handleExportVideoMP4}
                        onClearVideo={clearVideo}
                        onReset={resetVideoDraft}
                        onUploadVideo={ingestVideoBlob}
                        isExporting={isExporting}
                        mode={mode}
                        onModeChange={onModeChange}
                        activeSceneIndex={activeVideoScene.sceneIndex}
                        isOutro={activeVideoScene.isOutro}
                    />
                </div>
            </header>

            {exportStatus && (
                <ExportOverlay
                    status={exportStatus}
                    onClose={handleCloseExport}
                    onCancel={handleCancelExport}
                />
            )}

            <main className="sandbox-grid" inert={isOverlayOpen}>
                <div className="tpe-nle-split-pane">
                    {/* Left Pane: Dedicated Timeline Storyboard & Production Inspector */}
                    <TimelineStoryboard
                        draft={videoDraft}
                        onChange={updateVideoDraft}
                        currentTime={currentTime}
                        liveClock={liveClock}
                        isPlaying={isPlaying}
                        seekTo={seekTo}
                        onScrubStart={handleCardScrubStart}
                        onScrubMove={setCardScrubTime}
                        onScrubEnd={handleCardScrubEnd}
                        playbackMode={playbackMode}
                        onTogglePlaybackMode={handleTogglePlaybackMode}
                        isMobileDrawerOpen={isMobileScenesOpen}
                        onCloseMobileDrawer={handleCloseMobileScenes}
                    />

                    {/* Right Pane: Focused Program Monitor with Platform Switcher & Docked Transport */}
                    <StudioVideoMonitor
                        draft={videoDraft}
                        companionAudioUrl={activeCompanionAudioUrl}
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
                        externalScrubTime={cardScrubTime}
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
