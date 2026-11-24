"use client";

import React, { useMemo, useState, useRef, useCallback, useLayoutEffect } from "react";
import Image from "next/image";
import { VideoDraft, VideoAspectRatio, VideoKeyframe, DEFAULT_STAR_CUES, interpolateKeyframe, formatTimecode, parseTimeInput, snapTimeToSourceFrame, switchVideoAspectRatio, setSceneClipStartOffset, getSceneBoundaries, getSceneRoleColor, getActiveSubtitleTimelineTimes, getTimelineStructure, getSceneRoleLabel, getActiveSceneAtTime, findSubtitleAtMediaTime, wrapMediaTime, clamp, getDefaultVideoFraming } from "../../../types/news";
import { VideoCard } from "../../../components/templates/VideoCard/index";
import { VIDEO_FORMAT_CONFIGS } from "../../../config/omnichannel";
import { PlayIcon, PauseIcon } from "../../../components/icons/TPEIcons";
import { useFitScale } from "../hooks/useFitScale";
import { useStudioShortcuts } from "../hooks/useStudioShortcuts";
import { StudioFramingControls } from "./StudioFramingControls";
import { MainTimelineScrubber } from "./MainTimelineScrubber";
import { getKeyframeTelemetryTint, resolveKeyframeJumpStop } from "../utils/keyframeTelemetry";

interface StudioVideoMonitorProps {
    draft: VideoDraft;
    updateDraft: (draft: VideoDraft) => void;
    isPlaying: boolean;
    togglePlay: () => void;
    currentTime: number;
    seekNonce?: number;
    duration: number;
    seekTo: (time: number) => void;
    isMuted: boolean;
    playbackMode?: 'play-all' | 'loop-angle';
    isLoadingStream?: boolean;
    ingestStatus?: string | null;
    onTimeUpdate?: (current: number, duration: number) => void;
    isMobileScenesOpen: boolean;
    onToggleMobileScenes: () => void;
}

/** Program Monitor with viewport auto-fit, platform switcher, scrubber, keyframe controls, and focal tuning. */
export const StudioVideoMonitor: React.FC<StudioVideoMonitorProps> = ({
    draft, updateDraft, isPlaying, togglePlay, playbackMode = 'play-all', currentTime, seekNonce = 0, duration, seekTo, isMuted, isLoadingStream = false, ingestStatus = null, onTimeUpdate, isMobileScenesOpen, onToggleMobileScenes
}) => {
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [scrubTime, setScrubTime] = useState<number | null>(null);
    const [timeDraftText, setTimeDraftText] = useState<string | null>(null);
    const [activeToolTab, setActiveToolTab] = useState<'layout' | 'keyframes' | 'subtitles' | 'motion' | 'volume' | null>(null);
    const [kfEditSide, setKfEditSide] = useState<'post' | 'pre'>('pre');
    const [starPreviewNonce, setStarPreviewNonce] = useState(0);
    const wasPlayingBeforeScrubRef = useRef(false);

    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio];
    const { containerRef, scale } = useFitScale(dimensions.width, dimensions.height);

    const activeDisplayTime = isScrubbing && scrubTime !== null ? scrubTime : currentTime;
    const defaultFraming = useMemo(
        () => getDefaultVideoFraming(draft, draft.aspectRatio),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draft.aspectRatio, draft.defaultFramingByRatio, draft.zoom, draft.posX, draft.posY]
    );
    const existingKeyframeIndex = useMemo(
        () => ((!isPlaying || isScrubbing) && draft.keyframes
            ? draft.keyframes.findIndex(k => Math.abs(k.time - activeDisplayTime) < 0.05 || (k.easing === 'snap' && k.pre?.time !== undefined && Math.abs(k.pre.time - activeDisplayTime) < 0.05))
            : -1),
        [isPlaying, isScrubbing, draft.keyframes, activeDisplayTime]
    );
    const activeKf = existingKeyframeIndex >= 0 ? draft.keyframes?.[existingKeyframeIndex] : undefined;
    const isCutKeyframe = activeKf?.easing === 'snap';
    const effectiveEditSide: 'post' | 'pre' = isCutKeyframe ? kfEditSide : 'post';

    const activeFraming = useMemo(() => {
        const fb = defaultFraming;
        if (activeKf && effectiveEditSide === 'pre') {
            if (activeKf.easing === 'snap' && activeKf.pre) {
                return { zoom: activeKf.pre.zoom, posX: activeKf.pre.posX, posY: activeKf.pre.posY ?? defaultFraming.posY };
            }
            return interpolateKeyframe(draft.keyframes, Math.max(0, activeKf.time - 0.001), fb);
        }
        return interpolateKeyframe(draft.keyframes, activeDisplayTime, fb);
    }, [draft.keyframes, activeDisplayTime, defaultFraming, activeKf, effectiveEditSide]);

    const isTopBox45 = draft.aspectRatio === '4:5';
    const isLetterboxActive = isTopBox45 && Math.round(activeFraming.zoom) < 100;
    const zoomMin = isTopBox45 ? 0 : 100;
    const zoomMax = 200;

    const handleAddOrUpdateKeyframe = (kind: 'smooth' | 'snap' = 'snap') => {
        const keyframes: VideoKeyframe[] = draft.keyframes ? [...draft.keyframes] : [];
        const sourceFps = draft.sourceFps ?? 30;
        const roundedTime = snapTimeToSourceFrame(activeDisplayTime, sourceFps, draft.sourceFrameIndex);
        const nextPosY = isLetterboxActive ? activeFraming.posY : undefined;
        if (existingKeyframeIndex >= 0) {
            const curr = keyframes[existingKeyframeIndex]!;
            keyframes[existingKeyframeIndex] = curr.easing === 'snap' && effectiveEditSide === 'pre'
                ? { ...curr, easing: 'snap', pre: { ...curr.pre, zoom: activeFraming.zoom, posX: activeFraming.posX, posY: nextPosY } }
                : { ...curr, zoom: activeFraming.zoom, posX: activeFraming.posX, posY: nextPosY };
        } else {
            const base = { zoom: activeFraming.zoom, posX: activeFraming.posX, posY: nextPosY };
            keyframes.push(kind === 'snap' ? { id: `kf-${Date.now()}`, time: roundedTime, ...base, easing: 'snap', pre: { ...base } } : { id: `kf-${Date.now()}`, time: roundedTime, ...base, easing: 'smooth' });
            keyframes.sort((a, b) => a.time - b.time);
            if (kind === 'snap') setKfEditSide('pre');
        }
        updateDraft({ ...draft, keyframes });
    };

    const handleKeyframesToggle = useCallback(() => setActiveToolTab(p => (p === 'keyframes' ? null : 'keyframes')), []);
    const handleClearAllKeyframes = () => updateDraft({ ...draft, keyframes: [] });
    const handleRemoveKeyframe = () => {
        if (existingKeyframeIndex >= 0 && draft.keyframes) updateDraft({ ...draft, keyframes: draft.keyframes.filter((_, i) => i !== existingKeyframeIndex) });
    };

    const handleUpdateKeyframeTime = (nextRawTime: number, side?: 'pre' | 'post', quantizeToFrame = false) => {
        if (existingKeyframeIndex < 0 || !draft.keyframes) return;
        const maxT = duration > 0 ? duration : Math.max(nextRawTime, 60);
        const sourceFps = draft.sourceFps ?? 30;
        const hasVfrPts = Boolean(draft.sourceFrameIndex && !draft.sourceFrameIndex.cfr && draft.sourceFrameIndex.pts.length > 0);
        const clamped = quantizeToFrame
            ? (hasVfrPts
                ? clamp(nextRawTime, 0, maxT)
                : clamp(snapTimeToSourceFrame(nextRawTime, sourceFps, draft.sourceFrameIndex), 0, maxT))
            : clamp(Math.round(nextRawTime * 10000) / 10000, 0, maxT);
        const keyframes = [...draft.keyframes];
        const curr = keyframes[existingKeyframeIndex]!;
        if (curr.easing === 'snap' && (side ?? effectiveEditSide) === 'pre') {
            const preClamped = Math.min(curr.time, clamped);
            const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), defaultFraming);
            keyframes[existingKeyframeIndex] = { ...curr, easing: 'snap', pre: { ...basePre, time: preClamped } };
            updateDraft({ ...draft, keyframes });
            seekTo(preClamped);
            return;
        }
        const postClamped = curr.easing === 'snap' && curr.pre?.time !== undefined ? Math.max(curr.pre.time, clamped) : clamped;
        keyframes[existingKeyframeIndex] = { ...curr, time: postClamped };
        keyframes.sort((a, b) => a.time - b.time);
        updateDraft({ ...draft, keyframes });
        seekTo(postClamped);
    };

    const toggleActiveKeyframeEasing = () => {
        if (existingKeyframeIndex < 0 || !draft.keyframes) return;
        const keyframes = [...draft.keyframes];
        const curr = keyframes[existingKeyframeIndex]!;
        keyframes[existingKeyframeIndex] = curr.easing === 'snap' ? { ...curr, easing: 'smooth', pre: undefined } : { ...curr, easing: 'snap' };
        updateDraft({ ...draft, keyframes });
    };

    const handleJumpKeyframe = useCallback((direction: 'prev' | 'next') => {
        const { sortedKeyframes: kfs, activeDisplayTime: t, isPlaying: playing, togglePlay: toggle, seekTo: seek } = monitorRef.current;
        const target = resolveKeyframeJumpStop(kfs, t, direction, playing ? 0.2 : 0.06);
        if (!target) return;
        if (playing) toggle();
        setKfEditSide(target.side);
        seek(target.time);
    }, []);

    const handleCloseToolTab = React.useCallback(() => setActiveToolTab(null), []);
    const activeSubtitleTimes = useMemo(
        () => getActiveSubtitleTimelineTimes(draft),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draft.subtitles, draft.scenes, draft.showSubtitles]
    );

    const handleJumpToTime = useCallback((t: number, side?: 'pre' | 'post') => {
        if (side) setKfEditSide(side);
        seekTo(t);
    }, [seekTo]);

    // Gate VideoCard's currentTime during live playback to discrete events (~0.5 renders/sec instead of 120/sec)
    const activeSceneState = useMemo(() => getActiveSceneAtTime(draft, activeDisplayTime), [draft, activeDisplayTime]);
    const activeSubId = useMemo(() => {
        const captionsOn = activeSceneState.scene?.showSubtitles ?? (draft.showSubtitles !== false);
        if (!captionsOn || !draft.subtitles?.length) return "";
        return findSubtitleAtMediaTime(draft.subtitles, wrapMediaTime(draft, activeDisplayTime, draft.videoDuration || 0))?.id ?? "";
    }, [draft, activeSceneState.scene?.showSubtitles, activeDisplayTime]);
    const wordmarkPhase = activeDisplayTime < 1.8 ? 1 : 0;
    const discreteKey = `${isPlaying && !isScrubbing ? 1 : 0}:${activeSceneState.sceneIndex}:${activeSceneState.isOutro ? 1 : 0}:${activeSubId}:${wordmarkPhase}:${seekNonce}`;
    const [gatedCardTime, setGatedCardTime] = useState({ key: discreteKey, time: activeDisplayTime });
    const prevDisplayTimeRef = useRef(activeDisplayTime);

    useLayoutEffect(() => {
        const wrappedBack = activeDisplayTime < prevDisplayTimeRef.current - 0.05;
        prevDisplayTimeRef.current = activeDisplayTime;
        if (!isPlaying || isScrubbing) return;
        if (gatedCardTime.key !== discreteKey || wrappedBack) {
            setGatedCardTime({ key: discreteKey, time: activeDisplayTime });
        }
    }, [activeDisplayTime, discreteKey, gatedCardTime.key, isPlaying, isScrubbing]);
    const videoCardTime = isPlaying && !isScrubbing && gatedCardTime.key === discreteKey ? gatedCardTime.time : activeDisplayTime;

    const handleJumpSubtitle = (direction: 'prev' | 'next') => {
        if (!activeSubtitleTimes.length) return;
        const target = direction === 'prev'
            ? ([...activeSubtitleTimes].reverse().find(t => t < activeDisplayTime - 0.2) ?? activeSubtitleTimes[activeSubtitleTimes.length - 1])
            : (activeSubtitleTimes.find(t => t > activeDisplayTime + 0.2) ?? activeSubtitleTimes[0]);
        if (target !== undefined) seekTo(target);
    };

    const handleJumpStarCue = useCallback((direction: 'prev' | 'next') => {
        const cues = draft.starCues ?? DEFAULT_STAR_CUES;
        if (!cues.length) return;
        const sorted = [...cues].sort((a, b) => a.time - b.time);
        const target = direction === 'prev'
            ? ([...sorted].reverse().find(c => c.time < activeDisplayTime - 0.2) ?? sorted[sorted.length - 1])
            : (sorted.find(c => c.time > activeDisplayTime + 0.2) ?? sorted[0]);
        if (target) seekTo(target.time);
    }, [draft.starCues, activeDisplayTime, seekTo]);

    const handlePreviewStar = useCallback(() => setStarPreviewNonce((n) => n + 1), []);

    const handleFramingSliderChange = (field: 'zoom' | 'posX' | 'posY', val: number) => {
        if (field === 'posY' && !isLetterboxActive) return;
        if (existingKeyframeIndex < 0 || !draft.keyframes?.[existingKeyframeIndex]) return;
        const keyframes: VideoKeyframe[] = draft.keyframes ? [...draft.keyframes] : [];
        if (keyframes[existingKeyframeIndex]) {
            const nextZoom = field === 'zoom' ? val : activeFraming.zoom;
            const fillAfterChange = !isTopBox45 || Math.round(nextZoom) >= 100;
            const curr = keyframes[existingKeyframeIndex]!;
            if (curr.easing === 'snap' && effectiveEditSide === 'pre') {
                const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), defaultFraming);
                const postMatchesPre = curr.zoom === basePre.zoom && curr.posX === basePre.posX && (curr.posY ?? 100) === (basePre.posY ?? 100);
                const nextPre = { ...basePre, [field]: val };
                const finalPre = fillAfterChange ? { time: curr.pre?.time, zoom: nextPre.zoom, posX: nextPre.posX } : nextPre;
                keyframes[existingKeyframeIndex] = postMatchesPre
                    ? { ...curr, easing: 'snap', zoom: finalPre.zoom, posX: finalPre.posX, posY: finalPre.posY, pre: finalPre }
                    : { ...curr, easing: 'snap', pre: finalPre };
            } else {
                const updated: VideoKeyframe = { ...curr, [field]: val };
                keyframes[existingKeyframeIndex] = fillAfterChange ? { ...updated, posY: undefined } : updated;
            }
        }
        updateDraft({ ...draft, keyframes });
    };

    const handleDefaultFramingChange = (field: 'zoom' | 'posX' | 'posY', val: number) => {
        if (field === 'posY' && !(isTopBox45 && Math.round(defaultFraming.zoom) < 100)) return;
        const nextFraming = { ...defaultFraming, [field]: val };
        updateDraft({
            ...draft,
            ...nextFraming,
            defaultFramingByRatio: {
                ...draft.defaultFramingByRatio,
                [draft.aspectRatio]: nextFraming,
            },
        });
    };

    const handleSelectAspectRatio = (ratio: VideoAspectRatio) => {
        if (draft.aspectRatio === ratio) return;
        updateDraft(switchVideoAspectRatio(draft, ratio));
    };

    const handleScrubberPointerDown = useCallback(() => {
        setIsScrubbing(true);
        const { isPlaying: playing, togglePlay: toggle } = monitorRef.current;
        wasPlayingBeforeScrubRef.current = playing;
        if (playing) toggle();
    }, []);
    const handleScrubberEnd = useCallback((finalTime: number) => {
        setScrubTime(null);
        setIsScrubbing(false);
        const { seekTo: seek, togglePlay: toggle } = monitorRef.current;
        seek(finalTime);
        if (wasPlayingBeforeScrubRef.current) { wasPlayingBeforeScrubRef.current = false; toggle(); }
    }, []);
    const isCurrentlyMuted = draft.isMuted ?? isMuted;
    const timelineStruct = useMemo(() => getTimelineStructure(draft.scenes), [draft.scenes]);
    const sceneBounds = useMemo(() => getSceneBoundaries(draft.scenes), [draft.scenes]);
    const outroStart = sceneBounds.length > 0 ? sceneBounds[sceneBounds.length - 1]!.end : 0;

    const sceneMarkers = useMemo(
        () => sceneBounds.map((b, idx) => {
            const isReHook = timelineStruct.hasReHook && idx === 1;
            const isSetup = idx === timelineStruct.storyIdx;
            return {
                id: b.id,
                percent: duration > 0 ? (b.start / duration) * 100 : 0,
                label: getSceneRoleLabel(draft.scenes, idx),
                shortLabel: String(idx + 1).padStart(2, '0'),
                color: getSceneRoleColor(idx, isReHook, isSetup),
            };
        }),
        [sceneBounds, draft.scenes, duration, timelineStruct.hasReHook, timelineStruct.storyIdx]
    );

    const handleToggleToolTab = useCallback((tab: 'layout' | 'keyframes' | 'subtitles' | 'motion' | 'volume') => {
        setActiveToolTab(p => (p === tab ? null : tab));
    }, []);

    const sortedKeyframes = useMemo(
        () => (draft.keyframes?.length ? [...draft.keyframes].sort((a, b) => a.time - b.time) : undefined),
        [draft.keyframes]
    );
    const sceneStarts = useMemo(() => sceneBounds.map(b => b.start), [sceneBounds]);

    useStudioShortcuts({ togglePlay, seekTo, onToggleToolTab: handleToggleToolTab, sceneStarts, outroStart, enableOutro: Boolean(draft.enableOutro), activeDisplayTime, duration });

    const updateSceneOffset = (i: number, nextOffset: number) => {
        updateDraft(setSceneClipStartOffset(draft, i, nextOffset));
    };

    const monitorRef = useRef({
        sortedKeyframes,
        activeDisplayTime,
        isPlaying,
        togglePlay,
        seekTo,
        updateSceneOffset,
        hookDur: timelineStruct.hookDur,
    });
    useLayoutEffect(() => {
        monitorRef.current = {
            sortedKeyframes,
            activeDisplayTime,
            isPlaying,
            togglePlay,
            seekTo,
            updateSceneOffset,
            hookDur: timelineStruct.hookDur,
        };
    });

    const handleChangeHookOffset = useCallback((v: number) => monitorRef.current.updateSceneOffset(0, v), []);
    const handlePreviewHook = useCallback(() => monitorRef.current.seekTo(0), []);
    const handleChangeRehookOffset = useCallback((v: number) => monitorRef.current.updateSceneOffset(1, v), []);
    const handlePreviewRehook = useCallback(() => monitorRef.current.seekTo(monitorRef.current.hookDur), []);
    const handleHookDragEnd = useCallback((target: "hook" | "rehook", moved: boolean) => {
        setIsScrubbing(false);
        const { seekTo: seek, togglePlay: toggle, hookDur, activeDisplayTime: t } = monitorRef.current;
        if (!moved) {
            seek(target === "hook" ? 0 : hookDur);
        } else {
            seek(t);
        }
        if (wasPlayingBeforeScrubRef.current) {
            wasPlayingBeforeScrubRef.current = false;
            toggle();
        }
    }, []);

    const telemetryTint = getKeyframeTelemetryTint(sortedKeyframes, activeDisplayTime, effectiveEditSide, isCutKeyframe, true);

    return (
        <section aria-label="Video Monitor" aria-busy={Boolean(isLoadingStream)} className="tpe-flex-col" style={{ flex: 1, height: '100%', overflow: 'hidden', background: '#040404', position: 'relative' }}>
            {/* Monitor Header */}
            <div className="tpe-flex-row tpe-monitor-header" style={{ background: 'oklch(from var(--ui-bg) l c h / 0.9)', borderBlockEnd: '1px solid var(--ui-border)', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
                <div className="tpe-flex-row" style={{ gap: '6px', alignItems: 'center' }}>
                    <div className="tpe-mode-cluster tpe-monitor-aspect-switcher" role="group" aria-label="Target aspect ratio" style={{ background: 'oklch(from var(--ui-accent) l c h / 0.08)', borderRadius: '6px' }}>
                        <span className="tpe-monitor-platform-logo">
                            <Image src="/assets/social/trimmed/tt-primary-white.png" alt="TikTok" width={52} height={14} className="tpe-monitor-platform-logo-image" style={{ height: '14px', display: 'block', objectFit: 'contain' }} />
                        </span>
                        <button type="button" aria-pressed={draft.aspectRatio === '9:16'} onClick={() => handleSelectAspectRatio('9:16')} className="tpe-mode-btn tpe-monitor-aspect-button" data-active={draft.aspectRatio === '9:16'} title="TikTok 9:16 (1080 × 1920)">
                            <span>9:16</span>
                        </button>
                        <button type="button" aria-pressed={draft.aspectRatio === '4:5'} onClick={() => handleSelectAspectRatio('4:5')} className="tpe-mode-btn tpe-monitor-aspect-button" data-active={draft.aspectRatio === '4:5'} title="TikTok 4:5 (1080 × 1350)">
                            <span>4:5</span>
                        </button>
                        <button type="button" aria-pressed={draft.aspectRatio === '16:9'} onClick={() => handleSelectAspectRatio('16:9')} className="tpe-mode-btn tpe-monitor-aspect-button" data-active={draft.aspectRatio === '16:9'} title="TikTok 16:9 (1920 × 1080)">
                            <span>16:9</span>
                        </button>
                    </div>
                </div>

                <div className="tpe-flex-row tpe-monitor-status-row">
                    <div
                        className="tpe-monitor-status-pill"
                        title={draft.sourceMediaInfo
                            ? `Source: ${draft.sourceMediaInfo.width}×${draft.sourceMediaInfo.height} @ ${draft.sourceMediaInfo.exactFps}fps${draft.sourceMediaInfo.videoCodec ? ` · ${draft.sourceMediaInfo.videoCodec.toUpperCase()}` : ''}${draft.sourceMediaInfo.videoBitrate ? ` · ${(draft.sourceMediaInfo.videoBitrate / 1_000_000).toFixed(1)} Mbps` : ''}${draft.sourceMediaInfo.isHdr ? ' · HDR→BT.709' : ''}`
                            : `Export canvas: ${dimensions.width}×${dimensions.height}`}
                        style={{ borderRadius: '4px', background: 'oklch(from var(--ui-accent) l c h / 0.12)', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)', color: 'var(--ui-accent)', fontSize: '9px', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '0.06em' }}
                    >
                        {dimensions.width}×{dimensions.height}
                    </div>
                    <div className="tpe-monitor-status-pill" style={{ borderRadius: '4px', background: 'oklch(from var(--ui-text) l c h / 0.05)', border: '1px solid var(--ui-border)', color: 'var(--ui-text-dim)', fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {isTopBox45
                            ? (Math.round(activeFraming.zoom) === 0 ? '📺 CONTAIN (0%)' : Math.round(activeFraming.zoom) === 100 ? '📱 FILL (100%)' : `🔍 ZOOM ${Math.round(activeFraming.zoom)}%`)
                            : (draft.aspectRatio === '16:9' ? '🖥 LANDSCAPE' : '📱 FULL BLEED')}
                    </div>
                </div>
            </div>

            {/* Center Program Viewport */}
            <div ref={containerRef} tabIndex={-1} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '16px', background: 'radial-gradient(circle at center, #181d24 0%, #0e1115 100%)', outline: 'none' }}>
                <div style={{ width: `${Math.round(dimensions.width * scale)}px`, height: `${Math.round(dimensions.height * scale)}px`, boxShadow: '0 16px 40px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.14)', borderRadius: `${Math.max(8, Math.round(24 * scale))}px`, overflow: 'clip', flexShrink: 0, position: 'relative' }}>
                    <div style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                        <VideoCard draft={draft} starPreviewNonce={starPreviewNonce} pausedFramingOverride={!isPlaying && !isScrubbing && activeKf && effectiveEditSide === 'pre' ? activeFraming : undefined} isPlaying={isPlaying} isScrubbing={isScrubbing} playbackMode={playbackMode} currentTime={videoCardTime} seekNonce={seekNonce} isMuted={isCurrentlyMuted} isLoadingStream={isLoadingStream} ingestStatus={ingestStatus} onTogglePlay={togglePlay} onTimeUpdate={onTimeUpdate} />
                    </div>
                </div>
                
                {/* Mobile Scenes Button - centered in existing gap */}
                <div className="tpe-mobile-scenes-control" style={{ position: 'absolute', bottom: '0', left: '50%', transform: 'translateX(-50%)' }}>
                    <button
                        type="button"
                        data-mobile-scenes-trigger="true"
                        aria-label={isMobileScenesOpen ? "Close Scenes menu" : "Open Scenes menu"}
                        aria-expanded={isMobileScenesOpen}
                        aria-controls="mobile-scenes-drawer"
                        onClick={onToggleMobileScenes}
                        className="tpe-mode-btn tpe-mobile-scenes-trigger"
                        title={isMobileScenesOpen ? "Close scene drawer" : "Browse scenes"}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" style={{ marginTop: '-0.5px' }}>
                            <path d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        SCENES
                    </button>
                </div>
            </div>

            {/* Docked Studio Transport Bar */}
            <div className="tpe-flex-col tpe-transport-bar" style={{ background: 'oklch(from var(--ui-bg) l c h / 0.95)', borderBlockStart: '1px solid var(--ui-border)', padding: '8px 14px', gap: '8px' }}>
                {/* Row 1: Full-width Master Scrubber */}
                <div data-keep-tool-tab="true">
                    <MainTimelineScrubber
                        duration={duration} currentTime={activeDisplayTime} isPlaying={isPlaying} sceneMarkers={sceneMarkers}
                        keyframes={draft.keyframes} outroDuration={draft.outroDuration} enableOutro={draft.enableOutro}
                        showKeyframesLane={activeToolTab === 'keyframes'}
                        clipDuration={draft.videoDuration} hookDuration={timelineStruct.hookDur} hookOffset={timelineStruct.hookOffset}
                        rehookDuration={timelineStruct.rehookDur} rehookOffset={timelineStruct.rehookOffset}
                        setupOffset={timelineStruct.storyOffset}
                        showHookHandles={Boolean(draft.videoUrl && draft.videoDuration && draft.scenes?.[0])}
                        onChangeHookOffset={handleChangeHookOffset} onPreviewHook={handlePreviewHook}
                        onChangeRehookOffset={handleChangeRehookOffset} onPreviewRehook={handlePreviewRehook}
                        onHookDragStart={handleScrubberPointerDown} onHookDragEnd={handleHookDragEnd}
                        onScrubStart={handleScrubberPointerDown} onScrubMove={setScrubTime} onScrubEnd={handleScrubberEnd} onJumpToTime={handleJumpToTime}
                    />
                </div>

                {/* Row 2: Play + Editable Timecode */}
                <div role="toolbar" aria-label="Playback transport" className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center' }}>
                        <button type="button" aria-keyshortcuts="Space" aria-label={isPlaying ? "Pause Video" : "Play Video"} onClick={togglePlay} className="tpe-asset-btn" style={{ width: '26px', height: '26px', borderRadius: '50%', background: isPlaying ? 'oklch(from var(--ui-accent) l c h / 0.15)' : 'var(--ui-accent)', color: isPlaying ? 'var(--ui-accent)' : '#000', border: '1px solid var(--ui-accent)', flexShrink: 0 }} title={isPlaying ? "Pause Video (Spacebar)" : "Play Video (Spacebar)"}>
                            {isPlaying ? <PauseIcon width={11} height={11} fill="currentColor" /> : <PlayIcon width={11} height={11} fill="currentColor" />}
                        </button>
                        <div aria-live="off" translate="no" className="tpe-flex-row tpe-tabular-nums" style={{ alignItems: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 800, color: 'var(--ui-text)', gap: '5px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ui-border)', borderRadius: '6px', padding: '2px 7px' }}>
                            <input
                                type="text"
                                inputMode="decimal"
                                enterKeyHint="done"
                                spellCheck={false}
                                aria-label="Jump to timecode"
                                value={timeDraftText ?? formatTimecode(activeDisplayTime)}
                                onFocus={() => setTimeDraftText(formatTimecode(activeDisplayTime))}
                                onChange={(e) => setTimeDraftText(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setTimeDraftText(null); e.currentTarget.blur(); } }}
                                onBlur={(e) => {
                                    const parsed = parseTimeInput(e.currentTarget.value);
                                    setTimeDraftText(null);
                                    if (parsed !== null) seekTo(Math.min(duration, parsed));
                                }}
                                title="Type MM:SS.d or seconds + Enter to jump"
                                style={{ width: '48px', fontFamily: 'monospace', fontSize: '11px', fontWeight: 800, color: 'var(--ui-accent)', background: 'transparent', border: 'none', padding: 0, textAlign: 'center' }}
                            />
                            <span style={{ color: 'var(--ui-text-dim)', fontSize: '10px' }}>/</span>
                            <span style={{ color: duration >= 60 ? 'var(--ui-indicator)' : 'var(--ui-accent)', fontSize: '10px', fontWeight: 900 }} title={duration >= 60 ? "60s+ Monetisation & SEO runtime met" : "Under 60s target runtime"}>
                                {formatTimecode(duration)}
                            </span>
                            <span aria-hidden="true" style={{ width: '1px', height: '12px', background: 'var(--ui-border)', marginInline: '2px' }} />
                            <button type="button" data-keep-tool-tab="true" onClick={handleKeyframesToggle} title="Live camera framing (click to open Keyframes)" style={{ fontFamily: 'monospace', fontSize: '9px', fontWeight: 800, letterSpacing: '0.04em', color: telemetryTint.color, background: 'transparent', border: 'none', padding: '0 2px', cursor: 'pointer', whiteSpace: 'nowrap', transition: isPlaying ? 'none' : 'color 0.15s ease' }}>
                                Z {Math.round(activeFraming.zoom)}% · X {Math.round(activeFraming.posX)}%{isLetterboxActive ? ` · Y ${Math.round(activeFraming.posY ?? 100)}%` : ''}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Unified Camera, Keyframes & Framing Row */}
                <StudioFramingControls
                    draft={draft} sourceFps={draft.sourceFps ?? 30} sourceFrameIndex={draft.sourceFrameIndex} aspectRatio={draft.aspectRatio} defaultFraming={defaultFraming} isPlaying={isPlaying && !isScrubbing} isCurrentlyMuted={isCurrentlyMuted} isTopBox45={isTopBox45} isLetterboxActive={isLetterboxActive}
                    activeFraming={activeFraming} zoomMin={zoomMin} zoomMax={zoomMax}
                    existingKeyframeIndex={existingKeyframeIndex} activePreTime={activeKf?.easing === 'snap' ? (activeKf.pre?.time ?? activeKf.time) : undefined} activePostTime={activeKf?.time} activeKeyframeEasing={activeKf?.easing}
                    kfEditSide={effectiveEditSide} activeDisplayTime={activeDisplayTime} storyStart={timelineStruct.preStoryDur} activeToolTab={activeToolTab} onToggleToolTab={handleToggleToolTab} onCloseToolTab={handleCloseToolTab} seekTo={seekTo} onUpdateDraft={updateDraft}
                    onJumpKeyframe={handleJumpKeyframe} onJumpSubtitle={handleJumpSubtitle} onJumpStarCue={handleJumpStarCue} onPreviewStar={handlePreviewStar} activeSubtitleCount={activeSubtitleTimes.length} onAddOrUpdateKeyframe={handleAddOrUpdateKeyframe}
                    onRemoveKeyframe={handleRemoveKeyframe} onUpdateKeyframeTime={handleUpdateKeyframeTime}
                    onSetKfEditSide={(s) => { setKfEditSide(s); if (activeKf) seekTo(s === 'pre' && activeKf.easing === 'snap' ? (activeKf.pre?.time ?? activeKf.time) : activeKf.time); }}
                    onToggleEasing={toggleActiveKeyframeEasing} onClearAllKeyframes={handleClearAllKeyframes}
                    onFramingSliderChange={handleFramingSliderChange} onDefaultFramingChange={handleDefaultFramingChange}
                />
            </div>
        </section>
    );
};
