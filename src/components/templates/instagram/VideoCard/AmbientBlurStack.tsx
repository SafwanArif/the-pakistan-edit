import React from "react";

interface AmbientBlurStackProps {
    direction: 'top' | 'bottom';
    topPx: number;
    heightPx?: number;
    farRef: React.RefObject<HTMLCanvasElement | null>;
    midRef: React.RefObject<HTMLCanvasElement | null>;
    nearRef: React.RefObject<HTMLCanvasElement | null>;
}

/** 3-tier mirrored ambient colour spill (far 72px, mid 24px, near 2px feather) fading into `#080808`. */
export const AmbientBlurStack: React.FC<AmbientBlurStackProps> = React.memo(({
    direction,
    topPx,
    heightPx,
    farRef,
    midRef,
    nearRef,
}) => {
    const isTop = direction === 'top';
    const fadeDir = isTop ? 'to top' : 'to bottom';
    const origin = isTop ? 'bottom center' : 'top center';
    const edgePos = isTop ? { bottom: 0, left: 0 } : { top: 0, left: 0 };

    return (
        <div
            style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${topPx}px`,
                ...(heightPx !== undefined ? { height: `${heightPx}px` } : { bottom: 0 }),
                overflow: 'hidden',
                pointerEvents: 'none',
                zIndex: 1,
                contain: 'strict',
            }}
        >
            <canvas
                ref={farRef}
                width={64}
                height={36}
                style={{
                    width: '100%',
                    height: '72%',
                    ...(isTop ? { position: 'absolute', bottom: 0, left: 0 } : {}),
                    display: 'block',
                    filter: 'blur(72px) saturate(1.55) brightness(0.55)',
                    transform: 'scale(1.18)',
                    transformOrigin: origin,
                }}
            />
            <canvas
                ref={midRef}
                width={64}
                height={36}
                style={{
                    position: 'absolute',
                    ...edgePos,
                    width: '100%',
                    height: '260px',
                    display: 'block',
                    filter: 'blur(24px) saturate(1.3) brightness(0.75)',
                    transform: 'scale(1.06)',
                    transformOrigin: origin,
                    maskImage: `linear-gradient(${fadeDir}, black 25%, transparent 100%)`,
                    WebkitMaskImage: `linear-gradient(${fadeDir}, black 25%, transparent 100%)`,
                }}
            />
            <canvas
                ref={nearRef}
                width={128}
                height={72}
                style={{
                    position: 'absolute',
                    ...edgePos,
                    width: '100%',
                    height: '160px',
                    display: 'block',
                    filter: 'blur(2px) brightness(0.98)',
                    transform: 'scale(1.01)',
                    transformOrigin: origin,
                    maskImage: `linear-gradient(${fadeDir}, black 0%, rgba(0,0,0,0.6) 45%, transparent 100%)`,
                    WebkitMaskImage: `linear-gradient(${fadeDir}, black 0%, rgba(0,0,0,0.6) 45%, transparent 100%)`,
                }}
            />
            <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(${fadeDir}, transparent 0%, rgba(8,8,8,0.52) 56%, #080808 95%)` }} />
        </div>
    );
});

AmbientBlurStack.displayName = "AmbientBlurStack";
