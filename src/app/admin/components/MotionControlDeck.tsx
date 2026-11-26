"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    VideoDraft,
    StarSpinCue,
    StarSpinMode,
    StarSequenceMode,
    StarHoldFeel,
    DEFAULT_STAR_CUES,
    formatTimecode,
} from "@/types/news";
import { generateShortId } from "@/utils/idUtils";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";
import { ChevronLeftIcon, ChevronRightIcon } from "@/components/icons/TPEIcons";
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

type MotionAssetTab = 'logo' | 'wordmark' | 'text';

const ASSET_TABS: readonly { id: MotionAssetTab; label: string; title: string }[] = [
    { id: 'logo', label: 'LOGO', title: 'Configure P. logo spin cues and star motion' },
    { id: 'wordmark', label: 'WORDMARK', title: 'Toggle initial 0.6s PAKISTAN / EDIT wordmark wipe reveal' },
    { id: 'text', label: 'TEXT FX', title: 'Toggle kinetic headline slide-in and // slash pulse' },
];

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

const toCleanStepSeconds = (ms: number): number => Number(((Math.round(ms / 50) * 50) / 1000).toFixed(2));

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
    const masterMotionOn = draft.enableMotion !== false;
    const wordmarkOn = masterMotionOn && draft.motionWordmark !== false;
    const textOn = masterMotionOn && draft.motionText !== false;
    const logoOn = masterMotionOn && draft.enableLogo !== false;
    const [activeAsset, setActiveAsset] = useState<MotionAssetTab | null>(null);
    const addCueBtnRef = useRef<HTMLButtonElement>(null);

    const rawCues = draft.starCues ?? DEFAULT_STAR_CUES;
    const isLogoOpen = activeAsset === 'logo';
    const sortedCues = useMemo(
        () => (isLogoOpen ? rawCues.toSorted((a, b) => a.time - b.time) : rawCues),
        [isLogoOpen, rawCues]
    );

    const parkedCue = useMemo(
        () => (isLogoOpen && !isPlaying ? sortedCues.find((c) => Math.abs(c.time - activeDisplayTime) <= 0.08) : undefined),
        [isLogoOpen, isPlaying, sortedCues, activeDisplayTime]
    );

    const activeDisplayTimeRef = useRef(activeDisplayTime);
    const latestRef = useRef({ draft, onUpdateDraft, onSeekTo, activeDisplayTime });
    useLayoutEffect(() => {
        activeDisplayTimeRef.current = activeDisplayTime;
        latestRef.current = { draft, onUpdateDraft, onSeekTo, activeDisplayTime };
    });

    useEffect(() => {
        if (!isPlaying || !isLogoOpen || !logoOn || !liveClock) return;
        let lastStr = "";
        const setBtnText = (label: string) => {
            const btn = addCueBtnRef.current;
            if (!btn) return;
            if (btn.firstChild) btn.firstChild.nodeValue = label;
            else btn.textContent = label;
        };
        const sync = (t: number) => {
            const label = `+ ★ AT ${formatTimecode(t)}`;
            if (label !== lastStr) {
                lastStr = label;
                setBtnText(label);
            }
        };
        sync(liveClock.getTime());
        const unsub = liveClock.subscribe((frame) => sync(frame.time));
        return () => {
            unsub();
            setBtnText(`+ ★ AT ${formatTimecode(activeDisplayTimeRef.current)}`);
        };
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

    const onSelectSequence = useCallback((v: number) => {
        const nextMode = SEQUENCE_MODES[v]?.mode ?? 'star-crescent';
        const { draft: d, onUpdateDraft: update } = latestRef.current;
        if ((d.starSequence ?? 'star-crescent') !== nextMode) update({ ...d, starSequence: nextMode });
    }, []);
    const onSelectHoldFeel = useCallback((v: number) => {
        const nextFeel = HOLD_FEEL_MODES[v]?.mode ?? 'drift';
        const { draft: d, onUpdateDraft: update } = latestRef.current;
        if ((d.starHoldFeel ?? 'drift') !== nextFeel) update({ ...d, starHoldFeel: nextFeel });
    }, []);
    const onSelectSpinStyle = useCallback((v: number) => {
        const nextSpin = SPIN_MODES[v]?.mode ?? 'ccw';
        const { draft: d, onUpdateDraft: update } = latestRef.current;
        if ((d.starSpinMode ?? 'ccw') !== nextSpin) update({ ...d, starSpinMode: nextSpin });
    }, []);
    const onChangeMorph = useCallback((ms: number) => {
        const nextDur = toCleanStepSeconds(ms);
        const { draft: d, onUpdateDraft: update } = latestRef.current;
        if ((d.starMorphDuration ?? 0.45) !== nextDur) update({ ...d, starMorphDuration: nextDur });
    }, []);
    const onChangeHold = useCallback((ms: number) => {
        const nextDur = toCleanStepSeconds(ms);
        const { draft: d, onUpdateDraft: update } = latestRef.current;
        if ((d.starHoldDuration ?? 0.5) !== nextDur) update({ ...d, starHoldDuration: nextDur });
    }, []);
    const onChangeScale = useCallback((pct: number) => {
        const { draft: d, onUpdateDraft: update } = latestRef.current;
        if (Math.round(d.starScale ?? 100) !== pct) update({ ...d, starScale: pct });
    }, []);

    const addCueAtTime = (targetTime: number) => {
        if (!Number.isFinite(targetTime)) return;
        const rounded = Math.max(0, Math.round(targetTime * 100) / 100);
        const existing = sortedCues.find((c) => Math.abs(c.time - rounded) <= 0.08);
        if (existing) {
            if (Math.abs(existing.time - activeDisplayTime) > 0.005) onSeekTo(existing.time);
            return;
        }
        const nextCue: StarSpinCue = {
            id: `star-${generateShortId()}`,
            time: rounded,
        };
        const nextCues = [...rawCues, nextCue].toSorted((a, b) => a.time - b.time);
        onUpdateDraft({ ...draft, starCues: nextCues });
    };

    const removeCue = (id: string) => {
        onUpdateDraft({ ...draft, starCues: rawCues.filter((c) => c.id !== id) });
    };

    const toggleChannel = (channel: MotionAssetTab) => {
        const nextWordmark = channel === 'wordmark' ? !wordmarkOn : wordmarkOn;
        const nextText = channel === 'text' ? !textOn : textOn;
        const nextLogo = channel === 'logo' ? !logoOn : logoOn;
        onUpdateDraft({
            ...draft,
            motionWordmark: nextWordmark,
            motionText: nextText,
            enableLogo: nextLogo,
            enableMotion: nextWordmark || nextText || nextLogo,
        });
    };

    const simpleChannel = activeAsset === 'wordmark'
        ? { id: 'wordmark' as const, heading: 'WORDMARK MOTION', sub: '0.6s PAKISTAN / EDIT wipe reveal', enabled: wordmarkOn }
        : activeAsset === 'text'
            ? { id: 'text' as const, heading: 'TEXT MOTION', sub: 'Kinetic headline slide-in and // slash pulse', enabled: textOn }
            : null;

    return (
        <div className="tpe-flex-col tpe-motion-deck">
            {/* Row 1: Motion asset channel tabs */}
            <div className="tpe-flex-row tpe-motion-top-row">
                <div className="tpe-nested-action-row tpe-nested-capsule" role="group" aria-label="Motion assets">
                    {ASSET_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            aria-expanded={activeAsset === tab.id}
                            onClick={() => setActiveAsset((p) => (p === tab.id ? null : tab.id))}
                            className="tpe-mode-btn tpe-nested-action"
                            data-active={activeAsset === tab.id}
                            title={tab.title}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {simpleChannel && (
                <div className="tpe-flex-row tpe-motion-channel">
                    <div className="tpe-flex-col tpe-motion-channel-copy">
                        <span className="tpe-motion-channel-title">{simpleChannel.heading}</span>
                        <span className="tpe-motion-channel-sub">{simpleChannel.sub}</span>
                    </div>
                    <button
                        type="button"
                        aria-pressed={simpleChannel.enabled}
                        onClick={() => toggleChannel(simpleChannel.id)}
                        className="tpe-mode-btn tpe-motion-toggle"
                        data-active={simpleChannel.enabled}
                    >
                        {simpleChannel.enabled ? 'ON' : 'OFF'}
                    </button>
                </div>
            )}

            {isLogoOpen && (
                <>
                    <div className="tpe-flex-col tpe-motion-channel-stack">
                        <div className="tpe-flex-row tpe-motion-channel-head">
                            <div className="tpe-flex-col tpe-motion-channel-copy">
                                <span className="tpe-motion-channel-title">P. LOGO MOTION</span>
                                <span className="tpe-motion-channel-sub">Dot → 5-point star / crescent cues</span>
                            </div>
                            <button
                                type="button"
                                aria-pressed={logoOn}
                                onClick={() => toggleChannel('logo')}
                                className="tpe-mode-btn tpe-motion-toggle"
                                data-active={logoOn}
                            >
                                {logoOn ? 'ON' : 'OFF'}
                            </button>
                        </div>
                        {logoOn && (
                            <div className="tpe-flex-row tpe-motion-cue-bar">
                                {sortedCues.length > 1 && (
                                    <div className="tpe-mode-cluster" role="group" aria-label="Navigate star cues">
                                        <button type="button" aria-label="Jump to previous star cue" onClick={() => onJumpCue('prev')} className="tpe-cycle-arrow" title="Previous star cue"><ChevronLeftIcon /></button>
                                        <button type="button" aria-label="Jump to next star cue" onClick={() => onJumpCue('next')} className="tpe-cycle-arrow" title="Next star cue"><ChevronRightIcon /></button>
                                    </div>
                                )}
                                {parkedCue ? (
                                    <div className="tpe-flex-row tpe-tabular-nums tpe-motion-parked-pill">
                                        <span>★ AT {formatTimecode(parkedCue.time)}</span>
                                        <button type="button" aria-label={`Remove star spin cue at ${formatTimecode(parkedCue.time)}`} onClick={() => removeCue(parkedCue.id)} className="tpe-motion-parked-remove" title="Remove star spin cue at playhead">✕</button>
                                    </div>
                                ) : (
                                    <button ref={addCueBtnRef} type="button" onClick={() => addCueAtTime(isPlaying && liveClock ? liveClock.getTime() : activeDisplayTime)} className="tpe-mode-btn tpe-tabular-nums tpe-motion-add-cue" title="Trigger P. dot → 5-point star → dot animation at the current playhead timestamp">{`+ ★ AT ${formatTimecode(activeDisplayTime)}`}</button>
                                )}
                                {!hasHookCue && <button type="button" onClick={() => addCueAtTime(0)} className="tpe-mode-btn tpe-motion-quick-cue" title="Add star spin cue at 01. Hook start (00:00.0)">+ 0s</button>}
                                {storyStart > 0.2 && !hasStoryCue && <button type="button" onClick={() => addCueAtTime(storyStart)} className="tpe-mode-btn tpe-tabular-nums tpe-motion-quick-cue" title={`Add star spin cue right at 03. The Story start (${formatTimecode(storyStart)})`}>+ STORY</button>}
                                <button type="button" onClick={onPreviewStar} className="tpe-mode-btn tpe-motion-preview-btn" title="Preview the P. dot → 5-point star → dot animation live right now on the monitor">▶ TEST SPIN</button>
                            </div>
                        )}
                    </div>

                    {/* Active Star Cue Pills (if any scheduled) */}
                    {logoOn && sortedCues.length > 0 && (
                        <div className="tpe-flex-row tpe-motion-cue-bar">
                            <span className="tpe-motion-cues-label">STAR CUES:</span>
                            {sortedCues.map((cue) => {
                                const isNear = !isPlaying && Math.abs(cue.time - activeDisplayTime) <= 0.08;
                                return (
                                    <div key={cue.id} className="tpe-flex-row tpe-tabular-nums tpe-motion-cue-pill" data-near={isNear}>
                                        <button
                                            type="button"
                                            onClick={() => { if (Math.abs(cue.time - activeDisplayTime) > 0.005) onSeekTo(cue.time); }}
                                            title={`Seek to star cue at ${formatTimecode(cue.time)}`}
                                            className="tpe-motion-cue-jump"
                                        >
                                            ★ {formatTimecode(cue.time)}
                                        </button>
                                        <button
                                            type="button"
                                            aria-label={`Delete star cue at ${formatTimecode(cue.time)}`}
                                            onClick={() => removeCue(cue.id)}
                                            title="Delete cue"
                                            className="tpe-motion-cue-del"
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
                        <div className="tpe-flex-row tpe-motion-tuning-row">
                            <div className="tpe-flex-col tpe-kf-col">
                                <span className="tpe-motion-col-label">SEQUENCE</span>
                                <SnapCap ariaLabel="Emblem morph sequence" value={sequenceVal >= 0 ? sequenceVal : 0} options={SEQUENCE_SNAP_OPTIONS} onSelect={onSelectSequence} />
                            </div>
                            <div className="tpe-flex-col tpe-kf-col">
                                <span className="tpe-motion-col-label">HOLD FEEL</span>
                                <SnapCap ariaLabel="Hold motion feel" value={holdFeelVal >= 0 ? holdFeelVal : 0} options={HOLD_FEEL_SNAP_OPTIONS} onSelect={onSelectHoldFeel} />
                            </div>
                            <div className="tpe-flex-col tpe-kf-col">
                                <span className="tpe-motion-col-label">SPIN STYLE</span>
                                <SnapCap ariaLabel="Star rotation style" value={spinVal >= 0 ? spinVal : 0} options={SPIN_SNAP_OPTIONS} onSelect={onSelectSpinStyle} />
                            </div>

                            <ScrubPillSlider
                                label="MORPH"
                                value={morphMs}
                                min={200}
                                max={1500}
                                step={50}
                                unit="ms"
                                width="110px"
                                height="20px"
                                title="Dot -> Star morph & spin speed in milliseconds (default 450ms)"
                                onChange={onChangeMorph}
                            />

                            <ScrubPillSlider
                                label="HOLD"
                                value={holdMs}
                                min={0}
                                max={2500}
                                step={50}
                                unit="ms"
                                width="106px"
                                height="20px"
                                title="How long the 5-point star holds its silhouette before spinning back into the dot"
                                onChange={onChangeHold}
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
                                onChange={onChangeScale}
                            />
                        </div>
                    )}
                </>
            )}
        </div>
    );
});

MotionControlDeck.displayName = "MotionControlDeck";
