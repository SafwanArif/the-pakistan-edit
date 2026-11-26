"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { formatTimecode, parseTimeInput } from "@/types/news";
import { stopEventPropagation } from "../utils/domUtils";

type NudgeSpec = readonly [label: string, delta: number];
const NEG_NUDGES: readonly NudgeSpec[] = [['-1s', -1], ['-.1', -0.1]];
const POS_NUDGES: readonly NudgeSpec[] = [['+.1', 0.1], ['+1s', 1]];

const nudgeBtnStyle: React.CSSProperties = { width: '22px', height: '20px', fontSize: '9px', padding: 0 };
const headerRowStyle: React.CSSProperties = { justifyContent: 'space-between', alignItems: 'center' };
const headerLabelStyle: React.CSSProperties = { fontSize: '9px', fontWeight: 900, color: 'var(--ui-accent)', letterSpacing: '0.08em', alignItems: 'center', gap: '4px' };
const resetBtnStyle: React.CSSProperties = { width: '18px', height: '18px', fontSize: '11px', padding: 0, lineHeight: 1 };
const controlsRowStyle: React.CSSProperties = { alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' };
const nudgeGroupStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '2px' };
const offsetInputStyle: React.CSSProperties = { width: '52px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 900, color: 'var(--ui-accent)', paddingInline: '3px', background: 'rgba(0,0,0,0.5)', borderRadius: '3px', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)' };
const setBtnStyle: React.CSSProperties = { padding: '3px 8px', fontSize: '9px', fontWeight: 900, background: 'var(--ui-accent)', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', letterSpacing: '0.02em' };
const hintTextStyle: React.CSSProperties = { fontSize: '9px', color: 'var(--ui-text-dim)', fontStyle: 'italic' };
const summaryRowStyle: React.CSSProperties = { fontSize: '9px', color: 'var(--ui-text-dim)' };
const summaryStrongStyle: React.CSSProperties = { color: 'var(--ui-text)' };
const shellBaseStyle: React.CSSProperties = { padding: '8px 10px', borderRadius: '8px', borderWidth: '1px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '6px', minWidth: 0 };

const rehookSpanStyle: React.CSSProperties = { display: 'inline-block', lineHeight: 1, filter: 'drop-shadow(0 0 4px oklch(from var(--ui-accent) l c h / 0.65))' };
const hookSpanStyle: React.CSSProperties = { ...rehookSpanStyle, transform: 'scaleX(-1)' };
const hookImgStyle: React.CSSProperties = { display: 'inline-block', width: '1.333em', height: '1.333em', verticalAlign: '-0.22em', objectFit: 'contain', pointerEvents: 'none' };

/** Shared Hook / Re-Hook glyph using the native Segoe UI Emoji PNG for desktop/mobile parity. */
export const HookGlyph: React.FC<{ role: 'hook' | 'rehook'; style?: React.CSSProperties }> = React.memo(({ role, style }) => {
    const base = role === 'hook' ? hookSpanStyle : rehookSpanStyle;
    return (
        <span style={style ? { ...base, ...style } : base}>
            <Image src="/assets/icons/hook-emoji.png" alt="" aria-hidden="true" width={16} height={16} unoptimized draggable={false} style={hookImgStyle} />
        </span>
    );
});
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
                className="tpe-asset-btn"
                style={nudgeBtnStyle}
                onClick={() => {
                    const next = Math.round(Math.max(0, safeOffset + delta) * 10) / 10;
                    if (next !== safeOffset) onSetOffset(sceneIdx, next, true);
                }}
            >
                {label}
            </button>
        ));

    return (
        <div
            onClick={stopEventPropagation}
            style={{
                ...shellBaseStyle,
                background: hasOffset ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                borderStyle: isCardActive ? 'solid' : 'dashed',
                borderColor: hasOffset ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.14)',
            }}
        >
            <div className="tpe-flex-row" style={headerRowStyle}>
                <span className="tpe-flex-row" style={headerLabelStyle}>{MODE_LABELS[mode].title}</span>
                {hasOffset && (
                    <button
                        type="button"
                        aria-label="Reset clip start offset to 00:00.0"
                        title="Reset to clip start (00:00.0)"
                        className="tpe-asset-btn"
                        style={resetBtnStyle}
                        onClick={() => { cancelEditRef.current = false; setDraftText(null); onSetOffset(sceneIdx, undefined, true); }}
                    >
                        ↺
                    </button>
                )}
            </div>

            <div className="tpe-flex-row" style={controlsRowStyle}>
                {hasOffset ? (
                    <div style={nudgeGroupStyle}>
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
                            className="tpe-tabular-nums"
                            style={offsetInputStyle}
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
                            className="tpe-nav-btn"
                            style={setBtnStyle}
                            title="Capture the current monitor timestamp as the start point"
                            onClick={() => onSetOffset(sceneIdx, Number.isFinite(currentMediaTime) ? currentMediaTime : 0, true)}
                        >
                            🎯 {MODE_LABELS[mode].cta} ({formatTimecode(currentMediaTime)})
                        </button>
                        <span style={hintTextStyle}>Scrub monitor & click Set</span>
                    </>
                )}
            </div>

            {hasOffset && (
                <div style={summaryRowStyle}>
                    {isHook ? 'Hook clip:' : 'Starts at:'} <strong style={summaryStrongStyle}>{formatTimecode(safeOffset)}</strong>
                    {isHook && <> → <strong style={summaryStrongStyle}>{formatTimecode(safeOffset + sceneDuration)}</strong></>}
                </div>
            )}
        </div>
    );
});
ClipOffsetTrimmer.displayName = "ClipOffsetTrimmer";
