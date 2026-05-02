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
    const { isMounted, currentStep, setCurrentStep, activeDraft, updateDraft, resetState } = useEditorialState();
    const [exporting, setExporting] = useState<string | null>(null);
    const [draggingSlider, setDraggingSlider] = useState<string | null>(null);

    const handleExportBatch = useCallback(async (draft: Draft) => {
        try {
            await runExportEngine(draft, setExporting);
        } catch (e) {
            alert("Export Engine Failure. Check console for logs.");
            setExporting(null);
        }
    }, []);

    if (!isMounted) return null;

    const totalSteps = 2 + (activeDraft.extraSlides?.length || 0);

    return (
        <div className="dashboard-container">
            <header className="command-ribbon">
                <div className="tpe-progress-container">
                    {Array.from({ length: totalSteps }).map((_, i) => (
                        <div key={i} onClick={() => setCurrentStep(i + 1)} className="tpe-progress-segment" style={{ background: currentStep >= i + 1 ? (i < 1 ? 'var(--ui-indicator)' : i === 1 ? 'var(--ui-accent)' : 'var(--ui-text)') : 'transparent', boxShadow: currentStep === i + 1 ? '0 0 10px white' : 'none' }} />
                    ))}
                </div>
                <div onClick={resetState} className="tpe-flex-center" style={{ cursor: 'pointer' }}><TPEVectorLogo scale={1.08} showWordmark={false} /></div>
                <div className="tpe-flex-row" style={{ flex: 1 }}>
                    <DraftForm draft={activeDraft} onChange={updateDraft} onSubmit={handleExportBatch} step={currentStep} setStep={setCurrentStep} />
                </div>
                {exporting && <ExportOverlay status={exporting} />}
            </header>

            <main className="sandbox-grid">
                <OmniPreviewGrid draft={activeDraft} currentStep={currentStep} />
                <FocalToolkit activeDraft={activeDraft} updateDraft={updateDraft} currentStep={currentStep} setStep={setCurrentStep} draggingSlider={draggingSlider} setDraggingSlider={setDraggingSlider} />
            </main>

            <div id="export-capture-surface" style={{ position: 'fixed', insetInlineStart: '-5000px' }} />
        </div>
    );
}
