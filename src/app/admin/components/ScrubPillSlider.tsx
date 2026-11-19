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

/** 2026/2027 Fused Scrub-Bar: layers label, proportional fill track, and tabular readout in one compact pill. */
export const ScrubPillSlider: React.FC<ScrubPillSliderProps> = ({
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
        const parsed = Number(draftText.replace(/%.*$/, "").trim());
        if (Number.isFinite(parsed)) {
            onChange(clamp(Math.round(parsed), min, max));
        }
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <input
                type="text"
                inputMode="decimal"
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
            {/* Proportional fill track behind label & readout */}
            <div
                style={{
                    position: "absolute",
                    insetBlock: 0,
                    left: 0,
                    width: `${pct}%`,
                    background: `color-mix(in oklch, ${accentColor} 24%, transparent)`,
                    borderRight: pct > 0 && pct < 100 ? `2px solid ${accentColor}` : "none",
                    pointerEvents: "none",
                }}
            />
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
};
