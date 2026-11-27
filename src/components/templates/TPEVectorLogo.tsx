"use client";

import React, { useId, useLayoutEffect, useRef } from "react";
import { clamp, DEFAULT_STAR_CUES } from "@/types/news";
import {
    CIRCLE_PATH_R3, REST_CUE_STATE, buildLogoEmblemPath, clamp01, easeOutQuart,
    evaluateEmblemCue, getCueTotalDuration, getLogoEmblemState, getStarDotTransform,
    type LogoMotionConfig,
} from "@/utils/starMorphMath";

type EmblemCueState = ReturnType<typeof getLogoEmblemState>;
export type { LogoMotionConfig };

interface TPEVectorLogoProps {
    scale?: number;
    showWordmark?: boolean;
    animateWordmark?: boolean;
    wordmarkStartTime?: number;
    externalDriveRef?: React.MutableRefObject<((elapsedSec: number) => void) | null>;
    motionConfig?: LogoMotionConfig;
    decorative?: boolean;
}

interface DotRenderCache { path: string; transform: string; atRest: boolean; }

const REST_TRANSFORM = "translate(32 39)";
const SVG_ROOT_STYLE: React.CSSProperties = { display: 'block', verticalAlign: 'top', overflow: 'visible' };
const WORDMARK_PAKISTAN_STYLE: React.CSSProperties = {
    fontFamily: 'var(--tpe-font-playfair)', fontSize: '13px', fontWeight: 800, letterSpacing: '0.02em', textTransform: 'uppercase',
};
const WORDMARK_EDIT_STYLE: React.CSSProperties = {
    fontFamily: 'var(--tpe-font-inter)', fontSize: '8px', fontWeight: 800, letterSpacing: '0.35em', textTransform: 'uppercase',
};

const safeStarScale = (cfg: LogoMotionConfig | undefined): number =>
    cfg?.starScale !== undefined && Number.isFinite(cfg.starScale) ? cfg.starScale : 100;

const resetDotCache = (): DotRenderCache => ({ path: "", transform: "", atRest: false });

const applyDotState = (dotEl: SVGPathElement, st: EmblemCueState, starScale: number, cache: DotRenderCache): void => {
    if (st === REST_CUE_STATE) {
        if (cache.atRest) return;
        cache.atRest = true;
        if (cache.path !== CIRCLE_PATH_R3) { cache.path = CIRCLE_PATH_R3; dotEl.setAttribute("d", CIRCLE_PATH_R3); }
        if (cache.transform !== REST_TRANSFORM) { cache.transform = REST_TRANSFORM; dotEl.setAttribute("transform", REST_TRANSFORM); }
        return;
    }
    cache.atRest = false;
    const nextD = buildLogoEmblemPath(st.shapeA, st.shapeB, st.mix, starScale);
    const nextTransform = getStarDotTransform(st.expandFactor, st.angleDeg, starScale);
    if (nextD !== cache.path) { cache.path = nextD; dotEl.setAttribute("d", nextD); }
    if (nextTransform !== cache.transform) { cache.transform = nextTransform; dotEl.setAttribute("transform", nextTransform); }
};

const syncPausedDot = (dotEl: SVGPathElement, rawTime: number, cfg: LogoMotionConfig | undefined, cache: DotRenderCache): void => {
    const t = Number.isFinite(rawTime) && rawTime > 0 ? rawTime : 0;
    applyDotState(dotEl, t > 0 ? getLogoEmblemState(t, cfg) : REST_CUE_STATE, safeStarScale(cfg), cache);
};

/**
 * 2027 Professional Quality Vector Logo (Unified SVG Standard)
 * Drives wordmark wipe and on-demand P. dot -> Pakistan Flag star -> dot spin via SVG DOM refs at native VSync.
 */
export const TPEVectorLogo: React.FC<TPEVectorLogoProps> = React.memo(({
    scale = 1, showWordmark = true, animateWordmark = false, wordmarkStartTime = 0,
    externalDriveRef, motionConfig, decorative = false,
}) => {
    const uid = useId();
    const propsRef = useRef({ wordmarkStartTime, motionConfig, animateWordmark });
    const isPreviewingRef = useRef(false);
    const settledPreviewNonceRef = useRef(motionConfig?.previewNonce ?? 0);
    const dotCacheRef = useRef<DotRenderCache>(resetDotCache());
    const rect1Ref = useRef<SVGRectElement>(null);
    const rect2Ref = useRef<SVGRectElement>(null);
    const text1Ref = useRef<SVGTextElement>(null);
    const text2Ref = useRef<SVGTextElement>(null);
    const dotPathRef = useRef<SVGPathElement>(null);

    const wordmarkClipOn = animateWordmark && (motionConfig?.enableWordmark !== false);

    useLayoutEffect(() => {
        propsRef.current = { wordmarkStartTime, motionConfig, animateWordmark };
    }, [wordmarkStartTime, motionConfig, animateWordmark]);

    useLayoutEffect(() => {
        const previewNonce = motionConfig?.previewNonce ?? 0;
        if (motionConfig?.enableLogo === false) {
            settledPreviewNonceRef.current = previewNonce;
            return;
        }
        const dotEl = dotPathRef.current;
        if (!previewNonce || previewNonce === settledPreviewNonceRef.current || !dotEl) return;

        isPreviewingRef.current = true;
        const cfg = propsRef.current.motionConfig;
        const morphDur = clamp(cfg?.morphDuration ?? 0.45, 0.15, 2.0);
        const holdDur = clamp(cfg?.holdDuration ?? 0.5, 0, 5.0);
        const starScale = safeStarScale(cfg);
        const spinMode = cfg?.spinMode ?? 'ccw';
        const sequence = cfg?.sequence ?? 'star-crescent';
        const holdFeel = cfg?.holdFeel ?? 'drift';
        const total = getCueTotalDuration(morphDur, holdDur, sequence);
        const originMs = performance.now();
        let rafId = 0;

        const restoreDotAfterPreview = () => {
            isPreviewingRef.current = false;
            dotCacheRef.current = resetDotCache();
            if (!dotEl.isConnected) return;
            const cur = propsRef.current;
            syncPausedDot(dotEl, !cur.animateWordmark ? cur.wordmarkStartTime : 0, cur.motionConfig, dotCacheRef.current);
        };

        const tickPreview = (now: number) => {
            const localElapsed = (now - originMs) / 1000;
            if (localElapsed >= total) {
                settledPreviewNonceRef.current = previewNonce;
                restoreDotAfterPreview();
                return;
            }
            applyDotState(dotEl, evaluateEmblemCue(localElapsed, morphDur, holdDur, spinMode, sequence, holdFeel), starScale, dotCacheRef.current);
            rafId = requestAnimationFrame(tickPreview);
        };

        rafId = requestAnimationFrame(tickPreview);
        return () => { cancelAnimationFrame(rafId); restoreDotAfterPreview(); };
    }, [motionConfig?.previewNonce, motionConfig?.enableLogo]);

    useLayoutEffect(() => {
        const dotEl = dotPathRef.current;
        dotCacheRef.current = resetDotCache();
        let wordmarkSettled = false;

        const applyProgress = (elapsed: number, forceRest = false) => {
            const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
            const cfg = propsRef.current.motionConfig;
            if (showWordmark) {
                const r1 = rect1Ref.current, r2 = rect2Ref.current, t1 = text1Ref.current, t2 = text2Ref.current;
                if (forceRest || !animateWordmark || cfg?.enableWordmark === false || safeElapsed >= 0.62) {
                    if (!wordmarkSettled) {
                        r1?.setAttribute("width", "72"); r2?.setAttribute("width", "72");
                        t1?.setAttribute("y", "0"); t2?.setAttribute("y", "10");
                        wordmarkSettled = true;
                    }
                } else {
                    wordmarkSettled = false;
                    const p1 = easeOutQuart(clamp01((safeElapsed - 0.18) / 0.30));
                    const p2 = easeOutQuart(clamp01((safeElapsed - 0.32) / 0.30));
                    r1?.setAttribute("width", String(72 * p1)); r2?.setAttribute("width", String(72 * p2));
                    t1?.setAttribute("y", String((1 - p1) * 2.5)); t2?.setAttribute("y", String(10 + (1 - p2) * 2.5));
                }
            }
            if (dotEl && !isPreviewingRef.current) {
                if (forceRest) applyDotState(dotEl, REST_CUE_STATE, safeStarScale(cfg), dotCacheRef.current);
                else syncPausedDot(dotEl, safeElapsed, cfg, dotCacheRef.current);
            }
        };

        if (!animateWordmark) {
            if (externalDriveRef) externalDriveRef.current = null;
            applyProgress(propsRef.current.wordmarkStartTime, false);
            return;
        }
        if (externalDriveRef) {
            externalDriveRef.current = (t) => applyProgress(t, false);
            applyProgress(propsRef.current.wordmarkStartTime, false);
            return () => { externalDriveRef.current = null; };
        }
        if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
            applyProgress(0, true);
            return;
        }

        const originMs = performance.now();
        const baseOffset = Number.isFinite(propsRef.current.wordmarkStartTime) ? Math.max(0, propsRef.current.wordmarkStartTime) : 0;
        const cfg = propsRef.current.motionConfig;
        const morphDur = clamp(cfg?.morphDuration ?? 0.45, 0.15, 2.0);
        const holdDur = clamp(cfg?.holdDuration ?? 0.5, 0, 5.0);
        const sequence = cfg?.sequence ?? 'star-crescent';
        const cues = cfg?.enableLogo === false ? [] : (cfg?.starCues ?? DEFAULT_STAR_CUES);
        const wordmarkActive = showWordmark && cfg?.enableWordmark !== false;

        if (!wordmarkActive && cues.length === 0) { applyProgress(baseOffset, true); return; }

        let maxCueTime = 0;
        for (const cue of cues) if (Number.isFinite(cue.time) && cue.time > maxCueTime) maxCueTime = cue.time;
        const cutoff = Math.max(wordmarkActive ? 0.7 : 0, cues.length > 0 ? maxCueTime + getCueTotalDuration(morphDur, holdDur, sequence) + 0.1 : 0);

        applyProgress(baseOffset, false);
        if (baseOffset >= cutoff) return;

        let rafId = 0;
        const tick = (now: number) => {
            const elapsed = baseOffset + (now - originMs) / 1000;
            applyProgress(elapsed, false);
            if (elapsed < cutoff) rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafId);
    }, [animateWordmark, showWordmark, wordmarkClipOn, externalDriveRef]);

    useLayoutEffect(() => {
        if (animateWordmark || isPreviewingRef.current || !dotPathRef.current) return;
        syncPausedDot(dotPathRef.current, propsRef.current.wordmarkStartTime, propsRef.current.motionConfig, dotCacheRef.current);
    }, [
        animateWordmark, wordmarkStartTime, motionConfig?.enableLogo, motionConfig?.starCues,
        motionConfig?.morphDuration, motionConfig?.holdDuration, motionConfig?.starScale,
        motionConfig?.spinMode, motionConfig?.sequence, motionConfig?.holdFeel,
    ]);

    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const width = showWordmark ? 72 : 29;
    const height = showWordmark ? 85 : 36;
    const centerX = showWordmark ? 36 : 24;

    return (
        <svg
            aria-hidden={decorative ? "true" : undefined}
            role={decorative ? undefined : "img"}
            aria-label={decorative ? undefined : "The Pakistan Edit"}
            focusable="false"
            width={width * safeScale}
            height={height * safeScale}
            viewBox={showWordmark ? "0 0 72 85" : "6 6 29 36"}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={SVG_ROOT_STYLE}
        >
            <g transform={`translate(${centerX - 24}, 0)`}>
                <rect x="6" y="22" width="12" height="6" fill="var(--ui-text)" />
                <path fillRule="evenodd" clipRule="evenodd" d="M 18 6 H 24 A 11 11 0 0 1 24 28 V 42 H 18 V 6 Z M 24 12 V 22 A 5 5 0 0 0 24 12 Z" fill="var(--ui-indicator)" />
                <path ref={dotPathRef} transform={REST_TRANSFORM} d={CIRCLE_PATH_R3} fill="var(--ui-accent)" />
            </g>
            {showWordmark && (
                <g transform={`translate(${centerX}, 55)`}>
                    {wordmarkClipOn && (
                        <defs>
                            <clipPath id={`${uid}-l1`}><rect ref={rect1Ref} x="-36" y="-15" width="72" height="22" /></clipPath>
                            <clipPath id={`${uid}-l2`}><rect ref={rect2Ref} x="-36" y="0" width="72" height="18" /></clipPath>
                        </defs>
                    )}
                    <text ref={text1Ref} x="0" y="0" textAnchor="middle" fill="var(--ui-accent)" clipPath={wordmarkClipOn ? `url(#${uid}-l1)` : undefined} style={WORDMARK_PAKISTAN_STYLE}>PAKISTAN</text>
                    <text ref={text2Ref} x="0" y="10" textAnchor="middle" fill="var(--ui-text)" clipPath={wordmarkClipOn ? `url(#${uid}-l2)` : undefined} style={WORDMARK_EDIT_STYLE}>EDIT</text>
                </g>
            )}
        </svg>
    );
});

TPEVectorLogo.displayName = "TPEVectorLogo";
