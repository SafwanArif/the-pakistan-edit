"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { nudgeTimeToFrame } from "../../../types/news";
import { useClickOutside } from "../hooks/useClickOutside";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { KeyDiamondGlyph, SnapCap, KeyframeTimeChip } from "./FramingToolbarPrimitives";

const SNAP_MODE_OPTIONS = [
    { label: 'SNAP', val: 1, title: 'Instant angle snap with independent PRE & POST states' },
    { label: 'GLIDE', val: 0, title: 'Smooth continuous camera glide through keyframe' },
];
const CONTAIN_ZOOM_OPTIONS = [
    { label: 'CONTAIN', val: 0, title: 'Snap to 0% (4:5 Contain)' },
    { label: 'FILL', val: 100, title: 'Snap to 100% (Full-Bleed Fill)' },
];
const PAN_SNAP_OPTIONS = [
    { label: 'LEFT', val: 0, title: 'Snap Pan Left (0%)' },
    { label: 'CTR', val: 50, title: 'Snap Pan Center (50%)' },
    { label: 'RIGHT', val: 100, title: 'Snap Pan Right (100%)' },
];
const POS_Y_SNAP_OPTIONS = [
    { label: 'TOP', val: 100, title: 'Snap to Top edge (100%)' },
    { label: 'CTR', val: 50, title: 'Snap to Vertical Center (50%)' },
    { label: 'BTM', val: 0, title: 'Snap to Bottom edge (0%)' },
];

export interface KeyframeEditorCapsuleProps {
    sourceFps: number;
    sourceFrameIndex?: import("../../../types/news").SourceFrameIndex;
    isParked: boolean;
    kfCount: number;
    isTopBox45: boolean;
    isLetterboxActive: boolean;
    activeFraming: { zoom: number; posX: number; posY: number };
    zoomMin: number;
    zoomMax: number;
    activePreTime?: number;
    activePostTime?: number;
    activeKeyframeEasing?: 'smooth' | 'snap';
    kfEditSide: 'post' | 'pre';
    onAddOrUpdateKeyframe: (kind: 'smooth' | 'snap') => void;
    onRemoveKeyframe: () => void;
    onUpdateKeyframeTime?: (nextTime: number, side?: 'pre' | 'post', quantizeToFrame?: boolean) => void;
    onSetKfEditSide: (side: 'post' | 'pre') => void;
    onToggleEasing: () => void;
    onClearAllKeyframes: () => void;
    onFramingSliderChange: (field: 'zoom' | 'posX' | 'posY', val: number) => void;
}

/** Nested keyframe creation bar and active PRE/POST framing editor capsule. */
export const KeyframeEditorCapsule: React.FC<KeyframeEditorCapsuleProps> = React.memo(({
    sourceFps,
    sourceFrameIndex,
    isParked,
    kfCount,
    isTopBox45,
    isLetterboxActive,
    activeFraming,
    zoomMin,
    zoomMax,
    activePreTime,
    activePostTime,
    activeKeyframeEasing,
    kfEditSide,
    onAddOrUpdateKeyframe,
    onRemoveKeyframe,
    onUpdateKeyframeTime,
    onSetKfEditSide,
    onToggleEasing,
    onClearAllKeyframes,
    onFramingSliderChange,
}) => {
    const [showDeleteMenu, setShowDeleteMenu] = useState(false);
    const deleteMenuRef = useClickOutside(() => setShowDeleteMenu(false), undefined, showDeleteMenu);

    const sliderChangeRef = useRef(onFramingSliderChange);
    const toggleEasingRef = useRef(onToggleEasing);
    useLayoutEffect(() => {
        sliderChangeRef.current = onFramingSliderChange;
        toggleEasingRef.current = onToggleEasing;
    });

    const onZoomChange = useCallback((v: number) => sliderChangeRef.current('zoom', v), []);
    const onPanChange = useCallback((v: number) => sliderChangeRef.current('posX', v), []);
    const onPosYChange = useCallback((v: number) => sliderChangeRef.current('posY', v), []);

    const isSnap = isParked && activeKeyframeEasing === 'snap';
    const isPreMode = isSnap && kfEditSide === 'pre';
    const targetAccent = isPreMode ? 'var(--ui-pre)' : 'var(--ui-accent)';
    const onSnapModeSelect = useCallback((v: number) => {
        if ((v === 1) !== isSnap) toggleEasingRef.current();
    }, [isSnap]);

    if (!isParked) {
        return (
            <div
                className="tpe-nested-action-row tpe-nested-capsule"
            >
                <button type="button" onClick={() => onAddOrUpdateKeyframe('snap')} className="tpe-mode-btn tpe-nested-action" title="Insert a Snap Keyframe (with PRE & POST states) at playhead">
                    <KeyDiamondGlyph kind="snap" />
                    <span>SNAP</span>
                </button>
                <button type="button" onClick={() => onAddOrUpdateKeyframe('smooth')} className="tpe-mode-btn tpe-nested-action" title="Insert a Smooth Camera Glide keyframe at playhead">
                    <KeyDiamondGlyph kind="glide" />
                    <span>GLIDE</span>
                </button>
            </div>
        );
    }

    return (
        <div
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
                    options={SNAP_MODE_OPTIONS}
                    onSelect={onSnapModeSelect}
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
                            onNudgeTime={onUpdateKeyframeTime ? (frames) => onUpdateKeyframeTime(nudgeTimeToFrame(activePreTime ?? activePostTime ?? 0, frames, sourceFps, sourceFrameIndex), 'pre', true) : undefined}
                        />
                        <KeyframeTimeChip
                            prefix="◧ POST"
                            time={activePostTime ?? 0}
                            active={!isPreMode}
                            accentColor="var(--ui-accent)"
                            title="Select & preview outgoing POST framing"
                            onSelect={() => onSetKfEditSide('post')}
                            onCommitTime={onUpdateKeyframeTime ? (t) => onUpdateKeyframeTime(t, 'post') : undefined}
                            onNudgeTime={onUpdateKeyframeTime ? (frames) => onUpdateKeyframeTime(nudgeTimeToFrame(activePostTime ?? 0, frames, sourceFps, sourceFrameIndex), 'post', true) : undefined}
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
                        onNudgeTime={onUpdateKeyframeTime ? (frames) => onUpdateKeyframeTime(nudgeTimeToFrame(activePostTime ?? 0, frames, sourceFps, sourceFrameIndex), 'post', true) : undefined}
                    />
                )}
            </div>

            {isTopBox45 ? (
                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <SnapCap
                        ariaLabel="4:5 Contain zoom snap"
                        value={activeFraming.zoom}
                        options={CONTAIN_ZOOM_OPTIONS}
                        onSelect={onZoomChange}
                    />
                    <ScrubPillSlider label="ZOOM" value={activeFraming.zoom} min={zoomMin} max={zoomMax} accentColor={targetAccent} width="104px" height="20px" onChange={onZoomChange} />
                </div>
            ) : (
                <ScrubPillSlider label="ZOOM" value={activeFraming.zoom} min={zoomMin} max={zoomMax} accentColor={targetAccent} width="96px" height="20px" onChange={onZoomChange} />
            )}

            <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                <SnapCap
                    ariaLabel="Horizontal pan snap"
                    value={activeFraming.posX}
                    options={PAN_SNAP_OPTIONS}
                    onSelect={onPanChange}
                />
                <ScrubPillSlider label="PAN" value={activeFraming.posX} min={0} max={100} accentColor={targetAccent} width="108px" height="20px" onChange={onPanChange} />
            </div>

            {isLetterboxActive && (
                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <SnapCap
                        ariaLabel="Vertical position snap"
                        value={activeFraming.posY}
                        options={POS_Y_SNAP_OPTIONS}
                        onSelect={onPosYChange}
                    />
                    <ScrubPillSlider label="POS Y" value={activeFraming.posY} min={0} max={100} accentColor={targetAccent} width="104px" height="20px" title="4:5 vertical ceiling (100% = top edge, lower = pull down with top ambient spill)" onChange={onPosYChange} />
                </div>
            )}

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
        </div>
    );
});
KeyframeEditorCapsule.displayName = "KeyframeEditorCapsule";
