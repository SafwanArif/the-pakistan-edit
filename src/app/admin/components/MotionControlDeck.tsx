"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
    VideoDraft,
    StarSpinCue,
    StarSpinMode,
    StarSequenceMode,
    StarHoldFeel,
    DEFAULT_STAR_CUES,
    formatTimecode,
} from "../../../types/news";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";
import { ChevronLeftIcon, ChevronRightIcon } from "../../../components/icons/TPEIcons";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { SnapCap } from "./FramingToolbarPrimitives";

interface MotionControlDeckProps {
    draft: VideoDraft;
    activeDisplayTime: number;
    isPlaying?: boolean;
    liveClock?: LivePlaybackClock;
    storyStart: number;
    onUpdateDraft: (draft: VideoDraft) => void;
    onSeekTo: (time: number) => void;
    onPreviewStar: () => void;
    onJumpCue: (dir: 'prev' | 'next') => void;
}

const SPIN_MODES: { mode: StarSpinMode; val: number; label: string; title: string }[] = [
    { mode: 'ccw', val: 0, label: 'CCW', title: 'Anti-clockwise spin (default Pakistan Flag emblem flow)' },
    { mode: 'flag-tilt', val: 1, label: 'TILT', title: 'Clockwise Pakistan Flag tilt spin' },
    { mode: 'cw-1x', val: 2, label: '1× CW', title: 'Classic clockwise spin' },
    { mode: 'cw-2x', val: 3, label: '2× FAST', title: 'Energetic double-spin' },
];
const SEQUENCE_MODES: { mode: StarSequenceMode; val: number; label: string; title: string }[] = [
    { mode: 'star-crescent', val: 0, label: '★ → ☾', title: 'Full Pakistan Flag emblem cycle: Dot → 5-point Star → Crescent → Dot' },
    { mode: 'star-only', val: 1, label: '★ ONLY', title: 'Fast cut: Dot → 5-point Star → Dot' },
    { mode: 'crescent-only', val: 2, label: '☾ ONLY', title: 'Crescent sting: Dot → Pakistan Flag Crescent → Dot' },
];
const HOLD_FEEL_MODES: { mode: StarHoldFeel; val: number; label: string; title: string }[] = [
    { mode: 'drift', val: 0, label: 'DRIFT', title: 'Subtle slow floating drift during Star and Crescent holds' },
    { mode: 'still', val: 1, label: 'STILL', title: 'Crisp full stop during holds before spinning to the next shape' },
];

const SPIN_SNAP_OPTIONS = SPIN_MODES.map(({ label, val, title }) => ({ label, val, title }));
const SEQUENCE_SNAP_OPTIONS = SEQUENCE_MODES.map(({ label, val, title }) => ({ label, val, title }));
const HOLD_FEEL_SNAP_OPTIONS = HOLD_FEEL_MODES.map(({ label, val, title }) => ({ label, val, title }));

/**
 * On-demand Motion & Flag-Star Control Deck allowing exact placement of P. dot -> 5-point star cues,
 * live preview testing, spin style/speed/hold/size tuning, and independent motion channel switches.
 */
export const MotionControlDeck: React.FC<MotionControlDeckProps> = React.memo(({
    draft,
    activeDisplayTime,
    isPlaying = false,
    liveClock,
    storyStart,
    onUpdateDraft,
    onSeekTo,
    onPreviewStar,
    onJumpCue,
}) => {
    const wordmarkOn = draft.motionWordmark !== false;
    const textOn = draft.motionText !== false;
    const [activeAsset, setActiveAsset] = useState<'logo' | 'wordmark' | 'text' | null>(null);
    const addCueBtnRef = useRef<HTMLButtonElement>(null);
    const logoOn = draft.enableLogo !== false;

    const rawCues = draft.starCues ?? DEFAULT_STAR_CUES;
    const isLogoOpen = activeAsset === 'logo';
    const sortedCues = useMemo(
        () => (isLogoOpen ? [...rawCues].sort((a, b) => a.time - b.time) : rawCues),
        [isLogoOpen, rawCues]
    );

    const parkedCue = useMemo(
        () => (isLogoOpen && !isPlaying ? sortedCues.find((c) => Math.abs(c.time - activeDisplayTime) <= 0.08) : undefined),
        [isLogoOpen, isPlaying, sortedCues, activeDisplayTime]
    );

    useEffect(() => {
        if (!isPlaying || !isLogoOpen || !logoOn || !liveClock) return;
        let lastStr = "";
        const sync = (t: number) => {
            const btn = addCueBtnRef.current;
            if (!btn) return;
            const label = `+ ★ AT ${formatTimecode(t)}`;
            if (label !== lastStr) {
                lastStr = label;
                if (btn.firstChild) btn.firstChild.nodeValue = label;
                else btn.textContent = label;
            }
        };
        sync(liveClock.getTime());
        return liveClock.subscribe((frame) => sync(frame.time));
    }, [isPlaying, isLogoOpen, logoOn, liveClock]);

    const hasHookCue = useMemo(
        () => (isLogoOpen ? sortedCues.some((c) => c.time <= 0.15) : false),
        [isLogoOpen, sortedCues]
    );
    const hasStoryCue = useMemo(
        () => (isLogoOpen && storyStart > 0.2 ? sortedCues.some((c) => Math.abs(c.time - storyStart) <= 0.15) : false),
        [isLogoOpen, sortedCues, storyStart]
    );

    const spinMode: StarSpinMode = draft.starSpinMode ?? 'ccw';
    const spinVal = isLogoOpen ? SPIN_MODES.findIndex((m) => m.mode === spinMode) : 0;
    const sequenceMode: StarSequenceMode = draft.starSequence ?? 'star-crescent';
    const sequenceVal = isLogoOpen ? SEQUENCE_MODES.findIndex((m) => m.mode === sequenceMode) : 0;
    const holdFeel: StarHoldFeel = draft.starHoldFeel ?? 'drift';
    const holdFeelVal = isLogoOpen ? HOLD_FEEL_MODES.findIndex((m) => m.mode === holdFeel) : 0;
    const morphMs = Math.round((draft.starMorphDuration ?? 0.45) * 1000);
    const holdMs = Math.round((draft.starHoldDuration ?? 0.5) * 1000);
    const starScale = Math.round(draft.starScale ?? 100);

    const addCueAtTime = (targetTime: number) => {
        const rounded = Math.max(0, Math.round(targetTime * 100) / 100);
        const existing = sortedCues.find((c) => Math.abs(c.time - rounded) <= 0.08);
        if (existing) {
            onSeekTo(existing.time);
            return;
        }
        const nextCue: StarSpinCue = {
            id: `star-${crypto.randomUUID().slice(0, 8)}`,
            time: rounded,
        };
        const nextCues = [...rawCues, nextCue].sort((a, b) => a.time - b.time);
        onUpdateDraft({ ...draft, starCues: nextCues });
    };

    const removeCue = (id: string) => {
        onUpdateDraft({ ...draft, starCues: rawCues.filter((c) => c.id !== id) });
    };

    return (
        <div
            className="tpe-flex-col"
            style={{
                width: '100%',
                maxWidth: '680px',
                gap: '6px',
            }}
        >
            {/* Row 1: Scheduled ★ Star Cues (WHEN) + Channel Switches */}
            <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                {/* Independent Motion Assets */}
                <div
                    className="tpe-nested-action-row tpe-nested-capsule"
                    role="group"
                    aria-label="Motion assets"
                >
                    <button
                        type="button"
                        aria-expanded={activeAsset === 'logo'}
                        onClick={() => setActiveAsset(p => p === 'logo' ? null : 'logo')}
                        className="tpe-mode-btn tpe-nested-action"
                        data-active={activeAsset === 'logo'}
                        title="Configure P. logo spin cues and star motion"
                    >
                        LOGO
                    </button>
                    <button
                        type="button"
                        aria-expanded={activeAsset === 'wordmark'}
                        onClick={() => setActiveAsset(p => p === 'wordmark' ? null : 'wordmark')}
                        className="tpe-mode-btn tpe-nested-action"
                        data-active={activeAsset === 'wordmark'}
                        title="Toggle initial 0.6s PAKISTAN / EDIT wordmark wipe reveal"
                    >
                        WORDMARK
                    </button>
                    <button
                        type="button"
                        aria-expanded={activeAsset === 'text'}
                        onClick={() => setActiveAsset(p => p === 'text' ? null : 'text')}
                        className="tpe-mode-btn tpe-nested-action"
                        data-active={activeAsset === 'text'}
                        title="Toggle kinetic headline slide-in and // slash pulse"
                    >
                        TEXT FX
                    </button>
                </div>
            </div>

            {activeAsset === 'wordmark' && (
                <div className="tpe-flex-row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '2px 4px' }}>
                    <div className="tpe-flex-col" style={{ gap: '2px' }}>
                        <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)' }}>WORDMARK MOTION</span>
                        <span style={{ fontSize: '8px', color: 'var(--ui-text-dim)' }}>0.6s PAKISTAN / EDIT wipe reveal</span>
                    </div>
                    <button
                        type="button"
                        aria-pressed={wordmarkOn}
                        onClick={() => {
                            const nextWordmark = !wordmarkOn;
                            onUpdateDraft({
                                ...draft,
                                motionWordmark: nextWordmark,
                                enableMotion: nextWordmark || textOn,
                            });
                        }}
                        className="tpe-mode-btn"
                        data-active={wordmarkOn}
                        style={{ padding: '3px 8px', fontSize: '8px' }}
                    >
                        {wordmarkOn ? 'ON' : 'OFF'}
                    </button>
                </div>
            )}

            {activeAsset === 'text' && (
                <div className="tpe-flex-row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', padding: '2px 4px' }}>
                    <div className="tpe-flex-col" style={{ gap: '2px' }}>
                        <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)' }}>TEXT MOTION</span>
                        <span style={{ fontSize: '8px', color: 'var(--ui-text-dim)' }}>Kinetic headline slide-in and // slash pulse</span>
                    </div>
                    <button
                        type="button"
                        aria-pressed={textOn}
                        onClick={() => {
                            const nextText = !textOn;
                            onUpdateDraft({
                                ...draft,
                                motionText: nextText,
                                enableMotion: nextText || wordmarkOn,
                            });
                        }}
                        className="tpe-mode-btn"
                        data-active={textOn}
                        style={{ padding: '3px 8px', fontSize: '8px' }}
                    >
                        {textOn ? 'ON' : 'OFF'}
                    </button>
                </div>
            )}

            {activeAsset === 'logo' && (
                <>
                    <div className="tpe-flex-col" style={{ gap: '6px', padding: '2px 4px' }}>
                        <div className="tpe-flex-row" style={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '6px' }}>
                            <div className="tpe-flex-col" style={{ gap: '2px' }}>
                                <span style={{ fontSize: '8px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)' }}>P. LOGO MOTION</span>
                                <span style={{ fontSize: '8px', color: 'var(--ui-text-dim)' }}>Dot → 5-point star / crescent cues</span>
                            </div>
                            <button
                                type="button"
                                aria-pressed={logoOn}
                                onClick={() => onUpdateDraft({ ...draft, enableLogo: !logoOn })}
                                className="tpe-mode-btn"
                                data-active={logoOn}
                                style={{ padding: '3px 8px', fontSize: '8px' }}
                            >
                                {logoOn ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        {logoOn && (
                            <div className="tpe-flex-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                                {sortedCues.length > 1 && (
                                    <div className="tpe-mode-cluster" role="group" aria-label="Navigate star cues">
                                        <button type="button" aria-label="Jump to previous star cue" onClick={() => onJumpCue('prev')} className="tpe-cycle-arrow" title="Previous star cue"><ChevronLeftIcon /></button>
                                        <button type="button" aria-label="Jump to next star cue" onClick={() => onJumpCue('next')} className="tpe-cycle-arrow" title="Next star cue"><ChevronRightIcon /></button>
                                    </div>
                                )}
                                {parkedCue ? (
                                    <div className="tpe-flex-row tpe-tabular-nums" style={{ alignItems: 'center', gap: '4px', padding: '2px 7px', borderRadius: '5px', background: 'oklch(from var(--ui-accent) l c h / 0.16)', border: '1px solid oklch(from var(--ui-accent) l c h / 0.5)', fontSize: '8.5px', fontWeight: 900, color: 'var(--ui-accent)' }}>
                                        <span>★ AT {formatTimecode(parkedCue.time)}</span>
                                        <button type="button" aria-label={`Remove star spin cue at ${formatTimecode(parkedCue.time)}`} onClick={() => removeCue(parkedCue.id)} style={{ background: 'transparent', border: 'none', padding: '0 2px', color: 'var(--ui-danger)', fontWeight: 900, cursor: 'pointer', lineHeight: 1 }} title="Remove star spin cue at playhead">✕</button>
                                    </div>
                                ) : (
                                    <button ref={addCueBtnRef} type="button" onClick={() => addCueAtTime(isPlaying && liveClock ? liveClock.getTime() : activeDisplayTime)} className="tpe-mode-btn tpe-tabular-nums" style={{ padding: '2px 7px', fontSize: '8.5px', color: 'var(--ui-accent)', border: '1px dashed oklch(from var(--ui-accent) l c h / 0.5)' }} title="Trigger P. dot → 5-point star → dot animation at the current playhead timestamp">{`+ ★ AT ${formatTimecode(activeDisplayTime)}`}</button>
                                )}
                                {!hasHookCue && <button type="button" onClick={() => addCueAtTime(0)} className="tpe-mode-btn" style={{ padding: '2px 6px', fontSize: '8px' }} title="Add star spin cue at 01. Hook start (00:00.0)">+ 0s</button>}
                                {storyStart > 0.2 && !hasStoryCue && <button type="button" onClick={() => addCueAtTime(storyStart)} className="tpe-mode-btn tpe-tabular-nums" style={{ padding: '2px 6px', fontSize: '8px' }} title={`Add star spin cue right at 03. The Story start (${formatTimecode(storyStart)})`}>+ STORY</button>}
                                <button type="button" onClick={onPreviewStar} className="tpe-mode-btn" style={{ padding: '2px 7px', fontSize: '8.5px', fontWeight: 900, background: 'oklch(from var(--ui-accent) l c h / 0.14)', border: '1px solid oklch(from var(--ui-accent) l c h / 0.45)', color: 'var(--ui-accent)' }} title="Preview the P. dot → 5-point star → dot animation live right now on the monitor">▶ TEST SPIN</button>
                            </div>
                        )}
                    </div>

                    {/* Active Star Cue Pills (if any scheduled) */}
            {logoOn && sortedCues.length > 0 && (
                <div className="tpe-flex-row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '4px' }}>
                    <span style={{ fontSize: '7.5px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-text-dim)', marginInlineEnd: '2px' }}>
                        STAR CUES:
                    </span>
                    {sortedCues.map((cue) => {
                        const isNear = Math.abs(cue.time - activeDisplayTime) <= 0.08;
                        return (
                            <div
                                key={cue.id}
                                className="tpe-flex-row tpe-tabular-nums"
                                style={{
                                    alignItems: 'center',
                                    gap: '3px',
                                    padding: '1px 5px',
                                    borderRadius: '4px',
                                    background: isNear ? 'oklch(from var(--ui-accent) l c h / 0.2)' : 'rgba(255,255,255,0.04)',
                                    border: `1px solid ${isNear ? 'var(--ui-accent)' : 'var(--ui-border)'}`,
                                    fontSize: '8px',
                                    fontFamily: 'monospace',
                                    fontWeight: 800,
                                    color: isNear ? 'var(--ui-accent)' : 'var(--ui-text)',
                                }}
                            >
                                <button
                                    type="button"
                                    onClick={() => onSeekTo(cue.time)}
                                    title={`Seek to star cue at ${formatTimecode(cue.time)}`}
                                    style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}
                                >
                                    ★ {formatTimecode(cue.time)}
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Delete star cue at ${formatTimecode(cue.time)}`}
                                    onClick={() => removeCue(cue.id)}
                                    title="Delete cue"
                                    style={{ background: 'transparent', border: 'none', padding: '0 1px', color: 'var(--ui-text-dim)', fontSize: '9px', lineHeight: 1, cursor: 'pointer' }}
                                >
                                    ×
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Row 2: Sequence, Hold Feel, Spin Style, Morph Speed, Hold Time, Size (HOW) */}
            {logoOn && (
            <div className="tpe-flex-row" style={{ justifyContent: 'center', alignItems: 'flex-end', flexWrap: 'wrap', gap: '8px', paddingBlockStart: '2px', borderBlockStart: '1px solid var(--ui-border)' }}>
                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <span style={{ fontSize: '7.5px', fontWeight: 800, letterSpacing: '0.07em', color: 'var(--ui-text-dim)' }}>SEQUENCE</span>
                    <SnapCap
                        ariaLabel="Emblem morph sequence"
                        value={sequenceVal >= 0 ? sequenceVal : 0}
                        options={SEQUENCE_SNAP_OPTIONS}
                        onSelect={(v) => onUpdateDraft({ ...draft, starSequence: SEQUENCE_MODES[v]?.mode ?? 'star-crescent' })}
                    />
                </div>

                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <span style={{ fontSize: '7.5px', fontWeight: 800, letterSpacing: '0.07em', color: 'var(--ui-text-dim)' }}>HOLD FEEL</span>
                    <SnapCap
                        ariaLabel="Hold motion feel"
                        value={holdFeelVal >= 0 ? holdFeelVal : 0}
                        options={HOLD_FEEL_SNAP_OPTIONS}
                        onSelect={(v) => onUpdateDraft({ ...draft, starHoldFeel: HOLD_FEEL_MODES[v]?.mode ?? 'drift' })}
                    />
                </div>

                <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'stretch' }}>
                    <span style={{ fontSize: '7.5px', fontWeight: 800, letterSpacing: '0.07em', color: 'var(--ui-text-dim)' }}>SPIN STYLE</span>
                    <SnapCap
                        ariaLabel="Star rotation style"
                        value={spinVal >= 0 ? spinVal : 0}
                        options={SPIN_SNAP_OPTIONS}
                        onSelect={(v) => onUpdateDraft({ ...draft, starSpinMode: SPIN_MODES[v]?.mode ?? 'ccw' })}
                    />
                </div>

                <ScrubPillSlider
                    label="MORPH"
                    value={morphMs}
                    min={200}
                    max={1500}
                    unit="ms"
                    width="110px"
                    height="20px"
                    title="Dot -> Star morph & spin speed in milliseconds (default 500ms)"
                    onChange={(ms) => onUpdateDraft({ ...draft, starMorphDuration: Math.round(ms / 50) * 0.05 })}
                />

                <ScrubPillSlider
                    label="HOLD"
                    value={holdMs}
                    min={0}
                    max={2500}
                    unit="ms"
                    width="106px"
                    height="20px"
                    title="How long the 5-point star holds its silhouette before spinning back into the dot"
                    onChange={(ms) => onUpdateDraft({ ...draft, starHoldDuration: Math.round(ms / 50) * 0.05 })}
                />

                <ScrubPillSlider
                    label="SIZE"
                    value={starScale}
                    min={75}
                    max={160}
                    unit="%"
                    width="98px"
                    height="20px"
                    title="5-point star expansion size relative to default"
                    onChange={(pct) => onUpdateDraft({ ...draft, starScale: pct })}
                />
            </div>
            )}
                </>
            )}
        </div>
    );
});

MotionControlDeck.displayName = "MotionControlDeck";
