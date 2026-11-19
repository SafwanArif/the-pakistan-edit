"use client";

import React, { useMemo, useState, useRef, useCallback } from "react";
import Image from "next/image";
import { VideoDraft, VideoKeyframe, interpolateKeyframe, formatTimecode, parseTimeInput, getSceneBoundaries, getSceneRoleColor, getActiveSubtitleTimelineTimes, getTimelineStructure, getSceneRoleLabel, clamp } from "../../../types/news";
import { VideoCard } from "../../../components/templates/instagram/VideoCard/index";
import { Platform, VIDEO_PLATFORM_CONFIGS, OMNI_CONFIG, aspectRatioToPlatform } from "../../../config/omnichannel";
import { PlayIcon, PauseIcon, VolumeIcon, VolumeMuteIcon } from "../../../components/icons/TPEIcons";
import { useFitScale } from "../hooks/useFitScale";
import { useStudioShortcuts } from "../hooks/useStudioShortcuts";
import { StudioFramingControls } from "./StudioFramingControls";
import { MainTimelineScrubber } from "./MainTimelineScrubber";
import { getKeyframeTelemetryTint } from "../utils/keyframeTelemetry";

interface StudioVideoMonitorProps {
    draft: VideoDraft;
    updateDraft: (draft: VideoDraft) => void;
    isPlaying: boolean;
    togglePlay: () => void;
    currentTime: number;
    duration: number;
    seekTo: (time: number) => void;
    isMuted: boolean;
    playbackMode?: 'play-all' | 'loop-angle';
    isLoadingStream?: boolean;
    ingestStatus?: string | null;
    onTimeUpdate?: (current: number, duration: number) => void;
}

const labelStyle: React.CSSProperties = { fontSize: '9px', fontWeight: 800, color: 'var(--ui-text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase' };

/** Program Monitor with viewport auto-fit, platform switcher, scrubber, keyframe controls, and focal tuning. */
export const StudioVideoMonitor: React.FC<StudioVideoMonitorProps> = ({
    draft, updateDraft, isPlaying, togglePlay, playbackMode = 'play-all', currentTime, duration, seekTo, isMuted, isLoadingStream = false, ingestStatus = null, onTimeUpdate
}) => {
    const [isScrubbing, setIsScrubbing] = useState(false);
    const [scrubTime, setScrubTime] = useState<number | null>(null);
    const [timeDraftText, setTimeDraftText] = useState<string | null>(null);
    const [activeToolTab, setActiveToolTab] = useState<'keyframes' | 'subtitles' | null>(null);
    const [kfEditSide, setKfEditSide] = useState<'post' | 'pre'>('pre');
    const wasPlayingBeforeScrubRef = useRef(false);

    const activePlatform: Platform = useMemo(() => aspectRatioToPlatform(draft.aspectRatio), [draft.aspectRatio]);

    const dimensions = VIDEO_PLATFORM_CONFIGS[activePlatform] || OMNI_CONFIG[activePlatform];
    const { containerRef, scale } = useFitScale(dimensions.width, dimensions.height);

    const activeDisplayTime = isScrubbing && scrubTime !== null ? scrubTime : currentTime;
    const existingKeyframeIndex = useMemo(
        () => (draft.keyframes ? draft.keyframes.findIndex(k => Math.abs(k.time - activeDisplayTime) < 0.05 || (k.easing === 'snap' && k.pre?.time !== undefined && Math.abs(k.pre.time - activeDisplayTime) < 0.05)) : -1),
        [draft.keyframes, activeDisplayTime]
    );
    const activeKf = existingKeyframeIndex >= 0 ? draft.keyframes?.[existingKeyframeIndex] : undefined;
    const isCutKeyframe = activeKf?.easing === 'snap';
    const effectiveEditSide: 'post' | 'pre' = isCutKeyframe ? kfEditSide : 'post';

    const activeFraming = useMemo(() => {
        const fb = { zoom: draft.zoom, posX: draft.posX, posY: draft.posY };
        if (activeKf && effectiveEditSide === 'pre') {
            if (activeKf.easing === 'snap' && activeKf.pre) {
                return { zoom: activeKf.pre.zoom, posX: activeKf.pre.posX, posY: activeKf.pre.posY ?? (draft.posY ?? 100) };
            }
            return interpolateKeyframe(draft.keyframes, Math.max(0, activeKf.time - 0.001), fb);
        }
        return interpolateKeyframe(draft.keyframes, activeDisplayTime, fb);
    }, [draft.keyframes, activeDisplayTime, draft.zoom, draft.posX, draft.posY, activeKf, effectiveEditSide]);

    const framedDraft = useMemo(
        () => ({ ...draft, zoom: activeFraming.zoom, posX: activeFraming.posX, posY: activeFraming.posY }),
        [draft, activeFraming.zoom, activeFraming.posX, activeFraming.posY]
    );

    const isTopBox45 = activePlatform === 'instagram';
    const isLetterboxActive = isTopBox45 && Math.round(activeFraming.zoom) < 100;
    const zoomMin = isTopBox45 ? 0 : 50;
    const zoomMax = 200;

    const handleAddOrUpdateKeyframe = (kind: 'smooth' | 'snap' = 'snap') => {
        const keyframes: VideoKeyframe[] = draft.keyframes ? [...draft.keyframes] : [];
        const roundedTime = Math.round(activeDisplayTime * 20) / 20;
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

    const handleClearAllKeyframes = () => {
        updateDraft({ ...draft, keyframes: [] });
    };

    const handleRemoveKeyframe = () => {
        if (existingKeyframeIndex < 0 || !draft.keyframes) return;
        updateDraft({ ...draft, keyframes: draft.keyframes.filter((_, i) => i !== existingKeyframeIndex) });
    };

    const handleUpdateKeyframeTime = (nextRawTime: number, side?: 'pre' | 'post') => {
        if (existingKeyframeIndex < 0 || !draft.keyframes) return;
        const maxT = duration > 0 ? duration : Math.max(nextRawTime, 60);
        const clamped = clamp(Math.round(nextRawTime * 20) / 20, 0, maxT);
        const keyframes = [...draft.keyframes];
        const curr = keyframes[existingKeyframeIndex]!;
        if (curr.easing === 'snap' && (side ?? effectiveEditSide) === 'pre') {
            const preClamped = Math.min(curr.time, clamped);
            const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), { zoom: draft.zoom, posX: draft.posX, posY: draft.posY });
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

    const handleJumpKeyframe = (direction: 'prev' | 'next') => {
        if (!draft.keyframes?.length) return;
        const sorted = [...draft.keyframes].sort((a, b) => a.time - b.time);
        const target = direction === 'prev'
            ? [...sorted].reverse().find(k => k.time < activeDisplayTime - 0.2)
            : sorted.find(k => k.time > activeDisplayTime + 0.2);
        if (target) {
            if (isPlaying) togglePlay();
            if (target.easing === 'snap') setKfEditSide('pre');
            seekTo(target.time);
        }
    };

    const handleCloseToolTab = React.useCallback(() => setActiveToolTab(null), []);
    const activeSubtitleTimes = useMemo(() => getActiveSubtitleTimelineTimes(draft), [draft]);

    const handleJumpSubtitle = (direction: 'prev' | 'next') => {
        if (!activeSubtitleTimes.length) return;
        const target = direction === 'prev'
            ? ([...activeSubtitleTimes].reverse().find(t => t < activeDisplayTime - 0.2) ?? activeSubtitleTimes[activeSubtitleTimes.length - 1])
            : (activeSubtitleTimes.find(t => t > activeDisplayTime + 0.2) ?? activeSubtitleTimes[0]);
        if (target !== undefined) seekTo(target);
    };

    const handleFramingSliderChange = (field: 'zoom' | 'posX' | 'posY', val: number) => {
        if (field === 'posY' && !isLetterboxActive) return;
        const nextDraft: VideoDraft = { ...draft, [field]: val };
        if (field === 'zoom' && val >= 100) nextDraft.posY = 100;
        const keyframes: VideoKeyframe[] = draft.keyframes ? [...draft.keyframes] : [];
        if (existingKeyframeIndex >= 0 && keyframes[existingKeyframeIndex]) {
            const nextZoom = field === 'zoom' ? val : activeFraming.zoom;
            const fillAfterChange = !isTopBox45 || Math.round(nextZoom) >= 100;
            const curr = keyframes[existingKeyframeIndex]!;
            if (curr.easing === 'snap' && effectiveEditSide === 'pre') {
                const basePre = curr.pre ?? interpolateKeyframe(draft.keyframes, Math.max(0, curr.time - 0.001), { zoom: draft.zoom, posX: draft.posX, posY: draft.posY });
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
            nextDraft.keyframes = keyframes;
        }
        updateDraft(nextDraft);
    };

    const handleSelectPlatform = (_platform: Platform, ratio: '9:16' | '4:5' | '1:1') => {
        if (draft.aspectRatio === ratio) return;
        const was45 = draft.aspectRatio === '4:5';
        const isNext45 = ratio === '4:5';
        const nextKeyframes = draft.keyframes?.map(kf => {
            if (was45 && !isNext45) return { ...kf, zoom: kf.zoom > 100 ? Math.min(200, kf.zoom) : 100, posY: undefined };
            if (!was45 && isNext45) return { ...kf, zoom: kf.zoom > 100 ? Math.min(200, kf.zoom) : 0 };
            return kf;
        });
        updateDraft({ ...draft, aspectRatio: ratio, zoom: isNext45 ? 0 : 100, posY: 100, keyframes: nextKeyframes });
    };

    const handleScrubberPointerDown = () => {
        setIsScrubbing(true);
        wasPlayingBeforeScrubRef.current = isPlaying;
        if (isPlaying) togglePlay();
    };

    const handleScrubberEnd = (finalTime: number) => {
        setScrubTime(null);
        setIsScrubbing(false);
        seekTo(finalTime);
        if (wasPlayingBeforeScrubRef.current) {
            wasPlayingBeforeScrubRef.current = false;
            togglePlay();
        }
    };

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
                start: b.start,
                percent: duration > 0 ? (b.start / duration) * 100 : 0,
                label: getSceneRoleLabel(draft.scenes, idx),
                shortLabel: String(idx + 1).padStart(2, '0'),
                color: getSceneRoleColor(idx, isReHook, isSetup),
            };
        }),
        [sceneBounds, draft.scenes, duration, timelineStruct.hasReHook, timelineStruct.storyIdx]
    );

    const handleToggleToolTab = useCallback((tab: 'keyframes' | 'subtitles') => {
        setActiveToolTab(p => (p === tab ? null : tab));
    }, []);

    const sortedKeyframes = useMemo(
        () => (draft.keyframes?.length ? [...draft.keyframes].sort((a, b) => a.time - b.time) : undefined),
        [draft.keyframes]
    );
    const sceneStarts = useMemo(() => sceneBounds.map(b => b.start), [sceneBounds]);

    useStudioShortcuts({
        togglePlay,
        seekTo,
        onToggleToolTab: handleToggleToolTab,
        sceneStarts,
        outroStart,
        enableOutro: Boolean(draft.enableOutro),
        activeDisplayTime,
        duration,
    });

    const updateSceneOffset = (i: number, nextOffset: number) => {
        const updated = [...draft.scenes];
        updated[i] = { ...updated[i]!, clipStartOffset: nextOffset };
        updateDraft({ ...draft, scenes: updated });
    };

    const telemetryTint = getKeyframeTelemetryTint(sortedKeyframes, activeDisplayTime, effectiveEditSide, existingKeyframeIndex, true);

    return (
        <section aria-label="Video Monitor" className="tpe-flex-col" style={{ flex: 1, height: '100%', overflow: 'hidden', background: '#040404', position: 'relative' }}>
            {/* Monitor Header */}
            <div className="tpe-flex-row" style={{ padding: '8px 16px', background: 'oklch(from var(--ui-bg) l c h / 0.9)', borderBlockEnd: '1px solid var(--ui-border)', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                <div className="tpe-flex-row" style={{ gap: '6px', alignItems: 'center' }}>
                    <span style={{ ...labelStyle, marginInlineEnd: '4px' }}>MONITOR:</span>
                    <div className="tpe-mode-cluster" role="group" aria-label="Target aspect ratio" style={{ background: 'oklch(from var(--ui-accent) l c h / 0.08)', padding: '2px 4px', borderRadius: '6px' }}>
                        <span style={{ display: 'flex', alignItems: 'center', paddingInline: '6px' }}>
                            <Image src="/assets/social/trimmed/tt-primary-white.png" alt="TikTok" width={52} height={14} style={{ height: '14px', width: 'auto', display: 'block', objectFit: 'contain' }} />
                        </span>
                        <button type="button" aria-pressed={activePlatform === 'tiktok'} onClick={() => handleSelectPlatform('tiktok', '9:16')} className="tpe-mode-btn" data-active={activePlatform === 'tiktok'} style={{ padding: '4px 10px', fontSize: '10px' }} title="TikTok 9:16 Full Bleed (1080 × 1920)">
                            <span>9:16 (FULL BLEED)</span>
                        </button>
                        <button type="button" aria-pressed={activePlatform === 'instagram'} onClick={() => handleSelectPlatform('instagram', '4:5')} className="tpe-mode-btn" data-active={activePlatform === 'instagram'} style={{ padding: '4px 10px', fontSize: '10px' }} title="TikTok 4:5 Letterbox Frame (1080 × 1350)">
                            <span>4:5 (TOP-BOX)</span>
                        </button>
                    </div>
                </div>

                <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center' }}>
                    <div style={{ padding: '3px 8px', borderRadius: '4px', background: 'oklch(from var(--ui-accent) l c h / 0.12)', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)', color: 'var(--ui-accent)', fontSize: '9px', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '0.06em' }}>
                        {dimensions.width} × {dimensions.height}
                    </div>
                    <div style={{ padding: '3px 8px', borderRadius: '4px', background: 'oklch(from var(--ui-text) l c h / 0.05)', border: '1px solid var(--ui-border)', color: 'var(--ui-text-dim)', fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {activePlatform === 'instagram'
                            ? (Math.round(activeFraming.zoom) === 0 ? '📺 CONTAIN (0%)' : Math.round(activeFraming.zoom) === 100 ? '📱 FILL (100%)' : `🔍 ZOOM ${Math.round(activeFraming.zoom)}%`)
                            : (activePlatform === 'tiktok' ? '📱 9:16 FULL BLEED' : '⏹ 1:1 SQUARE')}
                    </div>
                </div>
            </div>

            {/* Center Program Viewport */}
            <div ref={containerRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '16px', background: 'radial-gradient(circle at center, #181d24 0%, #0e1115 100%)' }}>
                <div style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px`, transform: `scale(${scale})`, transformOrigin: 'center center', boxShadow: '0 30px 90px rgba(0, 0, 0, 0.95), 0 0 0 1px rgba(255, 255, 255, 0.14)', border: '1px solid rgba(255, 255, 255, 0.1)', borderRadius: '24px', overflow: 'hidden', flexShrink: 0, transition: 'width 0.25s ease, height 0.25s ease' }}>
                    <VideoCard
                        draft={framedDraft}
                        platform={activePlatform}
                        isPlaying={isPlaying}
                        isScrubbing={isScrubbing}
                        playbackMode={playbackMode}
                        currentTime={activeDisplayTime}
                        isMuted={isCurrentlyMuted}
                        isLoadingStream={isLoadingStream}
                        ingestStatus={ingestStatus}
                        onTogglePlay={togglePlay}
                        onTimeUpdate={onTimeUpdate}
                    />
                </div>
            </div>

            {/* Docked Studio Transport Bar */}
            <div className="tpe-flex-col" style={{ background: 'oklch(from var(--ui-bg) l c h / 0.95)', borderBlockStart: '1px solid var(--ui-border)', padding: '8px 14px', gap: '8px' }}>
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
                        onChangeHookOffset={(v) => updateSceneOffset(0, v)} onPreviewHook={() => seekTo(0)}
                        onChangeRehookOffset={(v) => updateSceneOffset(1, v)} onPreviewRehook={() => seekTo(timelineStruct.hookDur)}
                        onScrubStart={handleScrubberPointerDown} onScrubMove={setScrubTime} onScrubEnd={handleScrubberEnd} onJumpToTime={(t, side) => { if (side) setKfEditSide(side); seekTo(t); }}
                    />
                </div>

                {/* Row 2: Play + Editable Timecode (Left) & Audio/LUFS (Right) */}
                <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center' }}>
                        <button type="button" aria-label={isPlaying ? "Pause Video" : "Play Video"} onClick={togglePlay} className="tpe-asset-btn" style={{ width: '26px', height: '26px', borderRadius: '50%', background: isPlaying ? 'oklch(from var(--ui-accent) l c h / 0.15)' : 'var(--ui-accent)', color: isPlaying ? 'var(--ui-accent)' : '#000', border: '1px solid var(--ui-accent)', flexShrink: 0 }} title={isPlaying ? "Pause Video (Spacebar)" : "Play Video (Spacebar)"}>
                            {isPlaying ? <PauseIcon width={11} height={11} fill="currentColor" /> : <PlayIcon width={11} height={11} fill="currentColor" />}
                        </button>
                        <div className="tpe-flex-row tpe-tabular-nums" style={{ alignItems: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 800, color: 'var(--ui-text)', gap: '5px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ui-border)', borderRadius: '6px', padding: '2px 7px' }}>
                            <input
                                type="text"
                                inputMode="decimal"
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
                            <button type="button" data-keep-tool-tab="true" onClick={() => setActiveToolTab(p => (p === 'keyframes' ? null : 'keyframes'))} title="Live camera framing (click to open Keyframes)" style={{ fontFamily: 'monospace', fontSize: '9px', fontWeight: 800, letterSpacing: '0.04em', color: telemetryTint.color, background: 'transparent', border: 'none', padding: '0 2px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'color 0.15s ease' }}>
                                Z {Math.round(activeFraming.zoom)}% · X {Math.round(activeFraming.posX)}%{isLetterboxActive ? ` · Y ${Math.round(activeFraming.posY ?? 100)}%` : ''}
                            </button>
                        </div>
                    </div>

                    <div className="tpe-flex-row" style={{ gap: '4px', alignItems: 'center' }}>
                        <button type="button" aria-pressed={isCurrentlyMuted} aria-label={isCurrentlyMuted ? "Unmute Native Audio" : "Mute Native Audio"} onClick={() => updateDraft({ ...draft, isMuted: !isCurrentlyMuted })} className="tpe-asset-btn" style={{ width: '24px', height: '24px' }} title={isCurrentlyMuted ? "Unmute Native Audio" : "Mute Native Audio"}>
                            {isCurrentlyMuted ? <VolumeMuteIcon width={12} height={12} /> : <VolumeIcon width={12} height={12} />}
                        </button>
                        <input type="range" aria-label="Volume" min={0} max={1} step={0.05} value={isCurrentlyMuted ? 0 : (draft.volume ?? 1)} onChange={(e) => { const v = parseFloat(e.target.value); updateDraft({ ...draft, volume: v, isMuted: v === 0 }); }} style={{ width: '44px', accentColor: 'var(--ui-accent)' }} title="Volume" />
                        <button type="button" aria-pressed={draft.normalizeAudio !== false} className="tpe-mode-btn" data-active={draft.normalizeAudio !== false} onClick={() => updateDraft({ ...draft, normalizeAudio: draft.normalizeAudio === false })} style={{ padding: '2px 5px', fontSize: '8px', whiteSpace: 'nowrap' }} title="Broadcast Loudness Mastering (-14 LUFS / -1.5 dBTP) on MP4 export">
                            -14 LUFS
                        </button>
                    </div>
                </div>

                {/* Unified Camera, Keyframes & Framing Row */}
                <StudioFramingControls
                    draft={draft} activePlatform={activePlatform} isTopBox45={isTopBox45} isLetterboxActive={isLetterboxActive}
                    activeFraming={activeFraming} zoomMin={zoomMin} zoomMax={zoomMax}
                    existingKeyframeIndex={existingKeyframeIndex} activePreTime={activeKf?.easing === 'snap' ? (activeKf.pre?.time ?? activeKf.time) : undefined} activePostTime={activeKf?.time} activeKeyframeEasing={activeKf?.easing}
                    kfEditSide={effectiveEditSide} activeToolTab={activeToolTab} onToggleToolTab={handleToggleToolTab} onCloseToolTab={handleCloseToolTab} seekTo={seekTo} onUpdateDraft={updateDraft}
                    onJumpKeyframe={handleJumpKeyframe} onJumpSubtitle={handleJumpSubtitle} activeSubtitleCount={activeSubtitleTimes.length} onAddOrUpdateKeyframe={handleAddOrUpdateKeyframe}
                    onRemoveKeyframe={handleRemoveKeyframe} onUpdateKeyframeTime={handleUpdateKeyframeTime}
                    onSetKfEditSide={(s) => { setKfEditSide(s); if (activeKf) seekTo(s === 'pre' && activeKf.easing === 'snap' ? (activeKf.pre?.time ?? activeKf.time) : activeKf.time); }}
                    onToggleEasing={toggleActiveKeyframeEasing} onClearAllKeyframes={handleClearAllKeyframes}
                    onFramingSliderChange={handleFramingSliderChange}
                />
            </div>
        </section>
    );
};
