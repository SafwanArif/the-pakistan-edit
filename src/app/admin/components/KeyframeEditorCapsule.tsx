"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { nudgeTimeToFrame, type SourceFrameIndex } from "@/types/news";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { CONTAIN_ZOOM_OPTIONS, KeyDiamondGlyph, KeyframeTimeChip, PAN_SNAP_OPTIONS, POS_Y_SNAP_OPTIONS, SnapCap } from "./FramingToolbarPrimitives";

const SNAP_MODE_OPTIONS = [
    { label: 'SNAP', val: 1, title: 'Instant angle snap with independent PRE & POST states' },
    { label: 'GLIDE', val: 0, title: 'Smooth continuous camera glide through keyframe' },
];

interface KeyframeEditorCapsuleProps {
    sourceFps: number;
    sourceFrameIndex?: SourceFrameIndex;
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
    const [prevIsParked, setPrevIsParked] = useState(isParked);
    if (isParked !== prevIsParked) {
        setPrevIsParked(isParked);
        if (!isParked && showDeleteMenu) setShowDeleteMenu(false);
    }

    const triggerRef = useRef<HTMLButtonElement>(null);
    const closeDeleteMenu = useCallback((reason?: CloseReason) => {
        setShowDeleteMenu(false);
        if (reason === "escape") triggerRef.current?.focus();
    }, []);
    const deleteMenuRef = useClickOutside(closeDeleteMenu, undefined, showDeleteMenu && isParked);

    const latestRef = useRef({
        sourceFps,
        sourceFrameIndex,
        activePreTime,
        activePostTime,
        kfEditSide,
        onFramingSliderChange,
        onToggleEasing,
        onSetKfEditSide,
        onUpdateKeyframeTime,
    });
    useLayoutEffect(() => {
        latestRef.current = {
            sourceFps,
            sourceFrameIndex,
            activePreTime,
            activePostTime,
            kfEditSide,
            onFramingSliderChange,
            onToggleEasing,
            onSetKfEditSide,
            onUpdateKeyframeTime,
        };
    });

    const onZoomChange = useCallback((v: number) => latestRef.current.onFramingSliderChange('zoom', v), []);
    const onPanChange = useCallback((v: number) => latestRef.current.onFramingSliderChange('posX', v), []);
    const onPosYChange = useCallback((v: number) => latestRef.current.onFramingSliderChange('posY', v), []);

    const selectPre = useCallback(() => {
        if (latestRef.current.kfEditSide !== 'pre') latestRef.current.onSetKfEditSide('pre');
    }, []);
    const selectPost = useCallback(() => {
        if (latestRef.current.kfEditSide !== 'post') latestRef.current.onSetKfEditSide('post');
    }, []);
    const commitPre = useCallback((t: number) => latestRef.current.onUpdateKeyframeTime?.(t, 'pre'), []);
    const commitPost = useCallback((t: number) => latestRef.current.onUpdateKeyframeTime?.(t, 'post'), []);
    const nudgeSide = useCallback((side: 'pre' | 'post', frames: number) => {
        const s = latestRef.current;
        const base = side === 'pre' ? (s.activePreTime ?? s.activePostTime ?? 0) : (s.activePostTime ?? 0);
        s.onUpdateKeyframeTime?.(nudgeTimeToFrame(base, frames, s.sourceFps, s.sourceFrameIndex), side, true);
    }, []);
    const nudgePre = useCallback((frames: number) => nudgeSide('pre', frames), [nudgeSide]);
    const nudgePost = useCallback((frames: number) => nudgeSide('post', frames), [nudgeSide]);

    const isSnap = isParked && activeKeyframeEasing === 'snap';
    const isPreMode = isSnap && kfEditSide === 'pre';
    const targetAccent = isPreMode ? 'var(--ui-pre)' : 'var(--ui-accent)';
    const onSnapModeSelect = useCallback((v: number) => {
        if ((v === 1) !== isSnap) latestRef.current.onToggleEasing();
    }, [isSnap]);

    if (!isParked) {
        return (
            <div className="tpe-nested-action-row tpe-nested-capsule">
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

    const canUpdateTime = Boolean(onUpdateKeyframeTime);

    return (
        <div className="tpe-flex-row tpe-kf-capsule" data-mode={isPreMode ? 'pre' : 'post'}>
            <div className="tpe-flex-col tpe-kf-col">
                <SnapCap
                    ariaLabel="Keyframe interpolation mode"
                    value={isSnap ? 1 : 0}
                    options={SNAP_MODE_OPTIONS}
                    onSelect={onSnapModeSelect}
                />
                {isSnap ? (
                    <div className="tpe-flex-row tpe-kf-chip-row">
                        <KeyframeTimeChip
                            prefix="◧ PRE"
                            time={activePreTime ?? activePostTime ?? 0}
                            active={isPreMode}
                            accentColor="var(--ui-pre)"
                            title="Select & preview incoming PRE framing"
                            onSelect={selectPre}
                            onCommitTime={canUpdateTime ? commitPre : undefined}
                            onNudgeTime={canUpdateTime ? nudgePre : undefined}
                        />
                        <KeyframeTimeChip
                            prefix="◧ POST"
                            time={activePostTime ?? 0}
                            active={!isPreMode}
                            accentColor="var(--ui-accent)"
                            title="Select & preview outgoing POST framing"
                            onSelect={selectPost}
                            onCommitTime={canUpdateTime ? commitPost : undefined}
                            onNudgeTime={canUpdateTime ? nudgePost : undefined}
                        />
                    </div>
                ) : (
                    <KeyframeTimeChip
                        prefix="◆ GLIDE"
                        time={activePostTime ?? 0}
                        active={true}
                        accentColor="var(--ui-accent)"
                        title="Smooth glide keyframe"
                        onCommitTime={canUpdateTime ? commitPost : undefined}
                        onNudgeTime={canUpdateTime ? nudgePost : undefined}
                    />
                )}
            </div>

            {isTopBox45 ? (
                <div className="tpe-flex-col tpe-kf-col">
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

            <div className="tpe-flex-col tpe-kf-col">
                <SnapCap
                    ariaLabel="Horizontal pan snap"
                    value={activeFraming.posX}
                    options={PAN_SNAP_OPTIONS}
                    onSelect={onPanChange}
                />
                <ScrubPillSlider label="PAN" value={activeFraming.posX} min={0} max={100} accentColor={targetAccent} width="108px" height="20px" onChange={onPanChange} />
            </div>

            {isLetterboxActive && (
                <div className="tpe-flex-col tpe-kf-col">
                    <SnapCap
                        ariaLabel="Vertical position snap"
                        value={activeFraming.posY}
                        options={POS_Y_SNAP_OPTIONS}
                        onSelect={onPosYChange}
                    />
                    <ScrubPillSlider label="POS Y" value={activeFraming.posY} min={0} max={100} accentColor={targetAccent} width="104px" height="20px" title="4:5 vertical ceiling (100% = top edge, lower = pull down with top ambient spill)" onChange={onPosYChange} />
                </div>
            )}

            <div ref={deleteMenuRef} className="tpe-kf-del-anchor">
                <button
                    ref={triggerRef}
                    type="button"
                    aria-label="Delete keyframe options"
                    aria-expanded={showDeleteMenu}
                    aria-haspopup="menu"
                    onClick={() => setShowDeleteMenu((prev) => !prev)}
                    className="tpe-kf-del-trigger"
                    title="Delete keyframe options"
                >
                    ✕
                </button>
                {showDeleteMenu && (
                    <div
                        role="menu"
                        aria-label="Delete keyframe actions"
                        className="tpe-asset-tray-expanded tpe-flex-col tpe-kf-del-menu"
                    >
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setShowDeleteMenu(false); onRemoveKeyframe(); }}
                            className="tpe-mode-btn tpe-kf-del-item"
                            data-tone="danger"
                        >
                            ✕ Delete Keyframe
                        </button>
                        {kfCount > 1 && (
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setShowDeleteMenu(false); onClearAllKeyframes(); }}
                                className="tpe-mode-btn tpe-kf-del-item"
                                data-tone="danger"
                            >
                                🗑 Delete All ({kfCount})
                            </button>
                        )}
                        <button
                            type="button"
                            role="menuitem"
                            onClick={() => { setShowDeleteMenu(false); triggerRef.current?.focus(); }}
                            className="tpe-mode-btn tpe-kf-del-item"
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
