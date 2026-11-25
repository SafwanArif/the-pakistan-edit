"use client";

import React, { useState, useCallback } from "react";
import type { Draft, PostMode } from "../../../types/news";
import { useEditorialState } from "../hooks/useEditorialState";
import { DraftForm } from "./DraftForm";
import { OmniPreviewGrid } from "./OmniPreviewGrid";
import { FocalToolkit } from "./FocalToolkit";
import { ExportOverlay } from "./ExportOverlay";
import { SelectionPopover } from "./SelectionPopover";

interface CarouselStudioProps {
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
}

/**
 * Isolated Carousel Studio root — only hydrates Carousel IndexedDB & undo stack when Carousel mode is active,
 * and dynamically imports `exportEngine` (`jszip` + `html-to-image`) strictly on export click.
 */
export default function CarouselStudio({ mode, onModeChange }: CarouselStudioProps) {
    const [exporting, setExporting] = useState<string | null>(null);
    const {
        isMounted,
        currentStep,
        setCurrentStep,
        activeDraft,
        updateDraft,
        resetState,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useEditorialState();

    const handleExportBatch = useCallback(async (draft: Draft) => {
        try {
            const { runExportEngine } = await import("../utils/exportEngine");
            await runExportEngine(draft, setExporting);
        } catch (e) {
            console.error("ADMIN_DASHBOARD_EXPORT_INTERCEPT:", e);
        }
    }, []);

    if (!isMounted) return null;

    const totalSteps = 2 + (activeDraft.extraSlides?.length || 0);

    return (
        <>
            <header className="command-ribbon">
                <div className="tpe-flex-row" style={{ flex: 1 }}>
                    <DraftForm
                        draft={activeDraft}
                        onChange={updateDraft}
                        onSubmit={handleExportBatch}
                        step={currentStep}
                        setStep={setCurrentStep}
                        onReset={resetState}
                        mode={mode}
                        onModeChange={onModeChange}
                    />
                </div>
            </header>

            {/* PROGRESS BAR */}
            <div className="tpe-progress-container">
                {Array.from({ length: totalSteps }).map((_, i) => {
                    const stepNum = i + 1;
                    const isActive = currentStep === stepNum;
                    const segmentColor = (currentStep >= stepNum)
                        ? (stepNum === 1 ? 'var(--ui-indicator)' : (stepNum === 2 ? 'var(--ui-accent)' : 'var(--ui-text)'))
                        : 'transparent';

                    return (
                        <div
                            key={i}
                            role="button"
                            tabIndex={0}
                            aria-label={`Go to slide ${stepNum}`}
                            aria-current={isActive ? "step" : undefined}
                            onClick={() => setCurrentStep(stepNum)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setCurrentStep(stepNum);
                                }
                            }}
                            className="tpe-progress-segment"
                            data-active={isActive}
                            style={{ background: segmentColor }}
                        />
                    );
                })}
            </div>

            {exporting && (
                <ExportOverlay
                    status={exporting}
                    onClose={() => setExporting(null)}
                />
            )}

            <main className="sandbox-grid">
                <OmniPreviewGrid draft={activeDraft} currentStep={currentStep} />
                <FocalToolkit
                    activeDraft={activeDraft}
                    updateDraft={updateDraft}
                    currentStep={currentStep}
                    setStep={setCurrentStep}
                    undo={undo}
                    redo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                />
            </main>

            <SelectionPopover
                postMode="carousel"
                carouselDraft={activeDraft}
                onCarouselChange={updateDraft}
            />
        </>
    );
}
