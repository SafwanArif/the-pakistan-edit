"use client";

import React from "react";

interface AmbientBlurStackProps {
    direction: 'top' | 'bottom';
    translateY: number;
    visible?: boolean;
    liveMode?: boolean;
    wrapperRef?: React.RefObject<HTMLDivElement | null>;
    farRef: React.RefObject<HTMLCanvasElement | null>;
    midRef: React.RefObject<HTMLCanvasElement | null>;
    nearRef: React.RefObject<HTMLCanvasElement | null>;
}

const WRAPPER_BASE_STYLE: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    backgroundColor: '#080808',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: 1,
    contain: 'strict',
};

const createDirectionStyles = (isTop: boolean) => {
    const fadeDir = isTop ? 'to top' : 'to bottom';
    const edgeKey = isTop ? 'bottom' : 'top';
    const layerBase: React.CSSProperties = {
        position: 'absolute',
        left: 0,
        width: '100%',
        display: 'block',
        transformOrigin: isTop ? 'bottom center' : 'top center',
    };
    const midMask = `linear-gradient(${fadeDir}, black 25%, transparent 100%)`;
    const nearMask = `linear-gradient(${fadeDir}, black 0px, rgba(0,0,0,0.68) 18%, rgba(0,0,0,0.24) 48%, transparent 90%)`;
    return {
        far: { ...layerBase, [edgeKey]: '-64px', height: '380px', filter: 'blur(72px) saturate(1.55) brightness(0.55)', transform: 'scale(1.18) translateZ(0)' } satisfies React.CSSProperties,
        mid: { ...layerBase, [edgeKey]: '-24px', height: '280px', filter: 'blur(24px) saturate(1.3) brightness(0.75)', transform: 'scale(1.06) translateZ(0)', maskImage: midMask, WebkitMaskImage: midMask } satisfies React.CSSProperties,
        near: { ...layerBase, [edgeKey]: 0, height: '180px', filter: 'blur(3px)', transform: 'translateZ(0)', maskImage: nearMask, WebkitMaskImage: nearMask } satisfies React.CSSProperties,
        scrim: { position: 'absolute', inset: 0, background: `linear-gradient(${fadeDir}, transparent 0px, rgba(8,8,8,0.52) 210px, #080808 360px, #080808 100%)` } satisfies React.CSSProperties,
    };
};

const DIRECTION_STYLES = {
    top: createDirectionStyles(true),
    bottom: createDirectionStyles(false),
} as const;

/**
 * 3-tier mirrored ambient colour spill (far 72px, mid 24px, near 3px soft feather) at zIndex 1 behind `<video>`.
 * Each canvas is 384×180 (69,120 px > Chromium's 65,792 px GPU-acceleration threshold) so drawImage stays 100% in VRAM.
 */
export const AmbientBlurStack: React.FC<AmbientBlurStackProps> = React.memo(({
    direction,
    translateY,
    visible = true,
    liveMode = false,
    wrapperRef,
    farRef,
    midRef,
    nearRef,
}) => {
    const dirStyles = DIRECTION_STYLES[direction];
    const safeTranslateY = Number.isFinite(translateY) ? translateY : 0;

    return (
        <div
            ref={wrapperRef}
            aria-hidden="true"
            style={{
                ...WRAPPER_BASE_STYLE,
                ...(liveMode || visible ? { willChange: 'transform' } : {}),
                ...(liveMode ? {} : {
                    transform: `translate3d(0, ${safeTranslateY}px, 0)`,
                    visibility: visible ? 'visible' : 'hidden',
                }),
            }}
        >
            <canvas ref={farRef} width={384} height={180} style={dirStyles.far} />
            <canvas ref={midRef} width={384} height={180} style={dirStyles.mid} />
            <canvas ref={nearRef} width={384} height={180} style={dirStyles.near} />
            <div style={dirStyles.scrim} />
        </div>
    );
});

AmbientBlurStack.displayName = "AmbientBlurStack";
