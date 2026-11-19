"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { Draft, PostMode, getTotalVideoDuration, getActiveSceneAtTime } from "../../types/news";
import { useEditorialState } from "./hooks/useEditorialState";
import { useVideoDraftState } from "./hooks/useVideoDraftState";
import { runExportEngine } from "./utils/exportEngine";
import { runVideoOverlayExport, runVideoMP4Export } from "./utils/videoExportEngine";
import { get, set } from "idb-keyval";

// Institutional Components
import { DraftForm } from "./components/DraftForm";
import { VideoDraftForm } from "./components/VideoDraftForm";
import { OmniPreviewGrid } from "./components/OmniPreviewGrid";
import { StudioVideoMonitor } from "./components/StudioVideoMonitor";
import { FocalToolkit } from "./components/FocalToolkit";
import { TimelineStoryboard } from "./components/TimelineStoryboard";
import { ExportOverlay } from "./components/ExportOverlay";
import { SelectionPopover } from "./components/SelectionPopover";
import { CarouselIcon, VideoIcon } from "../../components/icons/TPEIcons";

/**
 * 2027 Institutional Command Center: AdminDashboard
 * Orchestrates Carousel and Video editorial workflows with sub-pixel omnichannel previews.
 */
export default function AdminDashboard() {
    const [postMode, setPostMode] = useState<PostMode>('carousel');
    const [exporting, setExporting] = useState<string | null>(null);

    // Carousel State
    const { 
        isMounted: isCarouselMounted, 
        currentStep, 
        setCurrentStep, 
        activeDraft, 
        updateDraft, 
        resetState, 
        undo, 
        redo, 
        canUndo, 
        canRedo 
    } = useEditorialState();

    // Video State
    const {
        isMounted: isVideoMounted,
        videoDraft,
        updateVideoDraft,
        resetVideoDraft,
        isOptimisingVideo,
        ingestStatus,
        ingestVideoBlob,
        isPlaying,
        togglePlay,
        playbackMode,
        setPlaybackMode,
        currentTime,
        seekTo,
        isMuted,
        syncTimeFromVideo
    } = useVideoDraftState();

    // Load saved post mode
    useEffect(() => {
        get<PostMode>('tpe_post_mode').then((savedMode) => {
            if (savedMode) setPostMode(savedMode);
        });
    }, []);

    const handleSetPostMode = useCallback((mode: PostMode) => {
        setPostMode(mode);
        set('tpe_post_mode', mode);
    }, []);

    const handleExportBatch = useCallback(async (draft: Draft) => {
        try {
            await runExportEngine(draft, setExporting);
        } catch (e) {
            console.error("ADMIN_DASHBOARD_EXPORT_INTERCEPT:", e);
        }
    }, []);

    const videoDraftRef = useRef(videoDraft);
    useEffect(() => {
        videoDraftRef.current = videoDraft;
    }, [videoDraft]);

    const handleExportVideoOverlay = useCallback(async () => {
        try {
            await runVideoOverlayExport(videoDraftRef.current, setExporting);
        } catch (e) {
            console.error("ADMIN_VIDEO_OVERLAY_EXPORT_INTERCEPT:", e);
        }
    }, []);

    const handleExportVideoMP4 = useCallback(async () => {
        try {
            await runVideoMP4Export(videoDraftRef.current, setExporting);
        } catch (e) {
            console.error("ADMIN_VIDEO_MP4_EXPORT_INTERCEPT:", e);
        }
    }, []);

    if (!isCarouselMounted || !isVideoMounted) return null;

    const totalSteps = 2 + (activeDraft.extraSlides?.length || 0);

    const modeSwitcher = (
        <div className="tpe-mode-cluster" role="tablist" aria-label="Post mode">
            <button
                type="button"
                role="tab"
                aria-selected={postMode === 'carousel'}
                className="tpe-mode-btn"
                data-active={postMode === 'carousel'}
                onClick={() => handleSetPostMode('carousel')}
                title="Carousel Multi-Slide Posts"
            >
                <CarouselIcon width={12} height={12} stroke={postMode === 'carousel' ? '#000' : 'currentColor'} />
                <span>CAROUSEL</span>
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={postMode === 'video'}
                className="tpe-mode-btn"
                data-active={postMode === 'video'}
                onClick={() => handleSetPostMode('video')}
                title="Timeline Video Engine (60s+ Monetization & Top-Box)"
            >
                <VideoIcon width={12} height={12} stroke={postMode === 'video' ? '#000' : 'currentColor'} />
                <span>VIDEO ENGINE</span>
            </button>
        </div>
    );

    return (
        <div className="dashboard-container">
            <header className="command-ribbon">
                <div className="tpe-flex-row" style={{ flex: 1 }}>
                    {postMode === 'carousel' ? (
                        <DraftForm 
                            draft={activeDraft} 
                            onChange={updateDraft} 
                            onSubmit={handleExportBatch} 
                            step={currentStep} 
                            setStep={setCurrentStep} 
                            onReset={resetState}
                            modeSwitcher={modeSwitcher}
                        />
                    ) : (
                        <VideoDraftForm 
                            draft={videoDraft} 
                            onChange={updateVideoDraft} 
                            onExportOverlay={handleExportVideoOverlay} 
                            onExportMP4={handleExportVideoMP4} 
                            onReset={resetVideoDraft}
                            onUploadVideo={ingestVideoBlob}
                            isOptimisingVideo={isOptimisingVideo}
                            isExporting={!!exporting}
                            modeSwitcher={modeSwitcher}
                            activeSceneIndex={getActiveSceneAtTime(videoDraft, currentTime).sceneIndex}
                            isOutro={getActiveSceneAtTime(videoDraft, currentTime).isOutro}
                        />
                    )}
                </div>
            </header>

            {/* PROGRESS BAR */}
            {postMode === 'carousel' && (
                <div className="tpe-progress-container">
                    {Array.from({ length: totalSteps }).map((_, i) => {
                        const stepNum = i + 1;
                        const isActive = currentStep === stepNum;
                        
                        const segmentColor = (currentStep >= stepNum) 
                            ? (stepNum === 1 ? 'var(--ui-indicator)' : (stepNum === 2 ? 'var(--ui-accent)' : 'var(--ui-text)'))
                            : 'transparent';

                        return (
                            <div 
                                key={i} 
                                onClick={() => setCurrentStep(stepNum)} 
                                className="tpe-progress-segment" 
                                data-active={isActive}
                                style={{ background: segmentColor }} 
                            />
                        );
                    })}
                </div>
            )}

            {exporting && (
                <ExportOverlay 
                    status={exporting} 
                    onClose={() => setExporting(null)} 
                />
            )}

            <main className="sandbox-grid">
                {postMode === 'carousel' ? (
                    <>
                        <OmniPreviewGrid draft={activeDraft} currentStep={currentStep} />
                        <FocalToolkit 
                            activeDraft={activeDraft} 
                            updateDraft={updateDraft} 
                            currentStep={currentStep} 
                            setStep={setCurrentStep} 
                            undo={undo} 
                            redo={redo} 
                            canUndo={canUndo} 
                            canRedo={canRedo} 
                        />
                    </>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'row', height: '100%', width: '100%', overflow: 'hidden' }}>
                        {/* 🏛️ LEFT PANE: Dedicated Timeline Storyboard & Production Inspector */}
                        <TimelineStoryboard
                            draft={videoDraft}
                            onChange={updateVideoDraft}
                            currentTime={currentTime}
                            seekTo={seekTo}
                            playbackMode={playbackMode}
                            onTogglePlaybackMode={() => setPlaybackMode(m => m === 'play-all' ? 'loop-angle' : 'play-all')}
                        />

                        {/* 🏛️ RIGHT PANE: Focused Program Monitor with Platform Switcher & Docked Transport */}
                        <StudioVideoMonitor 
                            draft={videoDraft}
                            updateDraft={updateVideoDraft}
                            isPlaying={isPlaying}
                            togglePlay={togglePlay}
                            playbackMode={playbackMode}
                            currentTime={currentTime}
                            duration={getTotalVideoDuration(videoDraft)}
                            seekTo={seekTo}
                            isMuted={isMuted}
                            isLoadingStream={isOptimisingVideo}
                            ingestStatus={ingestStatus}
                            onTimeUpdate={syncTimeFromVideo}
                        />
                    </div>
                )}
            </main>

            <div id="export-capture-surface" aria-hidden="true" inert style={{ position: 'fixed', insetInlineStart: '-5000px' }} />
            <SelectionPopover 
                postMode={postMode}
                carouselDraft={activeDraft}
                onCarouselChange={updateDraft}
                videoDraft={videoDraft}
                onVideoChange={updateVideoDraft}
                currentTime={currentTime}
            />
        </div>
    );
}
