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
    bgImage, zoom, posX, posY, mode 
}) => {
    if (!bgImage) return null;
    
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
                '--zoom': `${zoom / 100}`,
                '--pos-x': `${posX}%`,
                '--pos-y': `${posY}%`,
                // Native Scaling: Math is now handled by the browser engine
                objectFit: mode === 'grid' ? 'cover' : (mode === 'width' ? 'contain' : 'cover'),
                objectPosition: 'var(--pos-x) var(--pos-y)',
                transform: 'scale(var(--zoom))',
                transformOrigin: 'var(--pos-x) var(--pos-y)',
                zIndex: 5,
                viewTransitionName: 'main-asset', // Enable native morphing
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
            } as any} 
        />
    );
});

AssetLayer.displayName = "AssetLayer";
