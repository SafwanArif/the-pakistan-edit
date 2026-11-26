"use client";

import React, { useMemo, useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import Image from "next/image";
import { VideoDraft, VideoAspectRatio, DEFAULT_STAR_CUES, clamp, interpolateKeyframe, formatTimecode, parseTimeInput, switchVideoAspectRatio, setSceneClipStartOffset, getSceneBoundaries, getSceneRoleColor, getActiveSubtitleTimelineTimes, getTimelineStructure, getSceneRoleLabel, getDefaultVideoFraming } from "@/types/news";
import { findParkedKeyframe, toggleKeyframeEasing, updateKeyframeFraming, updateKeyframeTime, upsertKeyframe } from "@/utils/videoKeyframes";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";
import type { AvSyncDiagSnapshot } from "@/components/templates/VideoCard/avSyncHelpers";
import { VideoCard } from "@/components/templates/VideoCard/index";
import { VIDEO_FORMAT_CONFIGS } from "@/config/omnichannel";
import { PlayIcon, PauseIcon } from "@/components/icons/TPEIcons";
import { useFitScale } from "../hooks/useFitScale";
import { useStudioShortcuts } from "../hooks/useStudioShortcuts";
import { StudioFramingControls } from "./StudioFramingControls";
import { MainTimelineScrubber } from "./MainTimelineScrubber";
import { getKeyframeTelemetryTint, resolveKeyframeJumpStop } from "../utils/keyframeTelemetry";

const ASPECT_OPTIONS: readonly { ratio: VideoAspectRatio; title: string }[] = [
    { ratio: '9:16', title: 'TikTok 9:16 (1080 × 1920)' },
    { ratio: '4:5', title: 'TikTok 4:5 (1080 × 1350)' },
    { ratio: '16:9', title: 'TikTok 16:9 (1920 × 1080)' },
];

const findAdjacentTime = (sortedTimes: number[], curT: number, direction: 'prev' | 'next'): number | undefined => {
    if (!sortedTimes.length) return undefined;
    if (direction === 'prev') {
        for (let i = sortedTimes.length - 1; i >= 0; i--) {
            if (sortedTimes[i]! < curT - 0.2) return sortedTimes[i];
        }
        return sortedTimes[sortedTimes.length - 1];
    }
    for (let i = 0; i < sortedTimes.length; i++) {
        if (sortedTimes[i]! > curT + 0.2) return sortedTimes[i];
    }
    return sortedTimes[0];
};

const formatTelemetryLabel = (zoom: number, posX: number, posY: number | undefined, letterbox: boolean): string =>
    `Z ${Math.round(zoom)}% · X ${Math.round(posX)}%${letterbox ? ` · Y ${Math.round(posY ?? 100)}%` : ''}`;

interface StudioVideoMonitorProps {
    draft: VideoDraft;
    companionAudioUrl?: string;
    updateDraft: (draft: VideoDraft) => void;
    isPlaying: boolean;
    togglePlay: () => void;
    currentTime: number;
    liveClock?: LivePlaybackClock;
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
    externalIsScrubbing?: boolean;
    externalScrubTime?: number | null;
    onRegisterAudioUnlock?: (unlock: (() => void) | null) => void;
}

/** Program Monitor with viewport auto-fit, platform switcher, scrubber, keyframe controls, and focal tuning. */
export const StudioVideoMonitor: React.FC<StudioVideoMonitorProps> = React.memo(({
    draft, companionAudioUrl, updateDraft, isPlaying, togglePlay, playbackMode = 'play-all', currentTime, liveClock, seekNonce = 0, duration, seekTo, isMuted, isLoadingStream = false, ingestStatus = null, onTimeUpdate, isMobileScenesOpen, onToggleMobileScenes, externalIsScrubbing = false, externalScrubTime = null, onRegisterAudioUnlock,
}) => {
    const [isScrubbing, setIsScrubbing] = useState(false);
    const effectiveIsScrubbing = isScrubbing || externalIsScrubbing;
    const [scrubTime, setScrubTime] = useState<number | null>(null);
    const [timeDraftText, setTimeDraftText] = useState<string | null>(null);
    const [activeToolTab, setActiveToolTab] = useState<'layout' | 'keyframes' | 'subtitles' | 'motion' | 'volume' | null>(null);
    const [kfEditSide, setKfEditSide] = useState<'post' | 'pre'>('pre');
    const [starPreviewNonce, setStarPreviewNonce] = useState(0);
    const [showAvDiag, setShowAvDiag] = useState(false);
    const [avDiagText, setAvDiagText] = useState<string>("");
    const wasPlayingBeforeScrubRef = useRef(false);
    const cancelTimeEditRef = useRef(false);
    const timeInputRef = useRef<HTMLInputElement>(null);
    const telemetryBtnRef = useRef<HTMLButtonElement>(null);

    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio];
    const { containerRef, scale } = useFitScale(dimensions.width, dimensions.height);

    const activeDisplayTime = isScrubbing && scrubTime !== null
        ? scrubTime
        : (externalIsScrubbing && externalScrubTime !== null ? externalScrubTime : currentTime);
    const defaultFraming = useMemo(() => getDefaultVideoFraming(draft, draft.aspectRatio), [draft]);
    const parkedKf = useMemo(
        () => (!isPlaying || effectiveIsScrubbing ? findParkedKeyframe(draft.keyframes, activeDisplayTime) : { index: -1, inferredSide: null }),
        [isPlaying, effectiveIsScrubbing, draft.keyframes, activeDisplayTime]
    );
    const existingKeyframeIndex = parkedKf.index;
    const activeKf = existingKeyframeIndex >= 0 ? draft.keyframes?.[existingKeyframeIndex] : undefined;
    const isCutKeyframe = activeKf?.easing === 'snap';
    const effectiveEditSide: 'post' | 'pre' = isCutKeyframe ? (parkedKf.inferredSide ?? kfEditSide) : 'post';

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

    const isCurrentlyMuted = draft.isMuted ?? isMuted;
    const timelineStruct = useMemo(() => getTimelineStructure(draft.scenes), [draft.scenes]);
    const sceneBounds = useMemo(() => getSceneBoundaries(draft.scenes), [draft.scenes]);
    const outroStart = sceneBounds.length > 0 ? sceneBounds[sceneBounds.length - 1]!.end : 0;
    const activeSubtitleTimes = useMemo(() => getActiveSubtitleTimelineTimes(draft), [draft]);
    const sortedKeyframes = useMemo(
        () => (draft.keyframes?.length ? draft.keyframes.toSorted((a, b) => a.time - b.time) : undefined),
        [draft.keyframes]
    );
    const sceneStarts = useMemo(() => sceneBounds.map((b) => b.start), [sceneBounds]);
    const updateSceneOffset = (i: number, nextOffset: number) => {
        const next = setSceneClipStartOffset(draft, i, nextOffset);
        if (next !== draft) updateDraft(next);
    };

    const monitorRef = useRef({
        draft,
        updateDraft,
        duration,
        defaultFraming,
        activeFraming,
        isTopBox45,
        isLetterboxActive,
        existingKeyframeIndex,
        activeKf,
        effectiveEditSide,
        activeSubtitleTimes,
        sortedKeyframes,
        activeDisplayTime,
        liveClock,
        isPlaying,
        togglePlay,
        seekTo,
        updateSceneOffset,
        hookDur: timelineStruct.hookDur,
        preStoryDur: timelineStruct.preStoryDur,
    });
    useLayoutEffect(() => {
        monitorRef.current = {
            draft,
            updateDraft,
            duration,
            defaultFraming,
            activeFraming,
            isTopBox45,
            isLetterboxActive,
            existingKeyframeIndex,
            activeKf,
            effectiveEditSide,
            activeSubtitleTimes,
            sortedKeyframes,
            activeDisplayTime,
            liveClock,
            isPlaying,
            togglePlay,
            seekTo,
            updateSceneOffset,
            hookDur: timelineStruct.hookDur,
            preStoryDur: timelineStruct.preStoryDur,
        };
    });

    const handleTogglePlay = useCallback(() => { monitorRef.current.togglePlay(); }, []);
    const handleToggleToolTab = useCallback((tab: 'layout' | 'keyframes' | 'subtitles' | 'motion' | 'volume') => {
        setActiveToolTab((p) => (p === tab ? null : tab));
    }, []);
    const handleKeyframesToggle = useCallback(() => handleToggleToolTab('keyframes'), [handleToggleToolTab]);

    const handleAddOrUpdateKeyframe = useCallback((kind: 'smooth' | 'snap' = 'snap') => {
        const s = monitorRef.current;
        const useLiveClock = s.isPlaying && Boolean(s.liveClock);
        const liveTime = useLiveClock ? s.liveClock!.getTime() : s.activeDisplayTime;
        const liveFraming = useLiveClock
            ? interpolateKeyframe(s.draft.keyframes, liveTime, s.defaultFraming)
            : s.activeFraming;
        const liveParked = useLiveClock ? findParkedKeyframe(s.draft.keyframes, liveTime) : null;
        const { keyframes, nextEditSide } = upsertKeyframe(s.draft, {
            activeDisplayTime: liveTime,
            existingIndex: liveParked ? liveParked.index : s.existingKeyframeIndex,
            effectiveEditSide: liveParked ? (liveParked.inferredSide ?? 'post') : s.effectiveEditSide,
            activeFraming: liveFraming,
            isLetterboxActive: s.isTopBox45 && Math.round(liveFraming.zoom) < 100,
            kind,
        });
        if (nextEditSide) setKfEditSide(nextEditSide);
        s.updateDraft({ ...s.draft, keyframes });
    }, []);

    const handleClearAllKeyframes = useCallback(() => {
        const s = monitorRef.current;
        if (!s.draft.keyframes?.length) return;
        s.updateDraft({ ...s.draft, keyframes: [] });
    }, []);

    const handleRemoveKeyframe = useCallback(() => {
        const s = monitorRef.current;
        if (s.existingKeyframeIndex >= 0 && s.draft.keyframes) {
            s.updateDraft({ ...s.draft, keyframes: s.draft.keyframes.filter((_, i) => i !== s.existingKeyframeIndex) });
        }
    }, []);

    const handleUpdateKeyframeTime = useCallback((nextRawTime: number, side?: 'pre' | 'post', quantizeToFrame = false) => {
        const s = monitorRef.current;
        const result = updateKeyframeTime(s.draft, {
            existingIndex: s.existingKeyframeIndex,
            nextRawTime,
            side: side ?? s.effectiveEditSide,
            quantizeToFrame,
            duration: s.duration,
            defaultFraming: s.defaultFraming,
        });
        if (!result) return;
        s.updateDraft({ ...s.draft, keyframes: result.keyframes });
        s.seekTo(result.seekTime);
    }, []);

    const toggleActiveKeyframeEasing = useCallback(() => {
        const s = monitorRef.current;
        const next = toggleKeyframeEasing(s.draft, s.existingKeyframeIndex);
        if (next) s.updateDraft({ ...s.draft, keyframes: next });
    }, []);

    // Re-apply live 120Hz timecode synchronously after any React commit during playback so controlled input never snaps backwards
    useLayoutEffect(() => {
        if (!isPlaying || effectiveIsScrubbing || !liveClock || timeDraftText !== null) return;
        const input = timeInputRef.current;
        if (input && document.activeElement !== input) {
            input.value = formatTimecode(liveClock.getTime());
        }
    });

    // Update transport timecode & live framing telemetry directly via DOM refs at 120Hz (0 React renders during playback)
    useEffect(() => {
        if (!isPlaying || effectiveIsScrubbing || !liveClock) return;
        let lastTimeStr = "";
        let lastTelemetryStr = "";
        const paintDom = (t: number, zoom?: number, posX?: number, posY?: number, letterbox?: boolean) => {
            const input = timeInputRef.current;
            if (input && document.activeElement !== input) {
                const formatted = formatTimecode(t);
                if (formatted !== lastTimeStr) {
                    lastTimeStr = formatted;
                    input.value = formatted;
                }
            }
            const btn = telemetryBtnRef.current;
            if (btn && zoom !== undefined && posX !== undefined) {
                const nextText = formatTelemetryLabel(zoom, posX, posY, Boolean(letterbox));
                if (nextText !== lastTelemetryStr) {
                    lastTelemetryStr = nextText;
                    if (btn.firstChild) btn.firstChild.nodeValue = nextText;
                    else btn.textContent = nextText;
                }
            }
        };
        paintDom(liveClock.getTime());
        const unsub = liveClock.subscribe((frame) => paintDom(frame.time, frame.zoom, frame.posX, frame.posY, frame.isLetterbox));
        return () => {
            unsub();
            const s = monitorRef.current;
            lastTimeStr = "";
            lastTelemetryStr = "";
            paintDom(s.activeDisplayTime, s.activeFraming.zoom, s.activeFraming.posX, s.activeFraming.posY, s.isLetterboxActive);
        };
    }, [isPlaying, effectiveIsScrubbing, liveClock]);

    const handleJumpKeyframe = useCallback((direction: 'prev' | 'next') => {
        const { sortedKeyframes: kfs, activeDisplayTime: t, isPlaying: playing, togglePlay: toggle, seekTo: seek, liveClock: clock } = monitorRef.current;
        const curT = playing && clock ? clock.getTime() : t;
        const target = resolveKeyframeJumpStop(kfs, curT, direction, playing ? 0.2 : 0.06, true);
        if (!target) return;
        if (playing) toggle();
        setKfEditSide(target.side);
        seek(target.time);
    }, []);

    const handleCloseToolTab = useCallback(() => setActiveToolTab(null), []);

    const handleJumpToTime = useCallback((t: number, side?: 'pre' | 'post') => {
        if (side) setKfEditSide(side);
        seekTo(t);
    }, [seekTo]);

    const videoCardTime = activeDisplayTime;

    const handleJumpSubtitle = useCallback((direction: 'prev' | 'next') => {
        const { activeSubtitleTimes: times, activeDisplayTime: t, isPlaying: playing, seekTo: seek, liveClock: clock } = monitorRef.current;
        const curT = playing && clock ? clock.getTime() : t;
        const target = findAdjacentTime(times, curT, direction);
        if (target !== undefined && Math.abs(target - curT) > 0.01) seek(target);
    }, []);

    const handleJumpStarCue = useCallback((direction: 'prev' | 'next') => {
        const { draft: d, activeDisplayTime: t, isPlaying: playing, seekTo: seek, liveClock: clock } = monitorRef.current;
        const cues = d.starCues ?? DEFAULT_STAR_CUES;
        if (!cues.length) return;
        const curT = playing && clock ? clock.getTime() : t;
        const sortedTimes = cues.map((c) => c.time).toSorted((a, b) => a - b);
        const target = findAdjacentTime(sortedTimes, curT, direction);
        if (target !== undefined && Math.abs(target - curT) > 0.01) seek(target);
    }, []);

    const handlePreviewStar = useCallback(() => setStarPreviewNonce((n) => n + 1), []);

    const handleFramingSliderChange = useCallback((field: 'zoom' | 'posX' | 'posY', val: number) => {
        const s = monitorRef.current;
        const next = updateKeyframeFraming(s.draft, {
            existingIndex: s.existingKeyframeIndex,
            effectiveEditSide: s.effectiveEditSide,
            field,
            val,
            activeFraming: s.activeFraming,
            defaultFraming: s.defaultFraming,
            isTopBox45: s.isTopBox45,
            isLetterboxActive: s.isLetterboxActive,
        });
        if (next) s.updateDraft({ ...s.draft, keyframes: next });
    }, []);

    const handleDefaultFramingChange = useCallback((field: 'zoom' | 'posX' | 'posY', val: number) => {
        const s = monitorRef.current;
        if (field === 'posY' && !(s.isTopBox45 && Math.round(s.defaultFraming.zoom) < 100)) return;
        if (s.defaultFraming[field] === val) return;
        const nextFraming = { ...s.defaultFraming, [field]: val };
        s.updateDraft({
            ...s.draft,
            ...nextFraming,
            defaultFramingByRatio: {
                ...s.draft.defaultFramingByRatio,
                [s.draft.aspectRatio]: nextFraming,
            },
        });
    }, []);

    const handleSetKfEditSide = useCallback((side: 'post' | 'pre') => {
        setKfEditSide(side);
        const { activeKf: kf, seekTo: seek } = monitorRef.current;
        if (kf) seek(side === 'pre' && kf.easing === 'snap' ? (kf.pre?.time ?? kf.time) : kf.time);
    }, []);

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
        const { seekTo: seek, togglePlay: toggle, isPlaying: playing } = monitorRef.current;
        seek(finalTime);
        if (wasPlayingBeforeScrubRef.current) {
            wasPlayingBeforeScrubRef.current = false;
            if (!playing) toggle();
        }
    }, []);
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

    const getLiveShortcutTime = useCallback(
        () => (monitorRef.current.isPlaying && monitorRef.current.liveClock ? monitorRef.current.liveClock.getTime() : monitorRef.current.activeDisplayTime),
        []
    );

    useStudioShortcuts({ togglePlay: handleTogglePlay, seekTo, onToggleToolTab: handleToggleToolTab, sceneStarts, outroStart, enableOutro: Boolean(draft.enableOutro), activeDisplayTime, getLiveTime: getLiveShortcutTime, duration });

    const handleChangeHookOffset = useCallback((v: number) => monitorRef.current.updateSceneOffset(0, v), []);
    const handlePreviewHook = useCallback(() => monitorRef.current.seekTo(0), []);
    const handleChangeRehookOffset = useCallback((v: number) => monitorRef.current.updateSceneOffset(1, v), []);
    const handlePreviewRehook = useCallback(() => monitorRef.current.seekTo(monitorRef.current.hookDur), []);
    const handleHookDragEnd = useCallback((target: "hook" | "rehook", moved: boolean) => {
        setIsScrubbing(false);
        const { seekTo: seek, togglePlay: toggle, isPlaying: playing, hookDur, preStoryDur, activeDisplayTime: t } = monitorRef.current;
        if (!moved) seek(target === "hook" ? 0 : hookDur);
        else if (t < preStoryDur) seek(t);
        if (wasPlayingBeforeScrubRef.current) {
            wasPlayingBeforeScrubRef.current = false;
            if (!playing) toggle();
        }
    }, []);

    useEffect(() => {
        if (!showAvDiag) return;
        const sample = () => {
            const d = (globalThis as { __TPE_AV_DIAG__?: AvSyncDiagSnapshot }).__TPE_AV_DIAG__;
            if (!d) { setAvDiagText("NO DIAG"); return; }
            const tag = d.companionAudioFallback ? "FB" : d.companionAudioActive ? "LOCK" : d.profile === "keyframe-scrub" ? "KF" : "STD";
            const sign = d.lastAudioDriftMs >= 0 ? "+" : "";
            setAvDiagText(`${tag} ${sign}${d.lastAudioDriftMs}ms r${d.readyStateAtPlay}/${d.audioReadyStateAtPlay} s${d.audioSnaps} b${d.videoBufferingPauses}${d.lastError ? ` !${d.lastError.slice(0, 12)}` : ""}`);
        };
        sample();
        const id = setInterval(sample, 250);
        return () => clearInterval(id);
    }, [showAvDiag]);

    const telemetryTint = getKeyframeTelemetryTint(sortedKeyframes, activeDisplayTime, effectiveEditSide, isCutKeyframe, true);

    return (
        <section aria-label="Video Monitor" aria-busy={Boolean(isLoadingStream)} className="tpe-flex-col tpe-monitor-shell">
            {/* Monitor Header */}
            <div className="tpe-flex-row tpe-monitor-header tpe-monitor-head-bar">
                <div className="tpe-flex-row tpe-monitor-head-left">
                    <div className="tpe-mode-cluster tpe-monitor-aspect-switcher tpe-monitor-aspect-bg" role="group" aria-label="Target aspect ratio">
                        <span className="tpe-monitor-platform-logo">
                            <Image src="/assets/social/trimmed/tt-primary-white.png" alt="TikTok" width={52} height={14} className="tpe-monitor-platform-logo-image tpe-monitor-logo-img" />
                        </span>
                        {ASPECT_OPTIONS.map((opt) => (
                            <button
                                key={opt.ratio}
                                type="button"
                                aria-pressed={draft.aspectRatio === opt.ratio}
                                onClick={() => handleSelectAspectRatio(opt.ratio)}
                                className="tpe-mode-btn tpe-monitor-aspect-button"
                                data-active={draft.aspectRatio === opt.ratio}
                                title={opt.title}
                            >
                                <span>{opt.ratio}</span>
                            </button>
                        ))}
                    </div>
                </div>

                <div className="tpe-flex-row tpe-monitor-status-row">
                    <button
                        type="button"
                        aria-pressed={showAvDiag}
                        aria-label={showAvDiag ? "Hide live A/V sync diagnostics" : `Show live A/V sync diagnostics (${dimensions.width}×${dimensions.height})`}
                        onClick={() => setShowAvDiag((v) => !v)}
                        className="tpe-monitor-status-pill tpe-monitor-diag-pill tpe-tabular-nums"
                        title={draft.sourceMediaInfo
                            ? `Tap for live A/V sync diag · Source: ${draft.sourceMediaInfo.width}×${draft.sourceMediaInfo.height} @ ${draft.sourceMediaInfo.exactFps}fps${draft.sourceMediaInfo.videoCodec ? ` · ${draft.sourceMediaInfo.videoCodec.toUpperCase()}` : ''}${draft.sourceMediaInfo.audioCodec ? `+${draft.sourceMediaInfo.audioCodec.toUpperCase()}` : ''}${draft.sourceMediaInfo.maxGopSec ? ` · ${draft.sourceMediaInfo.maxGopSec}s GOP` : ''}${draft.sourceMediaInfo.videoBitrate ? ` · ${(draft.sourceMediaInfo.videoBitrate / 1_000_000).toFixed(1)} Mbps` : ''}${draft.sourceMediaInfo.isHdr ? ' · HDR→BT.709' : ''}`
                            : `Tap for live A/V sync diag · Export canvas: ${dimensions.width}×${dimensions.height}`}
                    >
                        {showAvDiag ? (avDiagText || "DIAG...") : `${dimensions.width}×${dimensions.height}`}
                    </button>
                    <div className="tpe-monitor-status-pill tpe-monitor-mode-pill tpe-tabular-nums">
                        {isTopBox45
                            ? (Math.round(activeFraming.zoom) === 0 ? '📺 CONTAIN (0%)' : Math.round(activeFraming.zoom) === 100 ? '📱 FILL (100%)' : `🔍 ZOOM ${Math.round(activeFraming.zoom)}%`)
                            : (draft.aspectRatio === '16:9' ? '🖥 LANDSCAPE' : '📱 FULL BLEED')}
                    </div>
                </div>
            </div>

            {/* Center Program Viewport */}
            <div ref={containerRef} tabIndex={-1} className="tpe-monitor-viewport">
                {isLoadingStream && (
                    <div role="status" aria-live="polite" className="tpe-tabular-nums tpe-monitor-ingest-pill" title="Loading video into playback stream">
                        ⚡ {ingestStatus || 'LOADING STREAM...'}
                    </div>
                )}
                <div
                    className="tpe-monitor-frame"
                    style={{
                        width: `${Math.round(dimensions.width * scale)}px`,
                        height: `${Math.round(dimensions.height * scale)}px`,
                        borderRadius: `${Math.max(8, Math.round(24 * scale))}px`,
                    }}
                >
                    <div className="tpe-monitor-scaler" style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px`, transform: `scale(${scale})` }}>
                        <VideoCard draft={draft} companionAudioUrl={companionAudioUrl} starPreviewNonce={starPreviewNonce} pausedFramingOverride={!isPlaying && !effectiveIsScrubbing && activeKf && effectiveEditSide === 'pre' ? activeFraming : undefined} isPlaying={isPlaying} isScrubbing={effectiveIsScrubbing} playbackMode={playbackMode} currentTime={videoCardTime} liveClock={liveClock} seekNonce={seekNonce} isMuted={isCurrentlyMuted} isLoadingStream={isLoadingStream} ingestStatus={ingestStatus} onTogglePlay={handleTogglePlay} onRegisterAudioUnlock={onRegisterAudioUnlock} onTimeUpdate={onTimeUpdate} />
                    </div>
                </div>

                {/* Mobile Scenes Button */}
                <div className="tpe-mobile-scenes-control tpe-monitor-mobile-anchor">
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
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="tpe-monitor-mobile-icon">
                            <path d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        SCENES
                    </button>
                </div>
            </div>

            {/* Docked Studio Transport Bar */}
            <div className="tpe-flex-col tpe-transport-bar tpe-transport-dock">
                {/* Row 1: Full-width Master Scrubber */}
                <div data-keep-tool-tab="true">
                    <MainTimelineScrubber
                        duration={duration} currentTime={activeDisplayTime} liveClock={liveClock} isPlaying={isPlaying} sceneMarkers={sceneMarkers}
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
                <div role="toolbar" aria-label="Playback transport" className="tpe-flex-row tpe-transport-row">
                    <div className="tpe-flex-row tpe-transport-left">
                        <button
                            type="button"
                            aria-keyshortcuts="Space"
                            aria-label={isPlaying ? "Pause Video" : "Play Video"}
                            onClick={handleTogglePlay}
                            className="tpe-asset-btn tpe-transport-play"
                            data-playing={isPlaying}
                            title={isPlaying ? "Pause Video (Spacebar)" : "Play Video (Spacebar)"}
                        >
                            {isPlaying ? <PauseIcon width={11} height={11} fill="currentColor" aria-hidden="true" /> : <PlayIcon width={11} height={11} fill="currentColor" aria-hidden="true" />}
                        </button>
                        <div aria-live="off" translate="no" className="tpe-flex-row tpe-tabular-nums tpe-transport-readout">
                            <input
                                ref={timeInputRef}
                                type="text"
                                inputMode="decimal"
                                enterKeyHint="done"
                                spellCheck={false}
                                aria-label="Jump to timecode"
                                value={timeDraftText ?? formatTimecode(activeDisplayTime)}
                                onFocus={(e) => {
                                    cancelTimeEditRef.current = false;
                                    setTimeDraftText(formatTimecode(isPlaying && liveClock ? liveClock.getTime() : activeDisplayTime));
                                    e.currentTarget.select();
                                }}
                                onChange={(e) => setTimeDraftText(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') e.currentTarget.blur();
                                    else if (e.key === 'Escape') {
                                        e.nativeEvent.stopImmediatePropagation();
                                        cancelTimeEditRef.current = true;
                                        setTimeDraftText(null);
                                        e.currentTarget.blur();
                                    }
                                }}
                                onBlur={(e) => {
                                    if (cancelTimeEditRef.current) {
                                        cancelTimeEditRef.current = false;
                                        setTimeDraftText(null);
                                        return;
                                    }
                                    const parsed = parseTimeInput(e.currentTarget.value);
                                    setTimeDraftText(null);
                                    if (parsed !== null) {
                                        const target = clamp(parsed, 0, duration);
                                        const cur = isPlaying && liveClock ? liveClock.getTime() : activeDisplayTime;
                                        if (Math.abs(target - cur) > 0.01) seekTo(target);
                                    }
                                }}
                                title="Type MM:SS.d or seconds + Enter to jump"
                                className="tpe-transport-time-input"
                            />
                            <span className="tpe-transport-slash" aria-hidden="true">/</span>
                            <span className="tpe-transport-dur" data-met={duration >= 60} title={duration >= 60 ? "60s+ Monetisation & SEO runtime met" : "Under 60s target runtime"}>
                                {formatTimecode(duration)}
                            </span>
                            <span aria-hidden="true" className="tpe-transport-divider" />
                            <button
                                ref={telemetryBtnRef}
                                type="button"
                                aria-expanded={activeToolTab === 'keyframes'}
                                data-keep-tool-tab="true"
                                onClick={handleKeyframesToggle}
                                title="Live camera framing (click to open Keyframes)"
                                className="tpe-transport-telemetry"
                                data-playing={isPlaying}
                                style={{ color: telemetryTint.color }}
                            >
                                {formatTelemetryLabel(activeFraming.zoom, activeFraming.posX, activeFraming.posY, isLetterboxActive)}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Unified Camera, Keyframes & Framing Row */}
                <StudioFramingControls
                    draft={draft} sourceFps={draft.sourceFps ?? 30} sourceFrameIndex={draft.sourceFrameIndex} aspectRatio={draft.aspectRatio} defaultFraming={defaultFraming} isPlaying={isPlaying && !effectiveIsScrubbing} liveClock={liveClock} isCurrentlyMuted={isCurrentlyMuted} isTopBox45={isTopBox45} isLetterboxActive={isLetterboxActive}
                    activeFraming={activeFraming} zoomMin={zoomMin} zoomMax={zoomMax}
                    existingKeyframeIndex={existingKeyframeIndex} activePreTime={activeKf?.easing === 'snap' ? (activeKf.pre?.time ?? activeKf.time) : undefined} activePostTime={activeKf?.time} activeKeyframeEasing={activeKf?.easing}
                    kfEditSide={effectiveEditSide} activeDisplayTime={activeDisplayTime} storyStart={timelineStruct.preStoryDur} activeToolTab={activeToolTab} onToggleToolTab={handleToggleToolTab} onCloseToolTab={handleCloseToolTab} seekTo={seekTo} onUpdateDraft={updateDraft}
                    onJumpKeyframe={handleJumpKeyframe} onJumpSubtitle={handleJumpSubtitle} onJumpStarCue={handleJumpStarCue} onPreviewStar={handlePreviewStar} activeSubtitleCount={activeSubtitleTimes.length} onAddOrUpdateKeyframe={handleAddOrUpdateKeyframe}
                    onRemoveKeyframe={handleRemoveKeyframe} onUpdateKeyframeTime={handleUpdateKeyframeTime}
                    onSetKfEditSide={handleSetKfEditSide}
                    onToggleEasing={toggleActiveKeyframeEasing} onClearAllKeyframes={handleClearAllKeyframes}
                    onFramingSliderChange={handleFramingSliderChange} onDefaultFramingChange={handleDefaultFramingChange}
                />
            </div>
        </section>
    );
});
StudioVideoMonitor.displayName = "StudioVideoMonitor";
