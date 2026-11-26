"use client";

import React, { useCallback, useState } from "react";
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
import { ClipOffsetTrimmer, HookGlyph } from "./ClipOffsetTrimmer";
import { FadePresetControl, SceneChecklistPopover } from "./SceneChecklistPopover";
import { SubtitleRowList } from "./SubtitleEditorTray";
import { CardTimelineScrubber } from "./CardTimelineScrubber";
import { CloseIcon } from "@/components/icons/TPEIcons";

const playingPillStyle: React.CSSProperties = {
    fontSize: '8px',
    padding: '1px 5px',
    borderRadius: '3px',
    background: 'var(--ui-accent)',
    color: '#000',
    fontWeight: 900,
};

const SceneDurationInput: React.FC<{ value: number; onCommit: (next: number) => void }> = React.memo(({ value, onCommit }) => {
    const [draftText, setDraftText] = useState<string | null>(null);
    const commit = (raw: string) => {
        const parsed = parseFloat(raw.trim());
        setDraftText(null);
        if (!Number.isNaN(parsed) && Number.isFinite(parsed)) {
            onCommit(clamp(Math.round(parsed * 10) / 10, 2, 180));
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
            className="tpe-tabular-nums"
            onFocus={(e) => { setDraftText(String(value)); e.currentTarget.select(); }}
            onChange={(e) => setDraftText(e.target.value)}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') { setDraftText(null); e.currentTarget.blur(); }
            }}
            style={{ width: '36px', fontSize: '11px', fontFamily: 'monospace', fontWeight: 800, color: 'var(--ui-text)', background: 'transparent', border: 'none', textAlign: 'center', padding: 0 }}
            title="Directly enter seconds for this angle (2–180s)"
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

    return (
        <div
            role="group"
            aria-roledescription="slide"
            aria-label={`${sceneLabel}, scene ${idx + 1} of ${carouselItemCount}`}
            aria-current={isSceneActive ? "step" : undefined}
            className={isChecklistOpen ? "tpe-storyboard-slide" : "tpe-storyboard-card tpe-storyboard-slide"}
            onClick={() => { if (bounds && !isSceneActive) onSeekTo(bounds.start); }}
            style={{
                width: '100%',
                cursor: isSceneActive ? 'default' : 'pointer',
                background: isSceneActive ? `color-mix(in oklch, ${roleColor} 9%, transparent)` : 'oklch(from var(--ui-text) l c h / 0.02)',
                borderStyle: 'solid',
                borderWidth: '1px 1px 1px 3px',
                borderColor: isSceneActive ? roleColor : `var(--ui-border) var(--ui-border) var(--ui-border) ${roleColor}`,
                borderRadius: '10px',
                padding: '12px',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                boxShadow: isSceneActive ? `0 0 16px color-mix(in oklch, ${roleColor} 18%, transparent)` : 'none',
                transition: 'background-color 0.2s ease, border-color 0.2s ease',
                position: 'relative',
            }}
        >
            <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '10px', fontWeight: 900, color: roleColor, letterSpacing: '0.06em' }}>{sceneLabel}</span>
                    {isSceneActive && <span style={playingPillStyle}>PLAYING</span>}
                </div>

                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '4px', position: 'relative' }} ref={isChecklistOpen ? checklistRef : undefined}>
                    {(idx === 0 || isReHook || isSetup) && (
                        <>
                            <button
                                type="button"
                                className="tpe-asset-btn"
                                data-active={isChecklistOpen}
                                onClick={(e) => { e.stopPropagation(); onToggleChecklist(idx); }}
                                title={idx === 0 ? "01. The Hook Retention Checklist" : (isReHook ? "02. Re-Hook Retention Checklist" : "03. The Story Retention Checklist")}
                                style={{ width: '20px', height: '20px', padding: 0 }}
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" style={{ width: '11px', height: '11px', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
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
                    <div className="tpe-mode-cluster" style={{ padding: '2px', gap: '2px' }}>
                        <button type="button" className="tpe-mode-btn" data-active={(scene.mediaType || 'video') === 'video'} onClick={() => onUpdateScene(idx, { mediaType: 'video' })} title="Loop native video footage" style={{ padding: '3px 6px', fontSize: '8.5px' }}>🎬 VIDEO</button>
                        <button type="button" className="tpe-mode-btn" data-active={scene.mediaType === 'image'} onClick={() => onUpdateScene(idx, { mediaType: 'image' })} title="Kinetic Ken Burns drift (100% to 104% continuous zoom)" style={{ padding: '3px 6px', fontSize: '8.5px' }}>🖼️ PHOTO</button>
                    </div>
                    {canDelete && (
                        <button type="button" aria-label={`Delete ${sceneLabel} scene`} onClick={() => onDeleteScene(idx)} className="tpe-asset-btn tpe-asset-btn-danger tpe-storyboard-remove-btn" title="Delete scene"><CloseIcon width={16} height={16} /></button>
                    )}
                </div>
            </div>

            {/* Duration Timer & Actions */}
            <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '3px' }}>
                    <button type="button" aria-label="Decrease duration 1s" onClick={() => onUpdateScene(idx, { duration: Math.max(2, Math.round((scene.duration - 1) * 10) / 10) })} className="tpe-asset-btn" style={{ width: '20px', height: '20px', fontSize: '11px', lineHeight: 1 }} title="Decrease 1s">-</button>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'oklch(from var(--ui-bg) l c h / 0.85)', border: '1px solid var(--ui-border)', borderRadius: '4px', padding: '1px 4px' }}>
                        <SceneDurationInput
                            value={scene.duration}
                            onCommit={handleCommitDuration}
                        />
                        <span style={{ fontSize: '9px', color: 'var(--ui-text-dim)', fontWeight: 700 }}>s</span>
                    </div>
                    <button type="button" aria-label="Increase duration 1s" onClick={() => onUpdateScene(idx, { duration: Math.max(2, Math.round((scene.duration + 1) * 10) / 10) })} className="tpe-asset-btn" style={{ width: '20px', height: '20px', fontSize: '11px', lineHeight: 1 }} title="Increase 1s">+</button>
                </div>
                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px' }}>
                    {scene.mediaType === 'image' && <span style={{ fontSize: '8px', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--ui-accent)', textTransform: 'uppercase' }}>KEN BURNS ✨</span>}
                    {Boolean(hasSubtitles && bounds) && (
                        <button type="button" className="tpe-mode-btn" data-active={isSubsOpen} onClick={(e) => { e.stopPropagation(); onToggleSubs(idx); }} title="View & edit subtitles playing during this angle card" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap' }}>
                            💬 CC ({cardSubs.length})
                        </button>
                    )}
                    {idx === 0 && (
                        hasReHook ? (
                            <button type="button" className="tpe-mode-btn" onClick={(e) => { e.stopPropagation(); onJumpToReHook(); }} title={reHookAnchored ? "Anchored to 02 Re-Hook (shared headline)" : "Un-anchored (02 Re-Hook uses its own headline)"} style={{ padding: '2px 7px', fontSize: '10px', whiteSpace: 'nowrap', lineHeight: 1, color: 'var(--ui-text)', opacity: reHookAnchored ? 1 : 0.35, filter: reHookAnchored ? 'none' : 'grayscale(1)', background: reHookAnchored ? 'oklch(from var(--ui-accent) l c h / 0.16)' : 'transparent', border: `1px solid ${reHookAnchored ? 'oklch(from var(--ui-accent) l c h / 0.5)' : 'var(--ui-border)'}`, boxShadow: reHookAnchored ? '0 0 12px oklch(from var(--ui-accent) l c h / 0.22)' : 'none' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center' }}><HookGlyph role="hook" /><HookGlyph role="rehook" style={{ marginLeft: '-10.5px' }} /></span>
                            </button>
                        ) : (
                            <button type="button" className="tpe-mode-btn" onClick={(e) => { e.stopPropagation(); onAddReHook(); }} title="Insert a 4s Re-Hook right after 01 The Hook" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap', color: 'var(--ui-accent)', border: '1px dashed oklch(from var(--ui-accent) l c h / 0.45)' }}>
                                + RE-HOOK
                            </button>
                        )
                    )}
                    {isReHook && (
                        <button type="button" className="tpe-mode-btn" data-active={scene.shareHookText !== false} onClick={(e) => { e.stopPropagation(); onUpdateScene(idx, { shareHookText: scene.shareHookText === false }); }} title="Anchor Hook: lock 01. The Hook's headline & subheading continuously across both hooks with zero flash" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap' }}>
                            ⚓ ANCHOR HOOK
                        </button>
                    )}
                    {isSetup && Boolean(videoDuration && videoDuration > 0) && (() => {
                        const adaptedDur = Math.max(2, Math.round((videoDuration! - (scene.clipStartOffset || 0)) * 10) / 10);
                        return (
                            <button type="button" className="tpe-mode-btn" data-active={Math.abs(scene.duration - adaptedDur) < 0.2} onClick={(e) => { e.stopPropagation(); onUpdateScene(idx, { duration: adaptedDur }); }} title="Adapt 03. The Story duration to match the remaining imported clip from its start offset" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap' }}>
                                ADAPT TO CLIP ({formatTimecode(adaptedDur)})
                            </button>
                        );
                    })()}
                </div>
            </div>

            {/* Scoped Angle Subtitles Tab */}
            {isSubsOpen && bounds && hasSubtitles && (
                <div onClick={(e) => e.stopPropagation()} style={{ padding: '6px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--ui-border)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '8.5px', fontWeight: 800, color: 'var(--ui-text-dim)', letterSpacing: '0.06em' }}>CARD CAPTIONS ({cardSubs.length})</span>
                        <button
                            type="button"
                            onClick={() => onUpdateScene(idx, { showSubtitles: !cardCcOn })}
                            className="tpe-mode-btn"
                            data-active={cardCcOn}
                            style={{ padding: '1px 7px', fontSize: '8.5px' }}
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
                        <div style={{ fontSize: '9px', color: 'var(--ui-text-dim)', fontStyle: 'italic' }}>No speech detected in this angle window.</div>
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

            {/* Side-by-side Clip Start Trimmer & Fade Control (Hook, Re-Hook & Setup) */}
            {(idx === 0 || isReHook || isSetup) && (
                <div className={hasVideo ? "tpe-storyboard-controls-grid" : undefined} style={hasVideo ? undefined : { display: 'grid', gridTemplateColumns: '1fr', gap: '8px', marginTop: '2px', alignItems: 'stretch' }}>
                    {hasVideo && (
                        <ClipOffsetTrimmer
                            sceneIdx={idx}
                            mode={idx === 0 ? 'hook' : (isReHook ? 'rehook' : 'setup')}
                            clipStartOffset={scene.clipStartOffset}
                            sceneDuration={scene.duration}
                            currentMediaTime={scene.clipStartOffset !== undefined ? 0 : currentMediaTime}
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
                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px', padding: '6px 8px', borderRadius: '6px', background: scene.mediaUrl ? 'oklch(from var(--ui-accent) l c h / 0.1)' : 'oklch(from var(--ui-text) l c h / 0.03)', border: scene.mediaUrl ? '1px solid oklch(from var(--ui-accent) l c h / 0.4)' : '1px dashed var(--ui-border)' }}>
                    <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.06em', color: scene.mediaUrl ? 'var(--ui-accent)' : 'var(--ui-text-dim)', whiteSpace: 'nowrap' }}>
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
                        style={{ flex: 1, minWidth: 0, fontSize: '9.5px', color: 'var(--ui-text)', background: 'transparent', border: 'none' }}
                    />
                    <label className="tpe-upload-label" style={{ cursor: 'pointer', fontSize: '9px', fontWeight: 800, color: 'var(--ui-accent)', padding: '2px 6px', borderRadius: '4px', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)', whiteSpace: 'nowrap' }} title="Upload custom video or photo for this angle">
                        UPLOAD
                        <input type="file" className="tpe-sr-only" accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSceneMediaUpload(idx, f); e.target.value = ''; }} />
                    </label>
                    {scene.mediaUrl && (
                        <button type="button" aria-label="Revert to master clip" onClick={() => onUpdateScene(idx, { mediaUrl: undefined, mediaName: undefined })} className="tpe-asset-btn tpe-asset-btn-danger" style={{ width: '18px', height: '18px', fontSize: '10px', padding: 0 }} title="Revert to master clip">✕</button>
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
