"use client";

import React from "react";
import { clamp, type Draft } from "@/types/news";
import { OMNI_CONFIG, type Platform } from "@/config/omnichannel";
import { useNewsCardState } from "@/app/admin/hooks/useNewsCardState";
import { AssetLayer } from "./AssetLayer";
import { HighlightedText } from "./HighlightedText";
import { TPEVectorLogo } from "../TPEVectorLogo";

interface NewsCardProps {
    draft: Draft;
    step?: number;
    platform?: Platform;
}

const PROGRESS_SEG_BASE_STYLE: React.CSSProperties = {
    blockSize: '4px',
    transition: 'background-color 0.3s, box-shadow 0.3s, opacity 0.3s',
};

const renderMeta = (prefix: string, text: string) => (
    <span dir="auto">
        <span className="tpe-meta-label">{prefix}</span> <HighlightedText text={text} />
    </span>
);

/**
 * 2027 Institutional Standard: NewsCard (Restored Narrative)
 * Pure visual component with full narrative fidelity and asset resolution.
 */
export const NewsCard: React.FC<NewsCardProps> = React.memo(({ draft, step = 1, platform = 'instagram' }) => {
    const totalSteps = 2 + (Array.isArray(draft.extraSlides) ? draft.extraSlides.length : 0);
    const safeStep = Number.isFinite(step) ? clamp(Math.trunc(step), 1, totalSteps) : 1;
    const { heading, content, sourcePrefix, sourceText, photoPrefix, photoText, asset, type } = useNewsCardState(draft, safeStep);
    const dimensions = OMNI_CONFIG[platform] ?? OMNI_CONFIG.instagram;

    const progressBars = (
        <div aria-hidden="true" className="tpe-flex-row tpe-news-progress">
            {Array.from({ length: totalSteps }).map((_, i) => {
                const s = i + 1;
                const active = safeStep === s;
                const color = active ? (s === 1 ? "var(--ui-indicator)" : s === 2 ? "var(--ui-accent)" : "var(--ui-text)") : 'oklch(from var(--ui-text) l c h / 0.15)';
                return <div key={s} style={{ ...PROGRESS_SEG_BASE_STYLE, inlineSize: totalSteps > 5 ? '60px' : '80px', background: color, boxShadow: active ? `0 0 20px ${color}` : 'none' }} />;
            })}
        </div>
    );

    return (
        <div
            className="tpe-news-card"
            data-slide-type={type}
            data-platform={platform}
            data-step={safeStep}
            style={{ '--card-w': `${dimensions.width}px`, '--card-h': `${dimensions.height}px` } as React.CSSProperties}
        >
            {/* 1. Background Layer (scrimmed) */}
            <div className="tpe-full-absolute">
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

            {/* 2. Branding Layer */}
            {type === 'bulletin' ? (
                <div className="tpe-branding-overlay tpe-flex-row">
                    <div className="tpe-brand-left" translate="no">
                        <TPEVectorLogo scale={1.8} showWordmark={true} />
                    </div>
                    <div className="tpe-brand-right tpe-flex-col">
                        <div className="tpe-category-tag" dir="auto">
                            <span className="tpe-slash" aria-hidden="true">{"//"}</span> {draft.category || "NEWS"}
                        </div>
                        <div className="tpe-watermark" translate="no">@thePakistanEdit</div>
                    </div>
                </div>
            ) : (
                <div className="tpe-branding-mini tpe-flex-row">
                    <TPEVectorLogo scale={1.15} showWordmark={false} />
                    <div className="tpe-category-pill" dir="auto">
                        <span className="tpe-slash" aria-hidden="true">{"//"}</span> {draft.category || "STORY"}
                    </div>
                </div>
            )}

            {/* 3. Content Layer */}
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
                                <div aria-hidden="true" className="tpe-news-h3-bar" />
                                <h3 dir="auto" className="tpe-news-h3">
                                    <HighlightedText text={heading} />
                                </h3>
                            </div>
                        )}
                        <div dir="auto" className="tpe-news-content">
                            <HighlightedText text={content} />
                        </div>
                    </div>
                )}
            </div>

            {/* 4. Footer Layer */}
            <div className="tpe-news-footer tpe-flex-row">
                <div className="tpe-metadata-cluster tpe-flex-row">
                    {type !== 'bulletin' && photoText && renderMeta(photoPrefix, photoText)}
                </div>
                <div className="tpe-metadata-cluster tpe-flex-row">
                    {sourceText && renderMeta(sourcePrefix, sourceText)}
                    {type === 'bulletin' && photoText && renderMeta(photoPrefix, photoText)}
                </div>
            </div>
        </div>
    );
});

NewsCard.displayName = "NewsCard";
