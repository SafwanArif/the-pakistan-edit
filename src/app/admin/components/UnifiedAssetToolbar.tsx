"use client";

import React, { useState, useEffect, useRef } from "react";
import { Draft } from "../../../types/news";
import { updateSlideAsset } from "../utils/dataAccessors";
import { UploadIcon, LinkIcon, CloseIcon } from "../../../components/icons/TPEIcons";

interface UnifiedAssetToolbarProps {
    hasOverride: boolean;
    currentUrl: string;
    onLink: (url: string) => void;
    onUpload: (data: any) => void;
    onClear: () => void;
}

/**
 * 2027 Institutional Standard: UnifiedAssetToolbar
 * High-fidelity, compact control ribbon for asset ingestion.
 * Preserves the exact visual DNA (Gold/Green/Red/Black palette).
 */
export const UnifiedAssetToolbar = React.memo<UnifiedAssetToolbarProps>(({ hasOverride, currentUrl, onLink, onUpload, onClear }) => {
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [url, setUrl] = useState(currentUrl || "");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (showLinkInput) inputRef.current?.focus();
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

    return (
        <div className="tpe-flex-row" style={{ gap: '8px' }}>
            {showLinkInput ? (
                <div className="tpe-asset-input-wrapper">
                    <input 
                        ref={inputRef}
                        className="tpe-input-minimal" 
                        placeholder="Paste Image URL..." 
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
            ) : (
                <div className="tpe-flex-row" style={{ gap: '6px' }}>
                    <label className="tpe-asset-btn" data-active={hasOverride}>
                        <UploadIcon fill="none" stroke={hasOverride ? "white" : "currentColor"} />
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                            if (e.target.files?.[0]) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                    const img = new Image();
                                    img.onload = () => {
                                        const base = { image: reader.result as string, imageWidth: img.width, imageHeight: img.height, imageZoom: 100, snapMode: 'height' as const, imagePosX: 50, imagePosY: 50 };
                                        onUpload(base);
                                    };
                                    img.src = reader.result as string;
                                };
                                reader.readAsDataURL(e.target.files[0]);
                            }
                        }} />
                    </label>
                    <button 
                        onClick={() => setShowLinkInput(true)}
                        className="tpe-asset-btn"
                    >
                        <LinkIcon />
                    </button>
                    {hasOverride && (
                        <button 
                            onClick={clear}
                            className="tpe-asset-btn tpe-asset-btn-danger"
                        >
                            <CloseIcon />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
});

UnifiedAssetToolbar.displayName = "UnifiedAssetToolbar";
