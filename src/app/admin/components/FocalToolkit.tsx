"use client";

import React, { useCallback, useMemo } from "react";
import { Draft } from "../../../types/news";
import { DraftResolver, getEffectiveSlideAsset } from "../utils/dataAccessors";
import { FocalSlider } from "./FocalSlider";
import { useClickOutside } from "../hooks/useClickOutside";

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

/**
 * 2027 Institutional Standard: FocalToolkit
 * High-fidelity control interface for asset focal point and metadata logic.
 * Orchestrates pan, zoom, and snap-mode transformations.
 */
export const FocalToolkit: React.FC<FocalToolkitProps> = ({ 
    activeDraft, updateDraft, currentStep, setStep, draggingSlider, setDraggingSlider, undo, redo, canUndo, canRedo
}) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const hudRef = useClickOutside(() => setIsExpanded(false));
    const asset = useMemo(() => getEffectiveSlideAsset(currentStep, activeDraft), [currentStep, activeDraft]);

    const handleSliderChange = useCallback((field: string, value: number, min: number, max: number) => {
        const val = clamp(value, min, max);
        updateDraft(DraftResolver.set(`slide-${currentStep}-${field}`, val, activeDraft));
    }, [activeDraft, currentStep, updateDraft]);

    const handleAddAngle = (e: React.MouseEvent) => {
        e.preventDefault();
        const newSlides = [...(activeDraft.extraSlides || [])];
        newSlides.push({ heading: '', content: '', sourceName: '', sourcePrefix: 'SOURCE:' });
        updateDraft({ ...activeDraft, extraSlides: newSlides });
        setStep(2 + newSlides.length);
    };

    const handleRemoveAngle = (e: React.MouseEvent) => {
        e.preventDefault();
        const index = currentStep - 3;
        if (index < 0 || !activeDraft.extraSlides) return;
        const slides = [...activeDraft.extraSlides];
        slides.splice(index, 1);
        updateDraft({ ...activeDraft, extraSlides: slides });
        setStep(currentStep - 1);
    };

    if (currentStep < 1) return null;

    return (
        <div ref={hudRef} className="tpe-flex-col" style={{ 
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
            <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center', pointerEvents: 'auto' }}>
                <button 
                    onClick={undo} 
                    disabled={!canUndo} 
                    className="tpe-hud-toggle" 
                    aria-label="Undo"
                    style={{ opacity: canUndo ? 1 : 0.3, pointerEvents: canUndo ? 'auto' : 'none', padding: '4px 8px' }}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"/></svg>
                </button>

                {currentStep >= 3 && (
                    <button onClick={handleAddAngle} className="tpe-hud-toggle" aria-label="Add Angle" style={{ padding: '4px 12px', color: 'var(--ui-accent)', fontWeight: 800 }}>
                        +
                    </button>
                )}

                {asset.image && (
                    <button 
                        onClick={() => setIsExpanded(!isExpanded)}
                        className="tpe-hud-toggle"
                        data-active={isExpanded}
                        style={{ padding: '4px 10px', fontSize: '11px', letterSpacing: '0.5px', fontWeight: 500 }}
                    >
                        FOCAL TOOLS
                    </button>
                )}

                {currentStep >= 3 && activeDraft.extraSlides && activeDraft.extraSlides.length > 0 && (
                    <button 
                        onClick={handleRemoveAngle} 
                        disabled={currentStep === 3}
                        className="tpe-hud-toggle" 
                        aria-label="Remove Angle"
                        style={{ 
                            padding: '4px 12px', 
                            color: currentStep === 3 ? 'var(--ui-text-dim)' : 'var(--ui-error, #ff4444)', 
                            fontWeight: 800,
                            opacity: currentStep === 3 ? 0.4 : 1,
                            cursor: currentStep === 3 ? 'not-allowed' : 'pointer'
                        }}
                    >
                        -
                    </button>
                )}

                <button 
                    onClick={redo} 
                    disabled={!canRedo} 
                    className="tpe-hud-toggle" 
                    style={{ opacity: canRedo ? 1 : 0.3, pointerEvents: canRedo ? 'auto' : 'none', padding: '4px 8px' }}
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"/></svg>
                </button>
            </div>

            {isExpanded && (
                <div className="tpe-flex-col tpe-glass-panel tpe-hud-container" style={{ pointerEvents: 'auto' }}>
                    <div className="tpe-hud-grid">
                        {[
                            { id: "zoom", label: "ZOOM", min: 10, max: 800, value: asset.imageZoom ?? 100, field: "imageZoom" },
                            { id: "posX", label: "PAN X", min: 0, max: 100, value: asset.imagePosX ?? 50, field: "imagePosX" },
                            { id: "posY", label: "PAN Y", min: 0, max: 100, value: asset.imagePosY ?? 50, field: "imagePosY" },
                            { id: "posY_sq", label: "PAN Y (FB)", min: 0, max: 100, value: asset.imagePosY_Square ?? asset.imagePosY ?? 50, field: "imagePosY_Square" }
                        ].map(s => (
                            <FocalSlider key={s.id} {...s} onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === s.id} />
                        ))}
                        
                        <div className="tpe-flex-row" style={{ gap: '8px', alignItems: 'center', justifyContent: 'center' }}>
                            <button
                                onClick={() => {
                                    const modes: ('height' | 'width' | 'grid')[] = ['height', 'width', 'grid'];
                                    const currentMode = asset.snapMode || 'height';
                                    const next = modes[(modes.indexOf(currentMode) + 1) % 3];
                                    let d = DraftResolver.set(`slide-${currentStep}-snapMode`, next, activeDraft);
                                    ['imageZoom', 'imagePosX', 'imagePosY', 'imagePosY_Square'].forEach(f => d = DraftResolver.set(`slide-${currentStep}-${f}`, f === 'imageZoom' ? 100 : 50, d));
                                    updateDraft(d);
                                }}
                                className="tpe-btn-primary tpe-btn-icon"
                                style={{ boxShadow: 'none' }}
                                aria-label="Toggle Snap Mode"
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
