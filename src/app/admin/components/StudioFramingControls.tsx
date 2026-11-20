"use client";

import React, { useCallback } from "react";
import { DEFAULT_STAR_CUES, type VideoDraft } from "../../../types/news";
import type { Platform } from "../../../config/omnichannel";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../components/icons/TPEIcons";
import { useClickOutside } from "../hooks/useClickOutside";
import { SubtitleEditorTray } from "./SubtitleEditorTray";
import { MotionControlDeck } from "./MotionControlDeck";
import { KeyframeEditorCapsule } from "./KeyframeEditorCapsule";

const HEADLINE_PRESETS = [
    { id: 'top' as const, label: 'UPPER THIRD', title: 'Upper Third: Safely positioned below the branding masthead; leaves center footage clear' },
    { id: 'center' as const, label: 'OPTICAL CENTER', title: 'Optical Center: Centered at primary eye level for maximum FYP retention hook' },
    { id: 'bottom' as const, label: 'LOWER THIRD', title: 'Lower Third: Broadcast lower third; positioned safely above native TikTok caption UI' }
];

interface StudioFramingControlsProps {
    draft: VideoDraft;
    isPlaying?: boolean;
    activePlatform: Platform;
    isTopBox45: boolean;
    isLetterboxActive: boolean;
    activeFraming: { zoom: number; posX: number; posY: number };
    zoomMin: number;
    zoomMax: number;
    existingKeyframeIndex: number;
    activePreTime?: number;
    activePostTime?: number;
    activeKeyframeEasing?: 'smooth' | 'snap';
    kfEditSide: 'post' | 'pre';
    activeDisplayTime: number;
    storyStart: number;
    activeToolTab: 'keyframes' | 'subtitles' | 'motion' | null;
    onToggleToolTab: (tab: 'keyframes' | 'subtitles' | 'motion') => void;
    onCloseToolTab: () => void;
    seekTo: (time: number) => void;
    onUpdateDraft: (draft: VideoDraft) => void;
    onJumpKeyframe: (dir: 'prev' | 'next') => void;
    onJumpSubtitle: (dir: 'prev' | 'next') => void;
    onJumpStarCue: (dir: 'prev' | 'next') => void;
    onPreviewStar: () => void;
    activeSubtitleCount: number;
    onAddOrUpdateKeyframe: (kind: 'smooth' | 'snap') => void;
    onRemoveKeyframe: () => void;
    onUpdateKeyframeTime?: (nextTime: number, side?: 'pre' | 'post') => void;
    onSetKfEditSide: (side: 'post' | 'pre') => void;
    onToggleEasing: () => void;
    onClearAllKeyframes: () => void;
    onFramingSliderChange: (field: 'zoom' | 'posX' | 'posY', val: number) => void;
}

/** Centred Keyframe & Framing Toolbar with ‹ KEYFRAMES › header, SNAP | GLIDE switcher, PRE/POST chips, and Fused Scrub-Bars. */
export const StudioFramingControls: React.FC<StudioFramingControlsProps> = React.memo(({
    draft, activePlatform, isTopBox45, isLetterboxActive, activeFraming, zoomMin, zoomMax,
    existingKeyframeIndex, activePreTime, activePostTime, activeKeyframeEasing, kfEditSide,
    activeDisplayTime, storyStart, activeToolTab, onToggleToolTab, onCloseToolTab, seekTo,
    onUpdateDraft, onJumpKeyframe, onJumpSubtitle, onJumpStarCue, onPreviewStar, activeSubtitleCount, onAddOrUpdateKeyframe, onRemoveKeyframe, onUpdateKeyframeTime,
    onSetKfEditSide, onToggleEasing, onClearAllKeyframes, onFramingSliderChange,
}) => {
    const closeIfOpen = useCallback(() => {
        if (activeToolTab !== null) onCloseToolTab();
    }, [activeToolTab, onCloseToolTab]);
    const toolbarRef = useClickOutside(closeIfOpen, '[data-keep-tool-tab]', activeToolTab !== null);

    const isExpanded = activeToolTab === 'keyframes';
    const isSubtitlesOpen = activeToolTab === 'subtitles';
    const isMotionOpen = activeToolTab === 'motion';
    const isParked = existingKeyframeIndex >= 0;
    const kfCount = draft.keyframes?.length ?? 0;
    const subCount = draft.subtitles?.length ?? 0;
    const starCueCount = (draft.starCues ?? DEFAULT_STAR_CUES).length;

    return (
        <div ref={toolbarRef} className="tpe-flex-col" style={{ alignItems: 'center', gap: '6px', width: 'fit-content', maxWidth: '100%', alignSelf: 'center' }}>
            {/* Top Centred Keyframes Header */}
            <div className="tpe-flex-row" style={{ justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                {activePlatform === 'tiktok' && (
                    <div className="tpe-mode-cluster" role="group" aria-label="Headline position preset">
                        {HEADLINE_PRESETS.map(p => (
                            <button key={p.id} type="button" aria-pressed={(draft.headlinePreset || 'bottom') === p.id} className="tpe-mode-btn" data-active={(draft.headlinePreset || 'bottom') === p.id} onClick={() => onUpdateDraft({ ...draft, headlinePreset: p.id })} title={p.title} style={{ padding: '2px 6px', fontSize: '8px' }}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                )}

                {[
                    {
                        tab: 'keyframes' as const,
                        label: 'KEYFRAMES',
                        count: kfCount,
                        navCount: kfCount,
                        isActive: isExpanded,
                        onJump: onJumpKeyframe,
                        prevLabel: 'Jump to previous keyframe',
                        nextLabel: 'Jump to next keyframe',
                        prevTitle: 'Previous keyframe',
                        nextTitle: 'Next keyframe',
                        title: isExpanded ? 'Collapse Keyframes drawer' : 'Expand Keyframes drawer',
                    },
                    {
                        tab: 'subtitles' as const,
                        label: 'SUBTITLES',
                        count: subCount,
                        navCount: activeSubtitleCount,
                        isActive: isSubtitlesOpen,
                        onJump: onJumpSubtitle,
                        prevLabel: 'Jump to previous subtitle',
                        nextLabel: 'Jump to next subtitle',
                        prevTitle: 'Previous subtitle',
                        nextTitle: 'Next subtitle',
                        title: isSubtitlesOpen ? 'Collapse Subtitles drawer' : 'Expand Subtitles drawer',
                    },
                    {
                        tab: 'motion' as const,
                        label: 'MOTION',
                        count: starCueCount,
                        navCount: starCueCount,
                        isActive: isMotionOpen,
                        onJump: onJumpStarCue,
                        prevLabel: 'Jump to previous star cue',
                        nextLabel: 'Jump to next star cue',
                        prevTitle: 'Previous star cue',
                        nextTitle: 'Next star cue',
                        title: isMotionOpen ? 'Collapse Motion Control Deck (M)' : 'Expand Motion Control Deck (M): on-demand P. dot → star cues & channels',
                    },
                ].filter((item) => activeToolTab === null || activeToolTab === item.tab).map((item) => (
                    <div key={item.tab} className="tpe-mode-cluster" style={{ padding: '2px', gap: '2px', alignItems: 'center' }}>
                        {item.navCount > 0 && (
                            <button type="button" aria-label={item.prevLabel} onMouseDown={(e) => e.preventDefault()} onClick={() => item.onJump('prev')} className="tpe-cycle-arrow" title={item.prevTitle}>
                                <ChevronLeftIcon />
                            </button>
                        )}
                        <button
                            type="button"
                            aria-expanded={item.isActive}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => onToggleToolTab(item.tab)}
                            className="tpe-tab-btn tpe-tabular-nums"
                            data-active={item.isActive}
                            title={item.title}
                        >
                            {item.label}{item.count > 0 ? ` (${item.count})` : ''}
                        </button>
                        {item.navCount > 0 && (
                            <button type="button" aria-label={item.nextLabel} onMouseDown={(e) => e.preventDefault()} onClick={() => item.onJump('next')} className="tpe-cycle-arrow" title={item.nextTitle}>
                                <ChevronRightIcon />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {/* Nested Subtitles Drawer */}
            {isSubtitlesOpen && (
                <div style={{ width: '100%', maxWidth: '640px' }}>
                    <SubtitleEditorTray draft={draft} onChange={onUpdateDraft} seekTo={seekTo} />
                </div>
            )}

            {/* Nested On-Demand Motion Control Deck */}
            {isMotionOpen && (
                <MotionControlDeck
                    draft={draft}
                    activeDisplayTime={activeDisplayTime}
                    storyStart={storyStart}
                    onUpdateDraft={onUpdateDraft}
                    onSeekTo={seekTo}
                    onPreviewStar={onPreviewStar}
                />
            )}

            {/* Nested Keyframes Editor Drawer */}
            {isExpanded && (
                <KeyframeEditorCapsule
                    isParked={isParked}
                    kfCount={kfCount}
                    isTopBox45={isTopBox45}
                    isLetterboxActive={isLetterboxActive}
                    activeFraming={activeFraming}
                    zoomMin={zoomMin}
                    zoomMax={zoomMax}
                    activePreTime={activePreTime}
                    activePostTime={activePostTime}
                    activeKeyframeEasing={activeKeyframeEasing}
                    kfEditSide={kfEditSide}
                    onAddOrUpdateKeyframe={onAddOrUpdateKeyframe}
                    onRemoveKeyframe={onRemoveKeyframe}
                    onUpdateKeyframeTime={onUpdateKeyframeTime}
                    onSetKfEditSide={onSetKfEditSide}
                    onToggleEasing={onToggleEasing}
                    onClearAllKeyframes={onClearAllKeyframes}
                    onFramingSliderChange={onFramingSliderChange}
                />
            )}
        </div>
    );
}, (prev, next) => {
    if (prev.activeToolTab !== next.activeToolTab) return false;
    if (next.activeToolTab === null) {
        return prev.activePlatform === next.activePlatform
            && prev.draft.headlinePreset === next.draft.headlinePreset
            && prev.draft.enableMotion === next.draft.enableMotion
            && (prev.draft.keyframes?.length ?? 0) === (next.draft.keyframes?.length ?? 0)
            && (prev.draft.subtitles?.length ?? 0) === (next.draft.subtitles?.length ?? 0)
            && (prev.draft.starCues ?? DEFAULT_STAR_CUES).length === (next.draft.starCues ?? DEFAULT_STAR_CUES).length
            && prev.activeSubtitleCount === next.activeSubtitleCount;
    }
    if (next.activeToolTab === 'subtitles') {
        return prev.draft === next.draft
            && prev.activePlatform === next.activePlatform
            && prev.activeSubtitleCount === next.activeSubtitleCount;
    }
    if (next.activeToolTab === 'motion') {
        return prev.draft === next.draft
            && prev.storyStart === next.storyStart
            && Math.round(prev.activeDisplayTime * 10) === Math.round(next.activeDisplayTime * 10);
    }
    return prev.draft === next.draft
        && prev.isPlaying === next.isPlaying
        && prev.activePlatform === next.activePlatform
        && prev.isTopBox45 === next.isTopBox45
        && prev.isLetterboxActive === next.isLetterboxActive
        && prev.existingKeyframeIndex === next.existingKeyframeIndex
        && prev.activePreTime === next.activePreTime
        && prev.activePostTime === next.activePostTime
        && prev.activeKeyframeEasing === next.activeKeyframeEasing
        && prev.kfEditSide === next.kfEditSide
        && prev.activeSubtitleCount === next.activeSubtitleCount
        && (Boolean(next.isPlaying) || (
            Math.round(prev.activeFraming.zoom) === Math.round(next.activeFraming.zoom)
            && Math.round(prev.activeFraming.posX) === Math.round(next.activeFraming.posX)
            && Math.round(prev.activeFraming.posY ?? 100) === Math.round(next.activeFraming.posY ?? 100)
        ));
});
StudioFramingControls.displayName = "StudioFramingControls";
