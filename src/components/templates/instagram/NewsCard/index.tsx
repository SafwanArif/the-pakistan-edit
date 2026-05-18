"use client";

import React from "react";
import { Draft } from "../../../../types/news";
import { Platform } from "../../../../config/omnichannel";
import { useNewsCardState } from "../../../../app/admin/hooks/useNewsCardState";
import { AssetLayer } from "./AssetLayer";
import { HighlightedText } from "./HighlightedText";
import { TPEVectorLogo } from "../TPEVectorLogo";
import { OMNI_CONFIG } from "../../../../config/omnichannel";

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
    const { heading, content, source, photo, asset, type } = useNewsCardState(draft, step);
    const dimensions = OMNI_CONFIG[platform];
    const totalSteps = 2 + (draft.extraSlides?.length || 0);

    return (
        <div 
            className="tpe-news-card" 
            data-slide-type={type} 
            data-platform={platform}
            style={{ 
                '--card-w': `${dimensions.width}px`, 
                '--card-h': `${dimensions.height}px` 
            } as any}
        >
            {/* 🏛️ 1. BACKGROUND LAYER ( scrimmed ) */}
            <div className="tpe-news-bg tpe-full-absolute">
                <AssetLayer 
                    bgImage={asset.image || ""} 
                    zoom={asset.imageZoom || 100} 
                    posX={asset.imagePosX || 50} 
                    posY={asset.imagePosY || 50} 
                    mode={asset.snapMode || 'height'} 
                />
                <div className="tpe-news-scrim tpe-full-absolute" />
            </div>

            {/* 🏛️ 2. BRANDING LAYER ( Zidane Standard ) */}
            {type === 'bulletin' ? (
                <div className="tpe-branding-overlay tpe-flex-row">
                    <div className="tpe-brand-left">
                        <TPEVectorLogo scale={1.8} showWordmark={true} />
                    </div>
                    <div className="tpe-brand-right tpe-flex-col">
                        <div className="tpe-category-tag">
                            <span className="tpe-slash">//</span> {draft.category || "NEWS"}
                        </div>
                        <div className="tpe-watermark">@thePakistanEdit</div>
                    </div>
                </div>
            ) : (
                <div className="tpe-branding-mini tpe-flex-row">
                     <TPEVectorLogo scale={0.8} showWordmark={false} />
                     <div className="tpe-category-pill">
                        <span className="tpe-slash">//</span> {draft.category || "STORY"}
                     </div>
                </div>
            )}

            {/* 🏛️ 3. CONTENT LAYER */}
            <div className="tpe-news-inner tpe-flex-col tpe-full-absolute">
                {type === 'bulletin' ? (
                    <div className="tpe-news-h1">
                        <HighlightedText text={heading} />
                    </div>
                ) : (
                    <div className="tpe-narrative-group">
                        <div className="tpe-news-h3-container tpe-flex-row">
                            <div className="tpe-news-h3-bar" />
                            <h3 className="tpe-news-h3">{heading}</h3>
                        </div>
                        <div className="tpe-news-content">
                            <HighlightedText text={content} />
                        </div>
                    </div>
                )}
            </div>

            {/* 🏛️ 4. FOOTER LAYER ( Pagination + Metadata ) */}
            <div className="tpe-news-footer tpe-flex-row">
                <div className="tpe-pagination">
                    {step.toString().padStart(2, '0')} <span className="tpe-slash-dim">/</span> {totalSteps.toString().padStart(2, '0')}
                </div>
                <div className="tpe-metadata-cluster tpe-flex-row">
                    {source && (
                        <span className="tpe-meta-item">
                            <span className="tpe-meta-label">SOURCE:</span> {source}
                        </span>
                    )}
                    {photo && (
                        <span className="tpe-meta-item">
                            <span className="tpe-meta-label">PHOTO:</span> {photo}
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
});

NewsCard.displayName = "NewsCard";
