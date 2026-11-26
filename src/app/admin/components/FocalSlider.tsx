"use client";

import React, { useRef, useState } from "react";
import { clamp } from "@/types/news";

const sliderColStyle: React.CSSProperties = { display: "flex", flexDirection: "column", inlineSize: "100%", alignItems: "center", gap: "4px" };
const sliderLabelStyle: React.CSSProperties = { fontSize: "7px", fontWeight: 800, opacity: 0.5, letterSpacing: "0.05em" };
const sliderTrackWrapStyle: React.CSSProperties = { position: "relative", inlineSize: "100%", blockSize: "18px", display: "flex", alignItems: "center" };
const sliderValueInputStyle: React.CSSProperties = { background: "transparent", border: "none", color: "var(--ui-accent)", fontSize: "10px", fontWeight: 700, textAlign: "center", inlineSize: "100%", padding: 0, margin: 0 };

interface FocalSliderProps {
    id: string;
    label: string;
    min: number;
    max: number;
    value: number;
    field: string;
    unit?: string;
    onChange: (field: string, val: number, min: number, max: number) => void;
}

/** Controlled slider and numeric input pair for focal zoom and pan coordinates. */
export const FocalSlider = React.memo<FocalSliderProps>(({ id, label, min, max, value, field, unit, onChange }) => {
    const [textInput, setTextInput] = useState<string | null>(null);
    const cancelEditRef = useRef(false);

    const safeValue = Number.isFinite(value) ? clamp(Math.round(value), min, max) : min;
    const committedText = `${safeValue}${unit ?? (id === "zoom" ? "%" : "")}`;
    const commitNumeric = (raw: string) => {
        const parsed = parseInt(raw, 10);
        if (Number.isNaN(parsed)) return;
        const next = clamp(parsed, min, max);
        if (next !== safeValue) onChange(field, next, min, max);
    };

    return (
        <div style={sliderColStyle}>
            <span className="focal-slider-label" style={sliderLabelStyle}>{label}</span>
            <div style={sliderTrackWrapStyle}>
                <input
                    type="range"
                    aria-label={label}
                    aria-valuetext={committedText}
                    min={min}
                    max={max}
                    value={safeValue}
                    onChange={(e) => { setTextInput(null); commitNumeric(e.target.value); }}
                />
            </div>
            <input
                className="tpe-tabular-nums"
                type="text"
                inputMode="numeric"
                enterKeyHint="done"
                autoComplete="off"
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                aria-label={`${label} numeric value`}
                value={textInput ?? committedText}
                style={sliderValueInputStyle}
                onFocus={(e) => { cancelEditRef.current = false; setTextInput(String(safeValue)); e.currentTarget.select(); }}
                onChange={(e) => setTextInput(e.target.value.replace(/[^0-9]/g, ""))}
                onBlur={() => {
                    if (cancelEditRef.current) { cancelEditRef.current = false; setTextInput(null); return; }
                    if (textInput !== null) commitNumeric(textInput);
                    setTextInput(null);
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    else if (e.key === "Escape") { cancelEditRef.current = true; setTextInput(null); e.currentTarget.blur(); }
                }}
            />
        </div>
    );
});
FocalSlider.displayName = "FocalSlider";
