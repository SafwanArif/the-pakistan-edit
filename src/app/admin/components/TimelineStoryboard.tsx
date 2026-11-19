"use client";

import React, { useMemo, useState } from "react";
import { VideoDraft, TimelineScene, timelineTimeToMediaTime, formatTimecode, getSceneBoundaries, getSceneRoleColor, resolveSceneFadeDurations, getTimelineStructure, clamp } from "../../../types/news";
import { useClickOutside } from "../hooks/useClickOutside";
import { ClipOffsetTrimmer, HookGlyph } from "./ClipOffsetTrimmer";
import { SceneChecklistPopover, FadePresetControl } from "./SceneChecklistPopover";
import { SubtitleRowList, getSceneSubtitles } from "./SubtitleEditorTray";
import { MasterChecklistPopover, getMasterChecklistItems } from "./MasterChecklistPopover";
import { CardTimelineScrubber } from "./CardTimelineScrubber";
import { TimelineFooterCards } from "./TimelineFooterCards";

interface TimelineStoryboardProps {
    draft: VideoDraft;
    onChange: (d: VideoDraft) => void;
    currentTime: number;
    seekTo: (time: number) => void;
    playbackMode?: 'play-all' | 'loop-angle';
    onTogglePlaybackMode?: () => void;
}

const playingPillStyle: React.CSSProperties = {
    fontSize: '8px', padding: '1px 5px', borderRadius: '3px', background: 'var(--ui-accent)', color: '#000', fontWeight: 900
};

/** Left-pane scene storyboard inspector with 60s monetisation pacing and cold-open hook extractor. */
export const TimelineStoryboard: React.FC<TimelineStoryboardProps> = ({
    draft, onChange, currentTime, seekTo, playbackMode = 'play-all', onTogglePlaybackMode
}) => {
    const [openChecklistIdx, setOpenChecklistIdx] = useState<number | null>(null);
    const [openSubSceneIdx, setOpenSubSceneIdx] = useState<number | null>(null);
    const [showMasterChecklist, setShowMasterChecklist] = useState(false);
    const checklistRef = useClickOutside(() => setOpenChecklistIdx(null));
    const masterChecklistRef = useClickOutside(() => setShowMasterChecklist(false));
    const masterItems = useMemo(() => getMasterChecklistItems(draft), [draft]);
    const masterPassed = useMemo(() => masterItems.filter(i => i.passed).length, [masterItems]);
    const scenes = draft.scenes || [];

    const sceneBoundaries = useMemo(() => getSceneBoundaries(draft.scenes), [draft.scenes]);
    const { hasReHook, storyIdx: setupIdx } = useMemo(() => getTimelineStructure(draft.scenes), [draft.scenes]);
    const sceneSubtitlesList = useMemo(
        () => sceneBoundaries.map((b) => (draft.subtitles?.length ? getSceneSubtitles({ ...draft, scenes: draft.scenes, subtitles: draft.subtitles, videoDuration: draft.videoDuration }, b.start, b.end) : [])),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draft.subtitles, draft.scenes, draft.videoDuration, sceneBoundaries]
    );
    const sceneFadesList = useMemo(
        () => (draft.scenes || []).map((_, idx) => resolveSceneFadeDurations(draft.scenes || [], idx)),
        [draft.scenes]
    );
    const outroStart = sceneBoundaries.length > 0 ? sceneBoundaries[sceneBoundaries.length - 1]!.end : 0;
    const isOutroActive = draft.enableOutro && currentTime >= outroStart;
    const currentMediaTime = useMemo(() => Math.round(timelineTimeToMediaTime(draft, currentTime) * 10) / 10, [draft, currentTime]);

    const updateScene = (index: number, patch: Partial<TimelineScene>) => {
        const updated = [...scenes];
        const prev = updated[index];
        if (!prev) return;
        if ('mediaUrl' in patch && prev.mediaUrl?.startsWith('blob:') && patch.mediaUrl !== prev.mediaUrl) {
            URL.revokeObjectURL(prev.mediaUrl);
        }
        updated[index] = { ...prev, ...patch };
        onChange({ ...draft, scenes: updated });
    };

    const setSceneOffset = (sceneIdx: number, nextOffset?: number, snapToStart = false) => {
        const newScenes = [...scenes];
        const target = newScenes[sceneIdx];
        if (!target) return;
        const copy = { ...target };
        if (nextOffset === undefined || nextOffset < 0) delete copy.clipStartOffset;
        else copy.clipStartOffset = Math.round(nextOffset * 10) / 10;
        newScenes[sceneIdx] = copy;
        onChange({ ...draft, scenes: newScenes });
        if (snapToStart) seekTo(sceneBoundaries[sceneIdx]?.start ?? 0);
    };

    const handleAddScene = () => {
        onChange({ ...draft, scenes: [...scenes, { id: `scene-${crypto.randomUUID().slice(0, 8)}`, title: `KEY ANGLE ${scenes.length + 1}: STRATEGIC ANALYSIS`, subtitle: "Verified intelligence breakdown and future market impact.", duration: 15, mediaType: 'video' }] });
    };

    const handleAddReHook = () => {
        const updated = [...scenes];
        updated.splice(1, 0, { id: `rehook-${crypto.randomUUID().slice(0, 8)}`, title: "WAIT — HERE IS ==THE REAL SHIFT==", subtitle: "The overlooked turning point right before the full picture emerged.", duration: 4, mediaType: 'video', shareHookText: true });
        onChange({ ...draft, scenes: updated });
    };

    const ingestAbortRef = React.useRef<AbortController | null>(null);

    React.useEffect(() => {
        return () => ingestAbortRef.current?.abort();
    }, []);

    const handleSceneMediaUpload = async (idx: number, file: File) => {
        const prevUrl = scenes[idx]?.mediaUrl;
        if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl);
        if (file.type.startsWith('image/')) {
            updateScene(idx, { mediaUrl: URL.createObjectURL(file), mediaType: 'image', mediaName: file.name });
            return;
        }
        ingestAbortRef.current?.abort();
        const controller = new AbortController();
        ingestAbortRef.current = controller;
        try {
            const formData = new FormData();
            formData.append('file', file, file.name);
            const res = await fetch('/api/video/ingest', { method: 'POST', body: formData, signal: controller.signal });
            if (res.ok) {
                const { url } = await res.json() as { url: string };
                updateScene(idx, { mediaUrl: url, mediaType: 'video', mediaName: file.name });
                return;
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            /* fallback to local object URL */
        }
        updateScene(idx, { mediaUrl: URL.createObjectURL(file), mediaType: 'video', mediaName: file.name });
    };

    return (
        <aside
            aria-label="Timeline Storyboard"
            className="tpe-flex-col"
            style={{
                width: '420px', minWidth: '360px', maxWidth: '460px',
                height: '100%', background: 'oklch(from var(--ui-bg) l c h / 0.95)',
                borderInlineEnd: '1px solid var(--ui-border)',
                padding: '14px 16px', gap: '12px', overflowY: 'auto', overflowX: 'hidden',
                flexShrink: 0
            }}
        >
            {/* Timeline Control HUD */}
            <div className="tpe-flex-col" style={{ gap: '8px', borderBlockEnd: '1px solid var(--ui-border)', paddingBlockEnd: '12px' }}>
                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    {onTogglePlaybackMode && (
                        <div className="tpe-mode-cluster" role="group" aria-label="Playback mode" style={{ padding: '2px', gap: '2px' }}>
                            <button
                                type="button"
                                aria-pressed={playbackMode === 'play-all'}
                                aria-label="Play All: play straight through all angle cards"
                                onClick={() => { if (playbackMode !== 'play-all') onTogglePlaybackMode(); }}
                                className="tpe-mode-btn"
                                data-active={playbackMode === 'play-all'}
                                style={{ width: '22px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                title="Play All: play straight through all angle cards"
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M5 4l10 8-10 8V4zm12 1h2v14h-2V5z" /></svg>
                            </button>
                            <button
                                type="button"
                                aria-pressed={playbackMode === 'loop-angle'}
                                aria-label="Loop Angle: repeat only the active angle card"
                                onClick={() => { if (playbackMode !== 'loop-angle') onTogglePlaybackMode(); }}
                                className="tpe-mode-btn"
                                data-active={playbackMode === 'loop-angle'}
                                style={{ width: '22px', height: '20px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                title="Loop Angle: repeat only the active angle card"
                            >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14" /><path d="M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
                            </button>
                        </div>
                    )}
                    <button type="button" aria-pressed={Boolean(draft.enableOutro)} onClick={() => onChange({ ...draft, enableOutro: !draft.enableOutro })} className="tpe-mode-btn" data-active={draft.enableOutro} style={{ padding: '4px 8px', fontSize: '9px' }} title="Append 5-second branded outro end card">🏁 OUTRO: {draft.enableOutro ? "ON" : "OFF"}</button>
                    <button type="button" aria-pressed={draft.enableMotion !== false} onClick={() => onChange({ ...draft, enableMotion: draft.enableMotion === false })} className="tpe-mode-btn" data-active={draft.enableMotion !== false} style={{ padding: '4px 8px', fontSize: '9px' }} title="Toggle 2026/2027 editorial kinetic motion on text, metadata, and branding">✨ MOTION: {draft.enableMotion !== false ? "ON" : "OFF"}</button>
                    <div ref={masterChecklistRef} style={{ position: 'relative' }}>
                        <button type="button" aria-expanded={showMasterChecklist} aria-haspopup="dialog" onClick={() => setShowMasterChecklist(p => !p)} className="tpe-mode-btn" data-active={showMasterChecklist || masterPassed === masterItems.length} style={{ padding: '4px 8px', fontSize: '9px' }} title="Master 2026/2027 video best-practice checklist">📋 MASTER ({masterPassed}/{masterItems.length})</button>
                        {showMasterChecklist && <MasterChecklistPopover draft={draft} onChange={onChange} onClose={() => setShowMasterChecklist(false)} />}
                    </div>
                </div>
            </div>

            {/* Scene Storyboard Rack */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', paddingBlock: '4px' }}>
                {scenes.map((scene, idx) => {
                    const bounds = sceneBoundaries[idx];
                    const isSceneActive = Boolean(bounds && currentTime >= bounds.start && currentTime < bounds.end);
                    const isReHook = idx === 1 && hasReHook;
                    const isSetup = idx === setupIdx;
                    const sceneLabel = idx === 0
                        ? "01. THE HOOK"
                        : (isReHook ? "02. RE-HOOK" : (isSetup ? `${String(idx + 1).padStart(2, '0')}. THE STORY` : `${String(idx + 1).padStart(2, '0')}. ANGLE`));

                    const roleColor = getSceneRoleColor(idx, isReHook, isSetup);
                    const rf = sceneFadesList[idx] ?? resolveSceneFadeDurations(scenes, idx);
                    const cardSubs = sceneSubtitlesList[idx] ?? [];
                    return (
                        <div
                            key={`${scene.id}-${idx}`}
                            onClick={() => { if (bounds && !isSceneActive) seekTo(bounds.start); }}
                            style={{ width: '100%', cursor: isSceneActive ? 'default' : 'pointer', background: isSceneActive ? `color-mix(in oklch, ${roleColor} 9%, transparent)` : 'oklch(from var(--ui-text) l c h / 0.02)', borderStyle: 'solid', borderWidth: '1px 1px 1px 3px', borderColor: isSceneActive ? roleColor : `var(--ui-border) var(--ui-border) var(--ui-border) ${roleColor}`, borderRadius: '10px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px', boxShadow: isSceneActive ? `0 0 16px color-mix(in oklch, ${roleColor} 18%, transparent)` : 'none', transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease', position: 'relative' }}
                        >
                            <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px' }}>
                                    <span style={{ fontSize: '10px', fontWeight: 900, color: roleColor, letterSpacing: '0.06em' }}>{sceneLabel}</span>
                                    {isSceneActive && <span style={playingPillStyle}>PLAYING</span>}
                                </div>

                                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '4px', position: 'relative' }} ref={openChecklistIdx === idx ? checklistRef : undefined}>
                                    {(idx === 0 || isReHook || isSetup) && (
                                        <>
                                            <button
                                                type="button"
                                                className="tpe-asset-btn"
                                                data-active={openChecklistIdx === idx}
                                                onClick={(e) => { e.stopPropagation(); setOpenChecklistIdx((prev) => (prev === idx ? null : idx)); }}
                                                title={idx === 0 ? "01. The Hook Retention Checklist" : (isReHook ? "02. Re-Hook Retention Checklist" : "03. The Story Retention Checklist")}
                                                style={{ width: '20px', height: '20px', padding: 0 }}
                                            >
                                                <svg width="11" height="11" viewBox="0 0 24 24" style={{ width: '11px', height: '11px', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round', strokeLinejoin: 'round' }}>
                                                    <path d="M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
                                                </svg>
                                            </button>
                                            {openChecklistIdx === idx && (
                                                <SceneChecklistPopover
                                                    sceneMode={idx === 0 ? 'hook' : (isReHook ? 'rehook' : 'setup')}
                                                    scene={scene}
                                                    draft={draft}
                                                    sceneBounds={bounds ? { start: bounds.start, end: bounds.end } : undefined}
                                                    onUpdateScene={(patch) => updateScene(idx, patch)}
                                                />
                                            )}
                                        </>
                                    )}
                                    <div className="tpe-mode-cluster" style={{ padding: '2px', gap: '2px' }}>
                                        <button type="button" className="tpe-mode-btn" data-active={(scene.mediaType || 'video') === 'video'} onClick={() => updateScene(idx, { mediaType: 'video' })} title="Loop native video footage" style={{ padding: '3px 6px', fontSize: '8.5px' }}>🎬 VIDEO</button>
                                        <button type="button" className="tpe-mode-btn" data-active={scene.mediaType === 'image'} onClick={() => updateScene(idx, { mediaType: 'image' })} title="Kinetic Ken Burns drift (100% to 104% continuous zoom)" style={{ padding: '3px 6px', fontSize: '8.5px' }}>🖼️ PHOTO</button>
                                    </div>
                                    {scenes.length > 1 && (
                                        <button type="button" onClick={() => onChange({ ...draft, scenes: scenes.filter((_, i) => i !== idx) })} className="tpe-asset-btn tpe-asset-btn-danger" style={{ width: '20px', height: '20px' }} title="Delete scene">×</button>
                                    )}
                                </div>
                            </div>

                            {/* Duration Timer & Actions */}
                            <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '3px' }}>
                                    <button type="button" aria-label="Decrease duration 1s" onClick={() => updateScene(idx, { duration: Math.max(2, Math.round((scene.duration - 1) * 10) / 10) })} className="tpe-asset-btn" style={{ width: '20px', height: '20px', fontSize: '11px', lineHeight: 1 }} title="Decrease 1s">-</button>
                                    <div style={{ display: 'flex', alignItems: 'center', background: 'oklch(from var(--ui-bg) l c h / 0.85)', border: '1px solid var(--ui-border)', borderRadius: '4px', padding: '1px 4px' }}>
                                        <input
                                            type="number" inputMode="decimal" step="0.5" min="1" max="180" value={scene.duration}
                                            aria-label="Scene duration in seconds"
                                            className="tpe-tabular-nums"
                                            onChange={(e) => { const val = parseFloat(e.target.value); if (!Number.isNaN(val)) updateScene(idx, { duration: Math.max(2, Math.round(val * 10) / 10) }); }}
                                            style={{ width: '36px', fontSize: '11px', fontFamily: 'monospace', fontWeight: 800, color: 'var(--ui-text)', background: 'transparent', border: 'none', textAlign: 'center', padding: 0 }}
                                            title="Directly enter seconds for this angle"
                                        />
                                        <span style={{ fontSize: '9px', color: 'var(--ui-text-dim)', fontWeight: 700 }}>s</span>
                                    </div>
                                    <button type="button" aria-label="Increase duration 1s" onClick={() => updateScene(idx, { duration: Math.max(2, Math.round((scene.duration + 1) * 10) / 10) })} className="tpe-asset-btn" style={{ width: '20px', height: '20px', fontSize: '11px', lineHeight: 1 }} title="Increase 1s">+</button>
                                </div>
                                <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px' }}>
                                    {scene.mediaType === 'image' && <span style={{ fontSize: '8px', fontWeight: 800, letterSpacing: '0.06em', color: 'var(--ui-accent)', textTransform: 'uppercase' }}>KEN BURNS ✨</span>}
                                    {Boolean(draft.subtitles?.length && bounds) && (
                                        <button type="button" className="tpe-mode-btn" data-active={openSubSceneIdx === idx} onClick={(e) => { e.stopPropagation(); setOpenSubSceneIdx((prev) => (prev === idx ? null : idx)); }} title="View & edit subtitles playing during this angle card" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap' }}>
                                            💬 CC ({cardSubs.length})
                                        </button>
                                    )}
                                    {idx === 0 && (
                                        hasReHook ? (
                                            <button type="button" className="tpe-mode-btn" onClick={(e) => { e.stopPropagation(); const b1 = sceneBoundaries[1]; if (b1) seekTo(b1.start); }} title={scenes[1]?.shareHookText !== false ? "Anchored to 02 Re-Hook (shared headline)" : "Un-anchored (02 Re-Hook uses its own headline)"} style={{ padding: '2px 7px', fontSize: '10px', whiteSpace: 'nowrap', lineHeight: 1, color: 'var(--ui-text)', opacity: scenes[1]?.shareHookText !== false ? 1 : 0.35, filter: scenes[1]?.shareHookText !== false ? 'none' : 'grayscale(1)', background: scenes[1]?.shareHookText !== false ? 'oklch(from var(--ui-accent) l c h / 0.16)' : 'transparent', border: `1px solid ${scenes[1]?.shareHookText !== false ? 'oklch(from var(--ui-accent) l c h / 0.5)' : 'var(--ui-border)'}`, boxShadow: scenes[1]?.shareHookText !== false ? '0 0 12px oklch(from var(--ui-accent) l c h / 0.22)' : 'none' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center' }}><HookGlyph role="hook" /><HookGlyph role="rehook" style={{ marginLeft: '-10.5px' }} /></span>
                                            </button>
                                        ) : (
                                            <button type="button" className="tpe-mode-btn" onClick={(e) => { e.stopPropagation(); handleAddReHook(); }} title="Insert a 4s Re-Hook right after 01 The Hook" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap', color: 'var(--ui-accent)', border: '1px dashed oklch(from var(--ui-accent) l c h / 0.45)' }}>
                                                + RE-HOOK
                                            </button>
                                        )
                                    )}
                                    {isReHook && (
                                        <button type="button" className="tpe-mode-btn" data-active={scene.shareHookText !== false} onClick={(e) => { e.stopPropagation(); updateScene(idx, { shareHookText: scene.shareHookText === false }); }} title="Anchor Hook: lock 01. The Hook's headline & subheading continuously across both hooks with zero flash" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap' }}>
                                            ⚓ ANCHOR HOOK
                                        </button>
                                    )}
                                    {isSetup && Boolean(draft.videoDuration && draft.videoDuration > 0) && (() => {
                                        const adaptedDur = Math.max(2, Math.round((draft.videoDuration! - (scene.clipStartOffset || 0)) * 10) / 10);
                                        return (
                                            <button type="button" className="tpe-mode-btn" data-active={Math.abs(scene.duration - adaptedDur) < 0.2} onClick={(e) => { e.stopPropagation(); updateScene(idx, { duration: adaptedDur }); }} title="Adapt 03. The Story duration to match the remaining imported clip from its start offset" style={{ padding: '2px 7px', fontSize: '9px', whiteSpace: 'nowrap' }}>
                                                ADAPT TO CLIP ({formatTimecode(adaptedDur)})
                                            </button>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Scoped Angle Subtitles Tab */}
                            {openSubSceneIdx === idx && bounds && draft.subtitles?.length ? (() => {
                                const cardCcOn = scene.showSubtitles ?? (draft.showSubtitles !== false);
                                return (
                                    <div onClick={(e) => e.stopPropagation()} style={{ padding: '6px', borderRadius: '6px', background: 'rgba(0,0,0,0.3)', border: '1px solid var(--ui-border)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                        <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '8.5px', fontWeight: 800, color: 'var(--ui-text-dim)', letterSpacing: '0.06em' }}>CARD CAPTIONS ({cardSubs.length})</span>
                                            <button
                                                type="button"
                                                onClick={() => updateScene(idx, { showSubtitles: !cardCcOn })}
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
                                                draft={draft}
                                                onChange={onChange}
                                                onSeekMedia={(ms) => seekTo(idx === 0 ? Math.max(0, ms - (scene.clipStartOffset ?? 0)) : bounds.start + Math.max(0, ms - timelineTimeToMediaTime(draft, bounds.start)))}
                                            />
                                        ) : (
                                            <div style={{ fontSize: '9px', color: 'var(--ui-text-dim)', fontStyle: 'italic' }}>No speech detected in this angle window.</div>
                                        )}
                                    </div>
                                );
                            })() : null}

                            {/* Scoped Per-Card Mini-Timeline Scrubber */}
                            {bounds && (
                                <CardTimelineScrubber
                                    sceneLabel={sceneLabel}
                                    start={bounds.start}
                                    end={bounds.end}
                                    duration={scene.duration}
                                    localTime={clamp(currentTime - bounds.start, 0, scene.duration)}
                                    isSceneActive={isSceneActive}
                                    keyframes={draft.keyframes}
                                    fadeInDur={scene.fadeIn ? rf.inDur : 0}
                                    fadeOutDur={scene.fadeOut ? rf.outDur : 0}
                                    onSeek={seekTo}
                                />
                            )}

                            {/* Side-by-side Clip Start Trimmer & Fade Control (Hook, Re-Hook & Setup) */}
                            {(idx === 0 || isReHook || isSetup) && (
                                <div style={{ display: 'grid', gridTemplateColumns: draft.videoUrl ? 'repeat(2, minmax(0, 1fr))' : '1fr', gap: '8px', marginTop: '2px', alignItems: 'stretch' }}>
                                    {!!draft.videoUrl && (
                                        <ClipOffsetTrimmer
                                            mode={idx === 0 ? 'hook' : (isReHook ? 'rehook' : 'setup')}
                                            clipStartOffset={scene.clipStartOffset}
                                            sceneDuration={scene.duration}
                                            currentMediaTime={currentMediaTime}
                                            isCardActive={isSceneActive}
                                            onSetOffset={(nextOffset, snap) => setSceneOffset(idx, nextOffset, snap)}
                                        />
                                    )}
                                    <FadePresetControl
                                        fadeInEnabled={scene.fadeIn ?? (isSetup || isReHook)} fadeInPreset={rf.inPreset} fadeInDuration={rf.inDur}
                                        fadeOutEnabled={scene.fadeOut ?? (idx === 0 || isReHook)} fadeOutPreset={rf.outPreset} fadeOutDuration={rf.outDur}
                                        defaultSide={isSetup || isReHook ? 'in' : 'out'}
                                        inHint={rf.inMode === 'micro' ? 'ANCHOR HOOK' : '🎬 ACT BREAK'}
                                        outHint={rf.outMode === 'micro' ? 'ANCHOR HOOK' : '🎬 ACT BREAK'}
                                        isCardActive={isSceneActive}
                                        onUpdate={(patch) => updateScene(idx, patch)} />
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
                                        aria-label="Scene media override URL"
                                        placeholder="Override URL or upload clip/photo..."
                                        value={scene.mediaUrl || ''}
                                        onChange={(e) => updateScene(idx, { mediaUrl: e.target.value || undefined, mediaName: undefined })}
                                        style={{ flex: 1, minWidth: 0, fontSize: '9.5px', color: 'var(--ui-text)', background: 'transparent', border: 'none' }}
                                    />
                                    <label className="tpe-upload-label" style={{ cursor: 'pointer', fontSize: '9px', fontWeight: 800, color: 'var(--ui-accent)', padding: '2px 6px', borderRadius: '4px', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)', whiteSpace: 'nowrap' }} title="Upload custom video or photo for this angle">
                                        UPLOAD
                                        <input type="file" className="tpe-sr-only" accept="video/*,image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleSceneMediaUpload(idx, f); e.target.value = ''; }} />
                                    </label>
                                    {scene.mediaUrl && (
                                        <button type="button" aria-label="Revert to master clip" onClick={() => updateScene(idx, { mediaUrl: undefined, mediaName: undefined })} className="tpe-asset-btn tpe-asset-btn-danger" style={{ width: '18px', height: '18px', fontSize: '10px', padding: 0 }} title="Revert to master clip">✕</button>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                <TimelineFooterCards
                    sceneCount={scenes.length} enableOutro={Boolean(draft.enableOutro)} outroDuration={draft.outroDuration}
                    outroCta={draft.outroCta} outroStart={outroStart} isOutroActive={isOutroActive}
                    onAddAngle={handleAddScene} onSeekOutro={seekTo}
                />
            </div>
        </aside>
    );
};
