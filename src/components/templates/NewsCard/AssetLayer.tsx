"use client";

import React from "react";
import Image from "next/image";
import { clamp } from "@/types/news";

type CSSVarStyle = React.CSSProperties & Record<`--${string}`, string | number>;

interface AssetLayerProps {
    bgImage: string;
    zoom: number;
    posX: number;
    posY: number;
    mode: 'width' | 'height' | 'grid';
    imageWidth?: number;
    imageHeight?: number;
    containerWidth?: number;
    containerHeight?: number;
}

const EMPTY_BACKDROP_STYLE: React.CSSProperties = { position: 'absolute', inset: 0, background: '#050505' };
const BLUR_BASE_STYLE: React.CSSProperties = {
    objectFit: 'cover', objectPosition: 'center', transform: 'scale(1.2) translateZ(0)',
    transformOrigin: 'center', zIndex: 1, pointerEvents: 'none',
};
const BLUR_OPTICAL_STYLE: React.CSSProperties = { ...BLUR_BASE_STYLE, filter: 'blur(80px) brightness(0.7)' };
const BLUR_FALLBACK_STYLE: React.CSSProperties = { ...BLUR_BASE_STYLE, filter: 'blur(80px) brightness(0.6)' };

const isPositiveFinite = (v: number | undefined): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const isValidImageSrc = (raw: string): boolean => raw.startsWith("/") || /^(https?:|data:image\/|blob:)/i.test(raw);

const computeAssetLayout = (
    z: number,
    mode: 'width' | 'height' | 'grid',
    imageWidth?: number,
    imageHeight?: number,
    containerWidth?: number,
    containerHeight?: number,
) => {
    if (isPositiveFinite(imageWidth) && isPositiveFinite(imageHeight) && isPositiveFinite(containerWidth) && isPositiveFinite(containerHeight)) {
        const imgAR = imageWidth / imageHeight;
        const contAR = containerWidth / containerHeight;
        const coverScale = imgAR > contAR ? imgAR / contAR : contAR / imgAR;
        const widthScale = imgAR > contAR ? 1 : contAR / imgAR;
        const heightScale = imgAR > contAR ? imgAR / contAR : 1;
        const baseScale = mode === 'width' ? widthScale : mode === 'height' ? heightScale : coverScale;
        const dynamicScale = baseScale * z;
        return { coversCanvas: dynamicScale >= coverScale - 0.005, objectFit: 'contain' as const, scale: dynamicScale, blurStyle: BLUR_OPTICAL_STYLE };
    }
    return { coversCanvas: mode !== 'width' && z >= 1, objectFit: (mode === 'width' ? 'contain' : 'cover') as 'contain' | 'cover', scale: z, blurStyle: BLUR_FALLBACK_STYLE };
};

/**
 * 2027 Performance Standard: AssetLayer
 * Pure Edge-Bleed Compositing: CSS blur bleeds exact edge pixels outward and skips blur when foreground fills 100%.
 */
export const AssetLayer = React.memo<AssetLayerProps>(({
    bgImage, zoom = 100, posX = 50, posY = 50, mode,
    imageWidth, imageHeight, containerWidth, containerHeight,
}) => {
    const safeSrc = typeof bgImage === "string" ? bgImage.trim() : "";
    if (!safeSrc || !isValidImageSrc(safeSrc)) return <div aria-hidden="true" style={EMPTY_BACKDROP_STYLE} />;

    const z = Math.max(0.1, (Number.isFinite(zoom) ? zoom : 100) / 100);
    const x = clamp(Number.isFinite(posX) ? posX : 50, 0, 100);
    const y = clamp(Number.isFinite(posY) ? posY : 50, 0, 100);
    const { coversCanvas, objectFit, scale, blurStyle } = computeAssetLayout(z, mode, imageWidth, imageHeight, containerWidth, containerHeight);

    const containerStyle: CSSVarStyle = { position: 'absolute', inset: 0, overflow: 'hidden', '--pos-x': `${x}%`, '--pos-y': `${y}%` };

    return (
        <div style={containerStyle}>
            {!coversCanvas && (
                <Image
                    src={safeSrc} alt="" aria-hidden="true" fill unoptimized loading="eager"
                    decoding="sync" crossOrigin="anonymous" referrerPolicy="no-referrer" sizes="100vw"
                    style={blurStyle}
                />
            )}
            <Image
                src={safeSrc} alt="" fill unoptimized loading="eager"
                decoding="sync" crossOrigin="anonymous" referrerPolicy="no-referrer" sizes="100vw"
                style={{
                    objectFit,
                    objectPosition: 'var(--pos-x) var(--pos-y)',
                    transform: `scale(${scale})`,
                    transformOrigin: 'var(--pos-x) var(--pos-y)',
                    zIndex: 5,
                    transition: 'none',
                }}
            />
        </div>
    );
});

AssetLayer.displayName = "AssetLayer";
