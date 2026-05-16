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
    const cfg = OMNI_CONFIG[platform];

    const cardStyles = {
        '--card-w': `${cfg.width}px`, 
        '--card-h': `${cfg.height}px`,
        '--p-top': `${cfg.padding.top}px`,
        '--p-right': `${cfg.padding.right}px`,
        '--p-bottom': `${cfg.padding.bottom}px`,
        '--p-left': `${cfg.padding.left}px`,
        '--off-top': `${cfg.offsets.top}px`,
        '--off-bottom': `${cfg.offsets.bottom}px`,
        '--logo-scale': cfg.logoScale,
        '--h1-size': cfg.typography.h1,
        '--narrative-size': type === 'bulletin' ? cfg.typography.slide2 : cfg.typography.slide3,
        '--h3-size': cfg.typography.slide3Heading,
        '--cat-size': cfg.catFontSize,
        '--source-size': cfg.handleFontSize
    } as React.CSSProperties;

    return (
        <div 
            className="tpe-news-card" 
            data-slide-type={type} 
            data-platform={platform}
            style={cardStyles}
        >
            {/* BACKGROUND LAYER */}
            <div className="tpe-news-bg tpe-full-absolute">
                <AssetLayer 
                    bgImage={asset.image || ""} 
                    zoom={asset.imageZoom || 100} 
                    posX={asset.imagePosX || 50} 
                    posY={asset.imagePosY || 50} 
                    mode={asset.snapMode || 'height'} 
                />
                {asset.scrim ? (
                    <div style={{ position: 'absolute', inset: 0, background: `rgba(0,0,0,${asset.scrim / 100})`, zIndex: 6 }} />
                ) : (
                    <div className="tpe-news-scrim" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.95) 100%)', zIndex: 6 }} />
                )}
            </div>

            {/* INSTITUTIONAL LOGO LAYER */}
            <div className="tpe-news-logo-overlay">
                <TPEVectorLogo scale={platform === 'square' ? 0.8 : 1.2} />
            </div>

            {/* CONTENT LAYER */}
            <div className="tpe-news-inner tpe-flex-col tpe-full-absolute">
                {type === 'bulletin' ? (
                    <>
                        <div className="tpe-news-cat-container">
                            <span className="tpe-news-cat">{draft.category || "NEWS"}</span>
                        </div>
                        <div className="tpe-news-h1">
                            <HighlightedText text={heading} />
                        </div>
                    </>
                ) : (
                    <>
                        <div className="tpe-news-h3-container tpe-flex-row">
                            <div className="tpe-news-h3-bar" />
                            <h3 className="tpe-news-h3">{heading}</h3>
                        </div>
                        <div className="tpe-news-narrative tpe-news-slide2">
                            <HighlightedText text={content} />
                        </div>
                    </>
                )}
            </div>

            {/* METADATA LAYER */}
            <div className="tpe-news-source tpe-flex-row">
                {source && <span>{source}</span>}
                {source && photo && <span style={{ opacity: 0.3, margin: '0 6px' }}>|</span>}
                {photo && <span>{photo}</span>}
            </div>
        </div>
    );
});

NewsCard.displayName = "NewsCard";
