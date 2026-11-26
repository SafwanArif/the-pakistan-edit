"use client";

import React, { useMemo, useState, useRef, useCallback, useEffect, useLayoutEffect } from "react";
import Image from "next/image";
import { VideoDraft, VideoAspectRatio, DEFAULT_STAR_CUES, interpolateKeyframe, formatTimecode, parseTimeInput, switchVideoAspectRatio, setSceneClipStartOffset, getSceneBoundaries, getSceneRoleColor, getActiveSubtitleTimelineTimes, getTimelineStructure, getSceneRoleLabel, getDefaultVideoFraming } from "@/types/news";
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
export const StudioVideoMonitor: React.FC<StudioVideoMonitorProps> = ({
    draft, companionAudioUrl, updateDraft, isPlaying, togglePlay, playbackMode = 'play-all', currentTime, liveClock, seekNonce = 0, duration, seekTo, isMuted, isLoadingStream = false, ingestStatus = null, onTimeUpdate, isMobileScenesOpen, onToggleMobileScenes, externalIsScrubbing = false, externalScrubTime = null, onRegisterAudioUnlock
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
    const timeInputRef = useRef<HTMLInputElement>(null);
    const telemetryBtnRef = useRef<HTMLButtonElement>(null);

    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio];
    const { containerRef, scale } = useFitScale(dimensions.width, dimensions.height);

    const activeDisplayTime = isScrubbing && scrubTime !== null
        ? scrubTime
        : (externalIsScrubbing && externalScrubTime !== null ? externalScrubTime : currentTime);
    const defaultFraming = useMemo(
        () => getDefaultVideoFraming(draft, draft.aspectRatio),
        [draft]
    );
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
        () => (draft.keyframes?.length ? [...draft.keyframes].sort((a, b) => a.time - b.time) : undefined),
        [draft.keyframes]
    );
    const sceneStarts = useMemo(() => sceneBounds.map(b => b.start), [sceneBounds]);
    const updateSceneOffset = (i: number, nextOffset: number) => {
        updateDraft(setSceneClipStartOffset(draft, i, nextOffset));
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

    const handleTogglePlay = useCallback(() => {
        monitorRef.current.togglePlay();
    }, []);

    const handleKeyframesToggle = useCallback(() => setActiveToolTab(p => (p === 'keyframes' ? null : 'keyframes')), []);

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

    // Update transport timecode & live framing telemetry directly via DOM refs at 120Hz (0 React renders during playback)
    useEffect(() => {
        if (!isPlaying || effectiveIsScrubbing || !liveClock) return;
        let lastTimeStr = "";
        let lastTelemetryStr = "";
        const applyFrame = (t: number, zoom?: number, posX?: number, posY?: number, letterbox?: boolean) => {
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
                const nextText = `Z ${Math.round(zoom)}% · X ${Math.round(posX)}%${letterbox ? ` · Y ${Math.round(posY ?? 100)}%` : ''}`;
                if (nextText !== lastTelemetryStr) {
                    lastTelemetryStr = nextText;
                    if (btn.firstChild) btn.firstChild.nodeValue = nextText;
                    else btn.textContent = nextText;
                }
            }
        };
        applyFrame(liveClock.getTime());
        return liveClock.subscribe((frame) => applyFrame(frame.time, frame.zoom, frame.posX, frame.posY, frame.isLetterbox));
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

    // `currentTime` is already discrete-gated in `useVideoDraftState` during live playback
    const videoCardTime = activeDisplayTime;

    const handleJumpSubtitle = useCallback((direction: 'prev' | 'next') => {
        const { activeSubtitleTimes: times, activeDisplayTime: t, isPlaying: playing, seekTo: seek, liveClock: clock } = monitorRef.current;
        if (!times.length) return;
        const curT = playing && clock ? clock.getTime() : t;
        const target = direction === 'prev'
            ? ([...times].reverse().find(ts => ts < curT - 0.2) ?? times[times.length - 1])
            : (times.find(ts => ts > curT + 0.2) ?? times[0]);
        if (target !== undefined) seek(target);
    }, []);

    const handleJumpStarCue = useCallback((direction: 'prev' | 'next') => {
        const { draft: d, activeDisplayTime: t, isPlaying: playing, seekTo: seek, liveClock: clock } = monitorRef.current;
        const cues = d.starCues ?? DEFAULT_STAR_CUES;
        if (!cues.length) return;
        const curT = playing && clock ? clock.getTime() : t;
        const sorted = [...cues].sort((a, b) => a.time - b.time);
        const target = direction === 'prev'
            ? ([...sorted].reverse().find(c => c.time < curT - 0.2) ?? sorted[sorted.length - 1])
            : (sorted.find(c => c.time > curT + 0.2) ?? sorted[0]);
        if (target) seek(target.time);
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
        const { seekTo: seek, togglePlay: toggle } = monitorRef.current;
        seek(finalTime);
        if (wasPlayingBeforeScrubRef.current) { wasPlayingBeforeScrubRef.current = false; toggle(); }
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

    const handleToggleToolTab = useCallback((tab: 'layout' | 'keyframes' | 'subtitles' | 'motion' | 'volume') => {
        setActiveToolTab(p => (p === tab ? null : tab));
    }, []);

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
        const { seekTo: seek, togglePlay: toggle, hookDur, preStoryDur, activeDisplayTime: t } = monitorRef.current;
        if (!moved) {
            seek(target === "hook" ? 0 : hookDur);
        } else if (t < preStoryDur) {
            seek(t);
        }
        if (wasPlayingBeforeScrubRef.current) {
            wasPlayingBeforeScrubRef.current = false;
            toggle();
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
                    <button
                        type="button"
                        onClick={() => setShowAvDiag((v) => !v)}
                        className="tpe-monitor-status-pill"
                        title={draft.sourceMediaInfo
                            ? `Tap for live A/V sync diag · Source: ${draft.sourceMediaInfo.width}×${draft.sourceMediaInfo.height} @ ${draft.sourceMediaInfo.exactFps}fps${draft.sourceMediaInfo.videoCodec ? ` · ${draft.sourceMediaInfo.videoCodec.toUpperCase()}` : ''}${draft.sourceMediaInfo.audioCodec ? `+${draft.sourceMediaInfo.audioCodec.toUpperCase()}` : ''}${draft.sourceMediaInfo.maxGopSec ? ` · ${draft.sourceMediaInfo.maxGopSec}s GOP` : ''}${draft.sourceMediaInfo.videoBitrate ? ` · ${(draft.sourceMediaInfo.videoBitrate / 1_000_000).toFixed(1)} Mbps` : ''}${draft.sourceMediaInfo.isHdr ? ' · HDR→BT.709' : ''}`
                            : `Tap for live A/V sync diag · Export canvas: ${dimensions.width}×${dimensions.height}`}
                        style={{ borderRadius: '4px', background: 'oklch(from var(--ui-accent) l c h / 0.12)', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)', color: 'var(--ui-accent)', fontSize: '9px', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '0.06em', cursor: 'pointer' }}
                    >
                        {showAvDiag ? (avDiagText || "DIAG...") : `${dimensions.width}×${dimensions.height}`}
                    </button>
                    <div className="tpe-monitor-status-pill" style={{ borderRadius: '4px', background: 'oklch(from var(--ui-text) l c h / 0.05)', border: '1px solid var(--ui-border)', color: 'var(--ui-text-dim)', fontSize: '9px', fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                        {isTopBox45
                            ? (Math.round(activeFraming.zoom) === 0 ? '📺 CONTAIN (0%)' : Math.round(activeFraming.zoom) === 100 ? '📱 FILL (100%)' : `🔍 ZOOM ${Math.round(activeFraming.zoom)}%`)
                            : (draft.aspectRatio === '16:9' ? '🖥 LANDSCAPE' : '📱 FULL BLEED')}
                    </div>
                </div>
            </div>

            {/* Center Program Viewport */}
            <div ref={containerRef} tabIndex={-1} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', overflow: 'hidden', padding: '16px', background: 'radial-gradient(circle at center, #181d24 0%, #0e1115 100%)', outline: 'none' }}>
                {isLoadingStream && (
                    <div
                        role="status"
                        aria-live="polite"
                        className="tpe-tabular-nums"
                        title="Loading video into playback stream"
                        style={{
                            position: 'absolute',
                            top: '4px',
                            left: '50%',
                            transform: 'translateX(-50%)',
                            zIndex: 12,
                            pointerEvents: 'none',
                            fontSize: '9px',
                            fontWeight: 900,
                            color: '#000',
                            background: 'var(--ui-accent)',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            letterSpacing: '0.06em',
                            whiteSpace: 'nowrap',
                            maxWidth: 'calc(100% - 24px)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            boxShadow: '0 4px 14px oklch(from var(--ui-accent) l c h / 0.45)',
                        }}
                    >
                        ⚡ {ingestStatus || 'LOADING STREAM...'}
                    </div>
                )}
                <div style={{ width: `${Math.round(dimensions.width * scale)}px`, height: `${Math.round(dimensions.height * scale)}px`, boxShadow: '0 16px 40px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(255, 255, 255, 0.14)', borderRadius: `${Math.max(8, Math.round(24 * scale))}px`, overflow: 'clip', flexShrink: 0, position: 'relative' }}>
                    <div style={{ width: `${dimensions.width}px`, height: `${dimensions.height}px`, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
                        <VideoCard draft={draft} companionAudioUrl={companionAudioUrl} starPreviewNonce={starPreviewNonce} pausedFramingOverride={!isPlaying && !effectiveIsScrubbing && activeKf && effectiveEditSide === 'pre' ? activeFraming : undefined} isPlaying={isPlaying} isScrubbing={effectiveIsScrubbing} playbackMode={playbackMode} currentTime={videoCardTime} liveClock={liveClock} seekNonce={seekNonce} isMuted={isCurrentlyMuted} isLoadingStream={isLoadingStream} ingestStatus={ingestStatus} onTogglePlay={handleTogglePlay} onRegisterAudioUnlock={onRegisterAudioUnlock} onTimeUpdate={onTimeUpdate} />
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
                <div role="toolbar" aria-label="Playback transport" className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                    <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center' }}>
                        <button type="button" aria-keyshortcuts="Space" aria-label={isPlaying ? "Pause Video" : "Play Video"} onClick={handleTogglePlay} className="tpe-asset-btn" style={{ width: '26px', height: '26px', borderRadius: '50%', background: isPlaying ? 'oklch(from var(--ui-accent) l c h / 0.15)' : 'var(--ui-accent)', color: isPlaying ? 'var(--ui-accent)' : '#000', border: '1px solid var(--ui-accent)', flexShrink: 0 }} title={isPlaying ? "Pause Video (Spacebar)" : "Play Video (Spacebar)"}>
                            {isPlaying ? <PauseIcon width={11} height={11} fill="currentColor" /> : <PlayIcon width={11} height={11} fill="currentColor" />}
                        </button>
                        <div aria-live="off" translate="no" className="tpe-flex-row tpe-tabular-nums" style={{ alignItems: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 800, color: 'var(--ui-text)', gap: '5px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ui-border)', borderRadius: '6px', padding: '2px 7px' }}>
                            <input
                                ref={timeInputRef}
                                type="text"
                                inputMode="decimal"
                                enterKeyHint="done"
                                spellCheck={false}
                                aria-label="Jump to timecode"
                                value={timeDraftText ?? formatTimecode(activeDisplayTime)}
                                onFocus={() => setTimeDraftText(formatTimecode(isPlaying && liveClock ? liveClock.getTime() : activeDisplayTime))}
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
                            <button ref={telemetryBtnRef} type="button" data-keep-tool-tab="true" onClick={handleKeyframesToggle} title="Live camera framing (click to open Keyframes)" style={{ fontFamily: 'monospace', fontSize: '9px', fontWeight: 800, letterSpacing: '0.04em', color: telemetryTint.color, background: 'transparent', border: 'none', padding: '0 2px', cursor: 'pointer', whiteSpace: 'nowrap', transition: isPlaying ? 'none' : 'color 0.15s ease' }}>
                                {`Z ${Math.round(activeFraming.zoom)}% · X ${Math.round(activeFraming.posX)}%${isLetterboxActive ? ` · Y ${Math.round(activeFraming.posY ?? 100)}%` : ''}`}
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
};
