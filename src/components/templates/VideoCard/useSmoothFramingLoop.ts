"use client";

import { useLayoutEffect, useRef } from "react";
import {
    VideoDraft,
    clamp,
    evaluateSceneTransition,
    getTotalVideoDuration,
    getDefaultVideoFraming,
    mediaTimeToTimelineTime,
} from "@/types/news";
import { interpolateKeyframeInto } from "@/utils/videoTimeline";
import type { LivePlaybackClock } from "@/app/admin/utils/livePlaybackClock";
import type { PlaybackEngineState } from "./avSyncHelpers";
import {
    compute45FrameLayout,
    computeAmbientCropInto,
    computeFullBleedLayout,
    computeKenBurnsMul,
    type AmbientCropRect,
    type AmbientVisibilityState,
    type Frame45Layout,
    type FullBleedLayout,
} from "./videoCardGeometry";

export type { AmbientCropRect, AmbientVisibilityState } from "./videoCardGeometry";

interface SmoothFramingLoopOptions {
    draft: VideoDraft;
    is45: boolean;
    isImage: boolean;
    isPlaying: boolean;
    isScrubbing: boolean;
    isOutro: boolean;
    currentTime: number;
    sceneStart: number;
    sceneDuration: number;
    mediaNaturalAspect: number;
    dimensions: { width: number; height: number };
    liveTimelineTimeRef: React.RefObject<number>;
    ambientCropRef: React.MutableRefObject<AmbientCropRect>;
    ambientVisibilityRef: React.MutableRefObject<AmbientVisibilityState>;
    isCameraGlidingRef?: React.MutableRefObject<boolean>;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    audioOutputRef?: React.RefObject<HTMLMediaElement | null>;
    engineStateRef?: React.RefObject<PlaybackEngineState>;
    imageRef: React.RefObject<HTMLImageElement | null>;
    bgBlurImgRef: React.RefObject<HTMLImageElement | null>;
    clipWrapperRef: React.RefObject<HTMLDivElement | null>;
    progressBarRef: React.RefObject<HTMLDivElement | null>;
    fadeOverlayRef: React.RefObject<HTMLDivElement | null>;
    topAmbientWrapRef: React.RefObject<HTMLDivElement | null>;
    botAmbientWrapRef: React.RefObject<HTMLDivElement | null>;
    logoWordmarkDriveRef?: React.MutableRefObject<((elapsedSec: number) => void) | null>;
    liveClock?: LivePlaybackClock;
}

interface AmbientWrapCache { el: HTMLDivElement | null; y: number; vis: string; }

const safeFiniteTime = (val: number | undefined, fallback = 0): number =>
    val !== undefined && Number.isFinite(val) ? Math.max(0, val) : fallback;

const syncAmbientWrap = (cache: AmbientWrapCache, el: HTMLDivElement | null, wrapY: number, visible: boolean): void => {
    if (!el) return;
    const vis = visible ? "visible" : "hidden";
    const isNew = el !== cache.el || !el.style.transform;
    if (isNew || Number.isNaN(cache.y) || Math.abs(wrapY - cache.y) > 0.001) {
        cache.y = wrapY;
        el.style.transform = `translate3d(0, ${wrapY}px, 0)`;
    }
    if (isNew || vis !== cache.vis) {
        cache.vis = vis;
        el.style.visibility = vis;
    }
    cache.el = el;
};

/**
 * Drives GPU-composited camera glides (zoom, pan X, pos Y), 4:5 clip-path, ambient translate3d,
 * 9:16/16:9 GPU pan, Photo Ken Burns, cosine fade overlay, 120Hz audio breath-dip, and progress bar
 * at full display VSync (120Hz/144Hz+) with zero React re-renders and zero layout reflows.
 */
export const useSmoothFramingLoop = (opts: SmoothFramingLoopOptions) => {
    const optsRef = useRef(opts);
    // Sync before the rAF useLayoutEffect below so frame 0 never reads stale paused opts
    useLayoutEffect(() => { optsRef.current = opts; });

    const { isPlaying, isScrubbing } = opts;

    useLayoutEffect(() => {
        if (!isPlaying || isScrubbing) return;

        let rafId = 0;
        let smoothedDt = 1 / 120;
        let lastMediaTime = optsRef.current.audioOutputRef?.current?.currentTime ?? optsRef.current.videoRef.current?.currentTime ?? -1;
        let lastSeenPropTime = safeFiniteTime(optsRef.current.currentTime);
        let latestMappedTime = safeFiniteTime(optsRef.current.liveTimelineTimeRef.current, lastSeenPropTime);
        let lastPerfNow = performance.now();
        let smoothedDrift = 0;
        let lastLiveT = latestMappedTime;
        let lastVideoEl: HTMLVideoElement | null = optsRef.current.videoRef.current;
        let lastClockEl: HTMLMediaElement | null = optsRef.current.audioOutputRef?.current ?? optsRef.current.videoRef.current;
        let deckSwapPerfNow = -1000;
        let awaitingFirstTickAfterSwap = false;
        let swapPhaseOffset = 0;
        let lastMediaEl: HTMLElement | null = null;
        let lastIs45 = optsRef.current.is45;
        let lastPanX = NaN;
        let lastTopY = NaN;
        let lastScale = NaN;
        const topWrapCache: AmbientWrapCache = { el: null, y: NaN, vis: "" };
        const botWrapCache: AmbientWrapCache = { el: null, y: NaN, vis: "" };
        let lastFade = NaN;
        let lastBarScaleX = NaN;
        let lastAudioEl: HTMLMediaElement | null = null;
        let lastWrittenVol = NaN;
        let cachedDraft: VideoDraft | null = null;
        let cachedRatio: VideoDraft["aspectRatio"] | null = null;
        let cachedTotalDur = 1;
        let cachedDefaultFraming = { zoom: 100, posX: 50, posY: 100 };
        const frameOut = { zoom: 100, posX: 50, posY: 100 };
        const layout45Out: Frame45Layout = { H_cont: 0, effScale: 1, containerH: 0, panX: 0, topY: 0, mediaY: 0, botInset: 0 };
        const fullBleedOut: FullBleedLayout = { coverW: 0, coverH: 0, finalScale: 1, panX: 0 };

        const applyFrame = (now: number) => {
            const o = optsRef.current;
            const video = o.videoRef.current;
            if (o.draft !== cachedDraft || o.draft.aspectRatio !== cachedRatio) {
                cachedDraft = o.draft;
                cachedRatio = o.draft.aspectRatio;
                const rawTotal = getTotalVideoDuration(o.draft);
                cachedTotalDur = Number.isFinite(rawTotal) && rawTotal > 0 ? rawTotal : 1;
                cachedDefaultFraming = getDefaultVideoFraming(o.draft, o.draft.aspectRatio);
            }
            const totalDur = cachedTotalDur;
            const rawDt = clamp((now - lastPerfNow) / 1000, 0, 0.05);
            if (rawDt >= 0.003 && rawDt <= 0.025) smoothedDt = smoothedDt * 0.8 + rawDt * 0.2;
            const dt = Math.abs(rawDt - smoothedDt) < 0.0025 ? smoothedDt : rawDt;
            lastPerfNow = now;
            let liveT: number;

            const propTime = safeFiniteTime(o.currentTime, lastSeenPropTime);
            const propChanged = propTime !== lastSeenPropTime;
            if (propChanged) lastSeenPropTime = propTime;

            const engineState = o.engineStateRef?.current;
            const engineRolling = !engineState || engineState === 'playing';
            const audioOut = o.audioOutputRef?.current;
            const useAudioMaster = Boolean(engineRolling && audioOut && audioOut !== video && audioOut.readyState >= 1 && !audioOut.paused && !audioOut.seeking);
            const clockEl: HTMLMediaElement | null = useAudioMaster ? audioOut! : video;

            if (o.isOutro || o.isImage || !video) {
                if (propChanged && Math.abs(propTime - lastLiveT) > 0.08) {
                    latestMappedTime = propTime;
                    liveT = propTime;
                } else {
                    liveT = clamp(lastLiveT + dt, 0, totalDur);
                }
            } else if (!engineRolling || (video.seeking && !useAudioMaster)) {
                latestMappedTime = safeFiniteTime(o.liveTimelineTimeRef.current, lastLiveT);
                liveT = latestMappedTime;
            } else {
                if (video !== lastVideoEl) {
                    lastVideoEl = video;
                    lastMediaTime = clockEl?.currentTime ?? video.currentTime;
                    deckSwapPerfNow = now;
                    smoothedDrift = 0;
                    latestMappedTime = safeFiniteTime(o.liveTimelineTimeRef.current, lastLiveT);
                    if (Math.abs(latestMappedTime - lastLiveT) >= 0.25) lastLiveT = latestMappedTime;
                    awaitingFirstTickAfterSwap = true;
                    swapPhaseOffset = 0;
                }
                if (clockEl !== lastClockEl) {
                    lastClockEl = clockEl;
                    lastMediaTime = clockEl?.currentTime ?? -1;
                    smoothedDrift = 0;
                }
                const minReadyState = useAudioMaster ? 1 : 2;
                if (clockEl && clockEl.readyState >= minReadyState) {
                    const mt = clockEl.currentTime;
                    if (Number.isFinite(mt) && (lastMediaTime < 0 || Math.abs(mt - lastMediaTime) > 0.0005)) {
                        const liveClipDur = Number.isFinite(video.duration) && video.duration > 1 ? video.duration : undefined;
                        const mapped = mediaTimeToTimelineTime(o.draft, mt, safeFiniteTime(o.liveTimelineTimeRef.current, lastLiveT), liveClipDur);
                        if (Number.isFinite(mapped)) latestMappedTime = mapped;
                        lastMediaTime = mt;
                        if (awaitingFirstTickAfterSwap) {
                            awaitingFirstTickAfterSwap = false;
                            smoothedDrift = 0;
                            swapPhaseOffset = clamp(lastLiveT - latestMappedTime, -0.22, 0.22);
                        }
                    }
                }
                const inSwapGrace = awaitingFirstTickAfterSwap && (now - deckSwapPerfNow < 240);
                if (!clockEl || (clockEl.paused && !inSwapGrace) || clockEl.readyState < minReadyState) {
                    liveT = lastLiveT;
                } else if (inSwapGrace) {
                    liveT = clamp(lastLiveT + dt, 0, totalDur);
                } else {
                    if (awaitingFirstTickAfterSwap) awaitingFirstTickAfterSwap = false;
                    swapPhaseOffset *= Math.exp(-dt * 1.4);
                    const rawDrift = (latestMappedTime + swapPhaseOffset) - lastLiveT;
                    if (Math.abs(rawDrift) >= 0.45) {
                        liveT = clamp(latestMappedTime, 0, totalDur);
                        smoothedDrift = 0;
                        swapPhaseOffset = 0;
                    } else {
                        smoothedDrift += (rawDrift - smoothedDrift) * Math.min(1, dt * 3.0);
                        const effectiveDrift = Math.abs(smoothedDrift) < 0.025 ? 0 : smoothedDrift;
                        liveT = clamp(lastLiveT + dt * (effectiveDrift === 0 ? 1 : clamp(1 + effectiveDrift * 0.25, 0.99, 1.01)), 0, totalDur);
                    }
                }
            }

            liveT = safeFiniteTime(liveT, lastLiveT);
            lastLiveT = liveT;

            // 1. Native-VSync Progress Bar & Video-Locked Logo Wordmark Wipe
            const bar = o.progressBarRef.current;
            if (bar) {
                const nextScaleX = clamp(liveT / totalDur, 0, 1);
                if (Number.isNaN(lastBarScaleX) || Math.abs(nextScaleX - lastBarScaleX) > 0.0002) {
                    lastBarScaleX = nextScaleX;
                    bar.style.transform = `scaleX(${nextScaleX})`;
                }
            }
            o.logoWordmarkDriveRef?.current?.(liveT);

            if (o.isOutro) {
                lastFade = NaN;
                lastMediaEl = null;
                if (o.isCameraGlidingRef) o.isCameraGlidingRef.current = false;
                o.liveClock?.emit(liveT);
                return;
            }

            // 2. Native-VSync Cosine Fade Overlay & 120Hz Audio Breath-Dip
            const { fade, audioGain } = evaluateSceneTransition(o.draft, liveT);
            const fadeEl = o.fadeOverlayRef.current;
            const fadeVisible = fade > 0.0005;
            if (fadeEl && (!fadeEl.style.opacity || Number.isNaN(lastFade) || fadeVisible !== (lastFade > 0.0005) || Math.abs(fade - lastFade) > 0.0005)) {
                lastFade = fade;
                fadeEl.style.opacity = String(fade);
                fadeEl.style.visibility = fadeVisible ? 'visible' : 'hidden';
            }
            const audioEl = o.audioOutputRef?.current ?? video;
            if (audioEl && !o.isImage && !audioEl.muted) {
                const nextVol = clamp((o.draft.volume ?? 1) * audioGain, 0, 1);
                if (audioEl !== lastAudioEl || Number.isNaN(lastWrittenVol) || Math.abs(lastWrittenVol - nextVol) > 0.015 || (nextVol === 1 && lastWrittenVol < 0.999)) {
                    lastAudioEl = audioEl;
                    lastWrittenVol = nextVol;
                    audioEl.volume = nextVol;
                }
            }

            const f = o.draft.keyframes?.length ? interpolateKeyframeInto(o.draft.keyframes, liveT, cachedDefaultFraming, frameOut) : cachedDefaultFraming;
            o.liveClock?.emit(liveT, f.zoom, f.posX, f.posY, o.is45 && Math.round(f.zoom) < 100);
            if (video && !o.isImage && video.seeking && video.style.transform) return;

            // 3. Native-VSync Camera Zoom / Pan X / Pos Y, 4:5 Clip-Path, Ambient GPU translate3d & Ken Burns
            const mediaEl = o.isImage ? o.imageRef.current : video;
            if (!mediaEl) return;

            if (o.is45 !== lastIs45) {
                lastIs45 = o.is45;
                lastMediaEl = null;
                topWrapCache.el = null;
                botWrapCache.el = null;
            }

            const kenBurnsMul = computeKenBurnsMul(o.isImage, liveT, o.sceneStart, o.sceneDuration);

            if (o.is45) {
                const { H_cont, effScale, containerH, panX, topY, mediaY, botInset } =
                    compute45FrameLayout(o.dimensions, o.mediaNaturalAspect, f, kenBurnsMul, layout45Out);
                const blurEnabled = o.draft.enableAmbientBlur !== false;
                const topVisible = blurEnabled && topY > 2;
                const botVisible = blurEnabled && topY + containerH < o.dimensions.height - 2;

                o.ambientVisibilityRef.current.topVisible = topVisible;
                o.ambientVisibilityRef.current.botVisible = botVisible;
                if (topVisible || botVisible) computeAmbientCropInto(o.dimensions, H_cont, containerH, effScale, panX, o.ambientCropRef.current);

                if (o.isCameraGlidingRef) {
                    o.isCameraGlidingRef.current = !Number.isNaN(lastScale) && (Math.abs(panX - lastPanX) > 0.05 || Math.abs(mediaY - lastTopY) > 0.05 || Math.abs(effScale - lastScale) > 0.0002);
                }

                const transformMoved = mediaEl !== lastMediaEl || !mediaEl.style.transform || Number.isNaN(lastPanX) ||
                    Math.abs(panX - lastPanX) > 0.001 || Math.abs(mediaY - lastTopY) > 0.001 || Math.abs(effScale - lastScale) > 0.00001;
                if (transformMoved) {
                    lastMediaEl = mediaEl; lastPanX = panX; lastTopY = mediaY; lastScale = effScale;
                    mediaEl.style.transform = `translate3d(${panX}px, ${mediaY}px, 0) scale(${effScale}) translateZ(0)`;
                }
                if (o.isImage) {
                    if (blurEnabled && o.bgBlurImgRef.current && (transformMoved || !o.bgBlurImgRef.current.style.transform)) {
                        o.bgBlurImgRef.current.style.transform = `translate3d(${panX}px, 0, 0) scale(${effScale * 1.08}) translateZ(0)`;
                    }
                    if (o.clipWrapperRef.current && (transformMoved || !o.clipWrapperRef.current.style.clipPath)) {
                        o.clipWrapperRef.current.style.clipPath = `inset(${topY}px 0 ${botInset}px 0)`;
                    }
                }
                if (!blurEnabled) {
                    topWrapCache.el = null; botWrapCache.el = null;
                } else {
                    syncAmbientWrap(topWrapCache, o.topAmbientWrapRef.current, topY + 4 - o.dimensions.height, topVisible);
                    syncAmbientWrap(botWrapCache, o.botAmbientWrapRef.current, Math.max(0, topY + containerH - 4), botVisible);
                }
            } else {
                const { finalScale, panX } = computeFullBleedLayout(o.dimensions, o.mediaNaturalAspect, f, kenBurnsMul, fullBleedOut);
                if (o.isCameraGlidingRef) {
                    o.isCameraGlidingRef.current = !Number.isNaN(lastScale) && (Math.abs(panX - lastPanX) > 0.05 || Math.abs(finalScale - lastScale) > 0.0002);
                }
                if (mediaEl !== lastMediaEl || !mediaEl.style.transform || Number.isNaN(lastPanX) || Math.abs(panX - lastPanX) > 0.001 || Math.abs(finalScale - lastScale) > 0.00001) {
                    lastMediaEl = mediaEl; lastPanX = panX; lastTopY = 0; lastScale = finalScale;
                    mediaEl.style.transform = `translate3d(${panX}px, 0, 0) scale(${finalScale}) translateZ(0)`;
                }
            }
        };

        const tick = (now: number) => {
            applyFrame(now);
            rafId = requestAnimationFrame(tick);
        };

        applyFrame(performance.now());
        rafId = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(rafId);
            if (optsRef.current.isCameraGlidingRef) optsRef.current.isCameraGlidingRef.current = false;
        };
    }, [isPlaying, isScrubbing]);
};
