"use client";

import React, { useCallback } from "react";
import { DEFAULT_STAR_CUES, getVideoHeadingPreset, has45LetterboxFraming, type VideoAspectRatio, type VideoDraft, type VideoFraming } from "../../../types/news";
import { ChevronLeftIcon, ChevronRightIcon, VolumeIcon, VolumeMuteIcon } from "../../../components/icons/TPEIcons";
import { useClickOutside } from "../hooks/useClickOutside";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { SnapCap } from "./FramingToolbarPrimitives";
import { SubtitleEditorTray } from "./SubtitleEditorTray";
import { MotionControlDeck } from "./MotionControlDeck";
import { KeyframeEditorCapsule } from "./KeyframeEditorCapsule";

const HEADLINE_PRESETS = [
    { id: 'top' as const, label: 'UPPER THIRD', title: 'Upper Third: Safely positioned below the branding masthead; leaves center footage clear' },
    { id: 'center' as const, label: 'OPTICAL CENTER', title: 'Optical Center: Centered at primary eye level for maximum FYP retention hook' },
    { id: 'bottom' as const, label: 'LOWER THIRD', title: 'Lower Third: Broadcast lower third; positioned safely above native TikTok caption UI' }
];

const CONTAIN_ZOOM_OPTIONS = [
    { label: 'CONTAIN', val: 0, title: 'Contain: preserve the full 4:5 frame' },
    { label: 'FILL', val: 100, title: 'Fill: cover the 4:5 frame edge to edge' },
];
const PAN_SNAP_OPTIONS = [
    { label: 'LEFT', val: 0, title: 'Snap Pan Left' },
    { label: 'CTR', val: 50, title: 'Snap Pan Center' },
    { label: 'RIGHT', val: 100, title: 'Snap Pan Right' },
];
const POS_Y_SNAP_OPTIONS = [
    { label: 'TOP', val: 100, title: 'Snap to Top edge' },
    { label: 'CTR', val: 50, title: 'Snap to Vertical Center' },
    { label: 'BTM', val: 0, title: 'Snap to Bottom edge' },
];

type ActiveToolTab = 'layout' | 'keyframes' | 'subtitles' | 'motion' | 'volume';

interface ToolTabItem {
    tab: ActiveToolTab;
    label: string;
    count?: number;
    navCount?: number;
    isActive: boolean;
    onJump?: (dir: 'prev' | 'next') => void;
    prevLabel?: string;
    nextLabel?: string;
    prevTitle?: string;
    nextTitle?: string;
    title: string;
}

interface StudioFramingControlsProps {
    draft: VideoDraft;
    sourceFps: number;
    sourceFrameIndex?: import("../../../types/news").SourceFrameIndex;
    isPlaying?: boolean;
    liveClock?: LivePlaybackClock;
    isCurrentlyMuted: boolean;
    aspectRatio: VideoAspectRatio;
    defaultFraming: VideoFraming;
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
    activeToolTab: ActiveToolTab | null;
    onToggleToolTab: (tab: ActiveToolTab) => void;
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
    onUpdateKeyframeTime?: (nextTime: number, side?: 'pre' | 'post', quantizeToFrame?: boolean) => void;
    onSetKfEditSide: (side: 'post' | 'pre') => void;
    onToggleEasing: () => void;
    onClearAllKeyframes: () => void;
    onFramingSliderChange: (field: 'zoom' | 'posX' | 'posY', val: number) => void;
    onDefaultFramingChange: (field: 'zoom' | 'posX' | 'posY', val: number) => void;
}

/** Video editing toolbar for layout, captions, motion, audio, and keyframe framing. */
export const StudioFramingControls: React.FC<StudioFramingControlsProps> = React.memo(({
    draft, sourceFps, sourceFrameIndex, isPlaying, liveClock, aspectRatio, defaultFraming, isTopBox45, isLetterboxActive, isCurrentlyMuted, activeFraming, zoomMin, zoomMax,
    existingKeyframeIndex, activePreTime, activePostTime, activeKeyframeEasing, kfEditSide,
    activeDisplayTime, storyStart, activeToolTab, onToggleToolTab, onCloseToolTab, seekTo,
    onUpdateDraft, onJumpKeyframe, onJumpSubtitle, onJumpStarCue, onPreviewStar, activeSubtitleCount, onAddOrUpdateKeyframe, onRemoveKeyframe, onUpdateKeyframeTime,
    onSetKfEditSide, onToggleEasing, onClearAllKeyframes, onFramingSliderChange, onDefaultFramingChange,
}) => {
    const closeIfOpen = useCallback(() => {
        if (activeToolTab !== null) onCloseToolTab();
    }, [activeToolTab, onCloseToolTab]);
    const toolbarRef = useClickOutside(closeIfOpen, '[data-keep-tool-tab]', activeToolTab !== null);

    const isExpanded = activeToolTab === 'keyframes';
    const isLayoutOpen = activeToolTab === 'layout';
    const isSubtitlesOpen = activeToolTab === 'subtitles';
    const isMotionOpen = activeToolTab === 'motion';
    const isVolumeOpen = activeToolTab === 'volume';
    const isParked = existingKeyframeIndex >= 0;
    const isDefaultLetterboxActive = aspectRatio === '4:5' && Math.round(defaultFraming.zoom) < 100;
    const show45BackgroundTreatment = aspectRatio === '4:5' && has45LetterboxFraming(draft);
    const kfCount = draft.keyframes?.length ?? 0;
    const subCount = draft.subtitles?.length ?? 0;
    const headingPreset = getVideoHeadingPreset(draft, aspectRatio);
    const hasUploadedVideo = Boolean(draft.videoUrl.trim());
    const volumePercent = Math.round((isCurrentlyMuted ? 0 : (draft.volume ?? 1)) * 100);

    return (
        <div ref={toolbarRef} className="tpe-flex-col" style={{ alignItems: 'center', gap: '6px', width: 'fit-content', maxWidth: '100%', alignSelf: 'center' }}>
            {/* Editing tool tabs */}
            <div className="tpe-flex-row" style={{ justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                {([
                    {
                        tab: 'layout' as const,
                        label: 'LAYOUT',
                        isActive: isLayoutOpen,
                        title: isLayoutOpen ? 'Collapse Layout drawer' : 'Expand Layout drawer',
                    },
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
                        isActive: isMotionOpen,
                        title: isMotionOpen ? 'Collapse Motion Control Deck (M)' : 'Expand Motion Control Deck (M): on-demand P. dot → star cues & channels',
                    },
                    {
                        tab: 'volume' as const,
                        label: 'VOLUME',
                        isActive: isVolumeOpen,
                        title: isVolumeOpen ? 'Collapse Volume controls' : 'Open Volume controls',
                    },
                ] satisfies ToolTabItem[]).filter((item) => activeToolTab === null || activeToolTab === item.tab).map((item) => (
                    <div key={item.tab} className="tpe-mode-cluster" style={{ padding: '2px', gap: '2px', alignItems: 'center' }}>
                        {(item.navCount ?? 0) > 0 && item.onJump && (
                            <button type="button" aria-label={item.prevLabel} onMouseDown={(e) => e.preventDefault()} onClick={() => item.onJump?.('prev')} className="tpe-cycle-arrow" title={item.prevTitle}>
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
                            style={{ inlineSize: '84px', justifyContent: 'center' }}
                        >
                            {item.label}{(item.count ?? 0) > 0 ? ` (${item.count})` : ''}
                        </button>
                        {(item.navCount ?? 0) > 0 && item.onJump && (
                            <button type="button" aria-label={item.nextLabel} onMouseDown={(e) => e.preventDefault()} onClick={() => item.onJump?.('next')} className="tpe-cycle-arrow" title={item.nextTitle}>
                                <ChevronRightIcon />
                            </button>
                        )}
                    </div>
                ))}
            </div>

            {isVolumeOpen && (
                <div role="group" aria-label="Volume controls" className="tpe-deck-surface tpe-flex-col" style={{ width: '280px', maxWidth: 'calc(100vw - 32px)', padding: '8px 10px', gap: '8px' }}>
                    <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                        <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '7px' }}>
                            <button
                                type="button"
                                aria-pressed={isCurrentlyMuted}
                                aria-label={isCurrentlyMuted ? "Unmute Native Audio" : "Mute Native Audio"}
                                onClick={() => onUpdateDraft({ ...draft, isMuted: !isCurrentlyMuted })}
                                className="tpe-asset-btn"
                                style={{ width: '24px', height: '24px' }}
                                title={isCurrentlyMuted ? "Unmute Native Audio" : "Mute Native Audio"}
                            >
                                {isCurrentlyMuted ? <VolumeMuteIcon width={12} height={12} /> : <VolumeIcon width={12} height={12} />}
                            </button>
                            <label className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px', fontSize: '8px', fontWeight: 900, color: 'var(--ui-text-dim)' }}>
                                VOLUME
                                <input
                                    type="range"
                                    aria-label="Volume"
                                    min={0}
                                    max={1}
                                    step={0.05}
                                    value={isCurrentlyMuted ? 0 : (draft.volume ?? 1)}
                                    onChange={(e) => {
                                        const volume = parseFloat(e.target.value);
                                        onUpdateDraft({ ...draft, volume, isMuted: volume === 0 });
                                    }}
                                    style={{ width: '100px', accentColor: 'var(--ui-accent)' }}
                                    title="Preview volume"
                                />
                            </label>
                            <span aria-hidden="true" className="tpe-tabular-nums" style={{ minWidth: '28px', textAlign: 'end', fontSize: '9px', fontWeight: 800, color: 'var(--ui-text)' }}>
                                {volumePercent}%
                            </span>
                        </div>
                        <button
                            type="button"
                            aria-pressed={draft.normalizeAudio !== false}
                            className="tpe-mode-btn"
                            data-active={draft.normalizeAudio !== false}
                            onClick={() => onUpdateDraft({ ...draft, normalizeAudio: draft.normalizeAudio === false })}
                            style={{ padding: '3px 7px', fontSize: '8px', whiteSpace: 'nowrap' }}
                            title="Broadcast Loudness Mastering (-14 LUFS / -1.5 dBTP) on MP4 export"
                        >
                            -14 LUFS
                        </button>
                    </div>
                    <p style={{ fontSize: '10px', color: 'var(--ui-text-dim)', margin: 0, paddingInline: '4px' }}>
                        Matches TikTok&apos;s loudness standard for consistent audio across all videos.
                    </p>
                </div>
            )}

            {/* Nested Layout Drawer */}
            {isLayoutOpen && (
                <div className="tpe-deck-surface tpe-flex-col" style={{ width: '100%', maxWidth: '640px', padding: '8px 10px', gap: '6px' }}>
                    <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)' }}>
                        HEADING PLACEMENT · {aspectRatio}
                    </span>
                    <div className="tpe-nested-action-row tpe-nested-capsule" role="group" aria-label={`Headings placement for ${aspectRatio}`}>
                        {HEADLINE_PRESETS.map(p => (
                            <button
                                key={p.id}
                                type="button"
                                aria-pressed={headingPreset === p.id}
                                className="tpe-mode-btn tpe-nested-action"
                                data-active={headingPreset === p.id}
                                onClick={() => onUpdateDraft({
                                    ...draft,
                                    headingPresets: { ...draft.headingPresets, [aspectRatio]: p.id },
                                })}
                                title={p.title}
                            >
                                {p.label}
                            </button>
                        ))}
                    </div>
                    {hasUploadedVideo && (
                        <>
                            <div className="tpe-flex-col" style={{ gap: '6px', paddingBlockStart: '6px', borderBlockStart: '1px solid var(--ui-border)' }}>
                                <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)' }}>
                                    DEFAULT FRAMING · {aspectRatio}
                                </span>
                                <div className="tpe-flex-row" style={{ alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                    {aspectRatio === '4:5' && (
                                        <div className="tpe-flex-col" style={{ alignItems: 'center', gap: '4px', width: '112px' }}>
                                            <SnapCap
                                                ariaLabel="4:5 contain or fill"
                                                value={defaultFraming.zoom}
                                                options={CONTAIN_ZOOM_OPTIONS}
                                                onSelect={(value) => onDefaultFramingChange('zoom', value)}
                                            />
                                            <ScrubPillSlider
                                                label="ZOOM"
                                                value={defaultFraming.zoom}
                                                min={zoomMin}
                                                max={zoomMax}
                                                accentColor="var(--ui-accent)"
                                                width="112px"
                                                height="20px"
                                                title="Default zoom for this aspect ratio; keyframes override it where present"
                                                onChange={(value) => onDefaultFramingChange('zoom', value)}
                                            />
                                        </div>
                                    )}
                                    {aspectRatio !== '4:5' && (
                                        <div className="tpe-flex-col" style={{ alignItems: 'center', gap: '4px', width: '112px' }}>
                                            <div aria-hidden="true" style={{ height: '20px' }} />
                                            <ScrubPillSlider
                                                label="ZOOM"
                                                value={defaultFraming.zoom}
                                                min={zoomMin}
                                                max={zoomMax}
                                                accentColor="var(--ui-accent)"
                                                width="112px"
                                                height="20px"
                                                title="Default zoom for this aspect ratio; keyframes override it where present"
                                                onChange={(value) => onDefaultFramingChange('zoom', value)}
                                            />
                                        </div>
                                    )}
                                    <div className="tpe-flex-col" style={{ alignItems: 'center', gap: '4px', width: '112px' }}>
                                        <SnapCap
                                            ariaLabel="Default horizontal pan"
                                            value={defaultFraming.posX}
                                            options={PAN_SNAP_OPTIONS}
                                            onSelect={(value) => onDefaultFramingChange('posX', value)}
                                        />
                                        <ScrubPillSlider
                                            label="PAN X"
                                            value={defaultFraming.posX}
                                            min={0}
                                            max={100}
                                            accentColor="var(--ui-accent)"
                                            width="112px"
                                            height="20px"
                                            title="Default horizontal pan for this aspect ratio"
                                            onChange={(value) => onDefaultFramingChange('posX', value)}
                                        />
                                    </div>
                                    {isDefaultLetterboxActive && (
                                        <div className="tpe-flex-col" style={{ alignItems: 'center', gap: '4px', width: '112px' }}>
                                            <SnapCap
                                                ariaLabel="Default vertical position"
                                                value={defaultFraming.posY}
                                                options={POS_Y_SNAP_OPTIONS}
                                                onSelect={(value) => onDefaultFramingChange('posY', value)}
                                            />
                                            <ScrubPillSlider
                                                label="POS Y"
                                                value={defaultFraming.posY}
                                                min={0}
                                                max={100}
                                                accentColor="var(--ui-accent)"
                                                width="112px"
                                                height="20px"
                                                title="Default 4:5 vertical position; 100% is the top edge"
                                                onChange={(value) => onDefaultFramingChange('posY', value)}
                                            />
                                        </div>
                                    )}
                                </div>
                                <span style={{ fontSize: '8px', color: 'var(--ui-text-dim)' }}>
                                    Sets framing without creating keyframes. Existing keyframes override it where they apply.
                                </span>
                            </div>
                            {show45BackgroundTreatment && (
                                <div className="tpe-flex-col" style={{ gap: '5px', paddingBlockStart: '6px', borderBlockStart: '1px solid var(--ui-border)' }}>
                                    <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)' }}>
                                        4:5 BACKGROUND TREATMENT
                                    </span>
                                    <div className="tpe-flex-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                        <button
                                            type="button"
                                            aria-pressed={draft.enableAmbientBlur !== false}
                                            onClick={() => onUpdateDraft({ ...draft, enableAmbientBlur: draft.enableAmbientBlur === false })}
                                            className="tpe-mode-btn"
                                            data-active={draft.enableAmbientBlur !== false}
                                            title="Toggle the ambient video blur behind the TikTok 4:5 contain frame"
                                            style={{ padding: '3px 7px', fontSize: '8px' }}
                                        >
                                            AMBIENT BLUR
                                        </button>
                                        <span style={{ fontSize: '8px', color: 'var(--ui-text-dim)' }}>
                                            Disabled removes the background blur layers.
                                        </span>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

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
                    isPlaying={Boolean(isPlaying)}
                    liveClock={liveClock}
                    storyStart={storyStart}
                    onUpdateDraft={onUpdateDraft}
                    onSeekTo={seekTo}
                    onPreviewStar={onPreviewStar}
                    onJumpCue={onJumpStarCue}
                />
            )}

            {/* Nested Keyframes Editor Drawer */}
            {isExpanded && (
                <KeyframeEditorCapsule
                    sourceFps={sourceFps}
                    sourceFrameIndex={sourceFrameIndex}
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
        return prev.aspectRatio === next.aspectRatio
            && getVideoHeadingPreset(prev.draft, prev.aspectRatio) === getVideoHeadingPreset(next.draft, next.aspectRatio)
            && prev.draft.enableMotion === next.draft.enableMotion
            && (prev.draft.keyframes?.length ?? 0) === (next.draft.keyframes?.length ?? 0)
            && (prev.draft.subtitles?.length ?? 0) === (next.draft.subtitles?.length ?? 0)
            && (prev.draft.starCues ?? DEFAULT_STAR_CUES).length === (next.draft.starCues ?? DEFAULT_STAR_CUES).length
            && prev.activeSubtitleCount === next.activeSubtitleCount;
    }
    if (next.activeToolTab === 'layout') {
        return prev.draft === next.draft
            && prev.aspectRatio === next.aspectRatio;
    }
    if (next.activeToolTab === 'subtitles') {
        return prev.draft === next.draft
            && prev.activeSubtitleCount === next.activeSubtitleCount;
    }
    if (next.activeToolTab === 'motion') {
        return prev.draft === next.draft
            && prev.storyStart === next.storyStart
            && prev.isPlaying === next.isPlaying
            && prev.liveClock === next.liveClock
            && Math.round(prev.activeDisplayTime * 10) === Math.round(next.activeDisplayTime * 10);
    }
    if (next.activeToolTab === 'volume') {
        return prev.draft === next.draft
            && prev.isCurrentlyMuted === next.isCurrentlyMuted;
    }
    return prev.draft === next.draft
        && prev.isPlaying === next.isPlaying
        && prev.aspectRatio === next.aspectRatio
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
