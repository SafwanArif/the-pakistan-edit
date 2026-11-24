"use client";

import React, { useRef, useState } from "react";
import { clamp } from "../../../types/news";

interface ScrubPillSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    unit?: string;
    accentColor?: string;
    width?: string;
    height?: string;
    title?: string;
    onChange: (next: number) => void;
}

/** Parses typed scrub-pill input, stripping unit suffixes (`ms`, `px`, `%`, `s`) and clamping to `[min, max]`. */
export function parseScrubPillInput(raw: string, min: number, max: number): number | null {
    const cleaned = raw.trim().replace(/\s*(?:ms|px|%|s)\s*$/i, "").trim();
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return clamp(Math.round(parsed), min, max);
}

/** 2026/2027 Fused Scrub-Bar: layers label, GPU-composited proportional fill track, and tabular readout in one compact pill. */
export const ScrubPillSlider: React.FC<ScrubPillSliderProps> = React.memo(({
    label,
    value,
    min,
    max,
    unit = "%",
    accentColor = "var(--ui-accent)",
    width = "96px",
    height = "24px",
    title,
    onChange,
}) => {
    const [isEditing, setIsEditing] = useState(false);
    const [draftText, setDraftText] = useState("");
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef<{ startX: number; startVal: number; moved: boolean } | null>(null);

    const span = Math.max(1, max - min);
    const pct = Math.max(0, Math.min(100, ((value - min) / span) * 100));

    const commitText = () => {
        const parsed = parseScrubPillInput(draftText, min, max);
        if (parsed !== null) {
            onChange(parsed);
        }
        setIsEditing(false);
    };

    if (isEditing) {
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
                className="tpe-tabular-nums"
                value={draftText}
                onFocus={(e) => e.currentTarget.select()}
                onChange={(e) => setDraftText(e.target.value)}
                onBlur={commitText}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setIsEditing(false);
                }}
                style={{
                    width,
                    height,
                    textAlign: "center",
                    fontSize: "9.5px",
                    fontFamily: "monospace",
                    fontWeight: 800,
                    color: accentColor,
                    background: "rgba(0,0,0,0.65)",
                    border: `1px solid ${accentColor}`,
                    borderRadius: "5px",
                    padding: "0 6px",
                }}
            />
        );
    }

    return (
        <div
            role="slider"
            tabIndex={0}
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Math.round(value)}
            className="tpe-scrubber"
            title={title || `${label}: drag horizontally to scrub (Shift for fine control) or click to type`}
            onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { startX: e.clientX, startVal: value, moved: false };
                setIsDragging(true);
            }}
            onPointerMove={(e) => {
                const state = dragRef.current;
                if (!state) return;
                const dx = e.clientX - state.startX;
                if (!state.moved && Math.abs(dx) > 3) state.moved = true;
                if (!state.moved) return;
                const speed = e.shiftKey ? 0.25 : 1;
                const next = Math.round(clamp(state.startVal + (dx / 120) * span * speed, min, max));
                if (next !== Math.round(value)) onChange(next);
            }}
            onPointerUp={(e) => {
                const state = dragRef.current;
                dragRef.current = null;
                setIsDragging(false);
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                }
                if (state && !state.moved) {
                    setDraftText(String(Math.round(value)));
                    setIsEditing(true);
                }
            }}
            onPointerCancel={() => {
                dragRef.current = null;
                setIsDragging(false);
            }}
            onLostPointerCapture={() => {
                if (!dragRef.current) return;
                dragRef.current = null;
                setIsDragging(false);
            }}
            onKeyDown={(e) => {
                const step = e.shiftKey ? 5 : 1;
                if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                    e.preventDefault();
                    onChange(clamp(Math.round(value) + step, min, max));
                } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                    e.preventDefault();
                    onChange(clamp(Math.round(value) - step, min, max));
                } else if (e.key === "Home") {
                    e.preventDefault();
                    onChange(min);
                } else if (e.key === "End") {
                    e.preventDefault();
                    onChange(max);
                } else if (e.key === "Enter") {
                    e.preventDefault();
                    setDraftText(String(Math.round(value)));
                    setIsEditing(true);
                }
            }}
            style={{
                position: "relative",
                width,
                height,
                borderRadius: "5px",
                background: "rgba(0,0,0,0.45)",
                border: `1px solid ${isDragging ? accentColor : "var(--ui-border)"}`,
                overflow: "hidden",
                cursor: "ew-resize",
                userSelect: "none",
                touchAction: "none",
                transition: "border-color 0.12s ease",
            }}
        >
            {/* Proportional fill track behind label & readout (GPU scaleX + GPU translate3d edge cap) */}
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    transform: `scaleX(${pct / 100})`,
                    transformOrigin: "left center",
                    willChange: "transform",
                    background: `color-mix(in oklch, ${accentColor} 24%, transparent)`,
                    pointerEvents: "none",
                }}
            />
            {pct > 0 && pct < 100 && (
                <div
                    style={{
                        position: "absolute",
                        inset: 0,
                        transform: `translate3d(${pct}%, 0, 0)`,
                        willChange: "transform",
                        pointerEvents: "none",
                    }}
                >
                    <div
                        style={{
                            position: "absolute",
                            left: "-1px",
                            top: 0,
                            bottom: 0,
                            width: "2px",
                            background: accentColor,
                        }}
                    />
                </div>
            )}
            <div
                style={{
                    position: "relative",
                    zIndex: 1,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    height: "100%",
                    paddingInline: "7px",
                    gap: "6px",
                    pointerEvents: "none",
                }}
            >
                <span style={{ fontSize: "8px", fontWeight: 800, letterSpacing: "0.07em", color: "var(--ui-text-dim)" }}>
                    {label}
                </span>
                <span className="tpe-tabular-nums" style={{ fontSize: "9.5px", fontWeight: 800, fontFamily: "monospace", color: accentColor }}>
                    {Math.round(value)}{unit}
                </span>
            </div>
        </div>
    );
});

ScrubPillSlider.displayName = "ScrubPillSlider";
