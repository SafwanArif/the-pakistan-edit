"use client";

import React, { useCallback, useMemo, useState } from "react";
import type { Draft, PostMode } from "@/types/news";
import { EDITORIAL_STEPS } from "@/config/editorial";
import { useAssetManager } from "../hooks/useAssetManager";
import { useClickOutside } from "../hooks/useClickOutside";
import { DraftResolver } from "../utils/dataAccessors";
import { UnifiedAssetToolbar } from "./UnifiedAssetToolbar";
import { EditorialField } from "./EditorialField";
import { CommandRibbonMenu } from "./CommandRibbonMenu";

const stepClusterStyle: React.CSSProperties = { minInlineSize: "auto" };
const stepLabelTextStyle: React.CSSProperties = { marginInlineEnd: "4px" };

interface DraftFormProps {
    draft: Draft;
    onChange: (d: Draft) => void;
    onSubmit: (d: Draft) => void;
    step: number;
    setStep: (s: number) => void | Promise<void>;
    onReset?: () => void | Promise<void>;
    isExporting?: boolean;
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
}

/**
 * Schema-driven form ribbon for Carousel slide editing and batch export.
 */
export const DraftForm: React.FC<DraftFormProps> = React.memo(({
    draft,
    onChange,
    onSubmit,
    step,
    setStep,
    onReset,
    isExporting = false,
    mode,
    onModeChange,
}) => {
    const { resolving, resolve, ingestFile, clearAsset } = useAssetManager(draft, onChange);
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const clearFocusedField = useCallback(() => setFocusedField(null), []);
    const headerRowRef = useClickOutside(clearFocusedField, '[data-editorial-popover="true"]', focusedField !== null);

    const handleUpload = useCallback((file: File) => ingestFile(file, step), [ingestFile, step]);
    const handleLink = useCallback((url: string) => resolve(url, step), [resolve, step]);
    const handleClear = useCallback(() => clearAsset(step), [clearAsset, step]);
    const handleFocusField = useCallback((fieldId: string) => setFocusedField(fieldId), []);

    const handleToolsBlurCapture = useCallback((e: React.FocusEvent<HTMLDivElement>) => {
        const next = e.relatedTarget;
        if (next instanceof Node && e.currentTarget.contains(next)) return;
        if (next instanceof Element && next.closest('[data-editorial-popover="true"]')) return;
        setFocusedField(null);
    }, []);

    // Resolve schema for current step (step 3+ is generated dynamically)
    const config = useMemo(() => {
        if (step >= 3) {
            const index = step - 3;
            return {
                step,
                label: index === 0 ? "Missing Context" : `Deep Angle ${index + 1}`,
                fields: [`extra-heading-${index}`, `extra-content-${index}`],
                required: [`extra-content-${index}`],
            };
        }
        return EDITORIAL_STEPS.find((s) => s.step === step);
    }, [step]);

    if (!config) return null;

    const activeFocusedField = focusedField && config.fields.includes(focusedField) ? focusedField : null;
    const isLastStep = step >= 2 + (draft.extraSlides?.length || 0);

    // Declarative validation (also verifies Slide 1 required fields before allowing EXPORT on Slide 3+)
    const stepValid = config.required.every((f) => {
        if (f === "image") return !!draft.image;
        const val = DraftResolver.get(f, draft);
        return !!(typeof val === "string" ? val.trim() : val);
    });
    const slide1Valid = Boolean(draft.category.trim() && draft.headline.trim() && draft.image);
    const canProceed = isLastStep ? (stepValid && slide1Valid) : stepValid;

    return (
        <div className="tpe-flex-col tpe-draft-form-container">
            <div ref={headerRowRef} className="tpe-header-row" data-focused-field={activeFocusedField || undefined}>
                <CommandRibbonMenu mode={mode} onModeChange={onModeChange} onReset={onReset} disabled={isExporting} />

                {/* Step indicator */}
                <div className="tpe-step-cluster" style={stepClusterStyle}>
                    <span className="tpe-step-number tpe-desktop-only">{step.toString().padStart(2, "0")}</span>
                    <div className="tpe-flex-row tpe-step-label">
                        <span className="tpe-desktop-only" style={stepLabelTextStyle}>{config.label}</span>
                        <span>:</span>
                    </div>
                </div>

                {/* Elastic text inputs */}
                <div className="tpe-header-main">
                    <div className="tpe-header-tools" onBlurCapture={handleToolsBlurCapture}>
                        {config.fields.map((f, i) => {
                            const isCategoryField = f === "category" || f.includes("heading");
                            const isFocused = activeFocusedField === f;
                            const hasOtherFocused = Boolean(activeFocusedField && activeFocusedField !== f);

                            return (
                                <React.Fragment key={f}>
                                    <div
                                        className={`tpe-elastic-field-wrapper ${isFocused ? "tpe-field-expanded" : (hasOtherFocused ? "tpe-field-shrunk" : "")}`}
                                        style={{
                                            flex: isFocused ? 1 : (hasOtherFocused ? 0 : (isCategoryField ? 0.3 : 1)),
                                            opacity: hasOtherFocused ? 0 : 1,
                                            pointerEvents: hasOtherFocused ? "none" : "auto",
                                        }}
                                    >
                                        <EditorialField
                                            fieldId={f}
                                            draft={draft}
                                            onChange={onChange}
                                            placeholder={f === "category" ? "CATEGORY" : (f.includes("heading") ? "HEADING" : "CONTENT...")}
                                            isMain={f === "headline" || f.includes("content")}
                                            isCategory={isCategoryField}
                                            onFocusField={handleFocusField}
                                        />
                                    </div>
                                    {i === 0 && config.fields.length > 1 && !activeFocusedField && <span className="tpe-separator-pipe">|</span>}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* Per-slide asset & credit tray */}
                <UnifiedAssetToolbar
                    step={step}
                    draft={draft}
                    onChange={onChange}
                    onUpload={handleUpload}
                    onLink={handleLink}
                    onClear={handleClear}
                />

                {/* Step navigation & export trigger */}
                <div className="tpe-nav-cluster">
                    {step > 1 && (
                        <button
                            type="button"
                            disabled={isExporting}
                            onClick={() => {
                                setFocusedField(null);
                                void setStep(step - 1);
                            }}
                            className="tpe-nav-btn tpe-btn-gold"
                        >
                            BACK
                        </button>
                    )}
                    <button
                        type="button"
                        aria-label={resolving ? "Resolving remote image" : undefined}
                        onClick={() => {
                            if (!canProceed) return;
                            setFocusedField(null);
                            if (isLastStep) onSubmit(draft);
                            else void setStep(step + 1);
                        }}
                        disabled={!canProceed || resolving || (isLastStep && isExporting)}
                        className={`tpe-nav-btn ${isLastStep ? "tpe-btn-primary" : "tpe-btn-gold"}`}
                    >
                        {resolving ? "..." : (isLastStep ? (isExporting ? "EXPORTING..." : "EXPORT") : "NEXT")}
                    </button>
                </div>
            </div>
        </div>
    );
});
DraftForm.displayName = "DraftForm";
