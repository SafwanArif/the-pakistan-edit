"use client";

import React, { useId, useLayoutEffect, useRef } from "react";
import { clamp, DEFAULT_STAR_CUES } from "../../../types/news";
import {
    CIRCLE_PATH_R3,
    buildLogoEmblemPath,
    clamp01,
    easeOutQuart,
    evaluateEmblemCue,
    getCueTotalDuration,
    getLogoEmblemState,
    getStarDotTransform,
    type LogoMotionConfig,
} from "../../../utils/starMorphMath";

export type { LogoMotionConfig };

interface TPEVectorLogoProps {
    scale?: number;
    showWordmark?: boolean;
    animateWordmark?: boolean;
    wordmarkStartTime?: number;
    externalDriveRef?: React.MutableRefObject<((elapsedSec: number) => void) | null>;
    motionConfig?: LogoMotionConfig;
}

/**
 * 2027 Professional Quality Vector Logo (Unified SVG Standard)
 * Drives the wordmark wipe and on-demand P. dot -> 5-point Pakistan Flag star -> dot spin via SVG DOM refs at native VSync.
 */
export const TPEVectorLogo: React.FC<TPEVectorLogoProps> = React.memo(({
    scale = 1,
    showWordmark = true,
    animateWordmark = false,
    wordmarkStartTime = 0,
    externalDriveRef,
    motionConfig,
}) => {
    const uid = useId();
    const startTimeRef = useRef(wordmarkStartTime);
    const motionConfigRef = useRef(motionConfig);
    const isPreviewingRef = useRef(false);
    const rect1Ref = useRef<SVGRectElement>(null);
    const rect2Ref = useRef<SVGRectElement>(null);
    const text1Ref = useRef<SVGTextElement>(null);
    const text2Ref = useRef<SVGTextElement>(null);
    const dotPathRef = useRef<SVGPathElement>(null);

    useLayoutEffect(() => {
        startTimeRef.current = wordmarkStartTime;
        motionConfigRef.current = motionConfig;
    }, [wordmarkStartTime, motionConfig]);

    useLayoutEffect(() => {
        const previewNonce = motionConfig?.previewNonce ?? 0;
        const dotEl = dotPathRef.current;
        if (!previewNonce || !dotEl) return;

        isPreviewingRef.current = true;
        const cfg = motionConfigRef.current;
        const morphDur = clamp(cfg?.morphDuration ?? 0.45, 0.15, 2.0);
        const holdDur = clamp(cfg?.holdDuration ?? 0.5, 0, 5.0);
        const starScale = cfg?.starScale ?? 100;
        const spinMode = cfg?.spinMode ?? 'ccw';
        const sequence = cfg?.sequence ?? 'star-crescent';
        const holdFeel = cfg?.holdFeel ?? 'drift';
        const total = getCueTotalDuration(morphDur, holdDur, sequence);
        const originMs = performance.now();
        let rafId = 0;

        const tickPreview = (now: number) => {
            const localElapsed = (now - originMs) / 1000;
            if (localElapsed >= total) {
                dotEl.setAttribute("d", CIRCLE_PATH_R3);
                dotEl.setAttribute("transform", "translate(32 39)");
                isPreviewingRef.current = false;
                return;
            }
            const st = evaluateEmblemCue(localElapsed, morphDur, holdDur, spinMode, sequence, holdFeel);
            dotEl.setAttribute("d", buildLogoEmblemPath(st.shapeA, st.shapeB, st.mix, starScale));
            dotEl.setAttribute("transform", getStarDotTransform(st.expandFactor, st.angleDeg, starScale));
            rafId = requestAnimationFrame(tickPreview);
        };

        rafId = requestAnimationFrame(tickPreview);
        return () => {
            cancelAnimationFrame(rafId);
            isPreviewingRef.current = false;
            dotEl.setAttribute("d", CIRCLE_PATH_R3);
            dotEl.setAttribute("transform", "translate(32 39)");
        };
    }, [motionConfig?.previewNonce]);

    useLayoutEffect(() => {
        const r1 = rect1Ref.current;
        const r2 = rect2Ref.current;
        const t1 = text1Ref.current;
        const t2 = text2Ref.current;
        const dotEl = dotPathRef.current;
        let lastDotPath = "";
        let lastDotTransform = "";
        let wordmarkSettled = false;

        const applyProgress = (elapsed: number, forceRest = false) => {
            const cfg = motionConfigRef.current;
            if (showWordmark) {
                const wordmarkOn = cfg?.enableWordmark !== false;
                if (forceRest || !animateWordmark || !wordmarkOn || elapsed >= 0.62) {
                    if (!wordmarkSettled) {
                        if (r1) r1.setAttribute("width", "72");
                        if (r2) r2.setAttribute("width", "72");
                        if (t1) t1.setAttribute("y", "0");
                        if (t2) t2.setAttribute("y", "10");
                        wordmarkSettled = true;
                    }
                } else {
                    wordmarkSettled = false;
                    const p1 = easeOutQuart(clamp01((elapsed - 0.18) / 0.30));
                    const p2 = easeOutQuart(clamp01((elapsed - 0.32) / 0.30));
                    if (r1) r1.setAttribute("width", String(72 * p1));
                    if (r2) r2.setAttribute("width", String(72 * p2));
                    if (t1) t1.setAttribute("y", String((1 - p1) * 2.5));
                    if (t2) t2.setAttribute("y", String(10 + (1 - p2) * 2.5));
                }
            }
            if (dotEl && !isPreviewingRef.current) {
                const st = forceRest || elapsed <= 0
                    ? { shapeA: "dot" as const, shapeB: "dot" as const, mix: 0, expandFactor: 0, angleDeg: 0 }
                    : getLogoEmblemState(elapsed, cfg);
                const starScale = cfg?.starScale ?? 100;
                const nextD = buildLogoEmblemPath(st.shapeA, st.shapeB, st.mix, starScale);
                const nextTransform = getStarDotTransform(st.expandFactor, st.angleDeg, starScale);
                if (nextD !== lastDotPath) {
                    lastDotPath = nextD;
                    dotEl.setAttribute("d", nextD);
                }
                if (nextTransform !== lastDotTransform) {
                    lastDotTransform = nextTransform;
                    dotEl.setAttribute("transform", nextTransform);
                }
            }
        };

        if (!animateWordmark) {
            if (externalDriveRef) externalDriveRef.current = null;
            applyProgress(startTimeRef.current, false);
            return;
        }

        // When driven externally by useSmoothFramingLoop, lock intro animation 1:1 to live video playback time
        if (externalDriveRef) {
            externalDriveRef.current = (t) => applyProgress(t, false);
            applyProgress(startTimeRef.current, false);
            return () => {
                externalDriveRef.current = null;
            };
        }

        const originMs = performance.now();
        const baseOffset = startTimeRef.current;
        const cfg = motionConfigRef.current;
        const morphDur = clamp(cfg?.morphDuration ?? 0.45, 0.15, 2.0);
        const holdDur = clamp(cfg?.holdDuration ?? 0.5, 0, 5.0);
        const sequence = cfg?.sequence ?? 'star-crescent';
        const cues = cfg?.starCues ?? DEFAULT_STAR_CUES;
        let maxCueTime = 0;
        for (let i = 0; i < cues.length; i++) {
            if (cues[i]!.time > maxCueTime) maxCueTime = cues[i]!.time;
        }
        const cutoff = Math.max(0.7, maxCueTime + getCueTotalDuration(morphDur, holdDur, sequence) + 0.1);
        let rafId = 0;

        applyProgress(baseOffset, false);
        const tick = (now: number) => {
            const elapsed = baseOffset + (now - originMs) / 1000;
            applyProgress(elapsed, false);
            if (elapsed < cutoff) {
                rafId = requestAnimationFrame(tick);
            }
        };

        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [animateWordmark, showWordmark, externalDriveRef]);

    useLayoutEffect(() => {
        if (animateWordmark || isPreviewingRef.current) return;
        const dotEl = dotPathRef.current;
        if (!dotEl) return;
        const t = startTimeRef.current;
        const cfg = motionConfigRef.current;
        const st = t > 0
            ? getLogoEmblemState(t, cfg)
            : { shapeA: "dot" as const, shapeB: "dot" as const, mix: 0, expandFactor: 0, angleDeg: 0 };
        const starScale = cfg?.starScale ?? 100;
        dotEl.setAttribute("d", buildLogoEmblemPath(st.shapeA, st.shapeB, st.mix, starScale));
        dotEl.setAttribute("transform", getStarDotTransform(st.expandFactor, st.angleDeg, starScale));
    }, [
        animateWordmark,
        wordmarkStartTime,
        motionConfig?.starCues,
        motionConfig?.morphDuration,
        motionConfig?.holdDuration,
        motionConfig?.starScale,
        motionConfig?.spinMode,
        motionConfig?.sequence,
        motionConfig?.holdFeel,
    ]);

    const wordmarkClipOn = animateWordmark && (motionConfig?.enableWordmark !== false);

    const width = showWordmark ? 72 : 29;
    const height = showWordmark ? 85 : 36;
    const viewBox = showWordmark ? "0 0 72 85" : "6 6 29 36";
    const centerX = showWordmark ? 72 / 2 : 24;

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
                overflow: 'visible',
            }}
        >
            {/* Monogram Group - Optically aligned with 'I' in PAKISTAN */}
            <g transform={`translate(${centerX - 24}, 0)`}>
                <rect x="6" y="22" width="12" height="6" fill="var(--ui-text)" />
                <path fillRule="evenodd" clipRule="evenodd" d="M 18 6 H 24 A 11 11 0 0 1 24 28 V 42 H 18 V 6 Z M 24 12 V 22 A 5 5 0 0 0 24 12 Z" fill="var(--ui-indicator)" />
                <path ref={dotPathRef} transform="translate(32 39)" d={CIRCLE_PATH_R3} fill="var(--ui-accent)" />
            </g>

            {/* Wordmark Group */}
            {showWordmark && (
                <g transform={`translate(${centerX}, 55)`}>
                    {wordmarkClipOn && (
                        <defs>
                            <clipPath id={`${uid}-l1`}>
                                <rect ref={rect1Ref} x="-36" y="-15" width="72" height="22" />
                            </clipPath>
                            <clipPath id={`${uid}-l2`}>
                                <rect ref={rect2Ref} x="-36" y="0" width="72" height="18" />
                            </clipPath>
                        </defs>
                    )}
                    <text
                        ref={text1Ref}
                        x="0"
                        y="0"
                        textAnchor="middle"
                        fill="var(--ui-accent)"
                        clipPath={wordmarkClipOn ? `url(#${uid}-l1)` : undefined}
                        style={{
                            fontFamily: 'var(--tpe-font-playfair)',
                            fontSize: '13px',
                            fontWeight: 800,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase',
                        }}
                    >
                        PAKISTAN
                    </text>
                    <text
                        ref={text2Ref}
                        x="0"
                        y="10"
                        textAnchor="middle"
                        fill="var(--ui-text)"
                        clipPath={wordmarkClipOn ? `url(#${uid}-l2)` : undefined}
                        style={{
                            fontFamily: 'var(--tpe-font-inter)',
                            fontSize: '8px',
                            fontWeight: 800,
                            letterSpacing: '0.35em',
                            textTransform: 'uppercase',
                        }}
                    >
                        EDIT
                    </text>
                </g>
            )}
        </svg>
    );
});

TPEVectorLogo.displayName = "TPEVectorLogo";
