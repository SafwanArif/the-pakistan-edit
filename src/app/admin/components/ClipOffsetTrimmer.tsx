"use client";

import React, { useState } from "react";
import { formatTimecode, parseTimeInput } from "../../../types/news";

const HOOK_NUDGES = [
    { label: '-1s', delta: -1, title: 'Nudge -1s' },
    { label: '-.1', delta: -0.1, title: 'Nudge -0.1s' },
    { label: '+.1', delta: 0.1, title: 'Nudge +0.1s' },
    { label: '+1s', delta: 1, title: 'Nudge +1s' },
];
const nudgeBtnStyle: React.CSSProperties = { width: '22px', height: '20px', fontSize: '9px', padding: 0 };
const trimmerHeaderRowStyle: React.CSSProperties = { justifyContent: 'space-between', alignItems: 'center' };
const trimmerHeaderLabelStyle: React.CSSProperties = { fontSize: '9px', fontWeight: 900, color: 'var(--ui-accent)', letterSpacing: '0.08em', alignItems: 'center', gap: '4px' };
const trimmerResetBtnStyle: React.CSSProperties = { width: '18px', height: '18px', fontSize: '11px', padding: 0, lineHeight: 1 };
const trimmerControlsRowStyle: React.CSSProperties = { alignItems: 'center', justifyContent: 'space-between', gap: '6px', flexWrap: 'wrap' };

/** Shared Hook / Re-Hook emoji glyph so mirroring and gold styling stay unified across cards and timelines. */
export const HookGlyph: React.FC<{ role: 'hook' | 'rehook'; style?: React.CSSProperties }> = ({ role, style }) => (
    <span
        style={{
            display: 'inline-block',
            lineHeight: 1,
            transform: role === 'hook' ? 'scaleX(-1)' : undefined,
            filter: 'drop-shadow(0 0 4px oklch(from var(--ui-accent) l c h / 0.65))',
            ...style,
        }}
    >
        🪝
    </span>
);

interface ClipOffsetTrimmerProps {
    sceneIdx: number;
    mode: 'hook' | 'rehook' | 'setup';
    clipStartOffset?: number;
    sceneDuration: number;
    currentMediaTime: number;
    isCardActive?: boolean;
    onSetOffset: (sceneIdx: number, nextOffset?: number, snapToStart?: boolean) => void;
}

/** Precision clip start-point trimmer for 01 The Hook, 02 Re-Hook, and The Setup. */
export const ClipOffsetTrimmer: React.FC<ClipOffsetTrimmerProps> = React.memo(({
    sceneIdx,
    mode,
    clipStartOffset,
    sceneDuration,
    currentMediaTime,
    isCardActive = false,
    onSetOffset,
}) => {
    const hasOffset = clipStartOffset !== undefined;
    const isHook = mode === 'hook' || mode === 'rehook';
    const [draftText, setDraftText] = useState<string | null>(null);
    const headerLabel = mode === 'hook'
        ? <><HookGlyph role="hook" /> HOOK IN-POINT</>
        : (mode === 'rehook' ? <><HookGlyph role="rehook" /> RE-HOOK IN-POINT</> : '🎬 STORY CLIP START');
    const setBtnLabel = mode === 'hook' ? 'SET AS HOOK' : (mode === 'rehook' ? 'SET RE-HOOK' : 'SET STORY START');

    return (
        <div
            onClick={(e) => e.stopPropagation()}
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
                    <button type="button" onClick={() => onSetOffset(sceneIdx, undefined, true)} className="tpe-asset-btn" style={trimmerResetBtnStyle} title="Reset to clip start (00:00.0)">
                        ↺
                    </button>
                )}
            </div>

            <div className="tpe-flex-row" style={trimmerControlsRowStyle}>
                {hasOffset ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                        {HOOK_NUDGES.slice(0, 2).map(n => (
                            <button key={n.label} type="button" onClick={() => onSetOffset(sceneIdx, Math.max(0, clipStartOffset + n.delta), true)} className="tpe-asset-btn" style={nudgeBtnStyle} title={n.title}>{n.label}</button>
                        ))}
                        <input
                            type="text"
                            aria-label="Clip start offset timecode"
                            value={draftText ?? formatTimecode(clipStartOffset)}
                            onFocus={(e) => { setDraftText(formatTimecode(clipStartOffset)); e.currentTarget.select(); }}
                            onChange={(e) => setDraftText(e.target.value)}
                            onBlur={() => {
                                if (draftText !== null) {
                                    const parsed = parseTimeInput(draftText);
                                    if (parsed !== null) onSetOffset(sceneIdx, parsed, true);
                                }
                                setDraftText(null);
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') e.currentTarget.blur();
                                if (e.key === 'Escape') { setDraftText(null); e.currentTarget.blur(); }
                            }}
                            title="Type seconds (e.g. 19.7) or MM:SS.d (e.g. 00:19.7)"
                            className="tpe-tabular-nums"
                            style={{ width: '52px', textAlign: 'center', fontFamily: 'monospace', fontSize: '11px', fontWeight: 900, color: 'var(--ui-accent)', paddingInline: '3px', background: 'rgba(0,0,0,0.5)', borderRadius: '3px', border: '1px solid oklch(from var(--ui-accent) l c h / 0.3)' }}
                        />
                        {HOOK_NUDGES.slice(2).map(n => (
                            <button key={n.label} type="button" onClick={() => onSetOffset(sceneIdx, Math.max(0, clipStartOffset + n.delta), true)} className="tpe-asset-btn" style={nudgeBtnStyle} title={n.title}>{n.label}</button>
                        ))}
                    </div>
                ) : (
                    <>
                        <button type="button" onClick={() => onSetOffset(sceneIdx, currentMediaTime, true)} className="tpe-nav-btn" style={{ padding: '3px 8px', fontSize: '9px', fontWeight: 900, background: 'var(--ui-accent)', color: '#000', border: 'none', borderRadius: '4px', cursor: 'pointer', letterSpacing: '0.02em' }} title="Capture the current monitor timestamp as the start point">
                            🎯 {setBtnLabel} ({formatTimecode(currentMediaTime)})
                        </button>
                        <span style={{ fontSize: '9px', color: 'var(--ui-text-dim)', fontStyle: 'italic' }}>Scrub monitor & click Set</span>
                    </>
                )}
            </div>

            {hasOffset && (
                <div style={{ fontSize: '9px', color: 'var(--ui-text-dim)' }}>
                    {isHook ? 'Hook clip:' : 'Starts at:'} <strong style={{ color: 'var(--ui-text)' }}>{formatTimecode(clipStartOffset)}</strong>{isHook ? <> → <strong style={{ color: 'var(--ui-text)' }}>{formatTimecode(clipStartOffset + sceneDuration)}</strong></> : null}
                </div>
            )}
        </div>
    );
});
ClipOffsetTrimmer.displayName = "ClipOffsetTrimmer";
