import React, { useState } from "react";

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

interface FocalSliderProps {
    id: string;
    label: string;
    min: number;
    max: number;
    value: number;
    field: string;
    onChange: (field: string, val: number, min: number, max: number) => void;
}

/**
 * Controlled slider and numeric input pair for focal zoom and pan coordinates.
 */
export const FocalSlider = React.memo<FocalSliderProps>(({ id, label, min, max, value, field, onChange }) => {
    const [textInput, setTextInput] = useState<string | null>(null);

    const handleInputBlur = () => {
        if (textInput !== null) {
            const parsed = parseInt(textInput, 10);
            if (!Number.isNaN(parsed)) {
                onChange(field, clamp(parsed, min, max), min, max);
            }
            setTextInput(null);
        }
    };

    const displayValue = textInput !== null ? textInput : value.toString() + (id === 'zoom' ? '%' : '');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', inlineSize: '100%', alignItems: 'center', gap: '4px' }}>
            <span className="focal-slider-label" style={{ fontSize: '7px', fontWeight: 800, opacity: 0.5, letterSpacing: '0.05em' }}>{label}</span>
            <div style={{ position: 'relative', inlineSize: '100%', blockSize: '18px', display: 'flex', alignItems: 'center' }}>
                <input 
                    className="focal-slider" 
                    type="range" 
                    aria-label={label}
                    min={min} 
                    max={max} 
                    value={value} 
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        const val = parseInt(e.target.value, 10);
                        setTextInput(null);
                        onChange(field, clamp(val, min, max), min, max);
                    }} 
                />
            </div>
            <input 
                className="focal-slider-value tpe-tabular-nums"
                type="text"
                inputMode="numeric"
                aria-label={`${label} numeric value`}
                value={displayValue}
                style={{ background: 'transparent', border: 'none', color: 'var(--ui-accent)', fontSize: '10px', fontWeight: 700, textAlign: 'center', inlineSize: '100%', padding: '0', margin: '0' }}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    setTextInput(val);
                }}
                onBlur={handleInputBlur}
                onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { 
                    if (e.key === 'Enter') { 
                        handleInputBlur(); 
                        e.currentTarget.blur(); 
                    } 
                }}
            />
        </div>
    );
});

FocalSlider.displayName = "FocalSlider";
