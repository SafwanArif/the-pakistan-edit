"use client";

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Draft, clamp } from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";
import { DraftResolver, getEffectiveSlideAsset } from "../utils/dataAccessors";
import { FocalSlider } from "./FocalSlider";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";

const SNAP_MODES = ['height', 'width', 'grid'] as const;

interface FocalToolkitProps {
    activeDraft: Draft;
    updateDraft: (draft: Draft) => void;
    currentStep: number;
    setStep: (step: number) => void | Promise<void>;
    undo?: () => void;
    redo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
}

/**
 * Floating HUD for per-slide focal pan/zoom, snap mode, slide steps, and undo/redo.
 */
export const FocalToolkit: React.FC<FocalToolkitProps> = React.memo(({
    activeDraft, updateDraft, currentStep, setStep, undo, redo, canUndo, canRedo,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const asset = useMemo(() => getEffectiveSlideAsset(currentStep, activeDraft), [currentStep, activeDraft]);
    const hasImage = Boolean(asset.image);
    const [prevHasImage, setPrevHasImage] = useState(hasImage);
    if (hasImage !== prevHasImage) {
        setPrevHasImage(hasImage);
        if (!hasImage && isExpanded) setIsExpanded(false);
    }

    const closeHud = useCallback((reason?: CloseReason) => {
        setIsExpanded(false);
        if (reason === "escape") triggerRef.current?.focus();
    }, []);
    const hudRef = useClickOutside(closeHud, undefined, isExpanded && hasImage);

    const stateRef = useRef({ activeDraft, currentStep, updateDraft, setStep, snapMode: asset.snapMode });
    useLayoutEffect(() => {
        stateRef.current = { activeDraft, currentStep, updateDraft, setStep, snapMode: asset.snapMode };
    });

    const handleSliderChange = useCallback((field: string, value: number, min: number, max: number) => {
        const s = stateRef.current;
        const val = clamp(value, min, max);
        s.updateDraft(DraftResolver.set(`slide-${s.currentStep}-${field}`, val, s.activeDraft));
    }, []);

    const handleAddAngle = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const s = stateRef.current;
        const newSlides = [...(s.activeDraft.extraSlides || [])];
        newSlides.push({ heading: '', content: '', sourceName: '', sourcePrefix: 'SOURCE:' });
        s.updateDraft({ ...s.activeDraft, extraSlides: newSlides });
        void Promise.resolve(s.setStep(2 + newSlides.length)).catch((err) => console.error("FOCAL_STEP_ERROR:", err));
    }, []);

    const handleRemoveAngle = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        const s = stateRef.current;
        const index = s.currentStep - 3;
        if (s.currentStep <= 3 || index < 0 || !s.activeDraft.extraSlides) return;
        const slides = [...s.activeDraft.extraSlides];
        slides.splice(index, 1);
        let nextSlideAssets = s.activeDraft.slideAssets;
        if (s.activeDraft.slideAssets) {
            revokeBlobUrl(s.activeDraft.slideAssets[s.currentStep]?.image);
            const rebuilt: NonNullable<Draft["slideAssets"]> = {};
            for (const [key, val] of Object.entries(s.activeDraft.slideAssets)) {
                const num = Number(key);
                if (num === s.currentStep) continue;
                rebuilt[num > s.currentStep ? num - 1 : num] = val;
            }
            nextSlideAssets = rebuilt;
        }
        s.updateDraft({ ...s.activeDraft, extraSlides: slides, slideAssets: nextSlideAssets });
        void Promise.resolve(s.setStep(s.currentStep - 1)).catch((err) => console.error("FOCAL_STEP_ERROR:", err));
    }, []);

    const handleCycleSnap = useCallback(() => {
        const s = stateRef.current;
        const currentMode = s.snapMode || 'height';
        const next = SNAP_MODES[(SNAP_MODES.indexOf(currentMode) + 1) % SNAP_MODES.length]!;
        s.updateDraft(DraftResolver.patchSlide(s.currentStep, {
            snapMode: next,
            imageZoom: 100,
            imagePosX: 50,
            imagePosY: 50,
            imagePosY_Square: 50,
        }, s.activeDraft));
    }, []);

    const handleToggleExpanded = useCallback(() => setIsExpanded((prev) => !prev), []);

    if (currentStep < 1) return null;

    const currentSnapMode = asset.snapMode || 'height';

    return (
        <div ref={hudRef} className="tpe-flex-col tpe-focal-hud">
            {/* CONTEXTUAL HUD ROW */}
            <div className="tpe-flex-row tpe-focal-hud-row">
                <button
                    type="button"
                    onClick={undo}
                    disabled={!canUndo}
                    className="tpe-hud-toggle tpe-focal-hud-icon-btn"
                    aria-label="Undo"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7v6h6" /><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13" /></svg>
                </button>

                {currentStep >= 3 && (
                    <button type="button" onClick={handleAddAngle} className="tpe-hud-toggle tpe-focal-hud-step-btn" aria-label="Add Angle">
                        +
                    </button>
                )}

                {hasImage && (
                    <button
                        ref={triggerRef}
                        type="button"
                        aria-expanded={isExpanded}
                        aria-haspopup="dialog"
                        onClick={handleToggleExpanded}
                        className="tpe-hud-toggle tpe-focal-hud-toggle-btn"
                        data-active={isExpanded}
                    >
                        FOCAL TOOLS
                    </button>
                )}

                {currentStep >= 3 && activeDraft.extraSlides && activeDraft.extraSlides.length > 0 && (
                    <button
                        type="button"
                        onClick={handleRemoveAngle}
                        disabled={currentStep === 3}
                        className="tpe-hud-toggle tpe-focal-hud-step-btn"
                        data-tone="danger"
                        aria-label="Remove Angle"
                    >
                        -
                    </button>
                )}

                <button
                    type="button"
                    aria-label="Redo"
                    onClick={redo}
                    disabled={!canRedo}
                    className="tpe-hud-toggle tpe-focal-hud-icon-btn"
                >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 7v6h-6" /><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7" /></svg>
                </button>
            </div>

            {isExpanded && hasImage && (
                <div role="dialog" aria-label="Focal controls" className="tpe-flex-col tpe-glass-panel tpe-hud-container tpe-focal-hud-panel">
                    <div className="tpe-hud-grid">
                        <FocalSlider id="zoom" label="ZOOM" min={10} max={800} value={asset.imageZoom ?? 100} field="imageZoom" unit="%" onChange={handleSliderChange} />
                        <FocalSlider id="posX" label="PAN X" min={0} max={100} value={asset.imagePosX ?? 50} field="imagePosX" onChange={handleSliderChange} />
                        <FocalSlider id="posY" label="PAN Y" min={0} max={100} value={asset.imagePosY ?? 50} field="imagePosY" onChange={handleSliderChange} />
                        <FocalSlider id="posY_sq" label="PAN Y (FB)" min={0} max={100} value={asset.imagePosY_Square ?? asset.imagePosY ?? 50} field="imagePosY_Square" onChange={handleSliderChange} />

                        <div className="tpe-flex-row tpe-focal-snap-wrap">
                            <button
                                type="button"
                                onClick={handleCycleSnap}
                                className="tpe-btn-primary tpe-focal-snap-btn"
                                aria-label={`Snap mode: ${currentSnapMode} — click to cycle`}
                            >
                                {currentSnapMode === 'width' ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="2.5" aria-hidden="true"><path d="M12 2v20M2 12h20" /><path d="M12 2l-3 3m6 0l-3-3M2 12l3-3m0 6l-3-3M12 22l-3-3m6 0l-3 3M22 12l-3-3m0 6l3-3" /></svg>
                                ) : currentSnapMode === 'grid' ? (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" aria-hidden="true"><path d="M8 18L12 22L16 18" /><path d="M8 6L12 2L16 6" /><path d="M12 2V22" /></svg>
                                ) : (
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3.5" aria-hidden="true"><path d="M18 8L22 12L18 16" /><path d="M6 8L2 12L6 16" /><path d="M2 12H22" /></svg>
                                )}
                            </button>
                            <span className="focal-slider-label">SNAP</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});
FocalToolkit.displayName = "FocalToolkit";
