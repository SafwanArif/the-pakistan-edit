"use client";

import React, { useMemo } from "react";
import { Draft } from "../../../types/news";
import { EDITORIAL_STEPS } from "../../../config/editorial";
import { useAssetManager } from "../hooks/useAssetManager";
import { DraftResolver } from "../utils/dataAccessors";
import { UnifiedAssetToolbar } from "./UnifiedAssetToolbar";
import { EditorialField } from "./EditorialField";
import { TPEVectorLogo } from "../../../components/templates/instagram/TPEVectorLogo";

interface DraftFormProps {
    draft: Draft;
    onChange: (d: Draft) => void;
    onSubmit: (d: Draft) => void;
    step: number;
    setStep: (s: number) => void;
    onReset?: () => void;
}

/**
 * 2027 Institutional Standard: DraftForm (Simplified)
 * High-performance, schema-driven orchestrator for the editorial workflow.
 */
export const DraftForm: React.FC<DraftFormProps> = ({ draft, onChange, onSubmit, step, setStep, onReset }) => {
    const { resolving, ingestFile, clearAsset } = useAssetManager(draft, onChange);
    const [focusedField, setFocusedField] = React.useState<string | null>(null);
    
    // 1. Resolve Schema for current step
    const config = useMemo(() => {
        const base = EDITORIAL_STEPS.find(s => s.step === step);
        if (step >= 3) {
            const index = step - 3;
            return {
                ...EDITORIAL_STEPS[2],
                label: index === 0 ? "Missing Context" : `Deep Angle ${index + 1}`,
                fields: [`extra-heading-${index}`, `extra-content-${index}`],
                required: [`extra-content-${index}`]
            };
        }
        return base;
    }, [step]);

    if (!config) return null;

    // 2. Declarative Validation
    const canProceed = config.required.every(f => {
        if (f === 'image') return !!draft.image;
        return !!DraftResolver.get(f, draft)?.trim();
    });

    const isLastStep = step >= 2 + (draft.extraSlides?.length || 0);

    return (
        <div className="tpe-flex-col tpe-draft-form-container">
            <div className="tpe-header-row">
                {/* 1. LOGO */}
                <div onClick={() => { if (window.confirm("Reset draft?")) onReset?.(); }} className="tpe-logo-wrapper">
                    <TPEVectorLogo scale={0.9} showWordmark={false} />
                </div>

                {/* 2. STEP ID (CLEANED FOR MOBILE) */}
                <div className="tpe-step-cluster" style={{ minInlineSize: 'auto' }}>
                    <span className="tpe-step-number tpe-desktop-only">{step.toString().padStart(2, '0')}</span>
                    <div className="tpe-flex-row tpe-step-label">
                        <span className="tpe-desktop-only" style={{ marginInlineEnd: '4px' }}>{config.label}</span>
                        <span className="terminal-cursor">:</span>
                    </div>
                </div>

                {/* 3 & 4. ELASTIC INPUTS */}
                <div className="tpe-header-main">
                    <div className="tpe-header-tools">
                        {config.fields.map((f, i) => {
                            const isFocused = focusedField === f;
                            const hasOtherFocused = focusedField && focusedField !== f;
                            
                            return (
                                <React.Fragment key={f}>
                                    <div 
                                        className={`tpe-elastic-field-wrapper ${isFocused ? 'tpe-field-expanded' : (hasOtherFocused ? 'tpe-field-shrunk' : '')}`}
                                        style={{ 
                                            flex: isFocused ? 1 : (hasOtherFocused ? 0 : (f === 'category' || f.includes('heading') ? 0.3 : 1)),
                                            opacity: hasOtherFocused ? 0 : 1,
                                            pointerEvents: hasOtherFocused ? 'none' : 'auto'
                                        }}
                                    >
                                        <EditorialField 
                                            fieldId={f} 
                                            draft={draft} 
                                            onChange={onChange} 
                                            placeholder={f.includes('heading') || f === 'category' ? "CATEGORY" : "CONTENT..."}
                                            isMain={f === 'headline' || f.includes('content')}
                                            isCategory={f === 'category' || f.includes('heading')}
                                            onFocus={() => setFocusedField(f)}
                                            onBlur={() => setFocusedField(null)}
                                        />
                                    </div>
                                    {i === 0 && config.fields.length > 1 && !focusedField && <span className="tpe-separator-pipe">|</span>}
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>

                {/* 5. ASSET BUTTON (CONTAINS SOURCE/CREDIT) */}
                <UnifiedAssetToolbar 
                    step={step}
                    draft={draft}
                    onChange={onChange}
                    onUpload={(file) => ingestFile(file, step)}
                    onClear={() => clearAsset(step)}
                />

                {/* NAVIGATION */}
                <div className="tpe-nav-cluster">
                    {step > 1 && (
                        <button onClick={() => setStep(step - 1)} className="tpe-nav-btn tpe-btn-gold">BACK</button>
                    )}
                    <button 
                        onClick={() => canProceed && (isLastStep ? onSubmit(draft) : setStep(step + 1))} 
                        disabled={!canProceed || resolving} 
                        className={`tpe-nav-btn ${isLastStep ? "tpe-btn-primary" : "tpe-btn-gold"}`}
                    >
                        {resolving ? "..." : (isLastStep ? "EXPORT" : "NEXT")}
                    </button>
                </div>
            </div>
        </div>
    );
};
