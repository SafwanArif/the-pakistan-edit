"use client";

import React, { useState } from "react";
import { Draft } from "../../../types/news";
import { DraftResolver } from "../utils/dataAccessors";
import { useClickOutside } from "../hooks/useClickOutside";
import { UploadIcon, LinkIcon, CloseIcon } from "../../../components/icons/TPEIcons";
import { ImageCreditToolbar, SourcePrefixToolbar } from "./EditorialTools";

interface UnifiedAssetToolbarProps {
    step: number;
    draft: Draft;
    onChange: (d: Draft) => void;
    onUpload: (file: File) => void;
    onLink?: (url: string) => void;
    onClear: () => void;
}

/**
 * Compact asset & metadata tray resolved per Carousel step via DraftResolver.
 */
export const UnifiedAssetToolbar = React.memo<UnifiedAssetToolbarProps>(({ 
    step, draft, onChange, onUpload, onLink, onClear 
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    
    const containerRef = useClickOutside(() => setIsExpanded(false), undefined, isExpanded);

    const hasOverride = !!draft.slideAssets?.[step]?.image || (step === 1 && !!draft.image);
    const hasEffectiveImage = hasOverride || !!draft.image;
    const creditFieldId = `slide-${step}-imageCredit`;
    const creditPrefixFieldId = `slide-${step}-creditPrefix`;
    const sourceFieldId = step === 2 ? 'sourceName' : `extra-source-${step - 3}`;
    const sourcePrefixFieldId = step === 2 ? 'sourcePrefix' : `extra-sourcePrefix-${step - 3}`;
    const imageCredit = String(DraftResolver.get(creditFieldId, draft) ?? '');
    const creditPrefix = String(DraftResolver.get(creditPrefixFieldId, draft) || "PHOTO:");
    const sourceName = String(DraftResolver.get(sourceFieldId, draft) ?? '');
    const sourcePrefix = String(DraftResolver.get(sourcePrefixFieldId, draft) || "SOURCE:");

    const handleLinkSubmit = () => {
        const clean = urlInput.trim();
        if (clean) {
            if (clean.startsWith('http') && onLink) {
                onLink(clean);
            } else {
                onChange(DraftResolver.set(`slide-${step}-image`, clean, draft));
            }
            setUrlInput("");
            setShowLinkInput(false);
        }
    };

    return (
        <div className="tpe-flex-row" style={{ gap: '8px', position: 'relative' }} ref={containerRef}>
            <button 
                type="button"
                aria-label="Slide assets and credits"
                aria-expanded={isExpanded}
                onClick={() => setIsExpanded(!isExpanded)}
                className="tpe-asset-btn"
                data-active={hasOverride}
            >
                <UploadIcon fill={hasOverride ? "var(--ui-accent)" : "currentColor"} />
            </button>

            <div className={`${isExpanded ? 'tpe-asset-tray-expanded' : 'tpe-hidden'} tpe-flex-col`} style={{ gap: '10px' }}>
                <div className="tpe-flex-row" style={{ gap: '6px' }}>
                    <label className="tpe-asset-btn tpe-upload-label" aria-label="Upload image" title="Upload image">
                        <input type="file" className="tpe-sr-only" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
                        <UploadIcon />
                    </label>
                    <button type="button" aria-pressed={showLinkInput} aria-label="Paste image URL" onClick={() => setShowLinkInput(!showLinkInput)} className="tpe-asset-btn" data-active={showLinkInput}><LinkIcon /></button>
                    {hasOverride && <button type="button" aria-label="Clear slide image" onClick={onClear} className="tpe-asset-btn tpe-asset-btn-danger"><CloseIcon /></button>}
                </div>

                {showLinkInput && (
                    <div className="tpe-asset-input-wrapper">
                        <input 
                            type="url"
                            aria-label="Paste image URL"
                            autoComplete="off"
                            className="tpe-popover-input" 
                            placeholder="PASTE URL..." 
                            value={urlInput} 
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLinkSubmit()}
                        />
                    </div>
                )}

                {/* Metadata Resolution (Credit/Source) */}
                {(hasEffectiveImage || step !== 1) && (
                    <div className="tpe-flex-col" style={{ gap: '8px', paddingBlockStart: '8px', borderBlockStart: '1px solid var(--ui-border)' }}>
                        {hasEffectiveImage && (
                            <div className="tpe-source-row-wrapper">
                                <ImageCreditToolbar 
                                    value={imageCredit} 
                                    prefix={creditPrefix} 
                                    onPrefixChange={(p: string) => onChange(DraftResolver.set(creditPrefixFieldId, p, draft))}
                                    onUpdate={(v: string) => onChange(DraftResolver.set(creditFieldId, v, draft))}
                                />
                                <input 
                                    aria-label="Image credit"
                                    className="tpe-input-field tpe-uppercase" 
                                    placeholder="CREDIT" 
                                    value={imageCredit}
                                    onChange={(e) => onChange(DraftResolver.set(creditFieldId, e.target.value, draft))}
                                />
                            </div>
                        )}

                        {step !== 1 && (
                            <div className="tpe-source-row-wrapper">
                                <SourcePrefixToolbar 
                                    fieldId={sourceFieldId}
                                    value={sourceName} 
                                    prefix={sourcePrefix}
                                    onPrefixChange={(p: string) => onChange(DraftResolver.set(sourcePrefixFieldId, p, draft))}
                                    onUpdate={(v: string) => onChange(DraftResolver.set(sourceFieldId, v, draft))}
                                />
                                <input 
                                    id={`input-${sourceFieldId}`}
                                    aria-label="Source name"
                                    className="tpe-input-field tpe-uppercase" 
                                    placeholder="SOURCE" 
                                    value={sourceName}
                                    onChange={(e) => onChange(DraftResolver.set(sourceFieldId, e.target.value, draft))}
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
});

UnifiedAssetToolbar.displayName = "UnifiedAssetToolbar";
