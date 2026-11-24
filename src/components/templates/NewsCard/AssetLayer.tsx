import React from "react";
import Image from "next/image";

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

/**
 * 2027 Performance Standard: AssetLayer
 * Pure Edge-Bleed Compositing: The background is composed of identically scaled 
 * layers sitting behind the sharp foreground. Massive CSS blurs (100px + 30px) 
 * cause the exact edge pixels to bleed outward into a smooth gradient, 
 * filling the empty gaps without distorting or artificially stretching the image.
 */
export const AssetLayer = React.memo<AssetLayerProps>(({ 
    bgImage, zoom = 100, posX = 50, posY = 50, mode,
    imageWidth, imageHeight, containerWidth, containerHeight
}) => {
    if (!bgImage) return <div style={{ position: 'absolute', inset: 0, background: '#050505' }} />;
    
    const z = Math.max(0.1, (zoom ?? 100) / 100);
    const x = posX ?? 50;
    const y = posY ?? 50;

    const hasDimensions = imageWidth && imageHeight && containerWidth && containerHeight;

    if (hasDimensions) {
        // --- 2027 True Optical Zoom ---
        const imgAR = imageWidth! / imageHeight!;
        const contAR = containerWidth! / containerHeight!;
        
        // Ensures `contain` can fill the screen at 100% zoom without black bars
        const coverScale = imgAR > contAR ? imgAR / contAR : contAR / imgAR;
        const widthScale = imgAR > contAR ? 1 : contAR / imgAR;
        const heightScale = imgAR > contAR ? imgAR / contAR : 1;

        let baseScale = coverScale; // Default to fill template
        if (mode === 'width') baseScale = widthScale;
        if (mode === 'height') baseScale = heightScale;

        const dynamicScale = baseScale * z;
        // Skip mounting the full-res blur(80px) backdrop when the sharp foreground already fills 100% of the card
        const coversCanvas = dynamicScale >= coverScale - 0.005;

        const containerStyle: CSSVarStyle = {
            position: 'absolute', inset: 0, overflow: 'hidden',
            '--pos-x': `${x}%`, '--pos-y': `${y}%`
        };

        return (
            <div style={containerStyle}>
                {/* Layer 1: Ambient Blurred Backdrop (only mounted when foreground leaves empty margins) */}
                {!coversCanvas && (
                    <Image src={bgImage} alt="" aria-hidden="true" fill unoptimized loading="eager" decoding="sync" referrerPolicy="no-referrer" sizes="100vw" style={{
                        objectFit: 'cover', objectPosition: 'var(--pos-x) var(--pos-y)',
                        filter: 'blur(80px) brightness(0.7)',
                        transform: `scale(1.2)`,
                        transformOrigin: 'var(--pos-x) var(--pos-y)',
                        zIndex: 1, pointerEvents: 'none'
                    }} />
                )}

                {/* Layer 2: Sharp Foreground Asset */}
                <Image src={bgImage} alt="asset" fill unoptimized loading="eager" decoding="sync" referrerPolicy="no-referrer" sizes="100vw" style={{
                    objectFit: 'contain', objectPosition: 'var(--pos-x) var(--pos-y)',
                    transform: `scale(${dynamicScale})`,
                    transformOrigin: 'var(--pos-x) var(--pos-y)',
                    zIndex: 5, transition: 'none'
                }} />
            </div>
        );
    }

    // --- Fallback Standard CSS Mode ---
    const fallbackCovers = mode !== 'width' && z >= 1;
    const fallbackStyle: CSSVarStyle = {
        position: 'absolute', inset: 0,
        '--zoom': `${z}`, '--pos-x': `${x}%`, '--pos-y': `${y}%`
    };

    return (
        <div style={fallbackStyle}>
            {!fallbackCovers && (
                <Image src={bgImage} alt="" aria-hidden="true" fill unoptimized loading="eager" decoding="sync" referrerPolicy="no-referrer" sizes="100vw" style={{
                    objectFit: 'cover', objectPosition: 'var(--pos-x) var(--pos-y)',
                    filter: 'blur(80px) brightness(0.6)',
                    transform: 'scale(1.2)', transformOrigin: 'var(--pos-x) var(--pos-y)',
                    zIndex: 1, pointerEvents: 'none'
                }} />
            )}
            <Image src={bgImage} alt="asset" fill unoptimized loading="eager" decoding="sync" referrerPolicy="no-referrer" sizes="100vw" style={{
                objectFit: mode === 'grid' ? 'cover' : (mode === 'width' ? 'contain' : 'cover'),
                objectPosition: 'var(--pos-x) var(--pos-y)',
                transform: 'scale(var(--zoom))', transformOrigin: 'var(--pos-x) var(--pos-y)',
                zIndex: 5, transition: 'none'
            }} />
        </div>
    );
});

AssetLayer.displayName = "AssetLayer";
