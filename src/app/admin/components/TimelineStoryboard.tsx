"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { VideoDraft, TimelineScene, timelineTimeToMediaTime, wrapMediaTime, getSceneBoundaries, getSceneRoleColor, resolveSceneFade, setSceneClipStartOffset, getTimelineStructure, clamp } from "@/types/news";
import { generateShortId, revokeBlobUrl } from "@/utils/idUtils";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { canUseServerIngest, deleteServerCachedVideo } from "../utils/serverCapabilities";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";
import { getSceneSubtitles } from "./SubtitleEditorTray";
import { MasterChecklistControl } from "./MasterChecklistPopover";
import { TimelineFooterCards, TimelineOutroCard } from "./TimelineFooterCards";
import { SceneStoryboardCard } from "./SceneStoryboardCard";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons/TPEIcons";

interface TimelineStoryboardProps {
    draft: VideoDraft;
    onChange: (d: VideoDraft) => void;
    currentTime: number;
    liveClock?: LivePlaybackClock;
    isPlaying?: boolean;
    seekTo: (time: number) => void;
    onScrubStart?: () => void;
    onScrubMove?: (time: number) => void;
    onScrubEnd?: (finalTime: number) => void;
    playbackMode?: 'play-all' | 'loop-angle';
    onTogglePlaybackMode?: () => void;
    isMobileDrawerOpen: boolean;
    onCloseMobileDrawer: () => void;
}

interface PlaybackModeControlProps {
    playbackMode: 'play-all' | 'loop-angle';
    onTogglePlaybackMode: () => void;
    variant: 'mobile' | 'desktop';
}

const PlaybackModeControl: React.FC<PlaybackModeControlProps> = React.memo(({ playbackMode, onTogglePlaybackMode, variant }) => (
    <div className={`tpe-mode-cluster tpe-${variant}-playback-mode tpe-playback-mode`} role="group" aria-label="Playback mode">
        <button
            type="button"
            aria-pressed={playbackMode === 'play-all'}
            aria-label="Play All: play straight through all angle cards"
            onClick={() => { if (playbackMode !== 'play-all') onTogglePlaybackMode(); }}
            className="tpe-mode-btn tpe-playback-mode-btn"
            data-active={playbackMode === 'play-all'}
            title="Play All: play straight through all angle cards"
        >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4l10 8-10 8V4zm12 1h2v14h-2V5z" /></svg>
        </button>
        <button
            type="button"
            aria-pressed={playbackMode === 'loop-angle'}
            aria-label="Loop Angle: repeat only the active angle card"
            onClick={() => { if (playbackMode !== 'loop-angle') onTogglePlaybackMode(); }}
            className="tpe-mode-btn tpe-playback-mode-btn"
            data-active={playbackMode === 'loop-angle'}
            title="Loop Angle: repeat only the active angle card"
        >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
        </button>
    </div>
));
PlaybackModeControl.displayName = "PlaybackModeControl";

/** Maps a subtitle segment's media start time inside a scene card to a clamped timeline seek target. */
export function resolveSceneSubtitleSeekTime(
    draft: VideoDraft,
    bounds: { start: number; end: number },
    sceneDuration: number,
    mediaStart: number,
    preStoryDur: number,
    storyOffset: number,
): number {
    const maxTarget = Math.max(bounds.start, bounds.end - 0.05);
    const clipDur = draft.videoDuration || 0;
    const cardMediaStart = wrapMediaTime(draft, bounds.start, clipDur);
    const loopStart = bounds.start >= preStoryDur && storyOffset > 0 && storyOffset < clipDur - 0.5 ? storyOffset : 0;
    const wrappedDelta = clipDur > 0 && cardMediaStart + sceneDuration > clipDur && mediaStart < cardMediaStart && mediaStart >= loopStart
        ? (clipDur - cardMediaStart) + (mediaStart - loopStart)
        : null;
    const rawTarget = wrappedDelta !== null && wrappedDelta < sceneDuration
        ? bounds.start + wrappedDelta
        : bounds.start + Math.max(0, mediaStart - cardMediaStart);
    return clamp(rawTarget, bounds.start, maxTarget);
}

/** Left-pane scene storyboard inspector with 60s monetisation pacing and cold-open hook extractor. */
export const TimelineStoryboard: React.FC<TimelineStoryboardProps> = React.memo(({
    draft, onChange, currentTime, liveClock, isPlaying = false, seekTo, onScrubStart, onScrubMove, onScrubEnd, playbackMode = 'play-all', onTogglePlaybackMode, isMobileDrawerOpen, onCloseMobileDrawer,
}) => {
    const isMobileViewport = useMediaQuery("(max-width: 900px)");
    const [openChecklistSceneId, setOpenChecklistSceneId] = useState<string | null>(null);
    const [openSubSceneId, setOpenSubSceneId] = useState<string | null>(null);
    const [drawerSceneIndex, setDrawerSceneIndex] = useState<number | null>(null);
    const [sceneUploadWarning, setSceneUploadWarning] = useState<string | null>(null);
    const closeChecklist = useCallback((reason?: CloseReason) => {
        setOpenChecklistSceneId(null);
        if (reason === "escape") {
            const btn = document.querySelector('.tpe-scene-checklist-btn[data-active="true"]') as HTMLElement | null;
            btn?.focus();
        }
    }, []);
    const checklistRef = useClickOutside(closeChecklist, undefined, openChecklistSceneId !== null);
    const carouselSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const offsetSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const suppressScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleCloseDrawer = useCallback((reason?: CloseReason) => {
        if (carouselSeekTimeoutRef.current !== null) {
            clearTimeout(carouselSeekTimeoutRef.current);
            carouselSeekTimeoutRef.current = null;
        }
        setDrawerSceneIndex(null);
        onCloseMobileDrawer();
        if (reason === "escape") {
            requestAnimationFrame(() => {
                (document.querySelector('[data-mobile-scenes-trigger="true"]') as HTMLElement | null)?.focus();
            });
        }
    }, [onCloseMobileDrawer]);
    const mobileDrawerRef = useClickOutside(handleCloseDrawer, '[data-mobile-scenes-trigger="true"], .tpe-checklist-popover', isMobileDrawerOpen);
    const mobileSceneRackRef = useRef<HTMLDivElement>(null);
    const suppressScrollSeekRef = useRef(false);
    const scenes = useMemo(() => draft.scenes || [], [draft.scenes]);
    const carouselItemCount = scenes.length + (draft.enableOutro ? 1 : 0);

    const sceneBoundaries = useMemo(() => getSceneBoundaries(scenes), [scenes]);
    const { hasReHook, storyIdx, preStoryDur, storyOffset } = useMemo(() => getTimelineStructure(scenes), [scenes]);
    const sceneSubtitlesList = useMemo(
        () => sceneBoundaries.map((b) => (draft.subtitles?.length ? getSceneSubtitles(draft, b.start, b.end) : [])),
        [draft, sceneBoundaries]
    );
    const sceneFadesList = useMemo(
        () => scenes.map((_, idx) => resolveSceneFade(scenes, idx)),
        [scenes]
    );
    const outroStart = sceneBoundaries.length > 0 ? sceneBoundaries[sceneBoundaries.length - 1]!.end : 0;
    const isOutroActive = Boolean(draft.enableOutro && currentTime >= outroStart);
    const currentMediaTime = useMemo(() => Math.round(timelineTimeToMediaTime(draft, currentTime) * 10) / 10, [draft, currentTime]);

    const derivedSceneIndex = useMemo(() => {
        if (draft.enableOutro && currentTime >= outroStart) return scenes.length;
        const activeIndex = sceneBoundaries.findIndex((bounds) => currentTime >= bounds.start && currentTime < bounds.end);
        return activeIndex >= 0 ? activeIndex : 0;
    }, [currentTime, draft.enableOutro, outroStart, sceneBoundaries, scenes.length]);

    const maxCarouselIndex = Math.max(0, carouselItemCount - 1);
    const mobileSceneIndex = clamp(
        isMobileDrawerOpen && drawerSceneIndex !== null ? drawerSceneIndex : derivedSceneIndex,
        0,
        maxCarouselIndex
    );
    const mobileSceneIndexRef = useRef(mobileSceneIndex);
    const currentTimeRef = useRef(currentTime);
    const draftRef = useRef(draft);
    const sceneBoundariesRef = useRef(sceneBoundaries);
    const structRef = useRef({ preStoryDur, storyOffset });
    useLayoutEffect(() => {
        mobileSceneIndexRef.current = mobileSceneIndex;
        currentTimeRef.current = currentTime;
        draftRef.current = draft;
        sceneBoundariesRef.current = sceneBoundaries;
        structRef.current = { preStoryDur, storyOffset };
    });

    const getLiveMediaTime = useCallback(() => {
        const liveT = liveClock ? liveClock.getTime() : currentTimeRef.current;
        return Math.round(timelineTimeToMediaTime(draftRef.current, liveT) * 10) / 10;
    }, [liveClock]);

    useEffect(() => {
        const rack = mobileSceneRackRef.current;
        if (!isMobileDrawerOpen || !rack?.clientWidth) return;
        suppressScrollSeekRef.current = true;
        rack.scrollTo({ left: mobileSceneIndexRef.current * rack.clientWidth, behavior: 'auto' });
        const rafId = requestAnimationFrame(() => { suppressScrollSeekRef.current = false; });
        return () => {
            cancelAnimationFrame(rafId);
            suppressScrollSeekRef.current = false;
        };
    }, [carouselItemCount, isMobileDrawerOpen]);

    useLayoutEffect(() => {
        const rack = mobileSceneRackRef.current;
        if (!rack) return;

        // Offscreen slides should not force the drawer to stay as tall as the longest card.
        const syncActiveSlideHeight = () => {
            if (!isMobileDrawerOpen || window.innerWidth > 900) {
                rack.style.removeProperty("block-size");
                return;
            }
            const activeSlide = rack.children.item(mobileSceneIndexRef.current) as HTMLElement | null;
            if (activeSlide) rack.style.blockSize = `${activeSlide.getBoundingClientRect().height}px`;
            else rack.style.removeProperty("block-size");
        };

        const observer = new ResizeObserver(syncActiveSlideHeight);
        const activeSlide = rack.children.item(mobileSceneIndexRef.current);
        if (activeSlide) observer.observe(activeSlide);
        syncActiveSlideHeight();
        window.addEventListener("resize", syncActiveSlideHeight);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", syncActiveSlideHeight);
        };
    }, [carouselItemCount, isMobileDrawerOpen, mobileSceneIndex]);

    useEffect(() => () => {
        if (carouselSeekTimeoutRef.current !== null) clearTimeout(carouselSeekTimeoutRef.current);
        if (offsetSeekTimeoutRef.current !== null) clearTimeout(offsetSeekTimeoutRef.current);
        if (suppressScrollTimerRef.current !== null) clearTimeout(suppressScrollTimerRef.current);
    }, []);

    const handleMobileSceneScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
        const rack = event.currentTarget;
        if (!rack.clientWidth || carouselItemCount === 0) return;
        const nextIndex = clamp(Math.round(rack.scrollLeft / rack.clientWidth), 0, carouselItemCount - 1);
        const prevIndex = mobileSceneIndexRef.current;
        mobileSceneIndexRef.current = nextIndex;
        setDrawerSceneIndex((current) => (current === nextIndex ? current : nextIndex));
        if (suppressScrollSeekRef.current || nextIndex === prevIndex) return;
        if (carouselSeekTimeoutRef.current !== null) clearTimeout(carouselSeekTimeoutRef.current);
        carouselSeekTimeoutRef.current = setTimeout(() => {
            carouselSeekTimeoutRef.current = null;
            if (nextIndex < scenes.length) {
                const bounds = sceneBoundaries[nextIndex];
                if (bounds) seekTo(bounds.start);
            } else if (draft.enableOutro) {
                seekTo(outroStart);
            }
        }, 140);
    }, [carouselItemCount, draft.enableOutro, outroStart, sceneBoundaries, scenes.length, seekTo]);

    const releaseSceneMedia = (mediaUrl?: string) => {
        revokeBlobUrl(mediaUrl);
        deleteServerCachedVideo(mediaUrl);
    };

    const updateScene = useCallback((index: number, patch: Partial<TimelineScene>) => {
        const curDraft = draftRef.current;
        const updated = [...(curDraft.scenes || [])];
        const prev = updated[index];
        if (!prev) return;
        if ('mediaUrl' in patch && patch.mediaUrl !== prev.mediaUrl) releaseSceneMedia(prev.mediaUrl);
        updated[index] = { ...prev, ...patch };
        onChange({ ...curDraft, scenes: updated });
    }, [onChange]);

    const updateSceneById = useCallback((sceneId: string, patch: Partial<TimelineScene>): boolean => {
        const curScenes = draftRef.current.scenes || [];
        const liveIdx = curScenes.findIndex((s) => s.id === sceneId);
        if (liveIdx < 0) return false;
        updateScene(liveIdx, patch);
        return true;
    }, [updateScene]);

    const handleDeleteScene = useCallback((index: number) => {
        const curDraft = draftRef.current;
        const curScenes = curDraft.scenes || [];
        const removed = curScenes[index];
        if (curScenes.length <= 1 || !removed) return;
        releaseSceneMedia(removed.mediaUrl);
        ingestAbortsRef.current.get(removed.id)?.abort();
        ingestAbortsRef.current.delete(removed.id);
        setOpenChecklistSceneId((prev) => (prev === removed.id ? null : prev));
        setOpenSubSceneId((prev) => (prev === removed.id ? null : prev));
        onChange({ ...curDraft, scenes: curScenes.filter((_, i) => i !== index) });
    }, [onChange]);

    const setSceneOffset = useCallback((sceneIdx: number, nextOffset?: number, snapToStart = false) => {
        const nextDraft = setSceneClipStartOffset(draftRef.current, sceneIdx, nextOffset);
        if (nextDraft === draftRef.current) return;
        onChange(nextDraft);
        if (snapToStart) {
            const targetStart = sceneBoundariesRef.current[sceneIdx]?.start ?? 0;
            if (offsetSeekTimeoutRef.current !== null) clearTimeout(offsetSeekTimeoutRef.current);
            // Coalesce rapid consecutive nudger taps into one clean video seek while keeping UI numbers instant
            offsetSeekTimeoutRef.current = setTimeout(() => {
                offsetSeekTimeoutRef.current = null;
                seekTo(targetStart);
            }, 110);
        }
    }, [onChange, seekTo]);

    const handleAddScene = useCallback(() => {
        const curDraft = draftRef.current;
        const curScenes = curDraft.scenes || [];
        onChange({ ...curDraft, scenes: [...curScenes, { id: `scene-${generateShortId()}`, title: `KEY ANGLE ${curScenes.length + 1}: STRATEGIC ANALYSIS`, subtitle: "Verified intelligence breakdown and future market impact.", duration: 15, mediaType: 'video' }] });
    }, [onChange]);

    const handleAddOutro = useCallback(() => {
        const curDraft = draftRef.current;
        const outroIndex = curDraft.scenes?.length ?? 0;
        if (!curDraft.enableOutro) onChange({ ...curDraft, enableOutro: true });
        mobileSceneIndexRef.current = outroIndex;
        setDrawerSceneIndex(outroIndex);
        if (isMobileDrawerOpen) {
            const rack = mobileSceneRackRef.current;
            if (rack?.clientWidth) rack.scrollTo({ left: outroIndex * rack.clientWidth, behavior: 'smooth' });
        }
        seekTo(sceneBoundariesRef.current[sceneBoundariesRef.current.length - 1]?.end ?? 0);
    }, [isMobileDrawerOpen, onChange, seekTo]);

    const handleRemoveOutro = useCallback(() => {
        onChange({ ...draftRef.current, enableOutro: false });
    }, [onChange]);

    const handleAddReHook = useCallback(() => {
        const curDraft = draftRef.current;
        const curScenes = curDraft.scenes || [];
        if (getTimelineStructure(curScenes).hasReHook) return;
        const updated = [...curScenes];
        updated.splice(1, 0, { id: `rehook-${generateShortId()}`, title: "WAIT — HERE IS ==THE REAL SHIFT==", subtitle: "The overlooked turning point right before the full picture emerged.", duration: 4, mediaType: 'video', shareHookText: true });
        onChange({ ...curDraft, scenes: updated });
    }, [onChange]);

    const handleJumpToReHook = useCallback(() => {
        const b1 = sceneBoundariesRef.current[1];
        if (b1) seekTo(b1.start);
    }, [seekTo]);

    const handleToggleChecklist = useCallback((idx: number) => {
        const sceneId = draftRef.current.scenes?.[idx]?.id;
        if (!sceneId) return;
        setOpenChecklistSceneId((prev) => (prev === sceneId ? null : sceneId));
    }, []);

    const handleToggleSubs = useCallback((idx: number) => {
        const sceneId = draftRef.current.scenes?.[idx]?.id;
        if (!sceneId) return;
        setOpenSubSceneId((prev) => (prev === sceneId ? null : sceneId));
    }, []);

    const ingestAbortsRef = useRef<Map<string, AbortController>>(new Map());
    useEffect(() => () => {
        const aborts = ingestAbortsRef.current;
        aborts.forEach((ctrl) => ctrl.abort());
        aborts.clear();
    }, []);

    const handleUpdateSubtitleText = useCallback((id: string, text: string) => {
        const curDraft = draftRef.current;
        const allSubs = curDraft.subtitles || [];
        onChange({ ...curDraft, subtitles: allSubs.map((s) => (s.id === id ? { ...s, text } : s)) });
    }, [onChange]);

    const handleRemoveSubtitle = useCallback((id: string) => {
        const curDraft = draftRef.current;
        const allSubs = curDraft.subtitles || [];
        onChange({ ...curDraft, subtitles: allSubs.filter((s) => s.id !== id) });
    }, [onChange]);

    const handleSeekSceneSubtitle = useCallback((idx: number, mediaStart: number) => {
        const curDraft = draftRef.current;
        const scene = curDraft.scenes?.[idx];
        const bounds = sceneBoundariesRef.current[idx];
        if (!scene) return;
        const { preStoryDur: preDur, storyOffset: sOff } = structRef.current;
        seekTo(bounds
            ? resolveSceneSubtitleSeekTime(curDraft, bounds, scene.duration, mediaStart, preDur, sOff)
            : Math.max(0, mediaStart - (scene.clipStartOffset ?? 0)));
    }, [seekTo]);

    const handleSceneMediaUpload = useCallback(async (idx: number, file: File) => {
        const targetSceneId = draftRef.current.scenes?.[idx]?.id;
        if (!targetSceneId) return;
        ingestAbortsRef.current.get(targetSceneId)?.abort();
        ingestAbortsRef.current.delete(targetSceneId);
        setSceneUploadWarning(null);
        if (file.type.startsWith('image/')) {
            const imgUrl = URL.createObjectURL(file);
            if (!updateSceneById(targetSceneId, { mediaUrl: imgUrl, mediaType: 'image', mediaName: file.name })) {
                revokeBlobUrl(imgUrl);
            }
            return;
        }
        const controller = new AbortController();
        ingestAbortsRef.current.set(targetSceneId, controller);
        try {
            if (!(await canUseServerIngest())) {
                if (controller.signal.aborted) return;
                const localUrl = URL.createObjectURL(file);
                if (!updateSceneById(targetSceneId, { mediaUrl: localUrl, mediaType: 'video', mediaName: file.name })) {
                    revokeBlobUrl(localUrl);
                }
                return;
            }
            const formData = new FormData();
            formData.append('file', file, file.name);
            const res = await fetch('/api/video/ingest', { method: 'POST', body: formData, signal: controller.signal });
            if (controller.signal.aborted) return;
            if (res.ok) {
                const { url } = await res.json() as { url: string };
                if (controller.signal.aborted) {
                    deleteServerCachedVideo(url);
                    return;
                }
                if (!updateSceneById(targetSceneId, { mediaUrl: url, mediaType: 'video', mediaName: file.name })) {
                    deleteServerCachedVideo(url);
                }
                return;
            }
            setSceneUploadWarning(`Server ingest failed (${res.status}) for ${file.name} — previewing local copy.`);
        } catch (err) {
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
            setSceneUploadWarning(`Server ingest unavailable for ${file.name} — previewing local copy.`);
        } finally {
            if (ingestAbortsRef.current.get(targetSceneId) === controller) {
                ingestAbortsRef.current.delete(targetSceneId);
            }
        }
        if (controller.signal.aborted) return;
        const localUrl = URL.createObjectURL(file);
        if (!updateSceneById(targetSceneId, { mediaUrl: localUrl, mediaType: 'video', mediaName: file.name })) {
            revokeBlobUrl(localUrl);
        }
    }, [updateSceneById]);

    const handleMobileSceneNavigate = useCallback((direction: -1 | 1) => {
        const rack = mobileSceneRackRef.current;
        if (!rack || carouselItemCount === 0) return;
        const nextIndex = clamp(mobileSceneIndexRef.current + direction, 0, carouselItemCount - 1);
        if (nextIndex === mobileSceneIndexRef.current) return;
        if (carouselSeekTimeoutRef.current !== null) {
            clearTimeout(carouselSeekTimeoutRef.current);
            carouselSeekTimeoutRef.current = null;
        }
        suppressScrollSeekRef.current = true;
        if (suppressScrollTimerRef.current !== null) clearTimeout(suppressScrollTimerRef.current);
        suppressScrollTimerRef.current = setTimeout(() => {
            suppressScrollTimerRef.current = null;
            suppressScrollSeekRef.current = false;
        }, 350);
        mobileSceneIndexRef.current = nextIndex;
        setDrawerSceneIndex(nextIndex);
        rack.scrollTo({ left: nextIndex * rack.clientWidth, behavior: 'smooth' });
        const curScenes = draftRef.current.scenes || [];
        if (nextIndex < curScenes.length) {
            const bounds = sceneBoundariesRef.current[nextIndex];
            if (bounds) seekTo(bounds.start);
        } else if (draftRef.current.enableOutro) {
            const endTime = sceneBoundariesRef.current[sceneBoundariesRef.current.length - 1]?.end ?? 0;
            seekTo(endTime);
        }
    }, [carouselItemCount, seekTo]);

    const hasVideo = Boolean(draft.videoUrl);
    const hasSubtitles = Boolean(draft.subtitles?.length);
    const globalShowSubtitles = draft.showSubtitles !== false;
    const reHookAnchored = scenes[1]?.shareHookText !== false;

    return (
        <>
            {isMobileDrawerOpen && (
                <button
                    type="button"
                    className="tpe-mobile-scenes-backdrop"
                    aria-hidden="true"
                    tabIndex={-1}
                    onClick={() => handleCloseDrawer()}
                />
            )}
            <aside
                id="mobile-scenes-drawer"
                ref={mobileDrawerRef}
                role={isMobileDrawerOpen ? "region" : undefined}
                aria-label={isMobileDrawerOpen ? "Scenes drawer" : "Timeline Storyboard"}
                data-mobile-open={isMobileDrawerOpen}
                className="tpe-flex-col tpe-storyboard-pane tpe-storyboard-aside"
            >
                <div className="tpe-mobile-scenes-header">
                    <div className="tpe-flex-row tpe-storyboard-head-left">
                        <div className="tpe-flex-col tpe-storyboard-title-col">
                            <span className="tpe-storyboard-title">SCENES</span>
                            <span aria-live="polite" className="tpe-storyboard-counter tpe-tabular-nums">
                                {carouselItemCount > 0 ? `SCENE ${mobileSceneIndex + 1} OF ${carouselItemCount}` : 'NO SCENES'}
                            </span>
                        </div>
                        {onTogglePlaybackMode && (
                            <PlaybackModeControl
                                playbackMode={playbackMode}
                                onTogglePlaybackMode={onTogglePlaybackMode}
                                variant="mobile"
                            />
                        )}
                        {isMobileViewport && <MasterChecklistControl variant="mobile" draft={draft} onChange={onChange} />}
                    </div>
                    <div className="tpe-flex-row tpe-storyboard-nav-right">
                        <button type="button" aria-label="Previous card" disabled={mobileSceneIndex <= 0} onClick={() => handleMobileSceneNavigate(-1)} className="tpe-cycle-arrow" title="Previous card">
                            <ChevronLeftIcon />
                        </button>
                        <button type="button" aria-label="Next card" disabled={mobileSceneIndex >= carouselItemCount - 1} onClick={() => handleMobileSceneNavigate(1)} className="tpe-cycle-arrow" title="Next card">
                            <ChevronRightIcon />
                        </button>
                        <button type="button" aria-label="Close Scenes drawer" onClick={() => handleCloseDrawer("escape")} className="tpe-asset-btn tpe-storyboard-close" title="Close Scenes drawer">×</button>
                    </div>
                </div>

                {/* Timeline Control HUD */}
                <div className="tpe-flex-col tpe-storyboard-timeline-hud tpe-storyboard-hud">
                    <div className="tpe-flex-row tpe-storyboard-hud-row">
                        {onTogglePlaybackMode && (
                            <PlaybackModeControl
                                playbackMode={playbackMode}
                                onTogglePlaybackMode={onTogglePlaybackMode}
                                variant="desktop"
                            />
                        )}
                        {!isMobileViewport && <MasterChecklistControl variant="desktop" draft={draft} onChange={onChange} />}
                    </div>
                </div>

                {/* Scene Storyboard Rack */}
                {sceneUploadWarning && (
                    <div role="status" aria-live="polite" className="tpe-flex-row tpe-storyboard-warn">
                        <span>{sceneUploadWarning}</span>
                        <button type="button" aria-label="Dismiss warning" onClick={() => setSceneUploadWarning(null)} className="tpe-storyboard-warn-close">×</button>
                    </div>
                )}
                <div
                    ref={mobileSceneRackRef}
                    onScroll={handleMobileSceneScroll}
                    role="region"
                    aria-label="Swipeable scene cards"
                    aria-roledescription="carousel"
                    className="tpe-storyboard-rack"
                >
                    {scenes.map((scene, idx) => {
                        const bounds = sceneBoundaries[idx];
                        const isSceneActive = Boolean(bounds && currentTime >= bounds.start && currentTime < bounds.end);
                        const isReHook = idx === 1 && hasReHook;
                        const isSetup = idx === storyIdx;
                        const sceneLabel = idx === 0
                            ? "01. THE HOOK"
                            : (isReHook ? "02. RE-HOOK" : (isSetup ? `${String(idx + 1).padStart(2, '0')}. THE STORY` : `${String(idx + 1).padStart(2, '0')}. ANGLE`));
                        const roleColor = getSceneRoleColor(idx, isReHook, isSetup);
                        const rf = sceneFadesList[idx] ?? resolveSceneFade(scenes, idx);
                        const cardSubs = sceneSubtitlesList[idx] ?? [];
                        const localTime = bounds
                            ? (isSceneActive ? clamp(currentTime - bounds.start, 0, scene.duration) : (currentTime >= bounds.end ? scene.duration : 0))
                            : 0;
                        const isChecklistOpen = openChecklistSceneId === scene.id;
                        return (
                            <SceneStoryboardCard
                                key={scene.id || idx}
                                idx={idx}
                                scene={scene}
                                sceneLabel={sceneLabel}
                                roleColor={roleColor}
                                carouselItemCount={carouselItemCount}
                                canDelete={scenes.length > 1}
                                bounds={bounds}
                                isSceneActive={isSceneActive}
                                isReHook={isReHook}
                                isSetup={isSetup}
                                hasReHook={hasReHook}
                                reHookAnchored={reHookAnchored}
                                hasVideo={hasVideo}
                                videoDuration={draft.videoDuration}
                                hasSubtitles={hasSubtitles}
                                globalShowSubtitles={globalShowSubtitles}
                                keyframes={draft.keyframes}
                                localTime={localTime}
                                currentMediaTime={scene.clipStartOffset !== undefined ? 0 : currentMediaTime}
                                getLiveMediaTime={getLiveMediaTime}
                                liveClock={liveClock}
                                isPlaying={isPlaying}
                                rf={rf}
                                cardSubs={cardSubs}
                                isChecklistOpen={isChecklistOpen}
                                isSubsOpen={openSubSceneId === scene.id}
                                checklistRef={isChecklistOpen ? checklistRef : undefined}
                                checklistDraft={isChecklistOpen ? draft : undefined}
                                onSeekTo={seekTo}
                                onScrubStart={onScrubStart}
                                onScrubMove={onScrubMove}
                                onScrubEnd={onScrubEnd}
                                onUpdateScene={updateScene}
                                onDeleteScene={handleDeleteScene}
                                onSetOffset={setSceneOffset}
                                onToggleChecklist={handleToggleChecklist}
                                onToggleSubs={handleToggleSubs}
                                onAddReHook={handleAddReHook}
                                onJumpToReHook={handleJumpToReHook}
                                onSceneMediaUpload={handleSceneMediaUpload}
                                onUpdateSubtitleText={handleUpdateSubtitleText}
                                onRemoveSubtitle={handleRemoveSubtitle}
                                onSeekSceneSubtitle={handleSeekSceneSubtitle}
                            />
                        );
                    })}
                    {draft.enableOutro && (
                        <div
                            role="group"
                            aria-roledescription="slide"
                            aria-label={`${String(scenes.length + 1).padStart(2, '0')}. OUTRO, scene ${scenes.length + 1} of ${carouselItemCount}`}
                            aria-current={isOutroActive ? "step" : undefined}
                            className="tpe-storyboard-slide"
                        >
                            <TimelineOutroCard
                                sceneCount={scenes.length}
                                outroDuration={draft.outroDuration}
                                outroCta={draft.outroCta}
                                outroStart={outroStart}
                                isOutroActive={isOutroActive}
                                onSeekOutro={seekTo}
                                onRemoveOutro={handleRemoveOutro}
                            />
                        </div>
                    )}
                </div>
                <div className="tpe-storyboard-footer-controls">
                    <TimelineFooterCards
                        enableOutro={Boolean(draft.enableOutro)}
                        onAddAngle={handleAddScene}
                        onAddOutro={handleAddOutro}
                    />
                </div>
            </aside>
        </>
    );
}, (prev, next) => {
    // Skip playback reconciliation completely when the mobile Scenes drawer is hidden off-screen
    const isHiddenMobileDrawer = !prev.isMobileDrawerOpen
        && !next.isMobileDrawerOpen
        && typeof window !== "undefined"
        && window.innerWidth <= 900;
    return prev.draft === next.draft
        && prev.onChange === next.onChange
        && prev.liveClock === next.liveClock
        && prev.isPlaying === next.isPlaying
        && prev.seekTo === next.seekTo
        && prev.onScrubStart === next.onScrubStart
        && prev.onScrubMove === next.onScrubMove
        && prev.onScrubEnd === next.onScrubEnd
        && prev.playbackMode === next.playbackMode
        && prev.onTogglePlaybackMode === next.onTogglePlaybackMode
        && prev.isMobileDrawerOpen === next.isMobileDrawerOpen
        && prev.onCloseMobileDrawer === next.onCloseMobileDrawer
        && (isHiddenMobileDrawer || prev.currentTime === next.currentTime);
});
TimelineStoryboard.displayName = "TimelineStoryboard";
