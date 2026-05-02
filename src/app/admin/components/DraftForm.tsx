"use client";

import React, { useMemo } from "react";
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
    const { resolving } = useAssetResolver(draft, onChange);
    const extraIndex = step - 3;
    const canProceed = step === 1 ? (!!draft.category?.trim() && !!draft.headline?.trim() && !!draft.image) : (step === 2 ? !!draft.summary?.trim() : !!draft.extraSlides?.[0]?.content?.trim());
    const stepLabel = useMemo(() => EDITORIAL_STEPS.find(s => s.step === step)?.label || `Angle ${step - 2}`, [step]);

    return (
        <div className="tpe-flex-row" style={{ color: 'var(--ui-text)', blockSize: '100%', inlineSize: '100%' }}>
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
                            <div className="tpe-flex-row" style={{ flex: 1, position: 'relative' }}>
                                <textarea id="input-headline" className="tpe-textarea tpe-input-field tpe-input-main tpe-uppercase" placeholder="PRIMARY HEADLINE BULLETIN" value={draft.headline} onChange={(e) => onChange({ ...draft, headline: e.target.value })} style={{ paddingInlineEnd: '30px', paddingTop: '7.5px' }} />
                                <EmojiToolbar fieldId="headline" value={draft.headline} onUpdate={(v) => onChange({ ...draft, headline: v })} popDirection="down" right={0} />
                            </div>
                        </>
                    )}
                    <UnifiedAssetToolbar 
                        hasOverride={step === 1 ? !!draft.image : !!draft.slideAssets?.[step]?.image}
                        currentUrl={step === 1 ? (draft.image || "") : (draft.slideAssets?.[step]?.image || "")}
                        onLink={(url) => onChange(step === 1 ? { ...draft, image: url } : updateDraftValue(`slide-image-${step}`, url, draft))}
                        onUpload={(base) => {
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
                    />
                    <div className="tpe-flex-row" style={{ gap: '12px' }}>
                        {step !== 1 && (
                            <SourceRow field={step === 2 ? 'sourceName' : `extra-source-${extraIndex}`} prefixField="sourcePrefix" draft={draft} onChange={onChange} />
                        )}
                        {(step === 1 || !!draft.slideAssets?.[step]?.image) && (
                            <SourceRow field={step === 1 ? 'imageCredit' : `slide-credit-${step}`} prefixField="creditPrefix" draft={draft} onChange={onChange} isCredit />
                        )}
                    </div>
                </div>
            </div>

            <div className="tpe-flex-row" style={{ gap: '10px', marginInlineStart: '16px' }}>
                {step > 1 && <button onClick={() => setStep(step - 1)} className="tpe-btn-gold" style={{ inlineSize: '42px', blockSize: '42px', padding: '0' }}><BackIcon /></button>}
                <button onClick={() => canProceed && (step < 2 + (draft.extraSlides?.length || 0) ? setStep(step + 1) : onSubmit(draft))} disabled={!canProceed || resolving} className={step < 2 + (draft.extraSlides?.length || 0) ? "tpe-btn-gold" : "tpe-btn-primary"} style={{ inlineSize: '180px', blockSize: '42px' }}>
                    {resolving ? 'RESOLVING...' : (canProceed ? (step < 2 + (draft.extraSlides?.length || 0) ? 'NEXT STEP ➔' : 'EXPORT BATCH ⬇') : 'INPUT REQUIRED')}
                </button>
            </div>
        </div>
    );
};
