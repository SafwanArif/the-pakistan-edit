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
}

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

export const FocalToolkit: React.FC<FocalToolkitProps> = ({ 
    activeDraft, updateDraft, currentStep, setStep, draggingSlider, setDraggingSlider 
}) => {
    const extraIndex = currentStep - 3;
    const isDeletable = currentStep > 3;
    const extraSlides = useMemo(() => activeDraft.extraSlides || [], [activeDraft.extraSlides]);
    const asset = useMemo(() => getEffectiveSlideAsset(currentStep, activeDraft), [currentStep, activeDraft]);

    const addExtraSlide = useCallback(() => {
        const slides = [...extraSlides];
        slides.splice(extraIndex + 1, 0, { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" });
        updateDraft({ ...activeDraft, extraSlides: slides });
        setStep(currentStep + 1);
    }, [activeDraft, extraSlides, extraIndex, currentStep, updateDraft, setStep]);

    const removeExtraSlide = useCallback((index: number) => {
        const slides = [...extraSlides];
        slides.splice(index, 1);
        updateDraft({ ...activeDraft, extraSlides: slides });
        setStep(currentStep - 1);
    }, [activeDraft, extraSlides, currentStep, updateDraft, setStep]);

    const handleSliderChange = useCallback((field: any, value: number, min: number, max: number) => {
        const val = clamp(value, min, max);
        updateDraft(currentStep === 1 ? { ...activeDraft, [field]: val } : updateSlideAsset(currentStep, field, val, activeDraft));
    }, [activeDraft, currentStep, updateDraft]);

    if (currentStep < 1) return null;

    return (
        <div className="tpe-flex-col" style={{ position: 'absolute', insetBlockEnd: '0', insetInlineStart: 0, insetInlineEnd: 0, pointerEvents: 'none', zIndex: 'var(--z-toolbar)', paddingBlockEnd: '15px', gap: '12px', alignItems: 'center' }}>
            
            <div className="tpe-flex-row tpe-glass-panel" style={{ gap: '15px', padding: '10px 22px', borderRadius: '40px', pointerEvents: 'auto' }}>
                <button
                    onClick={() => {
                        const modes: ('height' | 'width' | 'grid')[] = ['height', 'width', 'grid'];
                        const next = modes[(modes.indexOf(asset.snapMode) + 1) % 3];
                        const update = (f: string, v: any, d: Draft) => currentStep === 1 ? { ...d, [f]: v } : updateSlideAsset(currentStep, f, v, d);
                        let d = update('snapMode', next, activeDraft);
                        ['imageZoom', 'imagePosX', 'imagePosY', 'imagePosY_Square'].forEach(f => d = update(f, f === 'imageZoom' ? 100 : 50, d));
                        updateDraft(d);
                    }}
                    className="tpe-btn-primary" style={{ padding: '2px', borderRadius: '8px', minInlineSize: '32px', minBlockSize: '32px', boxShadow: 'none' }}
                >
                    {asset.snapMode === 'width' ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5"><path d="M12 2v20M2 12h20"/><path d="M12 2l-3 3m6 0l-3-3M2 12l3-3m0 6l-3-3M12 22l-3-3m6 0l-3 3M22 12l-3-3m0 6l3-3"/></svg>
                    ) : asset.snapMode === 'grid' ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5"><path d="M8 18L12 22L16 18"/><path d="M8 6L12 2L16 6"/><path d="M12 2V22"/></svg>
                    ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5"><path d="M18 8L22 12L18 16"/><path d="M6 8L2 12L6 16"/><path d="M2 12H22"/></svg>
                    )}
                </button>

                <div style={{ inlineSize: '1px', blockSize: '28px', background: 'oklch(from var(--ui-text) l c h / 0.05)' }} />

                <div className="tpe-focal-grid">
                    <FocalSlider id="zoom" label="Zoom" min={10} max={800} value={asset.imageZoom} field="imageZoom" onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === 'zoom'} />
                    <FocalSlider id="posX" label="Pan X" min={0} max={100} value={asset.imagePosX} field="imagePosX" onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === 'posX'} />
                    <FocalSlider id="posY" label="Pan Y" min={0} max={100} value={asset.imagePosY} field="imagePosY" onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === 'posY'} />
                    <FocalSlider id="posY_sq" label="Pan Y (FB)" min={0} max={100} value={asset.imagePosY_Square ?? asset.imagePosY} field="imagePosY_Square" onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === 'posY_sq'} />
                    <div className="tpe-desktop-only" style={{ inlineSize: '1px', blockSize: '28px', background: 'oklch(from var(--ui-text) l c h / 0.05)' }} />
                    <FocalSlider id="scrim" label="Opacity" min={0} max={100} value={asset.scrim ?? 0} field="scrim" onChange={handleSliderChange} onDrag={setDraggingSlider} isDragging={draggingSlider === 'scrim'} />
                </div>
            </div>

            {currentStep >= 3 && (
                <div className="tpe-flex-row tpe-glass-panel" style={{ gap: '12px', padding: '6px 18px', borderRadius: '30px', pointerEvents: 'auto' }}>
                    <div className="tpe-flex-row" style={{ position: 'relative', gap: '10px' }}>
                        <input
                            id={`input-extra-heading-${extraIndex}`}
                            className="tpe-input-minimal tpe-uppercase"
                            placeholder={extraIndex === 0 ? "ANGLE HEADING" : "SUPPLEMENTAL HEADING"}
                            value={extraSlides[extraIndex]?.heading || ""}
                            onChange={(e) => updateDraft(updateDraftValue(`extra-heading-${extraIndex}`, e.target.value, activeDraft))}
                            style={{ color: 'var(--ui-indicator)', fontWeight: 700, fontSize: '11px', borderBlockEnd: '1px solid oklch(from var(--ui-indicator) l c h / 0.2)', inlineSize: '260px', letterSpacing: '0.05em' }}
                        />
                        <EmojiToolbar 
                            fieldId={`extra-heading-${extraIndex}`} 
                            value={extraSlides[extraIndex]?.heading || ""} 
                            onUpdate={(v) => updateDraft(updateDraftValue(`extra-heading-${extraIndex}`, v, activeDraft))} 
                        />
                    </div>
                    <div style={{ inlineSize: '1px', blockSize: '18px', background: 'oklch(from var(--ui-text) l c h / 0.05)' }} />
                    <button onClick={addExtraSlide} className="tpe-btn-primary" style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '8px', background: 'var(--ui-accent)', fontWeight: 800 }}>ADD ANGLE</button>
                    {isDeletable && (
                        <button onClick={() => removeExtraSlide(extraIndex)} style={{ background: 'oklch(from red l c h / 0.1)', color: 'oklch(from red l c h / 0.8)', border: '1px solid oklch(from red l c h / 0.2)', padding: '4px 8px', borderRadius: '6px', fontSize: '8px', fontWeight: 900, cursor: 'pointer' }}>DEL</button>
                    )}
                </div>
            )}
        </div>
    );
};
