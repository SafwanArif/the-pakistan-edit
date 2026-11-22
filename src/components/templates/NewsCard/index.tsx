"use client";

import React from "react";
import { Draft } from "../../../types/news";
import { Platform } from "../../../config/omnichannel";
import { useNewsCardState } from "../../../app/admin/hooks/useNewsCardState";
import { AssetLayer } from "./AssetLayer";
import { HighlightedText } from "./HighlightedText";
import { TPEVectorLogo } from "../TPEVectorLogo";
import { OMNI_CONFIG } from "../../../config/omnichannel";

interface NewsCardProps {
    draft: Draft;
    step?: number;
    platform?: Platform;
}

/**
 * 2027 Institutional Standard: NewsCard (Restored Narrative)
 * Pure visual component with full narrative fidelity and asset resolution.
 */
export const NewsCard: React.FC<NewsCardProps> = React.memo(({ draft, step = 1, platform = 'instagram' }) => {
    const { heading, content, sourcePrefix, sourceText, photoPrefix, photoText, asset, type } = useNewsCardState(draft, step);
    const dimensions = OMNI_CONFIG[platform];
    const totalSteps = 2 + (draft.extraSlides?.length || 0);

    const progressBars = (
        <div className="tpe-flex-row tpe-news-progress">
            {Array.from({ length: totalSteps }).map((_, i) => {
                const s = i + 1; const active = step === s;
                const color = active ? (s === 1 ? "var(--ui-indicator)" : s === 2 ? "var(--ui-accent)" : "var(--ui-text)") : 'oklch(from var(--ui-text) l c h / 0.15)';
                return <div key={i} style={{ inlineSize: totalSteps > 5 ? '60px' : '80px', blockSize: '4px', background: color, boxShadow: active ? `0 0 20px ${color}` : 'none', transition: 'background-color 0.3s, box-shadow 0.3s, opacity 0.3s' }} />;
            })}
        </div>
    );

    return (
        <div 
            className="tpe-news-card" 
            data-slide-type={type} 
            data-platform={platform}
            data-step={step}
            style={{ 
                '--card-w': `${dimensions.width}px`,  
                '--card-h': `${dimensions.height}px` 
            } as React.CSSProperties}
        >
            {/* 🏛️ 1. BACKGROUND LAYER ( scrimmed ) */}
            <div className="tpe-news-bg tpe-full-absolute">
                <AssetLayer 
                    bgImage={asset.image || ""} 
                    zoom={asset.imageZoom ?? 100} 
                    posX={asset.imagePosX ?? 50} 
                    posY={(platform === 'square' ? (asset.imagePosY_Square ?? asset.imagePosY) : asset.imagePosY) ?? 50} 
                    mode={asset.snapMode || 'height'} 
                    imageWidth={asset.imageWidth}
                    imageHeight={asset.imageHeight}
                    containerWidth={dimensions.width}
                    containerHeight={dimensions.height}
                />
            </div>

            {/* 🏛️ 2. BRANDING LAYER ( Zidane Standard ) */}
            {type === 'bulletin' ? (
                <div className="tpe-branding-overlay tpe-flex-row">
                    <div className="tpe-brand-left" translate="no">
                        <TPEVectorLogo scale={1.8} showWordmark={true} />
                    </div>
                    <div className="tpe-brand-right tpe-flex-col">
                        <div className="tpe-category-tag">
                            <span className="tpe-slash" aria-hidden="true">{"//"}</span> {draft.category || "NEWS"}
                        </div>
                        <div className="tpe-watermark" translate="no">@thePakistanEdit</div>
                    </div>
                </div>
            ) : (
                <div className="tpe-branding-mini tpe-flex-row">
                     <TPEVectorLogo scale={1.15} showWordmark={false} />
                     <div className="tpe-category-pill">
                        <span className="tpe-slash" aria-hidden="true">{"//"}</span> {draft.category || "STORY"}
                     </div>
                </div>
            )}

            {/* 🏛️ 3. CONTENT LAYER */}
            <div className="tpe-news-inner tpe-flex-col tpe-full-absolute">
                {type === 'bulletin' ? (
                    <div className="tpe-bulletin-group">
                        {progressBars}
                        <div dir="auto" className="tpe-news-h1">
                            <HighlightedText text={heading} />
                        </div>
                    </div>
                ) : (
                    <div className="tpe-narrative-group">
                        {progressBars}
                        {heading && (
                            <div className="tpe-news-h3-container tpe-flex-row">
                                <div className="tpe-news-h3-bar" />
                                <h3 dir="auto" className="tpe-news-h3">{heading}</h3>
                            </div>
                        )}
                        <div dir="auto" className="tpe-news-content">
                            <HighlightedText text={content} />
                        </div>
                    </div>
                )}
            </div>

            {/* 🏛️ 4. FOOTER LAYER ( Pagination + Metadata ) */}
            <div className="tpe-news-footer tpe-flex-row">
                <div className="tpe-metadata-cluster tpe-flex-row">
                    {type !== 'bulletin' && photoText && (
                        <span className="tpe-meta-item">
                            <span className="tpe-meta-label">{photoPrefix}</span> {photoText}
                        </span>
                    )}
                </div>
                <div className="tpe-metadata-cluster tpe-flex-row">
                    {sourceText && (
                        <span className="tpe-meta-item">
                            <span className="tpe-meta-label">{sourcePrefix}</span> {sourceText}
                        </span>
                    )}
                    {type === 'bulletin' && photoText && (
                        <span className="tpe-meta-item">
                            <span className="tpe-meta-label">{photoPrefix}</span> {photoText}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});

NewsCard.displayName = "NewsCard";
