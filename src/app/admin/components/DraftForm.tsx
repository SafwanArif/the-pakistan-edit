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
                <div onClick={() => { if (window.confirm("Reset draft?")) onReset?.(); }} className="tpe-logo-wrapper">
                    <TPEVectorLogo scale={1.0} showWordmark={false} />
                </div>

                <div className="tpe-header-main">
                    <div className="tpe-step-cluster">
                        <span className="tpe-step-number">{step.toString().padStart(2, '0')}</span>
                        <div className="tpe-flex-row tpe-step-label">
                            <span>{config.label}</span><span className="terminal-cursor">:</span>
                        </div>
                    </div>

                    <div className="tpe-header-tools">
                        {config.fields.map(f => (
                            <React.Fragment key={f}>
                                <EditorialField 
                                    fieldId={f} 
                                    draft={draft} 
                                    onChange={onChange} 
                                    placeholder={f.includes('heading') || f === 'category' ? "CATEGORY / HEADING" : "CONTENT..."}
                                    isMain={f === 'headline' || f.includes('content')}
                                    isCategory={f === 'category' || f.includes('heading')}
                                    tools={config.tools as any}
                                />
                                {f === 'category' && <span className="tpe-separator-pipe">|</span>}
                            </React.Fragment>
                        ))}

                        <UnifiedAssetToolbar 
                            step={step}
                            draft={draft}
                            onChange={onChange}
                            onUpload={(file) => ingestFile(file, step)}
                            onClear={() => clearAsset(step)}
                        />
                    </div>

                    <div className="tpe-nav-cluster">
                        {step > 1 && (
                            <button onClick={() => setStep(step - 1)} className="tpe-nav-btn tpe-btn-gold">BACK</button>
                        )}
                        <button 
                            onClick={() => canProceed && (isLastStep ? onSubmit(draft) : setStep(step + 1))} 
                            disabled={!canProceed || resolving} 
                            className={`tpe-nav-btn ${isLastStep ? "tpe-btn-primary" : "tpe-btn-gold"}`}
                        >
                            {resolving ? "RESOLVING..." : (isLastStep ? "EXPORT BATCH" : "NEXT STEP")}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
