"use client";

import React, { useEffect, useState } from "react";
import { FadePresetMode, TimelineScene, VideoDraft, resolveSceneFade, isSharedReHookScene, getVideoHeadingPreset, getDefaultVideoFraming } from "../../../types/news";
import { PowerIcon } from "../../../components/icons/TPEIcons";
import { detectFaceInHookWindow, getCachedFaceScan } from "../utils/autoTrackSubject";

interface FadePresetControlProps {
    sceneIdx: number;
    fadeInEnabled: boolean;
    fadeInPreset: FadePresetMode;
    fadeInDuration: number;
    fadeOutEnabled: boolean;
    fadeOutPreset: FadePresetMode;
    fadeOutDuration: number;
    defaultSide?: 'in' | 'out';
    inHint?: string;
    outHint?: string;
    isCardActive?: boolean;
    onUpdate: (sceneIdx: number, patch: Partial<TimelineScene>) => void;
}

const FADE_PRESETS: { id: FadePresetMode; label: string; title: string }[] = [
    { id: 'auto', label: 'AUTO', title: 'Boundary-aware 2026–2027 default (Micro-Dip on Anchored Hook, Editorial Dip on Setup/Angles)' },
    { id: 'micro', label: 'MICRO', title: '4–5 frame subliminal B-roll / pattern-interrupt dip (0.06s / 0.08s)' },
    { id: 'editorial', label: 'EDIT', title: 'Asymmetric 0.30s editorial act-break dip (0.12s / 0.18s)' },
];

export const FadePresetControl: React.FC<FadePresetControlProps> = React.memo(({
    sceneIdx, fadeInEnabled, fadeInPreset, fadeInDuration, fadeOutEnabled, fadeOutPreset, fadeOutDuration, defaultSide = 'out', inHint, outHint, isCardActive = false, onUpdate
}) => {
    const [side, setSide] = useState<'in' | 'out'>(defaultSide);
    const isIn = side === 'in';
    const enabled = isIn ? fadeInEnabled : fadeOutEnabled;
    const activePreset = isIn ? fadeInPreset : fadeOutPreset;
    const duration = isIn ? fadeInDuration : fadeOutDuration;
    const activeHint = isIn ? inHint : outHint;

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            title="2026–2027 Fade Presets (or OFF for 0.00s hard cut)"
            style={{
                padding: '8px 10px',
                borderRadius: '8px',
                background: enabled ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                borderWidth: '1px',
                borderStyle: isCardActive ? 'solid' : 'dashed',
                borderColor: enabled ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.14)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '6px',
                minWidth: 0,
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                    <span style={{ fontSize: '9px', fontWeight: 900, color: 'var(--ui-accent)', letterSpacing: '0.08em', whiteSpace: 'nowrap' }}>
                        🌑 FADE
                    </span>
                    <div className="tpe-mode-cluster" role="group" aria-label="Fade side" style={{ padding: '1px', gap: '2px' }}>
                        <button type="button" aria-pressed={isIn} onClick={() => setSide('in')} className="tpe-mode-btn" data-active={isIn} style={{ padding: '1px 6px', fontSize: '8px', gap: '3px' }} title={`Fade In from black (${fadeInEnabled ? 'ON' : 'OFF'})`}>
                            IN
                            <span aria-hidden="true" style={{ width: '4px', height: '4px', borderRadius: '50%', background: fadeInEnabled ? (isIn ? 'currentColor' : 'var(--ui-indicator)') : 'transparent', border: fadeInEnabled ? 'none' : '1px solid currentColor', opacity: fadeInEnabled ? 1 : 0.35 }} />
                        </button>
                        <button type="button" aria-pressed={!isIn} onClick={() => setSide('out')} className="tpe-mode-btn" data-active={!isIn} style={{ padding: '1px 6px', fontSize: '8px', gap: '3px' }} title={`Fade Out to black (${fadeOutEnabled ? 'ON' : 'OFF'})`}>
                            OUT
                            <span aria-hidden="true" style={{ width: '4px', height: '4px', borderRadius: '50%', background: fadeOutEnabled ? (!isIn ? 'currentColor' : 'var(--ui-indicator)') : 'transparent', border: fadeOutEnabled ? 'none' : '1px solid currentColor', opacity: fadeOutEnabled ? 1 : 0.35 }} />
                        </button>
                    </div>
                </div>
                <button
                    type="button"
                    aria-pressed={enabled}
                    aria-label={enabled ? "Fade Active (click to Hard Cut 0.00s)" : "Hard Cut 0.00s (click to enable Fade)"}
                    className="tpe-asset-btn"
                    data-active={enabled}
                    onClick={() => onUpdate(sceneIdx, isIn ? { fadeIn: !fadeInEnabled } : { fadeOut: !fadeOutEnabled })}
                    style={{ width: '18px', height: '18px', padding: 0, lineHeight: 1 }}
                    title={enabled ? "Fade Active (click to Hard Cut 0.00s)" : "Hard Cut 0.00s (click to enable Fade)"}
                >
                    <PowerIcon />
                </button>
            </div>
            {enabled ? (
                <div className="tpe-mode-cluster" style={{ padding: '2px', gap: '2px', width: '100%', justifyContent: 'space-between' }}>
                    {FADE_PRESETS.map(p => (
                        <button
                            key={p.id}
                            type="button"
                            aria-pressed={activePreset === p.id}
                            onClick={() => onUpdate(sceneIdx, isIn ? { fadeInPreset: p.id } : { fadeOutPreset: p.id })}
                            className="tpe-mode-btn"
                            data-active={activePreset === p.id}
                            style={{ flex: 1, justifyContent: 'center', padding: '2px 4px', fontSize: '8px' }}
                            title={p.title}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            ) : (
                <span style={{ fontSize: '8.5px', color: 'var(--ui-text-dim)', fontStyle: 'italic' }}>Hard cut (0.00s)</span>
            )}
            <div style={{ fontSize: '9px', color: 'var(--ui-text-dim)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                {activeHint ? <span>{activeHint}:</span> : <span>Duration:</span>}
                <strong style={{ color: 'var(--ui-text)' }}>{enabled ? `${duration.toFixed(2)}s` : '0.00s'}</strong>
            </div>
        </div>
    );
});
FadePresetControl.displayName = "FadePresetControl";

interface SceneChecklistPopoverProps {
    sceneMode: 'hook' | 'rehook' | 'setup';
    scene: TimelineScene;
    draft: VideoDraft;
    sceneBounds?: { start: number; end: number };
    onUpdateScene: (patch: Partial<TimelineScene>) => void;
}

export interface SceneCheckItem {
    ok: boolean;
    label: string;
    fix?: () => void;
    fixLabel?: string;
}

/** Pure selector computing retention checklist items for Hook, Re-Hook, or Story scenes. */
export function getSceneCheckItems(
    sceneMode: 'hook' | 'rehook' | 'setup',
    scene: TimelineScene,
    draft: VideoDraft,
    options?: {
        sceneBounds?: { start: number; end: number };
        faceDetected?: boolean | null;
        onUpdateScene?: (patch: Partial<TimelineScene>) => void;
    }
): SceneCheckItem[] {
    const titleStr = (scene.title || '').trim();
    const subStr = (scene.subtitle || '').trim();
    const titleWords = titleStr.split(/\s+/).filter(Boolean).length;
    const subWords = subStr.split(/\s+/).filter(Boolean).length;
    const hookSrc = scene.mediaUrl || draft.videoUrl || '';
    const hookStart = scene.clipStartOffset ?? 0;
    const hasSubs = Boolean(draft.subtitles?.length);
    const update = options?.onUpdateScene;

    if (sceneMode === 'hook') {
        const hasAnchorReHook = isSharedReHookScene(draft.scenes, 1);
        const hasMotionOrCut = hasAnchorReHook || (draft.keyframes || []).some(k => k.time <= 5) || getDefaultVideoFraming(draft, draft.aspectRatio).zoom !== (draft.aspectRatio === '4:5' ? 0 : 100);
        const faceDone = typeof options?.faceDetected === 'boolean';
        const hasOpenLoop = /\?|:|—|"|'|%|£|\$|\d|\b(why|how|never|only|first|secret|truth|actually|would|could|unless|before)\b/i.test(titleStr);
        const titleLead = titleStr.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 3).join(' ');
        const subLead = subStr.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 3).join(' ');
        const nonRedundant = Boolean(titleLead && subLead && titleLead !== subLead);
        const resolvedHookFade = resolveSceneFade(draft.scenes || [], 0);
        const instantSpeech = hasSubs && draft.subtitles!.some(s => s.end > hookStart && s.start <= hookStart + 0.65);
        const highlightTokens = (titleStr.match(/(==|~~|\^\^|&&|\*\*)[\s\S]+?\1/g) || []).length;
        const cleanEmphasis = highlightTokens >= 1 && highlightTokens <= 3;

        return [
            { ok: scene.duration >= 3 && scene.duration <= 5, label: `3–5s scroll-stop gate (${scene.duration}s)`, fix: update ? () => update({ duration: 4 }) : undefined, fixLabel: 'Set 4s' },
            { ok: faceDone ? Boolean(options?.faceDetected) : false, label: !hookSrc ? '0.5s face / eye-contact trigger (no video)' : (faceDone ? (options?.faceDetected ? '0.5s face / eye-contact trigger detected' : 'No face in first 0.5s (higher scroll-past risk)') : 'Scanning first 0.5s for face...') },
            { ok: hasSubs ? instantSpeech : Boolean(scene.clipStartOffset && scene.clipStartOffset > 0), label: hasSubs ? (instantSpeech ? 'Zero dead air: speech starts < 0.6s' : 'Dead air at Hook start (> 0.6s silence)') : 'Juicy clip in-point trimmed (no dead air)' },
            { ok: titleWords > 0 && titleWords <= 8, label: `2-second visual read (${titleWords}/8 words)` },
            { ok: hasOpenLoop, label: 'Open curiosity loop / stakes trigger (? " : — or #)' },
            { ok: subWords > 0 && subWords <= 14, label: `Deck adds context without clutter (${subWords}/14 words)` },
            { ok: nonRedundant, label: 'Headline (hook) & deck (context) are non-redundant' },
            { ok: cleanEmphasis, label: highlightTokens > 3 ? `Over-highlighted (${highlightTokens} spans — keep ≤ 3)` : 'Selective focal emphasis (1–3 highlighted spans)' },
            { ok: hasMotionOrCut, label: 'Pattern interrupt in 5s (Re-Hook cut or camera beat)' },
            { ok: !draft.isMuted && (draft.volume ?? 1) > 0, label: 'Native voice / room audio active (> 0%)' },
            { ok: resolvedHookFade.outEnabled && (hasAnchorReHook ? resolvedHookFade.outMode === 'micro' : resolvedHookFade.outMode === 'editorial'), label: hasAnchorReHook ? `Micro-dip exit (${resolvedHookFade.rawOutDur.toFixed(2)}s — Anchored Hook)` : `Editorial exit dip (${resolvedHookFade.rawOutDur.toFixed(2)}s)`, fix: update ? () => update({ fadeOut: true, fadeOutPreset: 'auto' }) : undefined, fixLabel: 'Set Auto' },
            { ok: draft.aspectRatio !== '9:16' || getVideoHeadingPreset(draft, '9:16') !== 'center', label: draft.aspectRatio === '9:16' && getVideoHeadingPreset(draft, '9:16') === 'center' ? 'Optical Center: verify headline clears speaker eyes' : 'Headline placement clears TikTok native UI' },
        ];
    }

    if (sceneMode === 'rehook') {
        const isAnchored = scene.shareHookText !== false;
        const hook0 = draft.scenes?.[0];
        const hook1Offset = hook0?.clipStartOffset ?? 0;
        const hasVisualShift = Boolean(scene.mediaUrl) || (scene.clipStartOffset !== undefined && scene.clipStartOffset !== hook1Offset);
        const resolved = resolveSceneFade(draft.scenes || [], 1);
        const rehookMediaStart = scene.clipStartOffset ?? (hook1Offset + (hook0?.duration ?? 0));
        const instantSpeech = hasSubs && draft.subtitles!.some(s => s.end > rehookMediaStart && s.start <= rehookMediaStart + 0.65);

        return [
            { ok: scene.duration >= 2 && scene.duration <= 5, label: `2–5s pattern-interrupt beat (${scene.duration}s)`, fix: update ? () => update({ duration: 4 }) : undefined, fixLabel: 'Set 4s' },
            { ok: hasVisualShift, label: hasVisualShift ? 'Visual cut / angle shift from Hook 01' : 'Set Re-Hook in-point or custom clip (mirrors Hook 01)' },
            { ok: hasSubs ? instantSpeech : Boolean(scene.clipStartOffset && scene.clipStartOffset > 0), label: hasSubs ? (instantSpeech ? 'Zero dead air: speech starts < 0.6s' : 'Dead air at Re-Hook start (> 0.6s silence)') : 'Juicy Re-Hook in-point trimmed' },
            { ok: isAnchored || (titleWords > 0 && titleWords <= 8), label: isAnchored ? 'Anchor Hook locked (zero headline flash)' : `Un-anchored headline concise (${titleWords}/8 words)`, fix: isAnchored || !update ? undefined : () => update({ shareHookText: true }), fixLabel: 'Lock' },
            { ok: resolved.inEnabled && (isAnchored ? resolved.inMode === 'micro' : resolved.inMode === 'editorial'), label: isAnchored ? `Micro-dip entry (${resolved.rawInDur.toFixed(2)}s — Anchored)` : `Editorial entry dip (${resolved.rawInDur.toFixed(2)}s)`, fix: update ? () => update({ fadeIn: true, fadeInPreset: 'auto' }) : undefined, fixLabel: 'Set Auto' },
            { ok: resolved.outEnabled && resolved.outMode === 'editorial', label: `Editorial exit to Story (${resolved.rawOutDur.toFixed(2)}s)`, fix: update ? () => update({ fadeOut: true, fadeOutPreset: 'auto' }) : undefined, fixLabel: 'Set Auto' },
        ];
    }

    const sceneBounds = options?.sceneBounds;
    const hasStoryBeat = Boolean(scene.mediaUrl) || Boolean(sceneBounds && (draft.keyframes || []).some(k => k.time > sceneBounds.start && k.time < sceneBounds.end));
    return [
        { ok: titleWords > 0 && titleWords <= 10, label: `Concise Story headline (${titleWords}/10 words)` },
        { ok: subWords >= 8 && subWords <= 24, label: `Context subheading depth (${subWords}/8–24 words)` },
        { ok: scene.duration >= 12 && scene.duration <= 30, label: `Golden attention pacing (${scene.duration}s / 12–30s)`, fix: update ? () => update({ duration: 24 }) : undefined, fixLabel: 'Set 24s' },
        { ok: scene.fadeIn !== false, label: 'Story fade-in from Hook enabled', fix: update ? () => update({ fadeIn: true }) : undefined, fixLabel: 'Enable' },
        { ok: Boolean((scene.clipStartOffset !== undefined && scene.clipStartOffset > 0) || scene.mediaUrl), label: 'Story clip start trimmed / custom media' },
        { ok: hasStoryBeat, label: 'Visual refresh / camera beat inside Story' },
    ];
}

/** Card-specific social retention checklist popover for 01 The Hook, 02 Re-Hook, and The Setup. */
export const SceneChecklistPopover: React.FC<SceneChecklistPopoverProps> = React.memo(({
    sceneMode, scene, draft, sceneBounds, onUpdateScene
}) => {
    const [faceScan, setFaceScan] = useState<{ key: string; detected: boolean } | null>(null);
    const hookSrc = scene.mediaUrl || draft.videoUrl || '';
    const hookStart = scene.clipStartOffset ?? 0;
    const scanKey = `${hookSrc}@${hookStart}`;
    const cachedScan = sceneMode === 'hook' && hookSrc ? getCachedFaceScan(hookSrc, hookStart) : undefined;

    useEffect(() => {
        if (sceneMode !== 'hook' || !hookSrc || cachedScan !== undefined) return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            void detectFaceInHookWindow(hookSrc, hookStart, controller.signal).then((detected) => {
                if (!controller.signal.aborted) setFaceScan({ key: scanKey, detected });
            });
        }, 350);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [sceneMode, hookSrc, hookStart, scanKey, cachedScan]);

    const checks = getSceneCheckItems(sceneMode, scene, draft, {
        sceneBounds,
        faceDetected: cachedScan ?? (faceScan?.key === scanKey ? faceScan.detected : null),
        onUpdateScene,
    });

    const checklistTitle = sceneMode === 'hook'
        ? '01. THE HOOK RETENTION CHECKLIST'
        : sceneMode === 'rehook'
            ? '02. RE-HOOK RETENTION CHECKLIST'
            : '03. THE STORY RETENTION CHECKLIST';

    return (
        <div role="dialog" aria-label={checklistTitle} onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', right: 0, top: '26px', width: 'min(320px, calc(100vw - 24px))', maxHeight: '320px', overflowY: 'auto', padding: '10px', borderRadius: '8px', background: 'var(--ui-bg-popover)', border: '1px solid var(--ui-accent)', boxShadow: '0 14px 36px rgba(0,0,0,0.85)', zIndex: 40, display: 'flex', flexDirection: 'column', gap: '5px' }}>
            <div style={{ fontSize: '9px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-accent)', borderBlockEnd: '1px solid var(--ui-border)', paddingBlockEnd: '4px' }}>
                {checklistTitle} ({checks.filter(c => c.ok).length}/{checks.length})
            </div>
            {checks.map((c) => (
                <div key={c.label} className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '6px', fontSize: '9.5px', color: c.ok ? 'var(--ui-indicator)' : 'var(--ui-text)' }}>
                    <span>{c.ok ? '✓' : '○'} {c.label}</span>
                    {!c.ok && c.fix && (
                        <button type="button" onClick={c.fix} className="tpe-asset-btn" style={{ padding: '1px 6px', height: '18px', fontSize: '8.5px', color: 'var(--ui-accent)', borderColor: 'var(--ui-accent)' }}>
                            {c.fixLabel}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
});
SceneChecklistPopover.displayName = "SceneChecklistPopover";
