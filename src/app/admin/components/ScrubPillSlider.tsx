"use client";

import React, { useRef, useState } from "react";
import { clamp } from "@/types/news";
import { isPrimaryPointer, safeReleasePointerCapture, safeSetPointerCapture } from "../utils/domUtils";
import { useBufferedInput } from "../hooks/useBufferedInput";

interface ScrubPillSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    unit?: string;
    accentColor?: string;
    width?: string;
    height?: string;
    title?: string;
    onChange: (next: number) => void;
}

/** Parses typed scrub-pill input, stripping unit suffixes (`ms`, `px`, `%`, `s`), clamping to `[min, max]`, and snapping to `step`. */
export function parseScrubPillInput(raw: string, min: number, max: number, step = 1): number | null {
    const cleaned = raw.trim().replace(/\s*(?:ms|px|%|s)\s*$/i, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    const clamped = clamp(parsed, min, max);
    return step > 1
        ? clamp(min + Math.round((clamped - min) / step) * step, min, max)
        : Math.round(clamped);
}

/** 2026/2027 Fused Scrub-Bar: layers label, GPU-composited proportional fill track, and tabular readout in one compact pill. */
export const ScrubPillSlider: React.FC<ScrubPillSliderProps> = React.memo(({
    label,
    value,
    min,
    max,
    step = 1,
    unit = "%",
    accentColor = "var(--ui-accent)",
    width = "96px",
    height = "24px",
    title,
    onChange,
}) => {
    const [isDragging, setIsDragging] = useState(false);
    const pillRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; startX: number; startVal: number; lastEmitted: number; moved: boolean; lastShift: boolean } | null>(null);

    const safeVal = Number.isFinite(value) ? clamp(value, min, max) : min;
    const roundedVal = Math.round(safeVal);
    const span = Math.max(1, max - min);
    const pct = clamp(((safeVal - min) / span) * 100, 0, 100);
    const pillStyle = { width, height, "--pill-accent": accentColor } as React.CSSProperties;

    const buffered = useBufferedInput({
        onCommit: (raw) => {
            const parsed = parseScrubPillInput(raw, min, max, step);
            if (parsed !== null && parsed !== roundedVal) onChange(parsed);
        },
        onExit: () => { requestAnimationFrame(() => pillRef.current?.focus()); },
    });

    const cancelDrag = (pointerId?: number) => {
        const state = dragRef.current;
        if (!state || (pointerId !== undefined && state.pointerId !== pointerId)) return;
        dragRef.current = null;
        setIsDragging(false);
    };

    if (buffered.isEditing) {
        return (
            <input
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoFocus
                aria-label={`${label} numeric value`}
                className="tpe-tabular-nums tpe-scrub-pill-input"
                style={pillStyle}
                value={buffered.draftText ?? ""}
                onFocus={buffered.handleFocus}
                onChange={(e) => buffered.handleChange(e.target.value)}
                onBlur={buffered.handleBlur}
                onKeyDown={buffered.handleKeyDown}
            />
        );
    }

    return (
        <div
            ref={pillRef}
            dir="ltr"
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={roundedVal}
            aria-valuetext={`${roundedVal}${unit}`}
            className="tpe-scrubber tpe-scrub-pill"
            data-dragging={isDragging}
            title={title || `${label}: drag horizontally to scrub (Shift for fine control) or click to type`}
            style={pillStyle}
            onPointerDown={(e) => {
                if (!isPrimaryPointer(e) || dragRef.current) return;
                safeSetPointerCapture(e.currentTarget, e.pointerId);
                dragRef.current = { pointerId: e.pointerId, startX: e.clientX, startVal: safeVal, lastEmitted: roundedVal, moved: false, lastShift: e.shiftKey };
                setIsDragging(true);
            }}
            onPointerMove={(e) => {
                const state = dragRef.current;
                if (!state || e.pointerId !== state.pointerId) return;
                const dx = e.clientX - state.startX;
                if (!state.moved && Math.abs(dx) > 3) state.moved = true;
                if (!state.moved) return;
                if (e.shiftKey !== state.lastShift) {
                    state.startX = e.clientX;
                    state.startVal = state.lastEmitted;
                    state.lastShift = e.shiftKey;
                    return;
                }
                const speed = e.shiftKey ? 0.25 : 1;
                const raw = clamp(state.startVal + (dx / 120) * span * speed, min, max);
                const next = step > 1
                    ? clamp(min + Math.round((raw - min) / step) * step, min, max)
                    : Math.round(raw);
                if (next !== state.lastEmitted) {
                    state.lastEmitted = next;
                    onChange(next);
                }
            }}
            onPointerUp={(e) => {
                const state = dragRef.current;
                if (!state || e.pointerId !== state.pointerId) return;
                dragRef.current = null;
                setIsDragging(false);
                safeReleasePointerCapture(e.currentTarget, e.pointerId);
                if (!state.moved) {
                    buffered.startEdit(String(roundedVal));
                }
            }}
            onPointerCancel={(e) => cancelDrag(e.pointerId)}
            onLostPointerCapture={() => cancelDrag()}
            onKeyDown={(e) => {
                const keyStep = e.shiftKey ? step * 5 : step;
                let next: number | null = null;
                if (e.key === "ArrowRight" || e.key === "ArrowUp") next = clamp(roundedVal + keyStep, min, max);
                else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = clamp(roundedVal - keyStep, min, max);
                else if (e.key === "Home") next = min;
                else if (e.key === "End") next = max;
                else if (e.key === "Enter") {
                    e.preventDefault();
                    buffered.startEdit(String(roundedVal));
                    return;
                }
                if (next === null) return;
                e.preventDefault();
                if (next !== roundedVal) onChange(next);
            }}
        >
            {/* Proportional fill track behind label & readout (GPU scaleX + GPU translate3d edge cap) */}
            <div className="tpe-scrub-pill-fill" data-dragging={isDragging} style={{ transform: `scaleX(${pct / 100})` }} />
            {pct > 0 && pct < 100 && (
                <div className="tpe-scrub-pill-edge-wrap" data-dragging={isDragging} style={{ transform: `translate3d(${pct}%, 0, 0)` }}>
                    <div className="tpe-scrub-pill-edge" />
                </div>
            )}
            <div className="tpe-scrub-pill-content">
                <span className="tpe-scrub-pill-label">{label}</span>
                <span className="tpe-tabular-nums tpe-scrub-pill-val">
                    {roundedVal}{unit}
                </span>
            </div>
        </div>
    );
});

ScrubPillSlider.displayName = "ScrubPillSlider";
