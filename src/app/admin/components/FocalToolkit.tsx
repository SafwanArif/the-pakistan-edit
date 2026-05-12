"use client";

import React, { useCallback, useMemo } from "react";
import { Draft } from "../../../types/news";
import { EmojiToolbar } from "./EditorialTools";
import { updateDraftValue, updateSlideAsset, getEffectiveSlideAsset } from "../utils/dataAccessors";
import { FocalSlider } from "./FocalSlider";

interface FocalToolkitProps {
    activeDraft: Draft;
    updateDraft: (draft: Draft) => void;
    currentStep: number;
    setStep: (step: number) => void;
    draggingSlider: string | null;
    setDraggingSlider: (slider: string | null) => void;
    undo?: () => void;
    redo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
}

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

export const FocalToolkit: React.FC<FocalToolkitProps> = ({ 
    activeDraft, updateDraft, currentStep, setStep, draggingSlider, setDraggingSlider, undo, redo, canUndo, canRedo
}) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const asset = useMemo(() => getEffectiveSlideAsset(currentStep, activeDraft), [currentStep, activeDraft]);

    const handleSliderChange = useCallback((field: any, value: number, min: number, max: number) => {
        const val = clamp(value, min, max);
        updateDraft(currentStep === 1 ? { ...activeDraft, [field]: val } : updateSlideAsset(currentStep, field, val, activeDraft));
    }, [activeDraft, currentStep, updateDraft]);

    if (currentStep < 1) return null;

    return (
        <div className="tpe-flex-col" style={{ 
            position: 'fixed', 
            insetBlockStart: '60px', 
            insetInlineStart: 0, 
            insetInlineEnd: 0, 
            pointerEvents: 'none', 
            zIndex: 'var(--z-toolbar)', 
            gap: '8px', 
            alignItems: 'center' 
        }}>
            {/* CONTEXTUAL HUD ROW */}
            <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center' }}>
                <button 
                    onClick={undo} 
                    disabled={!canUndo} 
                    className="tpe-hud-toggle" 
                    style={{ opacity: canUndo ? 1 : 0.3, pointerEvents: canUndo ? 'auto' : 'none' }}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
                </button>

                {asset.image && (
                    <button 
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="tpe-hud-toggle"
                        data-active={isExpanded}
                    >
                        <div style={{ inlineSize: '6px', blockSize: '6px', borderRadius: '50%', background: isExpanded ? 'var(--ui-accent)' : 'currentColor', boxShadow: isExpanded ? '0 0 8px var(--ui-accent)' : 'none' }} />
                        FOCAL TOOLS
                        <svg width="10" height="6" viewBox="0 0 10 6" fill="none" style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.3s' }}>
                            <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                )}

                <button 
                    onClick={redo} 
                    disabled={!canRedo} 
                    className="tpe-hud-toggle" 
                    style={{ opacity: canRedo ? 1 : 0.3, pointerEvents: canRedo ? 'auto' : 'none' }}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/></svg>
                </button>
            </div>

            {isExpanded && (
                <div className="tpe-flex-col tpe-glass-panel tpe-hud-container">
                    {/* 2x3 GRID SYSTEM (VERTICAL) */}
                    <div className="tpe-hud-grid">
                        {[
                            { id: "zoom", label: "ZOOM", min: 10, max: 800, value: asset.imageZoom, field: "imageZoom" },
                            { id: "posX", label: "PAN X", min: 0, max: 100, value: asset.imagePosX, field: "imagePosX" },
                            { id: "posY", label: "PAN Y", min: 0, max: 100, value: asset.imagePosY, field: "imagePosY" },
                            { id: "posY_sq", label: "PAN Y (FB)", min: 0, max: 100, value: asset.imagePosY_Square ?? asset.imagePosY, field: "imagePosY_Square" }
                        ].map(s => (
                            <FocalSlider key={s.id} {...s} onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === s.id} />
                        ))}
                        
                        <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                            <button
                                onClick={() => {
                                    const modes: ('height' | 'width' | 'grid')[] = ['height', 'width', 'grid'];
                                    const next = modes[(modes.indexOf(asset.snapMode) + 1) % 3];
                                    const update = (f: string, v: any, d: Draft) => currentStep === 1 ? { ...d, [f]: v } : updateSlideAsset(currentStep, f, v, d);
                                    let d = update('snapMode', next, activeDraft);
                                    ['imageZoom', 'imagePosX', 'imagePosY', 'imagePosY_Square'].forEach(f => d = update(f, f === 'imageZoom' ? 100 : 50, d));
                                    updateDraft(d);
                                }}
                                className="tpe-btn-primary tpe-btn-icon"
                                style={{ boxShadow: 'none' }}
                            >
                                {asset.snapMode === 'width' ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><path d="M12 2v20M2 12h20"/><path d="M12 2l-3 3m6 0l-3-3M2 12l3-3m0 6l-3-3M12 22l-3-3m6 0l-3 3M22 12l-3-3m0 6l3-3"/></svg>
                                ) : asset.snapMode === 'grid' ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5"><path d="M8 18L12 22L16 18"/><path d="M8 6L12 2L16 6"/><path d="M12 2V22"/></svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5"><path d="M18 8L22 12L18 16"/><path d="M6 8L2 12L6 16"/><path d="M2 12H22"/></svg>
                                )}
                            </button>
                            <span className="focal-slider-label">SNAP</span>
                        </div>

                        <FocalSlider id="scrim" label="OPACITY" min={0} max={100} value={asset.scrim ?? 0} field="scrim" onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === 'scrim'} />
                    </div>
                </div>
            )}

        </div>
    );
};
