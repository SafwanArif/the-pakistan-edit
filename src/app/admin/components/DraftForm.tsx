"use client";

import React, { useMemo, useEffect } from "react";
import { Draft } from "../../../types/news";
import { EmojiToolbar, SourcePrefixToolbar, ImageCreditToolbar } from "./EditorialTools";
import { getDraftValue, updateDraftValue, updateDraftPrefix, updateSlideAsset } from "../utils/dataAccessors";
import { EDITORIAL_STEPS } from "../../../config/editorial";
import { useAssetResolver } from "../hooks/useAssetResolver";
import { UnifiedAssetToolbar } from "./UnifiedAssetToolbar";
import { BackIcon } from "../../../components/icons/TPEIcons";

/**
 * 2027 Institutional Atomic Layer: SourceRow
 */
const SourceRow = React.memo<{ field: string, prefixField: string, draft: Draft, onChange: (d: Draft) => void, isCredit?: boolean }>(({ field, prefixField, draft, onChange, isCredit }) => {
    const slide = parseInt(field.split('-')[2] || "1", 10);
    const prefix = isCredit ? (draft.slideAssets?.[slide]?.creditPrefix || "PHOTO:") : (getDraftValue(prefixField, draft) || "SOURCE:");
    const Toolbar = isCredit ? ImageCreditToolbar : SourcePrefixToolbar;
    const isBulletin = field === 'category' || field === 'headline' || field === 'sourceName' || field === 'imageCredit';

    return (
        <div className="tpe-source-row-wrapper">
            <Toolbar value={getDraftValue(field, draft)} prefix={prefix} onPrefixChange={(p) => onChange(updateDraftPrefix(field, p, draft))} onUpdate={(v) => onChange(updateDraftValue(field, v, draft))} fieldId={field} />
            <input id={`input-${field}`} className={`tpe-input-field tpe-uppercase ${isCredit ? 'tpe-credit-input' : 'tpe-source-input'}`} placeholder={isCredit ? "CREDIT" : "SOURCE"} value={getDraftValue(field, draft)} onChange={(e) => onChange(updateDraftValue(field, e.target.value, draft))} />
        </div>
    );
});

/**
 * 2027 Institutional Standard: DraftForm
 */
export const DraftForm: React.FC<{ draft: Draft, onChange: (d: Draft) => void, onSubmit: (d: Draft) => void, step: number, setStep: (s: number) => void }> = ({ draft, onChange, onSubmit, step, setStep }) => {
    const { resolving, resolve } = useAssetResolver(draft, onChange);

    useEffect(() => {
        const needsMain = draft.image && !draft.imageWidth;
        if (needsMain) resolve(draft.image || "");
        
        Object.entries(draft.slideAssets || {}).forEach(([s, a]) => {
            if (a.image && !a.imageWidth) resolve(a.image, parseInt(s, 10));
        });
    }, [draft.image, draft.imageWidth, draft.slideAssets, resolve]);

    const extraIndex = step - 3;
    const canProceed = step === 1 ? (!!draft.category?.trim() && !!draft.headline?.trim() && !!draft.image) : (step === 2 ? !!draft.summary?.trim() : !!draft.extraSlides?.[0]?.content?.trim());
    const stepLabel = useMemo(() => EDITORIAL_STEPS.find(s => s.step === step)?.label || `Angle ${step - 2}`, [step]);

    return (
        <div className="tpe-flex-row tpe-draft-form-container" style={{ color: 'var(--ui-text)', blockSize: '100%', inlineSize: '100%' }}>
            <div className="tpe-flex-row" style={{ flex: 1, gap: '16px', minInlineSize: 0 }}>
                <div className="tpe-flex-row" style={{ flexShrink: 0, gap: '10px' }}>
                    <span className="tpe-step-number" style={{ color: 'oklch(from var(--ui-text) l c h / 0.4)', fontSize: '20px', fontWeight: 300, inlineSize: '32px' }}>{step.toString().padStart(2, '0')}</span>
                    <div className="tpe-flex-row tpe-step-label" style={{ fontSize: '13px', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', inlineSize: '145px', justifyContent: 'space-between' }}>
                        <span>{stepLabel}</span><span className="terminal-cursor" style={{ transform: 'translateY(-1.75px)' }}>:</span>
                    </div>
                </div>

                <div className="tpe-flex-row" style={{ flex: 1, minInlineSize: 0, gap: '12px' }}>
                    {step === 2 || step >= 3 ? (
                        <div className="tpe-flex-row" style={{ flex: 1, position: 'relative' }}>
                            <textarea id={`input-${step === 2 ? 'summary' : `extra-content-${extraIndex}`}`} className="tpe-textarea tpe-input-field tpe-input-main" placeholder={step === 2 ? "THE CORE STORY..." : "CONTEXT..."} value={getDraftValue(step === 2 ? 'summary' : `extra-content-${extraIndex}`, draft)} onChange={(e) => onChange(updateDraftValue(step === 2 ? 'summary' : `extra-content-${extraIndex}`, e.target.value, draft))} style={{ paddingInlineEnd: '30px', paddingTop: '7.5px' }} />
                            <EmojiToolbar fieldId={step === 2 ? 'summary' : `extra-content-${extraIndex}`} value={getDraftValue(step === 2 ? 'summary' : `extra-content-${extraIndex}`, draft)} onUpdate={(v) => onChange(updateDraftValue(step === 2 ? 'summary' : `extra-content-${extraIndex}`, v, draft))} popDirection="down" right={0} />
                        </div>
                    ) : (
                        <>
                            <input className="tpe-input-field tpe-input-main tpe-uppercase" placeholder="CATEGORY" value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value })} style={{ inlineSize: '140px' }} />
                            <span style={{ color: 'var(--ui-border)', fontSize: '20px', fontWeight: 200, display: 'flex', alignItems: 'center', marginInline: '-6px', pointerEvents: 'none' }}>|</span>
                            <div className="tpe-flex-row" style={{ flex: 1, position: 'relative' }}>
                                <textarea id="input-headline" className="tpe-textarea tpe-input-field tpe-input-main tpe-uppercase" placeholder="PRIMARY HEADLINE BULLETIN" value={draft.headline} onChange={(e) => onChange({ ...draft, headline: e.target.value })} style={{ paddingInlineEnd: '30px', paddingTop: '7.5px' }} />
                                <EmojiToolbar fieldId="headline" value={draft.headline} onUpdate={(v) => onChange({ ...draft, headline: v })} popDirection="down" right={0} />
                            </div>
                        </>
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
                    />
                    <div className="tpe-flex-row tpe-desktop-only" style={{ gap: '12px' }}>
                        {step !== 1 && (
                            <SourceRow field={step === 2 ? 'sourceName' : `extra-source-${extraIndex}`} prefixField="sourcePrefix" draft={draft} onChange={onChange} />
                        )}
                    </div>
                </div>
            </div>

            <div className="tpe-flex-row" style={{ gap: '4px', marginInlineStart: '4px' }}>
                {step > 1 && (
                    <button 
                        onClick={() => setStep(step - 1)} 
                        className="tpe-nav-btn tpe-btn-gold"
                        style={{ inlineSize: '70px', gap: '6px', paddingInline: '0' }}
                    >
                        <span className="tpe-nav-btn-text" style={{ transform: 'translateY(1px)' }}>BACK</span>
                    </button>
                )}
                <button 
                    onClick={() => canProceed && (step < 2 + (draft.extraSlides?.length || 0) ? setStep(step + 1) : onSubmit(draft))} 
                    disabled={!canProceed || resolving} 
                    className={`tpe-nav-btn ${step < 2 + (draft.extraSlides?.length || 0) ? "tpe-btn-gold" : "tpe-btn-primary"}`} 
                    style={{ inlineSize: '130px', gap: '6px', paddingInline: '0' }}
                >
                    <span className="tpe-nav-btn-text" style={{ transform: 'translateY(1px)' }}>
                        {resolving ? "RESOLVE" : 
                         (canProceed ? (step < 2 + (draft.extraSlides?.length || 0) ? "NEXT STEP" : "EXPORT BATCH") : "INPUT REQ.")}
                    </span>
                    <span className="tpe-nav-btn-icon" style={{ fontSize: '13px', display: 'flex', alignItems: 'center', transform: 'translateY(-0.5px)' }}>→</span>
                </button>
            </div>
        </div>
    );
};
