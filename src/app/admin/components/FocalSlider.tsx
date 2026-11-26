"use client";

import React from "react";
import { clamp } from "@/types/news";
import { useBufferedInput } from "../hooks/useBufferedInput";

interface FocalSliderProps {
    label: string;
    min: number;
    max: number;
    value: number;
    field: string;
    unit?: string;
    onChange: (field: string, val: number, min: number, max: number) => void;
}

/** Controlled slider and numeric input pair for focal zoom and pan coordinates. */
export const FocalSlider = React.memo<FocalSliderProps>(({ label, min, max, value, field, unit = "", onChange }) => {
    const safeValue = Number.isFinite(value) ? clamp(Math.round(value), min, max) : min;
    const committedText = `${safeValue}${unit}`;
    const commitNumeric = (raw: string) => {
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) return;
        const next = clamp(parsed, min, max);
        if (next !== safeValue) onChange(field, next, min, max);
    };
    const buffered = useBufferedInput({
        onCommit: commitNumeric,
        sanitize: (raw) => raw.replace(/[^0-9]/g, ""),
        deferSelect: true,
    });

    return (
        <div className="tpe-focal-slider">
            <span className="tpe-focal-slider-label">{label}</span>
            <div className="tpe-focal-slider-track">
                <input
                    type="range"
                    aria-label={label}
                    aria-valuetext={committedText}
                    min={min}
                    max={max}
                    value={safeValue}
                    onChange={(e) => { buffered.clearEdit(); commitNumeric(e.target.value); }}
                />
            </div>
            <input
                className="tpe-tabular-nums tpe-focal-slider-value"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={`${label} numeric value`}
                value={buffered.draftText ?? committedText}
                onFocus={(e) => buffered.handleFocus(e, String(safeValue))}
                onChange={(e) => buffered.handleChange(e.target.value)}
                onBlur={buffered.handleBlur}
                onKeyDown={buffered.handleKeyDown}
            />
        </div>
    );
});
FocalSlider.displayName = "FocalSlider";
