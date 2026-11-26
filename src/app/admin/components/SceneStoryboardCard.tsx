"use client";

import React, { useCallback, useRef, useState } from "react";
import {
    clamp,
    formatTimecode,
    type ResolvedSceneFade,
    type SubtitleSegment,
    type TimelineScene,
    type VideoDraft,
    type VideoKeyframe,
} from "@/types/news";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";
import { stopEventPropagation } from "../utils/domUtils";
import { ClipOffsetTrimmer, HookGlyph } from "./ClipOffsetTrimmer";
import { FadePresetControl, SceneChecklistPopover } from "./SceneChecklistPopover";
import { SubtitleRowList } from "./SubtitleEditorTray";
import { CardTimelineScrubber } from "./CardTimelineScrubber";
import { CloseIcon } from "@/components/icons/TPEIcons";

const SceneDurationInput: React.FC<{ value: number; maxDur: number; onCommit: (next: number) => void }> = React.memo(({ value, maxDur, onCommit }) => {
    const [draftText, setDraftText] = useState<string | null>(null);
    const cancelEditRef = useRef(false);
    const commit = (raw: string) => {
        if (cancelEditRef.current) {
            cancelEditRef.current = false;
            setDraftText(null);
            return;
        }
        const parsed = parseFloat(raw.trim());
        setDraftText(null);
        if (Number.isFinite(parsed)) {
            const next = clamp(Math.round(parsed * 10) / 10, 2, maxDur);
            if (next !== value) onCommit(next);
        }
    };
    return (
        <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            spellCheck={false}
            value={draftText ?? String(value)}
            aria-label="Scene duration in seconds"
            className="tpe-tabular-nums tpe-scene-dur-input"
            onFocus={(e) => { cancelEditRef.current = false; setDraftText(String(value)); e.currentTarget.select(); }}
            onChange={(e) => setDraftText(e.target.value)}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                else if (e.key === 'Escape') { cancelEditRef.current = true; setDraftText(null); e.currentTarget.blur(); }
            }}
            title={`Directly enter seconds for this angle (2–${maxDur}s)`}
        />
    );
});
SceneDurationInput.displayName = "SceneDurationInput";

interface SceneStoryboardCardProps {
    idx: number;
    scene: TimelineScene;
    sceneLabel: string;
    roleColor: string;
    carouselItemCount: number;
    canDelete: boolean;
    bounds?: { start: number; end: number };
    isSceneActive: boolean;
    isReHook: boolean;
    isSetup: boolean;
    hasReHook: boolean;
    reHookAnchored: boolean;
    hasVideo: boolean;
    videoDuration?: number;
    hasSubtitles: boolean;
    globalShowSubtitles: boolean;
    keyframes?: VideoKeyframe[];
    localTime: number;
    currentMediaTime: number;
    liveClock?: LivePlaybackClock;
    isPlaying: boolean;
    rf: ResolvedSceneFade;
    cardSubs: SubtitleSegment[];
    isChecklistOpen: boolean;
    isSubsOpen: boolean;
    checklistRef?: React.Ref<HTMLDivElement>;
    checklistDraft?: VideoDraft;
    onSeekTo: (time: number) => void;
    onScrubStart?: () => void;
    onScrubMove?: (time: number) => void;
    onScrubEnd?: (finalTime: number) => void;
    onUpdateScene: (index: number, patch: Partial<TimelineScene>) => void;
    onDeleteScene: (index: number) => void;
    onSetOffset: (sceneIdx: number, nextOffset?: number, snapToStart?: boolean) => void;
    onToggleChecklist: (index: number) => void;
    onToggleSubs: (index: number) => void;
    onAddReHook: () => void;
    onJumpToReHook: () => void;
    onSceneMediaUpload: (index: number, file: File) => void;
    onUpdateSubtitleText: (id: string, text: string) => void;
    onRemoveSubtitle: (id: string) => void;
    onSeekSceneSubtitle: (index: number, mediaStart: number) => void;
}

const areSubArraysEqual = (a: SubtitleSegment[], b: SubtitleSegment[]): boolean => {
    if (a === b) return true;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
};

const areFadesEqual = (a: ResolvedSceneFade, b: ResolvedSceneFade): boolean =>
    a.inEnabled === b.inEnabled
    && a.outEnabled === b.outEnabled
    && a.inPreset === b.inPreset
    && a.outPreset === b.outPreset
    && a.inMode === b.inMode
    && a.outMode === b.outMode
    && a.inDur === b.inDur
    && a.outDur === b.outDur
    && a.rawInDur === b.rawInDur
    && a.rawOutDur === b.rawOutDur;

/** Memoized individual scene card inside `TimelineStoryboard` to isolate edits to 1 card instead of N. */
export const SceneStoryboardCard: React.FC<SceneStoryboardCardProps> = React.memo(({
    idx,
    scene,
    sceneLabel,
    roleColor,
    carouselItemCount,
    canDelete,
    bounds,
    isSceneActive,
    isReHook,
    isSetup,
    hasReHook,
    reHookAnchored,
    hasVideo,
    videoDuration,
    hasSubtitles,
    globalShowSubtitles,
    keyframes,
    localTime,
    currentMediaTime,
    liveClock,
    isPlaying,
    rf,
    cardSubs,
    isChecklistOpen,
    isSubsOpen,
    checklistRef,
    checklistDraft,
    onSeekTo,
    onScrubStart,
    onScrubMove,
    onScrubEnd,
    onUpdateScene,
    onDeleteScene,
    onSetOffset,
    onToggleChecklist,
    onToggleSubs,
    onAddReHook,
    onJumpToReHook,
    onSceneMediaUpload,
    onUpdateSubtitleText,
    onRemoveSubtitle,
    onSeekSceneSubtitle,
}) => {
    const handleCommitDuration = useCallback(
        (nextDur: number) => onUpdateScene(idx, { duration: nextDur }),
        [idx, onUpdateScene]
    );
    const handleChecklistUpdate = useCallback(
        (patch: Partial<TimelineScene>) => onUpdateScene(idx, patch),
        [idx, onUpdateScene]
    );
    const handleSeekSub = useCallback(
        (ms: number) => onSeekSceneSubtitle(idx, ms),
        [idx, onSeekSceneSubtitle]
    );

    const cardCcOn = scene.showSubtitles ?? globalShowSubtitles;
    const isVideoMode = (scene.mediaType || 'video') === 'video';
    const maxDur = Math.max(180, Math.ceil(videoDuration || 0));
    const checklistTitle = idx === 0
        ? "01. The Hook Retention Checklist"
        : (isReHook ? "02. Re-Hook Retention Checklist" : "03. The Story Retention Checklist");

    const stepDuration = (delta: number) => {
        const next = clamp(Math.round((scene.duration + delta) * 10) / 10, 2, maxDur);
        if (next !== scene.duration) onUpdateScene(idx, { duration: next });
    };

    return (
        <div
            role="group"
            aria-roledescription="slide"
            aria-label={`${sceneLabel}, scene ${idx + 1} of ${carouselItemCount}`}
            aria-current={isSceneActive ? "step" : undefined}
            className={`${isChecklistOpen ? "tpe-storyboard-slide" : "tpe-storyboard-card tpe-storyboard-slide"} tpe-scene-card`}
            data-active={isSceneActive}
            onClick={() => { if (bounds && !isSceneActive) onSeekTo(bounds.start); }}
            style={{ "--role-color": roleColor } as React.CSSProperties}
        >
            <div className="tpe-flex-row tpe-scene-card-row">
                <div className="tpe-flex-row tpe-scene-card-head-left">
                    <span className="tpe-scene-card-label">{sceneLabel}</span>
                    {isSceneActive && <span className="tpe-scene-playing-pill">PLAYING</span>}
                </div>

                <div className="tpe-flex-row tpe-scene-card-actions" onClick={stopEventPropagation} ref={isChecklistOpen ? checklistRef : undefined}>
                    {(idx === 0 || isReHook || isSetup) && (
                        <>
                            <button
                                type="button"
                                className="tpe-asset-btn tpe-scene-checklist-btn"
                                data-active={isChecklistOpen}
                                aria-label={checklistTitle}
                                aria-expanded={isChecklistOpen}
                                aria-haspopup="dialog"
                                onClick={() => onToggleChecklist(idx)}
                                title={checklistTitle}
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" aria-hidden="true" style={{ width: '11px', height: '11px', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                                    <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
                                </svg>
                            </button>
                            {isChecklistOpen && checklistDraft && (
                                <SceneChecklistPopover
                                    sceneMode={idx === 0 ? 'hook' : (isReHook ? 'rehook' : 'setup')}
                                    scene={scene}
                                    draft={checklistDraft}
                                    sceneBounds={bounds}
                                    onUpdateScene={handleChecklistUpdate}
                                />
                            )}
                        </>
                    )}
                    <div className="tpe-mode-cluster tpe-scene-media-cluster" role="group" aria-label="Scene media mode">
                        <button type="button" aria-pressed={isVideoMode} className="tpe-mode-btn tpe-scene-media-btn" data-active={isVideoMode} onClick={() => { if (!isVideoMode) onUpdateScene(idx, { mediaType: 'video' }); }} title="Loop native video footage">🎬 VIDEO</button>
                        <button type="button" aria-pressed={!isVideoMode} className="tpe-mode-btn tpe-scene-media-btn" data-active={!isVideoMode} onClick={() => { if (isVideoMode) onUpdateScene(idx, { mediaType: 'image' }); }} title="Kinetic Ken Burns drift (100% to 104% continuous zoom)">🖼️ PHOTO</button>
                    </div>
                    {canDelete && (
                        <button type="button" aria-label={`Delete ${sceneLabel} scene`} onClick={() => onDeleteScene(idx)} className="tpe-asset-btn tpe-asset-btn-danger tpe-storyboard-remove-btn" title="Delete scene"><CloseIcon width={16} height={16} /></button>
                    )}
                </div>
            </div>

            {/* Duration Timer & Actions */}
            <div className="tpe-flex-row tpe-scene-card-row" onClick={stopEventPropagation}>
                <div className="tpe-flex-row tpe-scene-dur-group">
                    <button type="button" disabled={scene.duration <= 2} aria-label="Decrease duration 1s" onClick={() => stepDuration(-1)} className="tpe-asset-btn tpe-scene-dur-step" title="Decrease 1s">-</button>
                    <div className="tpe-scene-dur-box">
                        <SceneDurationInput value={scene.duration} maxDur={maxDur} onCommit={handleCommitDuration} />
                        <span className="tpe-scene-dur-unit">s</span>
                    </div>
                    <button type="button" disabled={scene.duration >= maxDur} aria-label="Increase duration 1s" onClick={() => stepDuration(1)} className="tpe-asset-btn tpe-scene-dur-step" title="Increase 1s">+</button>
                </div>
                <div className="tpe-flex-row tpe-scene-meta-actions">
                    {!isVideoMode && <span className="tpe-scene-kb-badge">KEN BURNS ✨</span>}
                    {Boolean(hasSubtitles && bounds) && (
                        <button type="button" aria-expanded={isSubsOpen} className="tpe-mode-btn tpe-scene-pill-btn tpe-tabular-nums" data-active={isSubsOpen} onClick={() => onToggleSubs(idx)} title="View & edit subtitles playing during this angle card">
                            💬 CC ({cardSubs.length})
                        </button>
                    )}
                    {idx === 0 && (
                        hasReHook ? (
                            <button
                                type="button"
                                aria-label={reHookAnchored ? "Jump to anchored 02 Re-Hook scene" : "Jump to un-anchored 02 Re-Hook scene"}
                                className="tpe-mode-btn tpe-scene-rehook-link"
                                data-anchored={reHookAnchored}
                                onClick={onJumpToReHook}
                                title={reHookAnchored ? "Anchored to 02 Re-Hook (shared headline)" : "Un-anchored (02 Re-Hook uses its own headline)"}
                            >
                                <span className="tpe-scene-rehook-glyphs"><HookGlyph role="hook" /><HookGlyph role="rehook" className="tpe-scene-rehook-glyph-overlap" /></span>
                            </button>
                        ) : (
                            <button type="button" className="tpe-mode-btn tpe-scene-add-rehook" onClick={onAddReHook} title="Insert a 4s Re-Hook right after 01 The Hook">
                                + RE-HOOK
                            </button>
                        )
                    )}
                    {isReHook && (
                        <button type="button" aria-pressed={scene.shareHookText !== false} className="tpe-mode-btn tpe-scene-pill-btn" data-active={scene.shareHookText !== false} onClick={() => onUpdateScene(idx, { shareHookText: scene.shareHookText === false })} title="Anchor Hook: lock 01. The Hook's headline & subheading continuously across both hooks with zero flash">
                            ⚓ ANCHOR HOOK
                        </button>
                    )}
                    {isSetup && Boolean(videoDuration && videoDuration > 0) && (() => {
                        const adaptedDur = Math.max(2, Math.round((videoDuration! - (scene.clipStartOffset || 0)) * 10) / 10);
                        const isAdapted = Math.abs(scene.duration - adaptedDur) < 0.2;
                        return (
                            <button type="button" aria-pressed={isAdapted} className="tpe-mode-btn tpe-scene-pill-btn tpe-tabular-nums" data-active={isAdapted} onClick={() => { if (scene.duration !== adaptedDur) onUpdateScene(idx, { duration: adaptedDur }); }} title="Adapt 03. The Story duration to match the remaining imported clip from its start offset">
                                ADAPT TO CLIP ({formatTimecode(adaptedDur)})
                            </button>
                        );
                    })()}
                </div>
            </div>

            {/* Scoped Angle Subtitles Tab */}
            {isSubsOpen && bounds && hasSubtitles && (
                <div onClick={stopEventPropagation} className="tpe-scene-subs-tray">
                    <div className="tpe-flex-row tpe-scene-card-row">
                        <span className="tpe-scene-subs-label tpe-tabular-nums">CARD CAPTIONS ({cardSubs.length})</span>
                        <button
                            type="button"
                            aria-pressed={cardCcOn}
                            onClick={() => onUpdateScene(idx, { showSubtitles: !cardCcOn })}
                            className="tpe-mode-btn tpe-scene-subs-toggle"
                            data-active={cardCcOn}
                            title="Toggle closed captions only for this angle card"
                        >
                            CC: {cardCcOn ? "ON" : "OFF"}
                        </button>
                    </div>
                    {cardSubs.length > 0 ? (
                        <SubtitleRowList
                            segments={cardSubs}
                            onUpdateText={onUpdateSubtitleText}
                            onRemoveSeg={onRemoveSubtitle}
                            onSeekMedia={handleSeekSub}
                        />
                    ) : (
                        <div className="tpe-scene-subs-empty">No speech detected in this angle window.</div>
                    )}
                </div>
            )}

            {/* Scoped Per-Card Mini-Timeline Scrubber */}
            {bounds && (
                <CardTimelineScrubber
                    sceneLabel={sceneLabel}
                    start={bounds.start}
                    end={bounds.end}
                    duration={scene.duration}
                    localTime={localTime}
                    liveClock={liveClock}
                    isSceneActive={isSceneActive}
                    isPlaying={isPlaying}
                    keyframes={keyframes}
                    fadeInDur={rf.inDur}
                    fadeOutDur={rf.outDur}
                    onSeek={onSeekTo}
                    onScrubStart={onScrubStart}
                    onScrubMove={onScrubMove}
                    onScrubEnd={onScrubEnd}
                />
            )}

            {/* Side-by-side Clip Start Trimmer & Fade Control (Hook, Re-Hook & Story) */}
            {(idx === 0 || isReHook || isSetup) && (
                <div className={hasVideo ? "tpe-storyboard-controls-grid" : "tpe-scene-single-control-grid"}>
                    {hasVideo && (
                        <ClipOffsetTrimmer
                            sceneIdx={idx}
                            mode={idx === 0 ? 'hook' : (isReHook ? 'rehook' : 'setup')}
                            clipStartOffset={scene.clipStartOffset}
                            sceneDuration={scene.duration}
                            currentMediaTime={currentMediaTime}
                            isCardActive={isSceneActive}
                            onSetOffset={onSetOffset}
                        />
                    )}
                    <FadePresetControl
                        sceneIdx={idx}
                        fadeInEnabled={rf.inEnabled}
                        fadeInPreset={rf.inPreset}
                        fadeInDuration={rf.rawInDur}
                        fadeOutEnabled={rf.outEnabled}
                        fadeOutPreset={rf.outPreset}
                        fadeOutDuration={rf.rawOutDur}
                        defaultSide={isSetup || isReHook ? 'in' : 'out'}
                        inHint={rf.inMode === 'micro' ? 'ANCHOR HOOK' : '🎬 ACT BREAK'}
                        outHint={rf.outMode === 'micro' ? 'ANCHOR HOOK' : '🎬 ACT BREAK'}
                        isCardActive={isSceneActive}
                        onUpdate={onUpdateScene}
                    />
                </div>
            )}

            {/* Per-Scene Media Override (Scenes 02+) */}
            {idx > 0 && (
                <div className="tpe-flex-row tpe-scene-broll-bar" data-custom={Boolean(scene.mediaUrl)} onClick={stopEventPropagation}>
                    <span className="tpe-scene-broll-tag" data-custom={Boolean(scene.mediaUrl)}>
                        {scene.mediaUrl ? 'CUSTOM' : 'MASTER'}
                    </span>
                    <input
                        type="text"
                        inputMode="url"
                        enterKeyHint="done"
                        spellCheck={false}
                        autoCorrect="off"
                        autoCapitalize="off"
                        aria-label="Scene media override URL"
                        placeholder="Override URL or upload clip/photo..."
                        value={scene.mediaUrl || ''}
                        onChange={(e) => onUpdateScene(idx, { mediaUrl: e.target.value || undefined, mediaName: undefined })}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                        className="tpe-scene-broll-input"
                    />
                    <label className="tpe-upload-label tpe-scene-broll-upload" title="Upload custom video or photo for this angle">
                        UPLOAD
                        <input type="file" className="tpe-sr-only" accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSceneMediaUpload(idx, f); e.target.value = ''; }} />
                    </label>
                    {scene.mediaUrl && (
                        <button
                            type="button"
                            aria-label="Revert to master clip"
                            onClick={() => onUpdateScene(idx, { mediaUrl: undefined, mediaName: undefined, ...(hasVideo ? { mediaType: 'video' } : {}) })}
                            className="tpe-asset-btn tpe-asset-btn-danger tpe-scene-broll-revert"
                            title="Revert to master clip"
                        >
                            ✕
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}, (prev, next) =>
    prev.idx === next.idx
    && prev.scene === next.scene
    && prev.sceneLabel === next.sceneLabel
    && prev.roleColor === next.roleColor
    && prev.carouselItemCount === next.carouselItemCount
    && prev.canDelete === next.canDelete
    && prev.bounds?.start === next.bounds?.start
    && prev.bounds?.end === next.bounds?.end
    && prev.isSceneActive === next.isSceneActive
    && prev.isReHook === next.isReHook
    && prev.isSetup === next.isSetup
    && prev.hasReHook === next.hasReHook
    && prev.reHookAnchored === next.reHookAnchored
    && prev.hasVideo === next.hasVideo
    && prev.videoDuration === next.videoDuration
    && prev.hasSubtitles === next.hasSubtitles
    && prev.globalShowSubtitles === next.globalShowSubtitles
    && prev.keyframes === next.keyframes
    && prev.localTime === next.localTime
    && prev.currentMediaTime === next.currentMediaTime
    && prev.liveClock === next.liveClock
    && prev.isPlaying === next.isPlaying
    && prev.isChecklistOpen === next.isChecklistOpen
    && prev.isSubsOpen === next.isSubsOpen
    && prev.checklistDraft === next.checklistDraft
    && areFadesEqual(prev.rf, next.rf)
    && areSubArraysEqual(prev.cardSubs, next.cardSubs)
    && prev.onSeekTo === next.onSeekTo
    && prev.onScrubStart === next.onScrubStart
    && prev.onScrubMove === next.onScrubMove
    && prev.onScrubEnd === next.onScrubEnd
    && prev.onUpdateScene === next.onUpdateScene
    && prev.onDeleteScene === next.onDeleteScene
    && prev.onSetOffset === next.onSetOffset
    && prev.onToggleChecklist === next.onToggleChecklist
    && prev.onToggleSubs === next.onToggleSubs
    && prev.onAddReHook === next.onAddReHook
    && prev.onJumpToReHook === next.onJumpToReHook
    && prev.onSceneMediaUpload === next.onSceneMediaUpload
    && prev.onUpdateSubtitleText === next.onUpdateSubtitleText
    && prev.onRemoveSubtitle === next.onRemoveSubtitle
    && prev.onSeekSceneSubtitle === next.onSeekSceneSubtitle
);
SceneStoryboardCard.displayName = "SceneStoryboardCard";
