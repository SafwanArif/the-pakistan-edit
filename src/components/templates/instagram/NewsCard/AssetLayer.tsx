import React from "react";

interface AssetLayerProps {
    bgImage: string;
    zoom: number;
    posX: number;
    posY: number;
    mode: 'width' | 'height' | 'grid';
}

/**
 * 2027 Performance Standard: AssetLayer
 * Zero-JS Focal Mapping. Uses native browser 'object-position' and CSS variables.
 * Offloads all scaling and translation math to the browser's compositor thread.
 */
export const AssetLayer = React.memo<AssetLayerProps>(({ 
    bgImage, zoom = 100, posX = 50, posY = 50, mode 
}) => {
    if (!bgImage) return <div style={{ position: 'absolute', inset: 0, background: '#050505' }} />;
    
    // 🏛️ Harden values against NaN/undefined
    const z = Math.max(0.1, (zoom || 100) / 100);
    const x = posX ?? 50;
    const y = posY ?? 50;

    return (
        <img 
            src={bgImage} 
            alt="asset" 
            crossOrigin="anonymous" 
            loading="eager"
            decoding="sync"
            style={{ 
                position: "absolute", 
                inset: 0,
                inlineSize: '100%',
                blockSize: '100%',
                // 2027 Pattern: Inject raw percentages into CSS variables
                // @ts-ignore
                '--zoom': `${z}`,
                '--pos-x': `${x}%`,
                '--pos-y': `${y}%`,
                // Native Scaling: Math is now handled by the browser engine
                objectFit: mode === 'grid' ? 'cover' : (mode === 'width' ? 'contain' : 'cover'),
                objectPosition: 'var(--pos-x) var(--pos-y)',
                transform: 'scale(var(--zoom))',
                transformOrigin: 'var(--pos-x) var(--pos-y)',
                zIndex: 5,
                viewTransitionName: 'main-asset',
                transition: 'none'
            } as any} 
        />
    );
});

AssetLayer.displayName = "AssetLayer";
