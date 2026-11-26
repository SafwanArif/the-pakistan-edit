"use client";

import React, { useEffect, useState } from "react";
import { FadePresetMode, TimelineScene, VideoDraft, resolveSceneFade, isSharedReHookScene, getVideoHeadingPreset, getDefaultVideoFraming, timelineTimeToMediaTime } from "@/types/news";
import { PowerIcon } from "@/components/icons/TPEIcons";
import { detectFaceInHookWindow, getCachedFaceScan } from "../utils/autoTrackSubject";
import { stopEventPropagation } from "../utils/domUtils";

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
    { id: 'auto', label: 'AUTO', title: 'Boundary-aware 2026–2027 default (Micro-Dip on Anchored Hook, Editorial Dip on Story/Angles)' },
    { id: 'micro', label: 'MICRO', title: '4–5 frame subliminal B-roll / pattern-interrupt dip (0.06s / 0.08s)' },
    { id: 'editorial', label: 'EDIT', title: 'Asymmetric 0.30s editorial act-break dip (0.12s / 0.18s)' },
];

const IMAGE_URL_RE = /^data:image\/|\.(?:png|jpe?g|webp|avif|gif)(?:[?#]|$)/i;

export const FadePresetControl: React.FC<FadePresetControlProps> = React.memo(({
    sceneIdx, fadeInEnabled, fadeInPreset, fadeInDuration, fadeOutEnabled, fadeOutPreset, fadeOutDuration, defaultSide = 'out', inHint, outHint, isCardActive = false, onUpdate,
}) => {
    const [side, setSide] = useState<'in' | 'out'>(defaultSide);
    const isIn = side === 'in';
    const enabled = isIn ? fadeInEnabled : fadeOutEnabled;
    const activePreset = isIn ? fadeInPreset : fadeOutPreset;
    const duration = isIn ? fadeInDuration : fadeOutDuration;
    const activeHint = isIn ? inHint : outHint;

    const sideOptions = [
        { id: 'in' as const, label: 'IN', selected: isIn, on: fadeInEnabled, title: `Fade In from black (${fadeInEnabled ? 'ON' : 'OFF'})` },
        { id: 'out' as const, label: 'OUT', selected: !isIn, on: fadeOutEnabled, title: `Fade Out to black (${fadeOutEnabled ? 'ON' : 'OFF'})` },
    ];

    return (
        <div
            onClick={stopEventPropagation}
            title="2026–2027 Fade Presets (or OFF for 0.00s hard cut)"
            className="tpe-fade-control"
            data-enabled={enabled}
            data-active={isCardActive}
        >
            <div className="tpe-fade-header">
                <div className="tpe-fade-head-left">
                    <span className="tpe-fade-title">🌑 FADE</span>
                    <div className="tpe-mode-cluster tpe-fade-side-cluster" role="group" aria-label="Fade side">
                        {sideOptions.map((opt) => (
                            <button
                                key={opt.id}
                                type="button"
                                aria-pressed={opt.selected}
                                onClick={() => setSide(opt.id)}
                                className="tpe-mode-btn tpe-fade-side-btn"
                                data-active={opt.selected}
                                title={opt.title}
                            >
                                {opt.label}
                                <span aria-hidden="true" className="tpe-fade-dot" data-on={opt.on} data-selected={opt.selected} />
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    type="button"
                    aria-pressed={enabled}
                    aria-label={enabled ? "Fade Active (click to Hard Cut 0.00s)" : "Hard Cut 0.00s (click to enable Fade)"}
                    className="tpe-asset-btn tpe-fade-power"
                    data-active={enabled}
                    onClick={() => onUpdate(sceneIdx, isIn ? { fadeIn: !fadeInEnabled } : { fadeOut: !fadeOutEnabled })}
                    title={enabled ? "Fade Active (click to Hard Cut 0.00s)" : "Hard Cut 0.00s (click to enable Fade)"}
                >
                    <PowerIcon />
                </button>
            </div>
            {enabled ? (
                <div className="tpe-mode-cluster tpe-fade-presets">
                    {FADE_PRESETS.map((p) => (
                        <button
                            key={p.id}
                            type="button"
                            aria-pressed={activePreset === p.id}
                            onClick={() => {
                                if (activePreset !== p.id) onUpdate(sceneIdx, isIn ? { fadeInPreset: p.id } : { fadeOutPreset: p.id });
                            }}
                            className="tpe-mode-btn tpe-fade-preset-btn"
                            data-active={activePreset === p.id}
                            title={p.title}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>
            ) : (
                <span className="tpe-fade-hardcut">Hard cut (0.00s)</span>
            )}
            <div className="tpe-fade-footer">
                {activeHint ? <span>{activeHint}:</span> : <span>Duration:</span>}
                <strong className="tpe-tabular-nums">{enabled ? `${duration.toFixed(2)}s` : '0.00s'}</strong>
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

interface SceneCheckItem {
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
        const isImageHook = scene.mediaType === 'image' || IMAGE_URL_RE.test(hookSrc);
        const faceDone = typeof options?.faceDetected === 'boolean';
        const faceLabel = !hookSrc
            ? '0.5s face / eye-contact trigger (no video)'
            : isImageHook
                ? '0.5s face / eye-contact trigger (photo hook — verify visually)'
                : faceDone
                    ? (options?.faceDetected ? '0.5s face / eye-contact trigger detected' : 'No face in first 0.5s (higher scroll-past risk)')
                    : 'Scanning first 0.5s for face...';
        const hasOpenLoop = /\?|:|—|"|'|%|£|\$|\d|\b(why|how|never|only|first|secret|truth|actually|would|could|unless|before)\b/i.test(titleStr);
        const titleLead = titleStr.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).slice(0, 3).join(' ');
        const subLead = subStr.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(/\s+/).slice(0, 3).join(' ');
        const nonRedundant = Boolean(titleLead && subLead && titleLead !== subLead);
        const resolvedHookFade = resolveSceneFade(draft.scenes || [], 0);
        const instantSpeech = hasSubs && draft.subtitles!.some(s => s.end > hookStart && s.start <= hookStart + 0.65);
        const highlightTokens = (titleStr.match(/(==|~~|\^\^|&&|\*\*)[\s\S]+?\1/g) || []).length;
        const cleanEmphasis = highlightTokens >= 1 && highlightTokens <= 3;

        return [
            { ok: scene.duration >= 3 && scene.duration <= 5, label: `3–5s scroll-stop gate (${scene.duration}s)`, fix: update ? () => update({ duration: 4 }) : undefined, fixLabel: 'Set 4s' },
            { ok: faceDone ? Boolean(options?.faceDetected) : false, label: faceLabel },
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
        const rehookMediaStart = timelineTimeToMediaTime(draft, hook0?.duration ?? 0);
        const hasVisualShift = Boolean(scene.mediaUrl) || rehookMediaStart !== hook1Offset;
        const resolved = resolveSceneFade(draft.scenes || [], 1);
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

/** Card-specific social retention checklist popover for 01. The Hook, 02. Re-Hook, and 03. The Story. */
export const SceneChecklistPopover: React.FC<SceneChecklistPopoverProps> = React.memo(({
    sceneMode, scene, draft, sceneBounds, onUpdateScene,
}) => {
    const [faceScan, setFaceScan] = useState<{ key: string; detected: boolean } | null>(null);
    const hookSrc = scene.mediaUrl || draft.videoUrl || '';
    const hookStart = scene.clipStartOffset ?? 0;
    const isVideoHook = sceneMode === 'hook' && Boolean(hookSrc) && scene.mediaType !== 'image' && !IMAGE_URL_RE.test(hookSrc);
    const scanKey = `${hookSrc}@${hookStart}`;
    const cachedScan = isVideoHook ? getCachedFaceScan(hookSrc, hookStart) : undefined;

    useEffect(() => {
        if (!isVideoHook || cachedScan !== undefined) return;
        const controller = new AbortController();
        const timer = setTimeout(() => {
            void detectFaceInHookWindow(hookSrc, hookStart, controller.signal)
                .then((detected) => {
                    if (!controller.signal.aborted) setFaceScan({ key: scanKey, detected });
                })
                .catch(() => { /* aborted or unsupported codec */ });
        }, 350);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [isVideoHook, hookSrc, hookStart, scanKey, cachedScan]);

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
        <div role="dialog" aria-label={checklistTitle} onClick={stopEventPropagation} className="tpe-scene-checklist">
            <div className="tpe-scene-checklist-title tpe-tabular-nums">
                {checklistTitle} ({checks.filter((c) => c.ok).length}/{checks.length})
            </div>
            {checks.map((c, idx) => (
                <div key={idx} className="tpe-flex-row tpe-scene-checklist-row" data-ok={c.ok}>
                    <span>{c.ok ? '✓' : '○'} {c.label}</span>
                    {!c.ok && c.fix && (
                        <button type="button" onClick={c.fix} className="tpe-asset-btn tpe-scene-checklist-fix">
                            {c.fixLabel}
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
});
SceneChecklistPopover.displayName = "SceneChecklistPopover";
