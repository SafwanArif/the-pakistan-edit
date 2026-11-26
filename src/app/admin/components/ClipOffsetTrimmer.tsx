"use client";

import React, { useRef, useState } from "react";
import Image from "next/image";
import { formatTimecode, parseTimeInput } from "@/types/news";

const NEG_NUDGES = [
    { label: '-1s', delta: -1, title: 'Nudge -1s' },
    { label: '-.1', delta: -0.1, title: 'Nudge -0.1s' },
] as const;

const POS_NUDGES = [
    { label: '+.1', delta: 0.1, title: 'Nudge +0.1s' },
    { label: '+1s', delta: 1, title: 'Nudge +1s' },
] as const;

type NudgeOption = (typeof NEG_NUDGES)[number] | (typeof POS_NUDGES)[number];

const nudgeBtnStyle: React.CSSProperties = { width: '22px', height: '20px', fontSize: '9px', padding: 0 };
const trimmerHeaderRowStyle: React.CSSProperties = { justifyContent: 'space-between', alignItems: 'center' };
const trimmerHeaderLabelStyle: React.CSSProperties = { fontSize: '9px', fontWeight: 900, color: 'var(--ui-accent)', letterSpacing: '0.08em', alignItems: 'center', gap: '4px' };
const trimmerResetBtnStyle: React.CSSProperties = { width: '18px', height: '18px', fontSize: '11px', padding: 0, lineHeight: 1 };
const trimmerControlsRowStyle: React.CSSProperties = { alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' };
const nudgeGroupStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '2px' };
const offsetInputStyle: React.CSSProperties = {
    width: '52px',
    textAlign: 'center',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 900,
    color: 'var(--ui-accent)',
    paddingInline: '3px',
    background: 'rgba(0,0,0,0.5)',
    borderRadius: '3px',
    border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)',
};
const setOffsetBtnStyle: React.CSSProperties = {
    padding: '3px 8px',
    fontSize: '9px',
    fontWeight: 900,
    background: 'var(--ui-accent)',
    color: '#000',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    letterSpacing: '0.02em',
};
const hintTextStyle: React.CSSProperties = { fontSize: '9px', color: 'var(--ui-text-dim)', fontStyle: 'italic' };
const summaryRowStyle: React.CSSProperties = { fontSize: '9px', color: 'var(--ui-text-dim)' };
const summaryStrongStyle: React.CSSProperties = { color: 'var(--ui-text)' };

const hookSpanBaseStyle: React.CSSProperties = {
    display: 'inline-block',
    lineHeight: 1,
    transform: 'scaleX(-1)',
    filter: 'drop-shadow(0 0 4px oklch(from var(--ui-accent) l c h / 0.65))',
};
const rehookSpanBaseStyle: React.CSSProperties = {
    display: 'inline-block',
    lineHeight: 1,
    filter: 'drop-shadow(0 0 4px oklch(from var(--ui-accent) l c h / 0.65))',
};
const hookGlyphImgStyle: React.CSSProperties = {
    display: 'inline-block',
    width: '1.333em',
    height: '1.333em',
    verticalAlign: '-0.22em',
    objectFit: 'contain',
    pointerEvents: 'none',
};

const stopClickPropagation = (e: React.MouseEvent) => e.stopPropagation();

/** Shared Hook / Re-Hook glyph using the native desktop Segoe UI Emoji PNG for sub-pixel desktop/mobile parity. */
export const HookGlyph: React.FC<{ role: 'hook' | 'rehook'; style?: React.CSSProperties }> = React.memo(({ role, style }) => {
    const baseStyle = role === 'hook' ? hookSpanBaseStyle : rehookSpanBaseStyle;
    return (
        <span style={style ? { ...baseStyle, ...style } : baseStyle}>
            <Image
                src="/assets/icons/hook-emoji.png"
                alt=""
                aria-hidden="true"
                width={16}
                height={16}
                unoptimized
                draggable={false}
                style={hookGlyphImgStyle}
            />
        </span>
    );
});
HookGlyph.displayName = "HookGlyph";

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
    sceneIdx,
    mode,
    clipStartOffset,
    sceneDuration,
    currentMediaTime,
    isCardActive = false,
    onSetOffset,
}) => {
    const hasOffset = typeof clipStartOffset === "number" && Number.isFinite(clipStartOffset);
    const safeOffset = hasOffset ? Math.max(0, clipStartOffset) : 0;
    const isHook = mode === 'hook' || mode === 'rehook';
    const [draftText, setDraftText] = useState<string | null>(null);
    const cancelEditRef = useRef(false);

    const headerLabel = mode === 'hook'
        ? <><HookGlyph role="hook" /> HOOK IN-POINT</>
        : (mode === 'rehook' ? <><HookGlyph role="rehook" /> RE-HOOK IN-POINT</> : '🎬 STORY CLIP START');
    const setBtnLabel = mode === 'hook' ? 'SET AS HOOK' : (mode === 'rehook' ? 'SET RE-HOOK' : 'SET STORY START');

    const renderNudgeButtons = (nudges: readonly NudgeOption[]) =>
        nudges.map((n) => {
            const isAtFloor = n.delta < 0 && safeOffset <= 0;
            return (
                <button
                    key={n.label}
                    type="button"
                    disabled={isAtFloor}
                    aria-label={n.title}
                    onClick={() => {
                        const next = Math.round(Math.max(0, safeOffset + n.delta) * 10) / 10;
                        if (next !== safeOffset) onSetOffset(sceneIdx, next, true);
                    }}
                    className="tpe-asset-btn"
                    style={nudgeBtnStyle}
                    title={n.title}
                >
                    {n.label}
                </button>
            );
        });

    return (
        <div
            onClick={stopClickPropagation}
            style={{
                padding: '8px 10px',
                borderRadius: '8px',
                background: hasOffset ? 'rgba(255, 255, 255, 0.04)' : 'rgba(255, 255, 255, 0.02)',
                borderWidth: '1px',
                borderStyle: isCardActive ? 'solid' : 'dashed',
                borderColor: hasOffset ? 'rgba(255, 255, 255, 0.28)' : 'rgba(255, 255, 255, 0.14)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: '6px',
                minWidth: 0,
            }}
        >
            <div className="tpe-flex-row" style={trimmerHeaderRowStyle}>
                <span className="tpe-flex-row" style={trimmerHeaderLabelStyle}>
                    {headerLabel}
                </span>
                {hasOffset && (
                    <button
                        type="button"
                        aria-label="Reset clip start offset to 00:00.0"
                        onClick={() => {
                            cancelEditRef.current = false;
                            setDraftText(null);
                            onSetOffset(sceneIdx, undefined, true);
                        }}
                        className="tpe-asset-btn"
                        style={trimmerResetBtnStyle}
                        title="Reset to clip start (00:00.0)"
                    >
                        ↺
                    </button>
                )}
            </div>

            <div className="tpe-flex-row" style={trimmerControlsRowStyle}>
                {hasOffset ? (
                    <div style={nudgeGroupStyle}>
                        {renderNudgeButtons(NEG_NUDGES)}
                        <input
                            type="text"
                            inputMode="decimal"
                            enterKeyHint="done"
                            spellCheck={false}
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            aria-label="Clip start offset timecode"
                            value={draftText ?? formatTimecode(safeOffset)}
                            onFocus={(e) => {
                                cancelEditRef.current = false;
                                setDraftText(formatTimecode(safeOffset));
                                e.currentTarget.select();
                            }}
                            onChange={(e) => setDraftText(e.target.value)}
                            onBlur={() => {
                                if (cancelEditRef.current) {
                                    cancelEditRef.current = false;
                                    setDraftText(null);
                                    return;
                                }
                                if (draftText !== null) {
                                    const parsed = parseTimeInput(draftText);
                                    if (parsed !== null && Math.abs(parsed - safeOffset) > 0.001) {
                                        onSetOffset(sceneIdx, parsed, true);
                                    }
                                }
                                setDraftText(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                    cancelEditRef.current = true;
                                    setDraftText(null);
                                    e.currentTarget.blur();
                                }
                            }}
                            title="Type seconds (e.g. 19.7) or MM:SS.d (e.g. 00:19.7)"
                            className="tpe-tabular-nums"
                            style={offsetInputStyle}
                        />
                        {renderNudgeButtons(POS_NUDGES)}
                    </div>
                ) : (
                    <>
                        <button
                            type="button"
                            onClick={() => onSetOffset(sceneIdx, Number.isFinite(currentMediaTime) ? currentMediaTime : 0, true)}
                            className="tpe-nav-btn"
                            style={setOffsetBtnStyle}
                            title="Capture the current monitor timestamp as the start point"
                        >
                            🎯 {setBtnLabel} ({formatTimecode(currentMediaTime)})
                        </button>
                        <span style={hintTextStyle}>Scrub monitor & click Set</span>
                    </>
                )}
            </div>

            {hasOffset && (
                <div style={summaryRowStyle}>
                    {isHook ? 'Hook clip:' : 'Starts at:'} <strong style={summaryStrongStyle}>{formatTimecode(safeOffset)}</strong>{isHook ? <> → <strong style={summaryStrongStyle}>{formatTimecode(safeOffset + sceneDuration)}</strong></> : null}
                </div>
            )}
        </div>
    );
});
ClipOffsetTrimmer.displayName = "ClipOffsetTrimmer";
