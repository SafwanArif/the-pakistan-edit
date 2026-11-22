"use client";

import React, { useState } from "react";
import { formatTimecode, parseTimeInput } from "../../../types/news";

const DIAMOND_BASE_STYLE: React.CSSProperties = {
    display: 'inline-block',
    width: '7px',
    height: '7px',
    borderRadius: '1.5px',
    transform: 'rotate(45deg)',
    flexShrink: 0,
};
const DIAMOND_STYLES: Record<'snap' | 'glide', React.CSSProperties> = {
    snap: { ...DIAMOND_BASE_STYLE, background: 'linear-gradient(135deg, var(--ui-pre) 48%, var(--ui-accent) 52%)' },
    glide: { ...DIAMOND_BASE_STYLE, background: 'var(--ui-accent)' },
};

export const KeyDiamondGlyph: React.FC<{ kind: 'snap' | 'glide' }> = React.memo(({ kind }) => (
    <span aria-hidden="true" style={DIAMOND_STYLES[kind]} />
));
KeyDiamondGlyph.displayName = "KeyDiamondGlyph";

export const SnapCap: React.FC<{
    ariaLabel: string;
    value: number;
    options: { label: string; val: number; title: string }[];
    onSelect: (val: number) => void;
}> = React.memo(({ ariaLabel, value, options, onSelect }) => (
    <div
        className="tpe-mode-cluster"
        role="group"
        aria-label={ariaLabel}
        style={{ padding: '1px', display: 'grid', gridTemplateColumns: `repeat(${options.length}, 1fr)`, gap: '1px' }}
    >
        {options.map((opt) => {
            const active = Math.round(value) === opt.val;
            return (
                <button
                    key={opt.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onSelect(opt.val)}
                    className="tpe-mode-btn"
                    data-active={active}
                    style={{ padding: '1px 4px', fontSize: '7.5px', justifyContent: 'center' }}
                    title={opt.title}
                >
                    {opt.label}
                </button>
            );
        })}
    </div>
));
SnapCap.displayName = "SnapCap";

export const KeyframeTimeChip: React.FC<{
    prefix: string;
    time: number;
    active: boolean;
    accentColor: string;
    title: string;
    onSelect?: () => void;
    onCommitTime?: (nextTime: number) => void;
    onNudgeTime?: (deltaFrames: number) => void;
}> = React.memo(({ prefix, time, active, accentColor, title, onSelect, onCommitTime, onNudgeTime }) => {
    const [editingText, setEditingText] = useState<string | null>(null);

    if (editingText !== null && onCommitTime) {
        return (
            <input
                type="text"
                inputMode="decimal"
                autoFocus
                aria-label={`${prefix} timestamp`}
                className="tpe-tabular-nums"
                value={editingText}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => {
                    const parsed = parseTimeInput(editingText);
                    if (parsed !== null) onCommitTime(parsed);
                    setEditingText(null);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                    if (e.key === 'Escape') setEditingText(null);
                }}
                style={{ width: '84px', height: '20px', textAlign: 'center', fontSize: '9px', fontFamily: 'monospace', fontWeight: 900, color: '#050505', background: accentColor, border: '1px solid #fff', borderRadius: '4px', padding: '0 4px' }}
            />
        );
    }

    return (
        <div
            className="tpe-flex-row tpe-tabular-nums"
            style={{
                alignItems: 'center', gap: '3px', height: '20px', padding: '0 6px', borderRadius: '4px',
                background: active ? accentColor : 'rgba(255,255,255,0.06)',
                border: `1px solid ${active ? accentColor : 'var(--ui-border)'}`,
                color: active ? '#050505' : 'var(--ui-text-dim)',
                fontSize: '8.5px', fontWeight: 900, letterSpacing: '0.05em', whiteSpace: 'nowrap',
            }}
        >
            <button
                type="button"
                aria-pressed={active}
                onClick={onSelect}
                title={title}
                style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', font: 'inherit', letterSpacing: 'inherit', cursor: onSelect ? 'pointer' : 'default' }}
            >
                {prefix}
            </button>
            <span style={{ opacity: 0.45 }}>@</span>
            <button
                type="button"
                onClick={() => setEditingText(formatTimecode(time))}
                title="Click to edit timestamp"
                style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', font: 'inherit', fontFamily: 'monospace', cursor: 'text', textDecoration: 'underline dotted' }}
            >
                {formatTimecode(time)}
            </button>
            {onNudgeTime && (
                <>
                    <button type="button" aria-label={`Nudge ${prefix} keyframe back one frame`} onClick={() => onNudgeTime(-1)} title="Nudge back one frame" style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', font: 'inherit', lineHeight: 1, cursor: 'pointer' }}>‹</button>
                    <button type="button" aria-label={`Nudge ${prefix} keyframe forward one frame`} onClick={() => onNudgeTime(1)} title="Nudge forward one frame" style={{ background: 'transparent', border: 'none', padding: 0, color: 'inherit', font: 'inherit', lineHeight: 1, cursor: 'pointer' }}>›</button>
                </>
            )}
        </div>
    );
});
KeyframeTimeChip.displayName = "KeyframeTimeChip";
