import React, { useMemo } from "react";
import { TPEMasthead } from "../TPEMasthead";
import { EditorialScrim } from "../EditorialScrim";
import { OMNI_CONFIG, Platform } from "../../../../config/omnichannel";
import { AssetLayer } from "./AssetLayer";
import { HighlightedText } from "./HighlightedText";
import { SlideAsset } from "../../../../types/news";
import { getEffectiveSlideAsset } from "../../../../app/admin/utils/dataAccessors";

export const TOKENS = {
    colors: {
        deepPine: "var(--ui-bg)",
        pakistanGreen: "var(--ui-indicator)",
        crescentGold: "var(--ui-accent)",
        paperWhite: "var(--ui-text)",
    },
    fonts: { serif: "var(--tpe-font-playfair)" }
};

export interface NewsCardProps {
    headline?: string; category?: string; summary?: string; bgImage?: string;
    slide?: number; imageCredit?: string; creditPrefix?: string; sourceName?: string; sourcePrefix?: string;
    imagePosX?: number; imagePosY?: number; imagePosY_Square?: number; imageZoom?: number;
    imageWidth?: number; imageHeight?: number; snapMode?: 'width' | 'height' | 'grid';
    scrim?: number; platform?: Platform; totalSlides?: number;
    extraSlides?: { heading: string; content: string; sourceName?: string; sourcePrefix?: string; }[];
    slideAssets?: Record<number, SlideAsset>;
}

/**
 * 2027 Intelligence Standard: NewsCard
 * Zero-Math Architecture. Offloads all layout and focal calculations to the CSS Engine.
 */
export const NewsCard = React.memo<NewsCardProps>((props) => {
    const { slide = 1, platform = "instagram", totalSlides = 1 } = props;
    const config = OMNI_CONFIG[platform] || OMNI_CONFIG.instagram;

    const asset = useMemo(() => {
        const effective = getEffectiveSlideAsset(slide, props as any);
        return {
            image: effective.image, zoom: effective.imageZoom, 
            posX: effective.imagePosX, posY: (platform === 'square' && effective.imagePosY_Square !== undefined) ? effective.imagePosY_Square : effective.imagePosY, 
            mode: effective.snapMode, scrim: effective.scrim, 
            photoCredit: effective.imageCredit, photoPrefix: effective.creditPrefix
        };
    }, [slide, props, platform]);

    const sourceText = useMemo(() => {
        if (slide === 1) return "";
        const ex = slide === 2 ? { sourcePrefix: props.sourcePrefix, sourceName: props.sourceName } : props.extraSlides?.[slide - 3];
        return ex?.sourceName ? (ex.sourcePrefix?.trim()?.toUpperCase() ? `${ex.sourcePrefix.toUpperCase()} ${ex.sourceName}` : ex.sourceName) : "";
    }, [slide, props.sourceName, props.sourcePrefix, props.extraSlides]);

    const photoText = useMemo(() => asset.photoCredit ? (asset.photoPrefix?.trim() ? `${asset.photoPrefix.toUpperCase()} ${asset.photoCredit}` : asset.photoCredit) : "", [asset]);

    const backgroundLayer = <AssetLayer bgImage={asset.image} zoom={asset.zoom} posX={asset.posX} posY={asset.posY} mode={asset.mode} />;

    return (
        <div className="tpe-news-card" data-slide-type={slide === 1 ? "bulletin" : "narrative"} style={{ 
            '--card-w': `${config.width}px`, 
            '--card-h': `${config.height}px`,
            '--pad-top': `${config.padding.top}px`, '--pad-right': `${config.padding.right}px`, '--pad-bottom': `${config.padding.bottom}px`, '--pad-left': `${config.padding.left}px`,
            '--off-top': `${config.offsets.top}px`, '--off-bottom': `${config.offsets.bottom}px`,
            '--font-h1': config.typography.h1, '--font-slide2': config.typography.slide2, '--font-slide3': config.typography.slide3, '--font-prompt': config.typography.prompt, '--font-h3': config.typography.slide3Heading
        } as React.CSSProperties}>
            {/* 2027 Scenario A & B: Native Scrim and Image Layers */}
            <div className="tpe-news-bg">{backgroundLayer}</div>
            {asset.scrim > 0 && (
                <div style={{ 
                    position: "absolute", inset: 0, 
                    background: `oklch(from black l c h / ${(asset.scrim ?? 0) / 100})`, 
                    zIndex: 10,
                    transition: 'background 0.3s ease'
                }} />
            )}
            
            <TPEMasthead category={props.category || "ECONOMY"} platform={platform} />
            <div className="tpe-news-source">
                {(sourceText && photoText) && <span>{photoText}</span>}
                <span>{sourceText || photoText}</span>
            </div>

            <div className="tpe-news-inner tpe-full-absolute tpe-flex-col">
                <div className="tpe-flex-row tpe-news-progress">
                    {Array.from({ length: totalSlides }).map((_, i) => {
                        const s = i + 1; const active = slide === s;
                        const color = active ? (s === 1 ? TOKENS.colors.pakistanGreen : s === 2 ? TOKENS.colors.crescentGold : TOKENS.colors.paperWhite) : 'oklch(from var(--ui-text) l c h / 0.15)';
                        return <div key={i} style={{ inlineSize: totalSlides > 5 ? '60px' : '80px', blockSize: '4px', background: color, boxShadow: active ? `0 0 20px ${color}` : 'none', transition: 'all 0.3s' }} />;
                    })}
                </div>
                {slide === 1 ? (
                    <div className="tpe-news-h1">
                        <HighlightedText text={props.headline} />
                    </div>
                ) : (
                    <>
                        {props.extraSlides?.[slide - 3]?.heading && (
                            <div className="tpe-flex-row tpe-news-h3-container">
                                <div className="tpe-news-h3-bar" />
                                <h3 className="tpe-news-h3">
                                    <HighlightedText text={props.extraSlides?.[slide - 3]?.heading} />
                                </h3>
                            </div>
                        )}
                        <p className={`tpe-news-narrative ${slide === 2 ? 'tpe-news-slide2' : 'tpe-news-slide3'}`}>
                            <HighlightedText text={slide === 2 ? props.summary : props.extraSlides?.[slide - 3]?.content} />
                        </p>
                        {slide === totalSlides && slide > 2 && <p className="tpe-news-prompt">HAVE YOUR SAY BELOW ↓</p>}
                    </>
                )}
            </div>
            {slide === 1 && <EditorialScrim />}
        </div>
    );
});

NewsCard.displayName = "NewsCard";
