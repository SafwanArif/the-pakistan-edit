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
        <div style={{ display: 'flex', flexDirection: 'column', inlineSize: '90px', alignItems: 'center', position: 'relative' }}>
            <span className="focal-slider-label">{label}</span>
            <div style={{ position: 'relative', inlineSize: '100%', blockSize: '18px', display: 'flex', alignItems: 'center' }}>
                <input 
                    className="focal-slider" type="range" min={min} max={max} value={localValue} 
                    onChange={(e) => setLocalValue(parseInt(e.target.value, 10))} 
                    onPointerDown={() => onDrag(id)} 
                    onPointerUp={commitToGlobal}
                />
            </div>
            <div style={{ position: 'absolute', insetBlockEnd: '-12px', inlineSize: '100%', display: 'flex', justifyContent: 'center' }}>
                <input 
                    className="focal-slider-value"
                    type="text"
                    value={localValue.toString() + (id === 'zoom' || id === 'scrim' ? '%' : '')}
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
        </div>
    );
});

FocalSlider.displayName = "FocalSlider";
