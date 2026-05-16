"use client";

import React, { useState, useRef } from "react";
import { Draft } from "../../../types/news";
import { DraftResolver, getEffectiveSlideAsset } from "../utils/dataAccessors";
import { useClickOutside } from "../hooks/useClickOutside";
import { UploadIcon, LinkIcon, CloseIcon } from "../../../components/icons/TPEIcons";
import { ImageCreditToolbar, SourcePrefixToolbar } from "./EditorialTools";

interface UnifiedAssetToolbarProps {
    step: number;
    draft: Draft;
    onChange: (d: Draft) => void;
    onUpload: (file: File) => void;
    onClear: () => void;
}

/**
 * 2027 Institutional Standard: UnifiedAssetToolbar (Simplified)
 * Compact asset ribbon that resolves its own metadata paths from the DraftResolver.
 */
export const UnifiedAssetToolbar = React.memo<UnifiedAssetToolbarProps>(({ 
    step, draft, onChange, onUpload, onClear 
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const containerRef = useClickOutside(() => setIsExpanded(false));

    const asset = getEffectiveSlideAsset(step, draft);
    const hasOverride = !!draft.slideAssets?.[step]?.image || (step === 1 && !!draft.image);

    const handleLinkSubmit = () => {
        const clean = urlInput.trim();
        if (clean) {
            onChange(DraftResolver.set(`slide-${step}-image`, clean, draft));
            setShowLinkInput(false);
        }
    };

    return (
        <div className="tpe-flex-row" style={{ gap: '8px', position: 'relative' }} ref={containerRef}>
            <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="tpe-asset-btn"
                data-active={hasOverride}
            >
                <UploadIcon fill={hasOverride ? "var(--ui-accent)" : "currentColor"} />
            </button>

            <div className={`${isExpanded ? 'tpe-asset-tray-expanded' : 'tpe-hidden'} tpe-flex-col`} style={{ gap: '10px' }}>
                <div className="tpe-flex-row" style={{ gap: '6px' }}>
                    <input type="file" ref={fileInputRef} accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])} />
                    <button onClick={() => fileInputRef.current?.click()} className="tpe-asset-btn"><UploadIcon /></button>
                    <button onClick={() => setShowLinkInput(!showLinkInput)} className="tpe-asset-btn" data-active={showLinkInput}><LinkIcon /></button>
                    {hasOverride && <button onClick={onClear} className="tpe-asset-btn tpe-asset-btn-danger"><CloseIcon /></button>}
                </div>

                {showLinkInput && (
                    <div className="tpe-asset-input-wrapper">
                        <input 
                            className="tpe-popover-input" 
                            placeholder="PASTE URL..." 
                            value={urlInput} 
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleLinkSubmit()}
                        />
                    </div>
                )}

                {/* 🏛️ Metadata Resolution (Credit/Source) */}
                {hasOverride && (
                    <div className="tpe-flex-col" style={{ gap: '8px', paddingBlockStart: '8px', borderBlockStart: '1px solid var(--ui-border)' }}>
                        <div className="tpe-source-row-wrapper">
                            <ImageCreditToolbar 
                                value={DraftResolver.get(`slide-${step}-imageCredit`, draft)} 
                                prefix={DraftResolver.get(`slide-${step}-creditPrefix`, draft) || "PHOTO:"} 
                                onPrefixChange={(p: string) => onChange(DraftResolver.set(`slide-${step}-creditPrefix`, p, draft))}
                                onUpdate={(v: string) => onChange(DraftResolver.set(`slide-${step}-imageCredit`, v, draft))}
                            />
                            <input 
                                className="tpe-input-field tpe-uppercase" 
                                placeholder="CREDIT" 
                                value={DraftResolver.get(`slide-${step}-imageCredit`, draft)}
                                onChange={(e) => onChange(DraftResolver.set(`slide-${step}-imageCredit`, e.target.value, draft))}
                            />
                        </div>

                        {step !== 1 && (
                            <div className="tpe-source-row-wrapper">
                                <SourcePrefixToolbar 
                                    value={DraftResolver.get(step === 2 ? 'sourceName' : `extra-source-${step-3}`, draft)} 
                                    prefix={DraftResolver.get(step === 2 ? 'sourcePrefix' : `extra-sourcePrefix-${step-3}`, draft) || "SOURCE:"}
                                    onPrefixChange={(p: string) => onChange(DraftResolver.set(step === 2 ? 'sourcePrefix' : `extra-sourcePrefix-${step-3}`, p, draft))}
                                    onUpdate={(v: string) => onChange(DraftResolver.set(step === 2 ? 'sourceName' : `extra-source-${step-3}`, v, draft))}
                                />
                                <input 
                                    className="tpe-input-field tpe-uppercase" 
                                    placeholder="SOURCE" 
                                    value={DraftResolver.get(step === 2 ? 'sourceName' : `extra-source-${step-3}`, draft)}
                                    onChange={(e) => onChange(DraftResolver.set(step === 2 ? 'sourceName' : `extra-source-${step-3}`, e.target.value, draft))}
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
