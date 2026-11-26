"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { clamp, type Draft, type PostMode } from "@/types/news";
import { useEditorialState } from "../hooks/useEditorialState";
import { DraftForm } from "./DraftForm";
import { OmniPreviewGrid } from "./OmniPreviewGrid";
import { FocalToolkit } from "./FocalToolkit";
import { ExportOverlay } from "./ExportOverlay";
import { SelectionPopover } from "./SelectionPopover";

const ribbonRowStyle: React.CSSProperties = { flex: 1 };
const segmentTransparentStyle: React.CSSProperties = { background: "transparent" };
const segmentIndicatorStyle: React.CSSProperties = { background: "var(--ui-indicator)" };
const segmentAccentStyle: React.CSSProperties = { background: "var(--ui-accent)" };
const segmentTextStyle: React.CSSProperties = { background: "var(--ui-text)" };

const getSegmentStyle = (stepNum: number, safeStep: number): React.CSSProperties => {
    if (safeStep < stepNum) return segmentTransparentStyle;
    if (stepNum === 1) return segmentIndicatorStyle;
    if (stepNum === 2) return segmentAccentStyle;
    return segmentTextStyle;
};

interface CarouselProgressBarProps {
    totalSteps: number;
    safeStep: number;
    onSelectStep: (step: number) => void;
}

const CarouselProgressBar = React.memo<CarouselProgressBarProps>(({ totalSteps, safeStep, onSelectStep }) => (
    <div className="tpe-progress-container">
        {Array.from({ length: totalSteps }, (_, i) => {
            const stepNum = i + 1;
            const isActive = safeStep === stepNum;
            const select = () => {
                if (!isActive) onSelectStep(stepNum);
            };
            return (
                <div
                    key={stepNum}
                    role="button"
                    tabIndex={0}
                    aria-label={`Go to slide ${stepNum}`}
                    aria-current={isActive ? "step" : undefined}
                    onClick={select}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            select();
                        }
                    }}
                    className="tpe-progress-segment"
                    style={getSegmentStyle(stepNum, safeStep)}
                />
            );
        })}
    </div>
));
CarouselProgressBar.displayName = "CarouselProgressBar";

interface CarouselStudioProps {
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
}

/**
 * Isolated Carousel Studio root — only hydrates Carousel IndexedDB & undo stack when Carousel mode is active,
 * and dynamically imports `exportEngine` (`jszip` + `html-to-image`) strictly on export click.
 */
export default function CarouselStudio({ mode, onModeChange }: CarouselStudioProps) {
    const [exportStatus, setExportStatus] = useState<string | null>(null);
    const [isExporting, setIsExporting] = useState(false);
    const exportAbortRef = useRef<AbortController | null>(null);
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

    const totalSteps = 2 + (activeDraft.extraSlides?.length || 0);
    const safeStep = Number.isFinite(currentStep) ? clamp(Math.trunc(currentStep), 1, totalSteps) : 1;

    useEffect(() => {
        if (isMounted && currentStep !== safeStep) {
            void setCurrentStep(safeStep);
        }
    }, [isMounted, currentStep, safeStep, setCurrentStep]);

    useEffect(() => () => {
        exportAbortRef.current?.abort();
        exportAbortRef.current = null;
    }, []);

    const handleSelectStep = useCallback((stepNum: number) => {
        void setCurrentStep(stepNum);
    }, [setCurrentStep]);

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
        const onStatus = (msg: string | null) => {
            if (!controller.signal.aborted) setExportStatus(msg);
        };
        try {
            const { runExportEngine } = await import("../utils/exportEngine");
            await runExportEngine(draft, onStatus, controller.signal);
        } catch (e) {
            if (!(e instanceof DOMException && e.name === "AbortError")) {
                console.error("CAROUSEL_EXPORT_ERROR:", e);
            }
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
                    <DraftForm
                        draft={activeDraft}
                        onChange={updateDraft}
                        onSubmit={handleExportBatch}
                        step={safeStep}
                        setStep={setCurrentStep}
                        onReset={resetState}
                        isExporting={isExporting}
                        mode={mode}
                        onModeChange={onModeChange}
                    />
                </div>
            </header>

            {/* PROGRESS BAR */}
            <CarouselProgressBar
                totalSteps={totalSteps}
                safeStep={safeStep}
                onSelectStep={handleSelectStep}
            />

            {exportStatus && (
                <ExportOverlay
                    status={exportStatus}
                    onClose={handleCloseExport}
                    onCancel={handleCloseExport}
                />
            )}

            <main className="sandbox-grid">
                <OmniPreviewGrid draft={activeDraft} currentStep={safeStep} />
                <FocalToolkit
                    activeDraft={activeDraft}
                    updateDraft={updateDraft}
                    currentStep={safeStep}
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
