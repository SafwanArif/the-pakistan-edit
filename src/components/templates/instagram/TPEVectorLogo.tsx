"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { clamp } from "../../../types/news";

/**
 * 2027 Professional Quality Vector Logo (Unified SVG Standard)
 * Features a geometrically authentic representation of the Pakistan Crescent and Star
 * and a locked-in wordmark revealed via SVG clipPath for zero horizontal jitter.
 */
const easeOutQuart = (t: number): number => 1 - Math.pow(1 - t, 4);
const clamp01 = (v: number): number => clamp(v, 0, 1);

export function TPEVectorLogo({
    scale = 1,
    showWordmark = true,
    animateWordmark = false,
    wordmarkStartTime = 0
}: {
    scale?: number;
    showWordmark?: boolean;
    animateWordmark?: boolean;
    wordmarkStartTime?: number;
}) {
    const uid = useId();
    const [rafTime, setRafTime] = useState<number | null>(null);
    const startTimeRef = useRef(wordmarkStartTime);

    useEffect(() => {
        startTimeRef.current = wordmarkStartTime;
    }, [wordmarkStartTime]);

    useEffect(() => {
        if (!animateWordmark) return;
        const originMs = performance.now();
        const baseOffset = startTimeRef.current;
        let rafId = 0;

        const tick = (now: number) => {
            const elapsed = baseOffset + (now - originMs) / 1000;
            setRafTime(elapsed);
            if (elapsed < 0.65) {
                rafId = requestAnimationFrame(tick);
            }
        };

        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [animateWordmark]);

    const wordmarkTime = animateWordmark ? (rafTime ?? wordmarkStartTime) : undefined;
    const isWiping = wordmarkTime !== undefined && wordmarkTime < 0.62;
    const line1Pct = isWiping ? easeOutQuart(clamp01((wordmarkTime - 0.18) / 0.30)) : 1;
    const line2Pct = isWiping ? easeOutQuart(clamp01((wordmarkTime - 0.32) / 0.30)) : 1;


    // Unified SVG Dimensions
    // Wordmark version: 72x85, Monogram version: cropped to exact bounds (29x36)
    const width = showWordmark ? 72 : 29;
    const height = showWordmark ? 85 : 36;
    const viewBox = showWordmark ? "0 0 72 85" : "6 6 29 36";
    const centerX = showWordmark ? 72 / 2 : 24; // Ensure translate(0,0) when standalone

    return (
        <svg 
            role="img"
            aria-label="The Pakistan Edit"
            width={width * scale} 
            height={height * scale} 
            viewBox={viewBox} 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            style={{ 
                display: 'block', 
                verticalAlign: 'top',
                overflow: 'visible'
            }}
        >
            {/* Monogram Group - Optically aligned with 'I' in PAKISTAN */}
            <g transform={`translate(${centerX - 24}, 0)`}>
                {/* Rect (White Dash) */}
                <rect x="6" y="22" width="12" height="6" fill="var(--ui-text)" />
                {/* Green P Path - Stem is at x=18-24 (Center 21) */}
                <path fillRule="evenodd" clipRule="evenodd" d="M 18 6 H 24 A 11 11 0 0 1 24 28 V 42 H 18 V 6 Z M 24 12 V 22 A 5 5 0 0 0 24 12 Z" fill="var(--ui-indicator)" />
                {/* Gold Circle */}
                <circle cx="32" cy="39" r="3" fill="var(--ui-accent)" />
            </g>

            {/* Wordmark Group */}
            {showWordmark && (
                <g transform={`translate(${centerX}, 55)`}>
                    {isWiping && (
                        <defs>
                            <clipPath id={`${uid}-l1`}>
                                <rect x="-36" y="-15" width={72 * line1Pct} height="22" />
                            </clipPath>
                            <clipPath id={`${uid}-l2`}>
                                <rect x="-36" y="0" width={72 * line2Pct} height="18" />
                            </clipPath>
                        </defs>
                    )}
                    <text
                        x="0"
                        y={isWiping ? (1 - line1Pct) * 2.5 : 0}
                        textAnchor="middle"
                        fill="var(--ui-accent)"
                        clipPath={isWiping ? `url(#${uid}-l1)` : undefined}
                        style={{
                            fontFamily: 'var(--tpe-font-playfair)',
                            fontSize: '13px',
                            fontWeight: 800,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase'
                        }}
                    >
                        PAKISTAN
                    </text>
                    <text
                        x="0"
                        y={10 + (isWiping ? (1 - line2Pct) * 2.5 : 0)}
                        textAnchor="middle"
                        fill="var(--ui-text)"
                        clipPath={isWiping ? `url(#${uid}-l2)` : undefined}
                        style={{
                            fontFamily: 'var(--tpe-font-inter)',
                            fontSize: '8px',
                            fontWeight: 800,
                            letterSpacing: isWiping ? `${(0.35 + (1 - line2Pct) * 0.07).toFixed(4)}em` : '0.35em',
                            textTransform: 'uppercase'
                        }}
                    >
                        EDIT
                    </text>
                </g>
            )}
        </svg>
    );
};
