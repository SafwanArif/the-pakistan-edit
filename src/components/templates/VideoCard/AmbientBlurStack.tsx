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

const FAR_CANVAS_BASE_STYLE: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '380px',
    display: 'block',
    filter: 'blur(72px) saturate(1.55) brightness(0.55)',
    transform: 'scale(1.18) translateZ(0)',
};

const MID_CANVAS_BASE_STYLE: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '280px',
    display: 'block',
    filter: 'blur(24px) saturate(1.3) brightness(0.75)',
    transform: 'scale(1.06) translateZ(0)',
};

const NEAR_CANVAS_BASE_STYLE: React.CSSProperties = {
    position: 'absolute',
    width: '100%',
    height: '180px',
    display: 'block',
    filter: 'blur(3px)',
    transform: 'translateZ(0)',
};

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
    const isTop = direction === 'top';
    const fadeDir = isTop ? 'to top' : 'to bottom';
    const origin = isTop ? 'bottom center' : 'top center';
    const farEdgePos = isTop ? { bottom: '-64px', left: 0 } : { top: '-64px', left: 0 };
    const midEdgePos = isTop ? { bottom: '-24px', left: 0 } : { top: '-24px', left: 0 };
    const nearEdgePos = isTop ? { bottom: 0, left: 0 } : { top: 0, left: 0 };
    const midMask = `linear-gradient(${fadeDir}, black 25%, transparent 100%)`;
    const nearMask = `linear-gradient(${fadeDir}, black 0px, rgba(0,0,0,0.68) 18%, rgba(0,0,0,0.24) 48%, transparent 90%)`;

    return (
        <div
            ref={wrapperRef}
            style={{
                ...WRAPPER_BASE_STYLE,
                ...(liveMode || visible ? { willChange: 'transform' } : {}),
                ...(liveMode ? {} : {
                    transform: `translate3d(0, ${translateY}px, 0)`,
                    visibility: visible ? 'visible' : 'hidden',
                }),
            }}
        >
            <canvas
                ref={farRef}
                width={384}
                height={180}
                style={{
                    ...FAR_CANVAS_BASE_STYLE,
                    ...farEdgePos,
                    transformOrigin: origin,
                }}
            />
            <canvas
                ref={midRef}
                width={384}
                height={180}
                style={{
                    ...MID_CANVAS_BASE_STYLE,
                    ...midEdgePos,
                    transformOrigin: origin,
                    maskImage: midMask,
                    WebkitMaskImage: midMask,
                }}
            />
            <canvas
                ref={nearRef}
                width={384}
                height={180}
                style={{
                    ...NEAR_CANVAS_BASE_STYLE,
                    ...nearEdgePos,
                    transformOrigin: origin,
                    maskImage: nearMask,
                    WebkitMaskImage: nearMask,
                }}
            />
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(${fadeDir}, transparent 0px, rgba(8,8,8,0.52) 210px, #080808 360px, #080808 100%)` }} />
        </div>
    );
});

AmbientBlurStack.displayName = "AmbientBlurStack";
