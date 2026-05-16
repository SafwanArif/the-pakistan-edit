"use client";

import React from "react";
import { Draft } from "../../../../types/news";
import { useNewsCardState } from "../../../hooks/useNewsCardState";
import { AssetLayer } from "./AssetLayer";
import { HighlightedText } from "./HighlightedText";

interface NewsCardProps {
    draft: Draft;
    step?: number;
    platform?: 'instagram' | 'facebook' | 'tiktok' | 'x';
}

/**
 * 2027 Institutional Standard: NewsCard (Zero-Logic Rendering)
 * A pure visual component that offloads all data resolution to the useNewsCardState hook.
 */
export const NewsCard: React.FC<NewsCardProps> = React.memo(({ draft, step = 1, platform = 'instagram' }) => {
    const { heading, content, source, photo, asset, type } = useNewsCardState(draft, step);

    return (
        <div className="tpe-news-card" data-slide-type={type} data-platform={platform}>
            {/* BACKGROUND LAYER */}
            <div className="tpe-news-bg">
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
                    <div className="tpe-news-scrim" style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 40%, rgba(0,0,0,0.9) 100%)', zIndex: 6 }} />
                )}
            </div>

            {/* CONTENT LAYER */}
            <div className="tpe-news-inner tpe-flex-col tpe-full-absolute">
                {type === 'bulletin' ? (
                    <div className="tpe-news-h1">
                        <HighlightedText text={heading} />
                    </div>
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
            <div className="tpe-news-source">
                {source && <span>{source}</span>}
                {photo && <span>{photo}</span>}
            </div>
        </div>
    );
});

NewsCard.displayName = "NewsCard";
