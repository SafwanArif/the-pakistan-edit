"use client";

import React, { useState, useEffect, useRef } from "react";
import { Draft } from "../../../types/news";
import { updateSlideAsset } from "../utils/dataAccessors";
import { UploadIcon, LinkIcon, CloseIcon } from "../../../components/icons/TPEIcons";
import { ImageCreditToolbar, SourcePrefixToolbar } from "./EditorialTools";

interface UnifiedAssetToolbarProps {
    hasOverride: boolean;
    currentUrl: string;
    onLink: (url: string) => void;
    onUpload: (data: any) => void;
    onClear: () => void;
    // 2027 Asset Metadata Props
    creditValue?: string;
    creditPrefix?: string;
    onCreditUpdate?: (v: string) => void;
    onCreditPrefixChange?: (p: string) => void;
    // Narrative Source Props
    showSource?: boolean;
    sourceValue?: string;
    sourcePrefix?: string;
    onSourceUpdate?: (v: string) => void;
    onSourcePrefixChange?: (p: string) => void;
}

/**
 * 2027 Institutional Standard: UnifiedAssetToolbar
 * High-fidelity, compact control ribbon for asset ingestion.
 * Preserves the exact visual DNA (Gold/Green/Red/Black palette).
 */
export const UnifiedAssetToolbar = React.memo<UnifiedAssetToolbarProps>(({ 
    hasOverride, currentUrl, onLink, onUpload, onClear, 
    creditValue, creditPrefix, onCreditUpdate, onCreditPrefixChange,
    showSource, sourceValue, sourcePrefix, onSourceUpdate, onSourcePrefixChange
}) => {
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [url, setUrl] = useState(currentUrl || "");
    const linkInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (showLinkInput) linkInputRef.current?.focus();
    }, [showLinkInput]);

    useEffect(() => {
        setUrl(currentUrl || "");
    }, [currentUrl]);

    const handleUpdate = (newUrl: string) => {
        const cleanUrl = newUrl.trim().replace(/^["']|["']$/g, '');
        onLink(cleanUrl);
        setShowLinkInput(false);
    };

    const clear = () => {
        onClear();
        setUrl("");
    };

    const [isExpanded, setIsExpanded] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-close when clicking outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (isExpanded && containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsExpanded(false);
            }
        };
        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, [isExpanded]);

    return (
        <div className="tpe-flex-row" style={{ gap: '8px', position: 'relative' }} ref={containerRef}>
            {/* UNIVERSAL ASSET TRIGGER */}
            <button 
                onClick={() => setIsExpanded(!isExpanded)}
                className="tpe-asset-btn"
                data-active={hasOverride}
                style={{ border: hasOverride ? '1px solid var(--ui-accent)' : '1px solid var(--ui-border)' }}
            >
                {hasOverride ? <UploadIcon fill="var(--ui-accent)" /> : <UploadIcon />}
            </button>

            {/* UNIVERSAL ASSET TRAY */}
            <div className={`${isExpanded ? 'tpe-asset-tray-expanded' : 'tpe-hidden'} tpe-flex-col`} style={{ gap: '10px' }}>
                <div className="tpe-flex-row" style={{ gap: '6px' }}>
                    <input 
                        type="file" 
                        ref={fileInputRef}
                        accept="image/*" 
                        style={{ display: 'none' }} 
                        onChange={(e) => {
                            if (e.target.files?.[0]) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    const img = new Image();
                                    img.onload = () => {
                                        const base = { image: reader.result as string, imageWidth: img.width, imageHeight: img.height, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
                                        onUpload(base);
                                        setIsExpanded(false);
                                    };
                                    img.src = reader.result as string;
                                };
                                reader.readAsDataURL(e.target.files[0]);
                            }
                        }} 
                    />
                    <button 
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
                        className="tpe-asset-btn" 
                        data-active={hasOverride}
                    >
                        <UploadIcon fill="none" stroke={hasOverride ? "white" : "currentColor"} />
                    </button>
                    <button 
                        onClick={() => setShowLinkInput(!showLinkInput)}
                        className="tpe-asset-btn"
                        data-active={showLinkInput}
                    >
                        <LinkIcon />
                    </button>
                    {hasOverride && (
                        <button 
                            onClick={() => { clear(); setIsExpanded(false); }}
                            className="tpe-asset-btn tpe-asset-btn-danger"
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>

                {showLinkInput && (
                    <div className="tpe-asset-input-wrapper" style={{ inlineSize: '100%', margin: 0 }}>
                        <input 
                            ref={linkInputRef}
                            className="tpe-input-minimal" 
                            style={{ fontSize: '11px', flex: 1 }}
                            placeholder="PASTE IMAGE URL..." 
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyDown={(e) => { 
                                if (e.key === 'Enter') handleUpdate(url); 
                                if (e.key === 'Escape') setShowLinkInput(false); 
                            }}
                        />
                        <button 
                            onClick={() => setShowLinkInput(false)} 
                            className="tpe-flex-center"
                            style={{ color: 'oklch(from var(--ui-text) l c h / 0.3)', fontSize: '10px', padding: '4px' }}
                        >
                            ✖
                        </button>
                    </div>
                )}

                {/* 2027 ASSET METADATA ROW (PHOTO CREDIT) */}
                {hasOverride && onCreditUpdate && (
                    <div className="tpe-asset-tray-metadata" style={{ margin: 0, paddingBlockStart: '10px' }}>
                        <div className="tpe-source-row-wrapper" style={{ margin: 0 }}>
                            <ImageCreditToolbar 
                                value={creditValue || ""} 
                                prefix={creditPrefix || "PHOTO:"} 
                                onPrefixChange={(p: string) => onCreditPrefixChange?.(p)} 
                                onUpdate={onCreditUpdate} 
                            />
                            <input 
                                className="tpe-input-field tpe-uppercase tpe-credit-input" 
                                style={{ flex: 1, minWidth: 0, margin: 0 }}
                                placeholder="CREDIT" 
                                value={creditValue || ""} 
                                onChange={(e) => onCreditUpdate(e.target.value)} 
                            />
                        </div>
                    </div>
                )}

                {/* 2027 NARRATIVE SOURCE ROW (MOBILE-ONLY) */}
                {showSource && onSourceUpdate && (
                    <div className="tpe-asset-tray-metadata" style={{ paddingBlockStart: hasOverride ? '8px' : '0', borderBlockStart: hasOverride ? '1px solid var(--ui-border)' : 'none' }}>
                        <div className="tpe-source-row-wrapper" style={{ margin: 0 }}>
                            <SourcePrefixToolbar 
                                value={sourceValue || ""} 
                                prefix={sourcePrefix || "SOURCE:"} 
                                onPrefixChange={(p: string) => onSourcePrefixChange?.(p)} 
                                onUpdate={onSourceUpdate} 
                            />
                            <input 
                                className="tpe-input-field tpe-uppercase tpe-source-input" 
                                style={{ flex: 1, minWidth: 0, margin: 0 }}
                                placeholder="SOURCE" 
                                value={sourceValue || ""} 
                                onChange={(e) => onSourceUpdate(e.target.value)} 
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

UnifiedAssetToolbar.displayName = "UnifiedAssetToolbar";
