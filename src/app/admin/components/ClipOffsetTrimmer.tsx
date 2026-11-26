"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { formatTimecode, parseTimeInput } from "@/types/news";
import { stopEventPropagation } from "../utils/domUtils";

type NudgeSpec = readonly [label: string, delta: number];
const NEG_NUDGES: readonly NudgeSpec[] = [['-1s', -1], ['-.1', -0.1]];
const POS_NUDGES: readonly NudgeSpec[] = [['+.1', 0.1], ['+1s', 1]];

/** Shared Hook / Re-Hook glyph using the native Segoe UI Emoji PNG for desktop/mobile parity. */
export const HookGlyph: React.FC<{ role: 'hook' | 'rehook'; className?: string; style?: React.CSSProperties }> = React.memo(({ role, className, style }) => (
    <span className={className ? `tpe-hook-glyph ${className}` : "tpe-hook-glyph"} data-role={role} style={style}>
        <Image src="/assets/icons/hook-emoji.png" alt="" aria-hidden="true" width={16} height={16} unoptimized draggable={false} className="tpe-hook-glyph-img" />
    </span>
));
HookGlyph.displayName = "HookGlyph";

const MODE_LABELS = {
    hook: { title: <><HookGlyph role="hook" /> HOOK IN-POINT</>, cta: 'SET AS HOOK' },
    rehook: { title: <><HookGlyph role="rehook" /> RE-HOOK IN-POINT</>, cta: 'SET RE-HOOK' },
    setup: { title: '🎬 STORY CLIP START', cta: 'SET STORY START' },
} as const;

interface ClipOffsetTrimmerProps {
    sceneIdx: number;
    mode: 'hook' | 'rehook' | 'setup';
    clipStartOffset?: number;
    sceneDuration: number;
    currentMediaTime: number;
    isCardActive?: boolean;
    onSetOffset: (sceneIdx: number, nextOffset?: number, snapToStart?: boolean) => void;
}

/** Precision clip start-point trimmer for 01. The Hook, 02. Re-Hook, and 03. The Story. */
export const ClipOffsetTrimmer: React.FC<ClipOffsetTrimmerProps> = React.memo(({
    sceneIdx, mode, clipStartOffset, sceneDuration, currentMediaTime, isCardActive = false, onSetOffset,
}) => {
    const hasOffset = typeof clipStartOffset === "number" && Number.isFinite(clipStartOffset);
    const safeOffset = hasOffset ? Math.max(0, clipStartOffset) : 0;
    const isHook = mode !== 'setup';
    const [draftText, setDraftText] = useState<string | null>(null);
    const cancelEditRef = useRef(false);

    const renderNudges = (nudges: readonly NudgeSpec[]) =>
        nudges.map(([label, delta]) => (
            <button
                key={label}
                type="button"
                disabled={delta < 0 && safeOffset <= 0}
                aria-label={`Nudge ${label}`}
                title={`Nudge ${label}`}
                className="tpe-asset-btn tpe-offset-nudge-btn"
                onClick={() => {
                    const next = Math.round(Math.max(0, safeOffset + delta) * 10) / 10;
                    if (next !== safeOffset) onSetOffset(sceneIdx, next, true);
                }}
            >
                {label}
            </button>
        ));

    return (
        <div onClick={stopEventPropagation} className="tpe-offset-trimmer" data-active={isCardActive} data-has-offset={hasOffset}>
            <div className="tpe-flex-row tpe-offset-header">
                <span className="tpe-flex-row tpe-offset-label">{MODE_LABELS[mode].title}</span>
                {hasOffset && (
                    <button
                        type="button"
                        aria-label="Reset clip start offset to 00:00.0"
                        title="Reset to clip start (00:00.0)"
                        className="tpe-asset-btn tpe-offset-reset"
                        onClick={() => { cancelEditRef.current = false; setDraftText(null); onSetOffset(sceneIdx, undefined, true); }}
                    >
                        ↺
                    </button>
                )}
            </div>

            <div className="tpe-flex-row tpe-offset-controls">
                {hasOffset ? (
                    <div className="tpe-offset-nudges">
                        {renderNudges(NEG_NUDGES)}
                        <input
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="done"
                            spellCheck={false}
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            aria-label="Clip start offset timecode"
                            title="Type seconds (e.g. 19.7) or MM:SS.d (e.g. 00:19.7)"
                            className="tpe-tabular-nums tpe-offset-input"
                            value={draftText ?? formatTimecode(safeOffset)}
                            onFocus={(e) => { cancelEditRef.current = false; setDraftText(formatTimecode(safeOffset)); e.currentTarget.select(); }}
                            onChange={(e) => setDraftText(e.target.value)}
                            onBlur={() => {
                                if (cancelEditRef.current) { cancelEditRef.current = false; setDraftText(null); return; }
                                if (draftText !== null) {
                                    const parsed = parseTimeInput(draftText);
                                    if (parsed !== null && Math.abs(parsed - safeOffset) > 0.001) onSetOffset(sceneIdx, parsed, true);
                                }
                                setDraftText(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                else if (e.key === 'Escape') { cancelEditRef.current = true; setDraftText(null); e.currentTarget.blur(); }
                            }}
                        />
                        {renderNudges(POS_NUDGES)}
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            className="tpe-nav-btn tpe-offset-set-btn"
                            title="Capture the current monitor timestamp as the start point"
                            onClick={() => onSetOffset(sceneIdx, Number.isFinite(currentMediaTime) ? currentMediaTime : 0, true)}
                        >
                            🎯 {MODE_LABELS[mode].cta} ({formatTimecode(currentMediaTime)})
                        </button>
                        <span className="tpe-offset-hint">Scrub monitor & click Set</span>
                    </>
                )}
            </div>

            {hasOffset && (
                <div className="tpe-offset-summary">
                    {isHook ? 'Hook clip:' : 'Starts at:'} <strong>{formatTimecode(safeOffset)}</strong>
                    {isHook && <> → <strong>{formatTimecode(safeOffset + sceneDuration)}</strong></>}
                </div>
            )}
        </div>
    );
});
ClipOffsetTrimmer.displayName = "ClipOffsetTrimmer";
