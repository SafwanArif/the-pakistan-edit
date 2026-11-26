"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { clamp, getSlideCount, type Draft, type PostMode } from "@/types/news";
import { useEditorialState } from "../hooks/useEditorialState";
import { DraftForm } from "./DraftForm";
import { OmniPreviewGrid } from "./OmniPreviewGrid";
import { FocalToolkit } from "./FocalToolkit";
import { ExportOverlay } from "./ExportOverlay";
import { SelectionPopover } from "./SelectionPopover";

const CarouselProgressBar = React.memo<{ totalSteps: number; safeStep: number; inert?: boolean; onSelectStep: (step: number) => void }>(
    ({ totalSteps, safeStep, inert, onSelectStep }) => (
        <div className="tpe-progress-container" inert={inert}>
            {Array.from({ length: totalSteps }, (_, i) => {
                const stepNum = i + 1;
                const isActive = safeStep === stepNum;
                const tone = safeStep < stepNum ? undefined : stepNum === 1 ? "s1" : stepNum === 2 ? "s2" : "rest";
                return (
                    <button
                        key={stepNum}
                        type="button"
                        aria-label={`Go to slide ${stepNum}`}
                        aria-current={isActive ? "step" : undefined}
                        onClick={() => { if (!isActive) onSelectStep(stepNum); }}
                        className="tpe-progress-segment"
                        data-tone={tone}
                    />
                );
            })}
        </div>
    )
);
CarouselProgressBar.displayName = "CarouselProgressBar";

/** Isolated Carousel Studio root — hydrates Carousel state on demand and lazy-loads `exportEngine` on export. */
export default function CarouselStudio({ mode, onModeChange }: { mode: PostMode; onModeChange: (mode: PostMode) => void }) {
    const [exportStatus, setExportStatus] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const exportAbortRef = useRef<AbortController | null>(null);
    const { isMounted, currentStep, setCurrentStep, activeDraft, updateDraft, resetState, undo, redo, canUndo, canRedo } = useEditorialState();

    const totalSteps = getSlideCount(activeDraft);
    const safeStep = Number.isFinite(currentStep) ? clamp(Math.trunc(currentStep), 1, totalSteps) : 1;

    useEffect(() => {
        if (isMounted && currentStep !== safeStep) void setCurrentStep(safeStep);
    }, [isMounted, currentStep, safeStep, setCurrentStep]);

    useEffect(() => () => {
        exportAbortRef.current?.abort();
        exportAbortRef.current = null;
    }, []);

    const handleSelectStep = useCallback((stepNum: number) => { void setCurrentStep(stepNum); }, [setCurrentStep]);

    const handleCloseExport = useCallback(() => {
        exportAbortRef.current?.abort();
        exportAbortRef.current = null;
        setIsExporting(false);
        setExportStatus(null);
    }, []);

    const handleExportBatch = useCallback(async (draft: Draft) => {
        if (exportAbortRef.current) return;
        if (!draft.category.trim() || !draft.headline.trim() || !draft.image) {
            setExportStatus("ERROR: Complete Slide 1 (category, headline, and hero photo) before exporting.");
            return;
        }
        const controller = new AbortController();
        exportAbortRef.current = controller;
        setIsExporting(true);
        try {
            const { runExportEngine } = await import("../utils/exportEngine");
            await runExportEngine(draft, (msg) => { if (!controller.signal.aborted) setExportStatus(msg); }, controller.signal);
        } catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError")) console.error("CAROUSEL_EXPORT_ERROR:", e);
        } finally {
            if (exportAbortRef.current === controller) {
                exportAbortRef.current = null;
                setIsExporting(false);
            }
        }
    }, []);

    if (!isMounted) return null;
    const isModalOpen = Boolean(exportStatus);

    return (
        <>
            <header className="command-ribbon" inert={isModalOpen}>
                <div className="tpe-flex-row">
                    <DraftForm draft={activeDraft} onChange={updateDraft} onSubmit={handleExportBatch} step={safeStep} setStep={setCurrentStep} onReset={resetState} isExporting={isExporting} mode={mode} onModeChange={onModeChange} />
                </div>
            </header>

            <CarouselProgressBar totalSteps={totalSteps} safeStep={safeStep} inert={isModalOpen} onSelectStep={handleSelectStep} />

            {exportStatus && <ExportOverlay status={exportStatus} onClose={handleCloseExport} onCancel={handleCloseExport} />}

            <main className="sandbox-grid" inert={isModalOpen}>
                <OmniPreviewGrid draft={activeDraft} currentStep={safeStep} />
                <FocalToolkit activeDraft={activeDraft} updateDraft={updateDraft} currentStep={safeStep} setStep={setCurrentStep} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
            </main>

            <SelectionPopover postMode="carousel" carouselDraft={activeDraft} onCarouselChange={updateDraft} />
        </>
    );
}
