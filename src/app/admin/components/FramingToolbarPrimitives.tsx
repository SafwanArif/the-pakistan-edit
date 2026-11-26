"use client";

import React, { useRef, useState } from "react";
import { formatPreciseTimecode, parseTimeInput } from "@/types/news";

export const CONTAIN_ZOOM_OPTIONS = [
    { label: 'CONTAIN', val: 0, title: 'Contain: preserve the full 4:5 frame (0%)' },
    { label: 'FILL', val: 100, title: 'Fill: cover the 4:5 frame edge to edge (100%)' },
];
export const PAN_SNAP_OPTIONS = [
    { label: 'LEFT', val: 0, title: 'Snap Pan Left (0%)' },
    { label: 'CTR', val: 50, title: 'Snap Pan Center (50%)' },
    { label: 'RIGHT', val: 100, title: 'Snap Pan Right (100%)' },
];
export const POS_Y_SNAP_OPTIONS = [
    { label: 'TOP', val: 100, title: 'Snap to Top edge (100%)' },
    { label: 'CTR', val: 50, title: 'Snap to Vertical Center (50%)' },
    { label: 'BTM', val: 0, title: 'Snap to Bottom edge (0%)' },
];

export const KeyDiamondGlyph: React.FC<{ kind: 'snap' | 'glide' }> = React.memo(({ kind }) => (
    <span aria-hidden="true" className="tpe-key-diamond" data-kind={kind} />
));
KeyDiamondGlyph.displayName = "KeyDiamondGlyph";

export const SnapCap: React.FC<{
    ariaLabel: string;
    value: number;
    options: { label: string; val: number; title: string }[];
    onSelect: (val: number) => void;
}> = React.memo(({ ariaLabel, value, options, onSelect }) => (
    <div
        className="tpe-mode-cluster tpe-snap-cap"
        role="group"
        aria-label={ariaLabel}
        style={{ gridTemplateColumns: `repeat(${options.length}, 1fr)` }}
    >
        {options.map((opt) => {
            const active = Math.round(value) === opt.val;
            return (
                <button
                    key={opt.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => { if (!active) onSelect(opt.val); }}
                    className="tpe-mode-btn tpe-snap-cap-btn"
                    data-active={active}
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
    const cancelEditRef = useRef(false);
    const timeBtnRef = useRef<HTMLButtonElement>(null);

    const restoreFocus = () => {
        requestAnimationFrame(() => timeBtnRef.current?.focus());
    };

    const accentVar = { "--chip-accent": accentColor } as React.CSSProperties;

    if (editingText !== null && onCommitTime) {
        return (
            <input
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
                aria-label={`${prefix} timestamp`}
                className="tpe-tabular-nums tpe-kf-chip-input"
                style={accentVar}
                value={editingText}
                onFocus={(e) => { cancelEditRef.current = false; e.currentTarget.select(); }}
                onChange={(e) => setEditingText(e.target.value)}
                onBlur={() => {
                    if (cancelEditRef.current) {
                        cancelEditRef.current = false;
                        setEditingText(null);
                        return;
                    }
                    const parsed = parseTimeInput(editingText);
                    if (parsed !== null && Math.abs(parsed - time) > 0.0001) onCommitTime(parsed);
                    setEditingText(null);
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                        e.currentTarget.blur();
                        restoreFocus();
                    } else if (e.key === 'Escape') {
                        cancelEditRef.current = true;
                        setEditingText(null);
                        restoreFocus();
                    }
                }}
            />
        );
    }

    const formatted = formatPreciseTimecode(time);

    return (
        <div className="tpe-flex-row tpe-tabular-nums tpe-kf-chip" data-active={active} style={accentVar}>
            {onSelect ? (
                <button
                    type="button"
                    aria-pressed={active}
                    onClick={onSelect}
                    title={title}
                    className="tpe-kf-chip-btn"
                >
                    {prefix}
                </button>
            ) : (
                <span title={title}>{prefix}</span>
            )}
            <span className="tpe-kf-chip-at" aria-hidden="true">@</span>
            {onCommitTime ? (
                <button
                    ref={timeBtnRef}
                    type="button"
                    aria-label={`Edit ${prefix} timestamp`}
                    onClick={() => setEditingText(formatted)}
                    title="Click to edit timestamp"
                    className="tpe-kf-chip-time"
                >
                    {formatted}
                </button>
            ) : (
                <span className="tpe-kf-chip-time-static">{formatted}</span>
            )}
            {onNudgeTime && (
                <>
                    <button
                        type="button"
                        disabled={time <= 0.0005}
                        aria-label={`Nudge ${prefix} keyframe back one frame`}
                        onClick={() => onNudgeTime(-1)}
                        title="Nudge back one frame"
                        className="tpe-kf-chip-nudge"
                    >
                        ‹
                    </button>
                    <button
                        type="button"
                        aria-label={`Nudge ${prefix} keyframe forward one frame`}
                        onClick={() => onNudgeTime(1)}
                        title="Nudge forward one frame"
                        className="tpe-kf-chip-nudge"
                    >
                        ›
                    </button>
                </>
            )}
        </div>
    );
});
KeyframeTimeChip.displayName = "KeyframeTimeChip";
