"use client";

import React, { useState, useCallback } from "react";
import { Draft } from "../../types/news";
import { useEditorialState } from "./hooks/useEditorialState";
import { runExportEngine } from "./utils/exportEngine";

// Institutional Components
import { DraftForm } from "./components/DraftForm";
import { OmniPreviewGrid } from "./components/OmniPreviewGrid";
import { FocalToolkit } from "./components/FocalToolkit";
import { TPEVectorLogo } from "../../components/templates/instagram/TPEVectorLogo";
import { ExportOverlay } from "./components/ExportOverlay";

/**
 * 2027 Institutional Command Center: AdminDashboard
 * Orchestrates the editorial workflow within a high-density, logical layout.
 */
export default function AdminDashboard() {
    const { isMounted, currentStep, setCurrentStep, activeDraft, updateDraft, resetState, undo, redo, canUndo, canRedo } = useEditorialState();
    const [exporting, setExporting] = useState<string | null>(null);
    const [draggingSlider, setDraggingSlider] = useState<string | null>(null);

    const handleExportBatch = useCallback(async (draft: Draft) => {
        try {
            await runExportEngine(draft, setExporting);
        } catch (e) {
            // Error is now handled via ExportOverlay status state
            console.error("ADMIN_DASHBOARD_EXPORT_INTERCEPT:", e);
        }
    }, []);

    if (!isMounted) return null;

    const totalSteps = 2 + (activeDraft.extraSlides?.length || 0);

    return (
        <div className="dashboard-container">
            <header className="command-ribbon">
                <div className="tpe-flex-row" style={{ flex: 1 }}>
                    <DraftForm draft={activeDraft} onChange={updateDraft} onSubmit={handleExportBatch} step={currentStep} setStep={setCurrentStep} onReset={resetState} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
                </div>
                <div className="tpe-progress-container">
                    {Array.from({ length: totalSteps }).map((_, i) => (
                        <div 
                            key={i} 
                            onClick={() => setCurrentStep(i + 1)} 
                            className="tpe-progress-segment" 
                            data-active={currentStep === i + 1}
                            style={{ 
                                background: currentStep >= i + 1 ? (i < 1 ? 'var(--ui-indicator)' : i === 1 ? 'var(--ui-accent)' : 'var(--ui-text)') : 'transparent' 
                            }} 
                        />
                    ))}
                </div>
                {exporting && (
                    <ExportOverlay 
                        status={exporting} 
                        onClose={() => setExporting(null)} 
                    />
                )}
            </header>

            <main className="sandbox-grid">
                <OmniPreviewGrid draft={activeDraft} currentStep={currentStep} />
                <FocalToolkit activeDraft={activeDraft} updateDraft={updateDraft} currentStep={currentStep} setStep={setCurrentStep} draggingSlider={draggingSlider} setDraggingSlider={setDraggingSlider} undo={undo} redo={redo} canUndo={canUndo} canRedo={canRedo} />
            </main>

            <div id="export-capture-surface" style={{ position: 'fixed', insetInlineStart: '-5000px' }} />
        </div>
    );
}
