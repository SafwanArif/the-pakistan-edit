"use client";

import React, { useMemo, useEffect } from "react";
import { Draft } from "../../../types/news";
import { EmojiToolbar, SourcePrefixToolbar, ImageCreditToolbar } from "./EditorialTools";
import { getDraftValue, updateDraftValue, updateDraftPrefix, updateSlideAsset } from "../utils/dataAccessors";
import { EDITORIAL_STEPS } from "../../../config/editorial";
import { useAssetResolver } from "../hooks/useAssetResolver";
import { UnifiedAssetToolbar } from "./UnifiedAssetToolbar";
import { TPEVectorLogo } from "../../../components/templates/instagram/TPEVectorLogo";

/**
 * 2027 Institutional Atomic Layer: SourceRow
 */
const SourceRow = React.memo<{ field: string, prefixField: string, draft: Draft, onChange: (d: Draft) => void, isCredit?: boolean }>(({ field, prefixField, draft, onChange, isCredit }) => {
    const slide = parseInt(field.split('-')[2] || "1", 10);
    const prefix = isCredit ? (draft.slideAssets?.[slide]?.creditPrefix || "PHOTO:") : (getDraftValue(prefixField, draft) || "SOURCE:");
    const Toolbar = isCredit ? ImageCreditToolbar : SourcePrefixToolbar;

    return (
        <div className="tpe-source-row-wrapper">
            <Toolbar value={getDraftValue(field, draft)} prefix={prefix} onPrefixChange={(p: string) => onChange(updateDraftPrefix(field, p, draft))} onUpdate={(v: string) => onChange(updateDraftValue(field, v, draft))} fieldId={field} />
            <input id={`input-${field}`} className={`tpe-input-field tpe-uppercase ${isCredit ? 'tpe-credit-input' : 'tpe-source-input'}`} placeholder={isCredit ? "CREDIT" : "SOURCE"} value={getDraftValue(field, draft)} onChange={(e) => onChange(updateDraftValue(field, e.target.value, draft))} />
        </div>
    );
});

/**
 * 2027 Institutional Atomic Layer: Slide1Editor
 */


const Slide1Editor = React.memo<{ draft: Draft, onChange: (d: Draft) => void }>(({ draft, onChange }) => {
    const [isExpanded, setIsExpanded] = React.useState(false);

    const handleClose = React.useCallback((e?: React.SyntheticEvent) => {
        if (e) e.stopPropagation();
        setIsExpanded(false);
        const el = document.getElementById('input-headline');
        if (el) el.blur();
    }, []);

    return (
        <>
            <input className="tpe-input-field tpe-input-main tpe-uppercase tpe-category-input" placeholder="CATEGORY" value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value })} />
            <span className="tpe-separator-pipe">|</span>
            <div className={`tpe-flex-row tpe-textarea-wrapper ${isExpanded ? 'tpe-expanded' : ''}`} style={{ flex: 1, position: 'relative' }}>
                {isExpanded && <div className="tpe-overlay-backdrop tpe-mobile-only" onPointerDown={handleClose} onClick={handleClose} />}
                <textarea 
                    id="input-headline" 
                    className="tpe-textarea tpe-input-field tpe-input-main tpe-uppercase" 
                    placeholder="PRIMARY HEADLINE BULLETIN" 
                    value={draft.headline} 
                    onChange={(e) => onChange({ ...draft, headline: e.target.value })} 
                    onFocus={() => setIsExpanded(true)}
                    style={{ paddingInlineEnd: '30px', paddingTop: '7.5px' }} 
                />
                {isExpanded && <button onPointerDown={handleClose} onClick={handleClose} className="tpe-done-btn tpe-mobile-only">DONE</button>}
                <EmojiToolbar fieldId="headline" value={draft.headline} onUpdate={(v) => onChange({ ...draft, headline: v })} popDirection="down" right={0} />
            </div>
        </>
    );
});

const NarrativeEditor = React.memo<{ step: number, extraIndex: number, draft: Draft, onChange: (d: Draft) => void }>(({ step, extraIndex, draft, onChange }) => {
    const [isExpanded, setIsExpanded] = React.useState(false);
    const fieldId = step === 2 ? 'summary' : `extra-content-${extraIndex}`;
    const placeholder = step === 2 ? "THE CORE STORY..." : "CONTEXT...";
    const val = getDraftValue(fieldId, draft);

    const handleClose = React.useCallback((e?: React.SyntheticEvent) => {
        if (e) e.stopPropagation();
        setIsExpanded(false);
        const el = document.getElementById(`input-${fieldId}`);
        if (el) el.blur();
    }, [fieldId]);

    return (
        <>
            {step >= 3 && (
                <>
                    <input 
                        className="tpe-input-field tpe-input-main tpe-uppercase tpe-category-input" 
                        placeholder={extraIndex === 0 ? "ANGLE" : "SUPPLEMENT"} 
                        value={draft.extraSlides?.[extraIndex]?.heading || ""} 
                        onChange={(e) => onChange(updateDraftValue(`extra-heading-${extraIndex}`, e.target.value, draft))} 
                    />
                    <span className="tpe-separator-pipe">|</span>
                </>
            )}
            <div className={`tpe-flex-row tpe-textarea-wrapper ${isExpanded ? 'tpe-expanded' : ''}`} style={{ flex: 1, position: 'relative' }}>
                {isExpanded && <div className="tpe-overlay-backdrop tpe-mobile-only" onPointerDown={handleClose} onClick={handleClose} />}
                <textarea 
                    id={`input-${fieldId}`} 
                    className="tpe-textarea tpe-input-field tpe-input-main" 
                    placeholder={placeholder} 
                    value={val} 
                    onChange={(e) => onChange(updateDraftValue(fieldId, e.target.value, draft))} 
                    onFocus={() => setIsExpanded(true)}
                    style={{ paddingInlineEnd: '30px', paddingTop: '7.5px' }} 
                />
                {isExpanded && <button onPointerDown={handleClose} onClick={handleClose} className="tpe-done-btn tpe-mobile-only">DONE</button>}
                <EmojiToolbar fieldId={fieldId} value={val} onUpdate={(v) => onChange(updateDraftValue(fieldId, v, draft))} popDirection="down" right={0} />
            </div>
        </>
    );
});

/**
 * 2027 Institutional Standard: DraftForm
 */
export const DraftForm: React.FC<{ draft: Draft, onChange: (d: Draft) => void, onSubmit: (d: Draft) => void, step: number, setStep: (s: number) => void, onReset?: () => void }> = ({ draft, onChange, onSubmit, step, setStep, onReset }) => {
    const { resolving, resolve } = useAssetResolver(draft, onChange);
    const extraSlides = useMemo(() => draft.extraSlides || [], [draft.extraSlides]);
    const extraIndex = step - 3;
    const isDeletable = step > 3;

    const addExtraSlide = React.useCallback(() => {
        const slides = [...extraSlides];
        slides.splice(extraIndex + 1, 0, { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" });
        onChange({ ...draft, extraSlides: slides });
        setStep(step + 1);
    }, [draft, extraSlides, extraIndex, step, onChange, setStep]);

    const removeExtraSlide = React.useCallback((index: number) => {
        const slides = [...extraSlides];
        slides.splice(index, 1);
        onChange({ ...draft, extraSlides: slides });
        setStep(step - 1);
    }, [draft, extraSlides, step, onChange, setStep]);

    useEffect(() => {
        const needsMain = draft.image && !draft.imageWidth;
        if (needsMain) resolve(draft.image || "");
        
        Object.entries(draft.slideAssets || {}).forEach(([s, a]) => {
            if (a.image && !a.imageWidth) resolve(a.image, parseInt(s, 10));
        });
    }, [draft.image, draft.imageWidth, draft.slideAssets, resolve]);


    const canProceed = step === 1 ? (!!draft.category?.trim() && !!draft.headline?.trim() && !!draft.image) : (step === 2 ? !!draft.summary?.trim() : !!draft.extraSlides?.[0]?.content?.trim());
    const stepLabel = useMemo(() => EDITORIAL_STEPS.find(s => s.step === step)?.label || `Angle ${step - 2}`, [step]);

    return (
        <div className="tpe-flex-col tpe-draft-form-container" style={{ color: 'var(--ui-text)', blockSize: '100%', inlineSize: '100%' }}>
            <div className="tpe-header-row">
                <div onClick={() => { if (window.confirm("Clear all draft progress?")) onReset?.(); }} className="tpe-logo-wrapper">
                    <TPEVectorLogo scale={1.0} showWordmark={false} />
                </div>
                <div className="tpe-header-main">
                <div className="tpe-step-cluster">
                    <span className="tpe-step-number">{step.toString().padStart(2, '0')}</span>
                    <div className="tpe-flex-row tpe-step-label">
                        <span>{stepLabel}</span><span className="terminal-cursor">:</span>
                    </div>
                </div>

                <div className="tpe-header-tools">
                    {step === 1 ? (
                        <Slide1Editor draft={draft} onChange={onChange} />
                    ) : (
                        <NarrativeEditor step={step} extraIndex={extraIndex} draft={draft} onChange={onChange} />
                    )}
                    <UnifiedAssetToolbar 
                        hasOverride={step === 1 ? !!draft.image : !!draft.slideAssets?.[step]?.image}
                        currentUrl={step === 1 ? (draft.image || "") : (draft.slideAssets?.[step]?.image || "")}
                        onLink={(url: string) => onChange(step === 1 ? { ...draft, image: url } : updateDraftValue(`slide-image-${step}`, url, draft))}
                        onUpload={(base: any) => {
                            if (step === 1) onChange({ ...draft, ...base });
                            else {
                                let d = draft;
                                Object.entries(base).forEach(([k, v]) => { 
                                    d = updateSlideAsset(step, k, v, d);
                                });
                                onChange(d);
                            }
                        }}
                        onClear={() => {
                            if (step === 1) {
                                onChange({ ...draft, image: "", imageWidth: undefined, imageHeight: undefined, imageZoom: undefined, imagePosX: undefined, imagePosY: undefined, snapMode: undefined });
                            } else {
                                const assets = { ...(draft.slideAssets || {}) };
                                delete assets[step];
                                onChange({ ...draft, slideAssets: assets });
                            }
                        }}
                        creditValue={step === 1 ? draft.imageCredit : draft.slideAssets?.[step]?.imageCredit}
                        creditPrefix={step === 1 ? draft.creditPrefix : draft.slideAssets?.[step]?.creditPrefix}
                        onCreditUpdate={(v) => onChange(updateDraftValue(step === 1 ? 'imageCredit' : `slide-credit-${step}`, v, draft))}
                        onCreditPrefixChange={(p) => onChange(updateDraftPrefix(step === 1 ? 'imageCredit' : `slide-credit-${step}`, p, draft))}
                        showSource={step !== 1}
                        sourceValue={getDraftValue(step === 2 ? 'sourceName' : `extra-source-${extraIndex}`, draft)}
                        sourcePrefix={step === 1 ? "" : (step === 2 ? (draft.sourcePrefix || "SOURCE:") : (draft.extraSlides?.[extraIndex]?.sourcePrefix || "SOURCE:"))}
                        onSourceUpdate={(v) => onChange(updateDraftValue(step === 2 ? 'sourceName' : `extra-source-${extraIndex}`, v, draft))}
                        onSourcePrefixChange={(p) => onChange(updateDraftPrefix(step === 2 ? 'sourceName' : `extra-source-${extraIndex}`, p, draft))}
                    />
                    <div className="tpe-flex-row tpe-desktop-only" style={{ gap: '12px' }}>
                        {step !== 1 && (
                            <SourceRow field={step === 2 ? 'sourceName' : `extra-source-${extraIndex}`} prefixField="sourcePrefix" draft={draft} onChange={onChange} />
                        )}
                    </div>
                </div>
            <div className="tpe-nav-cluster">
                {step > 1 && (
                    <button 
                        onClick={() => setStep(step - 1)} 
                        className="tpe-nav-btn tpe-btn-gold tpe-nav-back"
                    >
                        <span className="tpe-nav-btn-text">BACK</span>
                    </button>
                )}
                <button 
                    onClick={() => canProceed && (step < 2 + (draft.extraSlides?.length || 0) ? setStep(step + 1) : onSubmit(draft))} 
                    disabled={!canProceed || resolving} 
                    className={`tpe-nav-btn ${step < 2 + (draft.extraSlides?.length || 0) ? "tpe-btn-gold" : "tpe-btn-primary"} tpe-nav-next`} 
                >
                    <span className="tpe-nav-btn-text">
                        {resolving ? "RESOLVE" : 
                         (canProceed ? (step < 2 + (draft.extraSlides?.length || 0) ? "NEXT STEP" : "EXPORT BATCH") : "INPUT REQ.")}
                    </span>
                    <span className="tpe-nav-btn-icon">→</span>
                </button>
            </div>
            </div>
        </div>
        </div>
    );
};
