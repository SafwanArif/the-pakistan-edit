"use client";

import React, { useState } from "react";
import type { VideoDraft } from "../../../types/news";
import type { Platform } from "../../../config/omnichannel";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../components/icons/TPEIcons";
import { useClickOutside } from "../hooks/useClickOutside";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { SubtitleEditorTray } from "./SubtitleEditorTray";
import { KeyDiamondGlyph, SnapCap, KeyframeTimeChip } from "./FramingToolbarPrimitives";

const HEADLINE_PRESETS = [
    { id: 'top' as const, label: 'UPPER THIRD', title: 'Upper Third: Safely positioned below the branding masthead; leaves center footage clear' },
    { id: 'center' as const, label: 'OPTICAL CENTER', title: 'Optical Center: Centered at primary eye level for maximum FYP retention hook' },
    { id: 'bottom' as const, label: 'LOWER THIRD', title: 'Lower Third: Broadcast lower third; positioned safely above native TikTok caption UI' }
];

interface StudioFramingControlsProps {
    draft: VideoDraft;
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
    activeToolTab: 'keyframes' | 'subtitles' | null;
    onToggleToolTab: (tab: 'keyframes' | 'subtitles') => void;
    onCloseToolTab: () => void;
    seekTo: (time: number) => void;
    onUpdateDraft: (draft: VideoDraft) => void;
    onJumpKeyframe: (dir: 'prev' | 'next') => void;
    onJumpSubtitle: (dir: 'prev' | 'next') => void;
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
export function StudioFramingControls({
    draft, activePlatform, isTopBox45, isLetterboxActive, activeFraming, zoomMin, zoomMax,
    existingKeyframeIndex, activePreTime, activePostTime, activeKeyframeEasing, kfEditSide,
    activeToolTab, onToggleToolTab, onCloseToolTab, seekTo,
    onUpdateDraft, onJumpKeyframe, onJumpSubtitle, activeSubtitleCount, onAddOrUpdateKeyframe, onRemoveKeyframe, onUpdateKeyframeTime,
    onSetKfEditSide, onToggleEasing, onClearAllKeyframes, onFramingSliderChange,
}: StudioFramingControlsProps) {
    const [showDeleteMenu, setShowDeleteMenu] = useState(false);
    const deleteMenuRef = useClickOutside(() => setShowDeleteMenu(false));
    const closeIfOpen = React.useCallback(() => {
        if (activeToolTab !== null) onCloseToolTab();
    }, [activeToolTab, onCloseToolTab]);
    const toolbarRef = useClickOutside(closeIfOpen, '[data-keep-tool-tab]');
    const isExpanded = activeToolTab === 'keyframes';
    const isSubtitlesOpen = activeToolTab === 'subtitles';
    const isParked = existingKeyframeIndex >= 0;
    const isSnap = isParked && activeKeyframeEasing === 'snap';
    const isPreMode = isSnap && kfEditSide === 'pre';
    const kfCount = draft.keyframes?.length ?? 0;
    const subCount = draft.subtitles?.length ?? 0;
    const targetAccent = isPreMode ? 'var(--ui-pre)' : 'var(--ui-accent)';

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

            {/* Nested Keyframe Creation Toolbar (when not parked on a keyframe) */}
            {isExpanded && !isParked && (
                <div
                    className="tpe-flex-row"
                    style={{
                        justifyContent: 'center', gap: '6px', alignItems: 'center',
                        padding: '4px 10px', borderRadius: '7px',
                        background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ui-border)',
                    }}
                >
                    <button type="button" onClick={() => onAddOrUpdateKeyframe('snap')} className="tpe-mode-btn" style={{ padding: '2px 6px', fontSize: '8.5px', gap: '5px' }} title="Insert a Snap Keyframe (with PRE & POST states) at playhead">
                        <KeyDiamondGlyph kind="snap" />
                        <span>+ SNAP</span>
                    </button>
                    <button type="button" onClick={() => onAddOrUpdateKeyframe('smooth')} className="tpe-mode-btn" style={{ padding: '2px 6px', fontSize: '8.5px', gap: '5px' }} title="Insert a Smooth Camera Glide keyframe at playhead">
                        <KeyDiamondGlyph kind="glide" />
                        <span>+ GLIDE</span>
                    </button>
                </div>
            )}

            {/* Nested Active Keyframe State & Framing Capsule */}
            {isExpanded && isParked && <div
                className="tpe-flex-row"
                style={{
                    position: 'relative',
                    justifyContent: 'center', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap',
                    padding: '5px 10px', borderRadius: '7px',
                    background: isPreMode ? 'rgba(56, 189, 248, 0.08)' : 'oklch(from var(--ui-accent) l c h / 0.08)',
                    border: isPreMode ? '1px solid rgba(56, 189, 248, 0.45)' : '1px solid oklch(from var(--ui-accent) l c h / 0.45)',
                    transition: 'background-color 0.15s ease, border-color 0.15s ease',
                }}
            >
                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <SnapCap
                        ariaLabel="Keyframe interpolation mode"
                        value={isSnap ? 1 : 0}
                        options={[
                            { label: 'SNAP', val: 1, title: 'Instant angle snap with independent PRE & POST states' },
                            { label: 'GLIDE', val: 0, title: 'Smooth continuous camera glide through keyframe' },
                        ]}
                        onSelect={(v) => { if ((v === 1) !== isSnap) onToggleEasing(); }}
                    />
                    {isSnap ? (
                        <div className="tpe-flex-row" style={{ gap: '4px', alignItems: 'center' }}>
                            <KeyframeTimeChip
                                prefix="◧ PRE"
                                time={activePreTime ?? activePostTime ?? 0}
                                active={isPreMode}
                                accentColor="var(--ui-pre)"
                                title="Select & preview incoming PRE framing"
                                onSelect={() => onSetKfEditSide('pre')}
                                onCommitTime={onUpdateKeyframeTime ? (t) => onUpdateKeyframeTime(t, 'pre') : undefined}
                            />
                            <KeyframeTimeChip
                                prefix="◧ POST"
                                time={activePostTime ?? 0}
                                active={!isPreMode}
                                accentColor="var(--ui-accent)"
                                title="Select & preview outgoing POST framing"
                                onSelect={() => onSetKfEditSide('post')}
                                onCommitTime={onUpdateKeyframeTime ? (t) => onUpdateKeyframeTime(t, 'post') : undefined}
                            />
                        </div>
                    ) : (
                        <KeyframeTimeChip
                            prefix="◆ GLIDE"
                            time={activePostTime ?? 0}
                            active={true}
                            accentColor="var(--ui-accent)"
                            title="Smooth glide keyframe"
                            onCommitTime={onUpdateKeyframeTime ? (t) => onUpdateKeyframeTime(t, 'post') : undefined}
                        />
                    )}
                </div>

                {isTopBox45 ? (
                    <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                        <SnapCap
                            ariaLabel="Top-Box zoom snap"
                            value={activeFraming.zoom}
                            options={[
                                { label: 'CONTAIN', val: 0, title: 'Snap to 0% (Top-Box Contain)' },
                                { label: 'FILL', val: 100, title: 'Snap to 100% (Full-Bleed Fill)' },
                            ]}
                            onSelect={(v) => onFramingSliderChange('zoom', v)}
                        />
                        <ScrubPillSlider label="ZOOM" value={activeFraming.zoom} min={zoomMin} max={zoomMax} accentColor={targetAccent} width="104px" height="20px" onChange={(v) => onFramingSliderChange('zoom', v)} />
                    </div>
                ) : (
                    <ScrubPillSlider label="ZOOM" value={activeFraming.zoom} min={zoomMin} max={zoomMax} accentColor={targetAccent} width="96px" height="20px" onChange={(v) => onFramingSliderChange('zoom', v)} />
                )}

                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <SnapCap
                        ariaLabel="Horizontal pan snap"
                        value={activeFraming.posX}
                        options={[
                            { label: 'LEFT', val: 0, title: 'Snap Pan Left (0%)' },
                            { label: 'CTR', val: 50, title: 'Snap Pan Center (50%)' },
                            { label: 'RIGHT', val: 100, title: 'Snap Pan Right (100%)' },
                        ]}
                        onSelect={(v) => onFramingSliderChange('posX', v)}
                    />
                    <ScrubPillSlider label="PAN" value={activeFraming.posX} min={0} max={100} accentColor={targetAccent} width="108px" height="20px" onChange={(v) => onFramingSliderChange('posX', v)} />
                </div>

                {isLetterboxActive && (
                    <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                        <SnapCap
                            ariaLabel="Vertical position snap"
                            value={activeFraming.posY}
                            options={[
                                { label: 'TOP', val: 100, title: 'Snap to Top edge (100%)' },
                                { label: 'CTR', val: 50, title: 'Snap to Vertical Center (50%)' },
                                { label: 'BTM', val: 0, title: 'Snap to Bottom edge (0%)' },
                            ]}
                            onSelect={(v) => onFramingSliderChange('posY', v)}
                        />
                        <ScrubPillSlider label="POS Y" value={activeFraming.posY} min={0} max={100} accentColor={targetAccent} width="104px" height="20px" title="4:5 vertical ceiling (100% = top edge, lower = pull down with top ambient spill)" onChange={(v) => onFramingSliderChange('posY', v)} />
                    </div>
                )}

                {isParked && (
                    <div ref={deleteMenuRef} style={{ position: 'absolute', left: '-18px', top: '50%', transform: 'translateY(-50%)' }}>
                        <button
                            type="button"
                            aria-label="Delete keyframe options"
                            aria-expanded={showDeleteMenu}
                            aria-haspopup="menu"
                            onClick={() => setShowDeleteMenu((prev) => !prev)}
                            style={{
                                background: 'transparent', border: 'none', padding: '1px 3px',
                                color: 'var(--ui-danger)', fontSize: '10px', fontWeight: 800, lineHeight: 1, cursor: 'pointer', opacity: 0.85,
                            }}
                            title="Delete keyframe options"
                        >
                            ✕
                        </button>
                        {showDeleteMenu && (
                            <div
                                role="menu"
                                aria-label="Delete keyframe actions"
                                className="tpe-asset-tray-expanded tpe-flex-col"
                                style={{ bottom: '24px', top: 'auto', left: 0, right: 'auto', minWidth: '150px', gap: '4px', padding: '6px', zIndex: 30 }}
                            >
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => { setShowDeleteMenu(false); onRemoveKeyframe(); }}
                                    className="tpe-mode-btn"
                                    style={{ width: '100%', justifyContent: 'flex-start', padding: '4px 8px', fontSize: '8.5px', color: 'var(--ui-danger)' }}
                                >
                                    ✕ Delete Keyframe
                                </button>
                                {kfCount > 1 && (
                                    <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => { setShowDeleteMenu(false); onClearAllKeyframes(); }}
                                        className="tpe-mode-btn"
                                        style={{ width: '100%', justifyContent: 'flex-start', padding: '4px 8px', fontSize: '8.5px', color: 'var(--ui-danger)' }}
                                    >
                                        🗑 Delete All ({kfCount})
                                    </button>
                                )}
                                <button
                                    type="button"
                                    role="menuitem"
                                    onClick={() => setShowDeleteMenu(false)}
                                    className="tpe-mode-btn"
                                    style={{ width: '100%', justifyContent: 'flex-start', padding: '4px 8px', fontSize: '8.5px' }}
                                >
                                    Cancel
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>}
        </div>
    );
}
