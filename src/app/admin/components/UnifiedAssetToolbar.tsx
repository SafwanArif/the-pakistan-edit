"use client";

import React, { useCallback, useRef, useState } from "react";
import { Draft } from "@/types/news";
import { DraftResolver, getEffectiveSlideAsset } from "../utils/dataAccessors";
import { isSafeMediaUrl } from "../utils/domUtils";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";
import { UploadIcon, LinkIcon, CloseIcon } from "@/components/icons/TPEIcons";
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
    step, draft, onChange, onUpload, onLink, onClear,
}) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const linkBtnRef = useRef<HTMLButtonElement>(null);

    const closeTray = useCallback((reason?: CloseReason) => {
        setIsExpanded(false);
        setShowLinkInput(false);
        if (reason === "escape") triggerRef.current?.focus();
    }, []);
    const containerRef = useClickOutside(closeTray, '[data-editorial-popover="true"]', isExpanded);

    const hasOverride = !!draft.slideAssets?.[step]?.image || (step === 1 && !!draft.image);

    const handleLinkSubmit = () => {
        const clean = urlInput.trim();
        if (!isSafeMediaUrl(clean, true)) return;
        if (/^https?:\/\//i.test(clean) && onLink) {
            onLink(clean);
        } else {
            onChange(DraftResolver.patchSlide(step, {
                image: clean,
                imageWidth: 0,
                imageHeight: 0,
                imageZoom: 100,
                snapMode: 'height',
                imagePosX: 50,
                imagePosY: 50,
            }, draft));
        }
        setUrlInput("");
        setShowLinkInput(false);
    };

    const effectiveAsset = isExpanded ? getEffectiveSlideAsset(step, draft) : null;
    const hasEffectiveImage = Boolean(effectiveAsset?.image);
    const creditFieldId = `slide-${step}-imageCredit`;
    const creditPrefixFieldId = `slide-${step}-creditPrefix`;
    const sourceFieldId = step === 2 ? 'sourceName' : `extra-source-${step - 3}`;
    const sourcePrefixFieldId = step === 2 ? 'sourcePrefix' : `extra-sourcePrefix-${step - 3}`;
    const imageCredit = effectiveAsset?.imageCredit ?? '';
    const creditPrefix = effectiveAsset?.creditPrefix || "PHOTO:";
    const sourceName = isExpanded && step !== 1 ? String(DraftResolver.get(sourceFieldId, draft) ?? '') : '';
    const sourcePrefix = isExpanded && step !== 1 ? String(DraftResolver.get(sourcePrefixFieldId, draft) || "SOURCE:") : "SOURCE:";

    return (
        <div className="tpe-flex-row tpe-asset-toolbar" ref={containerRef}>
            <button
                ref={triggerRef}
                type="button"
                aria-label="Slide assets and credits"
                aria-expanded={isExpanded}
                aria-haspopup="dialog"
                onClick={() => setIsExpanded((open) => !open)}
                className="tpe-asset-btn"
                data-active={hasOverride}
            >
                <UploadIcon stroke={hasOverride ? "var(--ui-accent)" : "currentColor"} />
            </button>

            {isExpanded && (
                <div role="dialog" aria-label="Slide assets and credits" className="tpe-asset-tray-expanded tpe-flex-col tpe-asset-tray-stack">
                    <div className="tpe-flex-row tpe-asset-tray-actions">
                        <label className="tpe-asset-btn tpe-upload-label" aria-label="Upload image" title="Upload image">
                            <input type="file" className="tpe-sr-only" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ''; }} />
                            <UploadIcon />
                        </label>
                        <button ref={linkBtnRef} type="button" aria-pressed={showLinkInput} aria-label="Paste image URL" onClick={() => setShowLinkInput((v) => !v)} className="tpe-asset-btn" data-active={showLinkInput}><LinkIcon /></button>
                        {hasOverride && <button type="button" aria-label="Clear slide image" onClick={onClear} className="tpe-asset-btn tpe-asset-btn-danger"><CloseIcon /></button>}
                    </div>

                    {showLinkInput && (
                        <input
                            type="url"
                            inputMode="url"
                            enterKeyHint="done"
                            spellCheck={false}
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoFocus
                            aria-label="Paste image URL"
                            autoComplete="off"
                            className="tpe-popover-input"
                            placeholder="PASTE URL..."
                            value={urlInput}
                            onChange={(e) => setUrlInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    handleLinkSubmit();
                                    e.currentTarget.blur();
                                } else if (e.key === 'Escape') {
                                    e.nativeEvent.stopImmediatePropagation();
                                    setUrlInput("");
                                    setShowLinkInput(false);
                                    linkBtnRef.current?.focus();
                                }
                            }}
                        />
                    )}

                    {/* Metadata Resolution (Credit/Source) */}
                    {(hasEffectiveImage || step !== 1) && (
                        <div className="tpe-flex-col tpe-asset-tray-meta">
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
                                        dir="auto"
                                        enterKeyHint="done"
                                        autoCapitalize="words"
                                        className="tpe-input-field tpe-uppercase"
                                        placeholder="CREDIT"
                                        value={imageCredit}
                                        onChange={(e) => onChange(DraftResolver.set(creditFieldId, e.target.value, draft))}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
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
                                        dir="auto"
                                        enterKeyHint="done"
                                        autoCapitalize="words"
                                        className="tpe-input-field tpe-uppercase"
                                        placeholder="SOURCE"
                                        value={sourceName}
                                        onChange={(e) => onChange(DraftResolver.set(sourceFieldId, e.target.value, draft))}
                                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});
UnifiedAssetToolbar.displayName = "UnifiedAssetToolbar";
