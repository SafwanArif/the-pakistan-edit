"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { clamp, type Draft, type PostMode } from "@/types/news";
import { useEditorialState } from "../hooks/useEditorialState";
import { isActivationKey } from "../utils/domUtils";
import { DraftForm } from "./DraftForm";
import { OmniPreviewGrid } from "./OmniPreviewGrid";
import { FocalToolkit } from "./FocalToolkit";
import { ExportOverlay } from "./ExportOverlay";
import { SelectionPopover } from "./SelectionPopover";

const ribbonRowStyle: React.CSSProperties = { flex: 1 };
const SEGMENT_STYLES = {
    off: { background: "transparent" },
    s1: { background: "var(--ui-indicator)" },
    s2: { background: "var(--ui-accent)" },
    rest: { background: "var(--ui-text)" },
} satisfies Record<string, React.CSSProperties>;

const CarouselProgressBar = React.memo<{ totalSteps: number; safeStep: number; onSelectStep: (step: number) => void }>(
    ({ totalSteps, safeStep, onSelectStep }) => (
        <div className="tpe-progress-container">
            {Array.from({ length: totalSteps }, (_, i) => {
                const stepNum = i + 1;
                const isActive = safeStep === stepNum;
                const select = () => { if (!isActive) onSelectStep(stepNum); };
                const style = safeStep < stepNum ? SEGMENT_STYLES.off : stepNum === 1 ? SEGMENT_STYLES.s1 : stepNum === 2 ? SEGMENT_STYLES.s2 : SEGMENT_STYLES.rest;
                return (
                    <div
                        key={stepNum}
                        role="button"
                        tabIndex={0}
                        aria-label={`Go to slide ${stepNum}`}
                        aria-current={isActive ? "step" : undefined}
                        onClick={select}
                        onKeyDown={(e) => { if (isActivationKey(e.key)) { e.preventDefault(); select(); } }}
                        className="tpe-progress-segment"
                        style={style}
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

    const totalSteps = 2 + (activeDraft.extraSlides?.length || 0);
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

    return (
        <>
            <header className="command-ribbon">
                <div className="tpe-flex-row" style={ribbonRowStyle}>
                    <DraftForm draft={activeDraft} onChange={updateDraft} onSubmit={handleExportBatch} step={safeStep} setStep={setCurrentStep} onReset={resetState} isExporting={isExporting} mode={mode} onModeChange={onModeChange} />
                </div>
            </header>

            <CarouselProgressBar totalSteps={totalSteps} safeStep={safeStep} onSelectStep={handleSelectStep} />

            {exportStatus && <ExportOverlay status={exportStatus} onClose={handleCloseExport} onCancel={handleCloseExport} />}

            <main className="sandbox-grid">
                <OmniPreviewGrid draft={activeDraft} currentStep={safeStep} />
                <FocalToolkit activeDraft={activeDraft} updateDraft={updateDraft} currentStep={safeStep} setStep={setCurrentStep} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
            </main>

            <SelectionPopover postMode="carousel" carouselDraft={activeDraft} onCarouselChange={updateDraft} />
        </>
    );
}
