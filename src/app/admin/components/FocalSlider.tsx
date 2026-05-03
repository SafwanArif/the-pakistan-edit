import React, { useState, useEffect } from "react";

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

interface FocalSliderProps {
    id: string;
    label: string;
    min: number;
    max: number;
    value: number;
    field: string;
    onChange: (field: any, val: number, min: number, max: number) => void;
    onDrag: (id: string | null) => void;
    isDragging: boolean;
}

/**
 * Institutional FocalSlider Primitive
 * Pure UI layer for high-precision focal mapping.
 */
export const FocalSlider = React.memo<FocalSliderProps>(({ id, label, min, max, value, field, onChange, onDrag, isDragging }) => {
    const [localValue, setLocalValue] = useState(value);

    useEffect(() => {
        if (!isDragging) setLocalValue(value);
    }, [value, isDragging]);

    const commitToGlobal = () => {
        onDrag(null);
        onChange(field, clamp(localValue, min, max), min, max);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', inlineSize: '100%', alignItems: 'center', gap: '4px' }}>
            <span className="focal-slider-label" style={{ fontSize: '7px', fontWeight: 800, opacity: 0.5, letterSpacing: '0.05em' }}>{label}</span>
            <div style={{ position: 'relative', inlineSize: '100%', blockSize: '18px', display: 'flex', alignItems: 'center' }}>
                <input 
                    className="focal-slider" type="range" min={min} max={max} value={localValue} 
                    onChange={(e) => setLocalValue(parseInt(e.target.value, 10))} 
                    onPointerDown={() => onDrag(id)} 
                    onPointerUp={commitToGlobal}
                />
            </div>
            <input 
                className="focal-slider-value"
                type="text"
                value={localValue.toString() + (id === 'zoom' || id === 'scrim' ? '%' : '')}
                style={{ background: 'transparent', border: 'none', color: 'var(--ui-accent)', fontSize: '10px', fontWeight: 700, textAlign: 'center', inlineSize: '100%', padding: '0', margin: '0' }}
                onChange={(e) => {
                    const val = e.target.value.replace(/[^0-9]/g, '');
                    if (val === '') { setLocalValue(0); return; }
                    const parsed = parseInt(val, 10);
                    if (!isNaN(parsed)) setLocalValue(parsed);
                }}
                onBlur={commitToGlobal}
                onKeyDown={(e) => { if (e.key === 'Enter') { commitToGlobal(); e.currentTarget.blur(); } }}
            />
        </div>
    );
});

FocalSlider.displayName = "FocalSlider";
