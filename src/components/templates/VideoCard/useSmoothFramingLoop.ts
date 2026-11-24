import { useLayoutEffect, useRef } from "react";
import {
    VideoDraft,
    clamp,
    getBreathDipAudioGain,
    getHookTransitionFade,
    getTopBoxOffsetY,
    getTotalVideoDuration,
    getDefaultVideoFraming,
    interpolateKeyframe,
    mediaTimeToTimelineTime,
} from "../../../types/news";

export interface AmbientCropRect {
    xFrac: number;
    wFrac: number;
    yFrac: number;
    hFrac: number;
}

export interface AmbientVisibilityState {
    topVisible: boolean;
    botVisible: boolean;
}

interface SmoothFramingLoopOptions {
    draft: VideoDraft;
    is45: boolean;
    isImage: boolean;
    isPlaying: boolean;
    isScrubbing: boolean;
    isOutro: boolean;
    overlayOnly: boolean;
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
    imageRef: React.RefObject<HTMLImageElement | null>;
    bgBlurImgRef: React.RefObject<HTMLImageElement | null>;
    clipWrapperRef: React.RefObject<HTMLDivElement | null>;
    progressBarRef: React.RefObject<HTMLDivElement | null>;
    fadeOverlayRef: React.RefObject<HTMLDivElement | null>;
    topAmbientWrapRef: React.RefObject<HTMLDivElement | null>;
    botAmbientWrapRef: React.RefObject<HTMLDivElement | null>;
    logoWordmarkDriveRef?: React.MutableRefObject<((elapsedSec: number) => void) | null>;
}

/**
 * Drives GPU-composited camera glides (zoom, pan X, pos Y), 4:5 clip-path, ambient translate3d,
 * 9:16/16:9 GPU pan, Photo Ken Burns, cosine fade overlay, 120Hz audio breath-dip, and progress bar
 * at full display VSync (120Hz/144Hz+) with zero React re-renders and zero layout reflows.
 */
export const useSmoothFramingLoop = (opts: SmoothFramingLoopOptions) => {
    const optsRef = useRef(opts);
    // Sync before the rAF useLayoutEffect below so frame 0 never reads stale paused opts
    useLayoutEffect(() => {
        optsRef.current = opts;
    });

    const { isPlaying, isScrubbing, overlayOnly } = opts;

    useLayoutEffect(() => {
        if (!isPlaying || isScrubbing || overlayOnly) return;

        let rafId = 0;
        let smoothedDt = 1 / 120;
        let lastMediaTime = optsRef.current.videoRef.current?.currentTime ?? -1;
        let lastSeenPropTime = optsRef.current.currentTime;
        let latestMappedTime = optsRef.current.liveTimelineTimeRef.current ?? optsRef.current.currentTime;
        let lastPerfNow = performance.now();
        let smoothedDrift = 0;
        let lastLiveT = latestMappedTime;
        let lastVideoEl: HTMLVideoElement | null = optsRef.current.videoRef.current;
        let deckSwapPerfNow = -1000;
        let awaitingFirstTickAfterSwap = false;
        let swapPhaseOffset = 0;
        let lastMediaEl: HTMLElement | null = null;
        let lastPanX = NaN;
        let lastTopY = NaN;
        let lastScale = NaN;
        let lastTopWrapEl: HTMLDivElement | null = null;
        let lastTopWrapY = NaN;
        let lastTopVis = "";
        let lastBotWrapEl: HTMLDivElement | null = null;
        let lastBotWrapY = NaN;
        let lastBotVis = "";
        let lastFade = NaN;

        const applyFrame = (now: number) => {
            const o = optsRef.current;
            const video = o.videoRef.current;
            const totalDur = getTotalVideoDuration(o.draft) || 1;
            const rawDt = Math.min(0.05, Math.max(0, (now - lastPerfNow) / 1000));
            if (rawDt >= 0.003 && rawDt <= 0.025) {
                smoothedDt = smoothedDt * 0.8 + rawDt * 0.2;
            }
            const dt = Math.abs(rawDt - smoothedDt) < 0.0025 ? smoothedDt : rawDt;
            lastPerfNow = now;
            let liveT: number;

            // Re-anchor only when the discrete currentTime prop itself changed (seek / loop-wrap / cut)
            const propChanged = o.currentTime !== lastSeenPropTime;
            if (propChanged) {
                lastSeenPropTime = o.currentTime;
            }

            if (o.isOutro || o.isImage || !video) {
                if (propChanged && Math.abs(o.currentTime - lastLiveT) > 0.08) {
                    latestMappedTime = o.currentTime;
                    liveT = o.currentTime;
                } else {
                    liveT = clamp(lastLiveT + dt, 0, totalDur);
                }
            } else if (video.seeking) {
                latestMappedTime = o.liveTimelineTimeRef.current;
                liveT = latestMappedTime;
            } else {
                if (video !== lastVideoEl) {
                    lastVideoEl = video;
                    lastMediaTime = video.currentTime;
                    deckSwapPerfNow = now;
                    smoothedDrift = 0;
                    latestMappedTime = o.liveTimelineTimeRef.current;
                    if (Math.abs(latestMappedTime - lastLiveT) >= 0.25) {
                        lastLiveT = latestMappedTime;
                    }
                    awaitingFirstTickAfterSwap = true;
                    swapPhaseOffset = 0;
                }
                if (video.readyState >= 2) {
                    const mt = video.currentTime;
                    if (lastMediaTime < 0 || Math.abs(mt - lastMediaTime) > 0.0005) {
                        latestMappedTime = mediaTimeToTimelineTime(o.draft, mt, o.liveTimelineTimeRef.current);
                        lastMediaTime = mt;
                        if (awaitingFirstTickAfterSwap) {
                            awaitingFirstTickAfterSwap = false;
                            smoothedDrift = 0;
                            swapPhaseOffset = clamp(lastLiveT - latestMappedTime, -0.22, 0.22);
                        }
                    }
                }
                const inSwapGrace = awaitingFirstTickAfterSwap && (now - deckSwapPerfNow < 240);
                if ((video.paused && !inSwapGrace) || video.readyState < 2) {
                    liveT = lastLiveT;
                } else if (inSwapGrace) {
                    // Glide at pure 1.0x VSync velocity until the standby deck emits its first audio-clock tick
                    liveT = clamp(lastLiveT + dt, 0, totalDur);
                } else {
                    if (awaitingFirstTickAfterSwap) awaitingFirstTickAfterSwap = false;
                    swapPhaseOffset *= Math.exp(-dt * 1.4);
                    const rawDrift = (latestMappedTime + swapPhaseOffset) - lastLiveT;
                    if (Math.abs(rawDrift) >= 0.45) {
                        // Genuine seek or scene/loop jump — snap immediately
                        liveT = clamp(latestMappedTime, 0, totalDur);
                        smoothedDrift = 0;
                        swapPhaseOffset = 0;
                    } else {
                        // Low-pass filtered drift integrator + ±25ms deadband eliminates 100Hz/120Hz beat waves
                        smoothedDrift += (rawDrift - smoothedDrift) * Math.min(1, dt * 3.0);
                        const effectiveDrift = Math.abs(smoothedDrift) < 0.025 ? 0 : smoothedDrift;
                        const rate = effectiveDrift === 0 ? 1 : clamp(1 + effectiveDrift * 0.25, 0.99, 1.01);
                        liveT = clamp(lastLiveT + dt * rate, 0, totalDur);
                    }
                }
            }

            lastLiveT = liveT;

            // 1. Native-VSync Progress Bar & Video-Locked Logo Wordmark Wipe
            const bar = o.progressBarRef.current;
            if (bar) {
                bar.style.transform = `scaleX(${clamp(liveT / totalDur, 0, 1)})`;
            }
            if (o.logoWordmarkDriveRef?.current) {
                o.logoWordmarkDriveRef.current(liveT);
            }

            if (o.isOutro) {
                if (o.isCameraGlidingRef) o.isCameraGlidingRef.current = false;
                return;
            }

            // 2. Native-VSync Cosine Fade Overlay & 120Hz Audio Breath-Dip
            const fade = getHookTransitionFade(o.draft, liveT);
            const fadeEl = o.fadeOverlayRef.current;
            if (fadeEl && (!fadeEl.style.opacity || Number.isNaN(lastFade) || Math.abs(fade - lastFade) > 0.0005)) {
                lastFade = fade;
                fadeEl.style.opacity = String(fade);
                fadeEl.style.visibility = fade > 0.0005 ? 'visible' : 'hidden';
            }
            if (video && !o.isImage && !video.muted) {
                const nextVol = clamp((o.draft.volume ?? 1) * getBreathDipAudioGain(fade), 0, 1);
                if (Math.abs(video.volume - nextVol) > 0.002) {
                    video.volume = nextVol;
                }
            }

            // Hold camera transform steady while <video> is mid-seek so incoming scene framing never flashes on the outgoing frozen frame
            // (but always apply frame 0 if React just handed off transform control and style.transform is empty)
            if (video && !o.isImage && video.seeking && video.style.transform) return;

            // 3. Native-VSync Camera Zoom / Pan X / Pos Y, 4:5 Clip-Path, Ambient GPU translate3d & Ken Burns
            const mediaEl = o.isImage ? o.imageRef.current : video;
            if (!mediaEl) return;

            const defaultFraming = getDefaultVideoFraming(o.draft, o.draft.aspectRatio);
            const f = o.draft.keyframes?.length
                ? interpolateKeyframe(o.draft.keyframes, liveT, defaultFraming)
                : defaultFraming;

            const kenBurnsMul = o.isImage
                ? 1 + 0.04 * clamp((liveT - o.sceneStart) / Math.max(o.sceneDuration, 0.1), 0, 1)
                : 1;
            const r = o.mediaNaturalAspect > 0 ? o.mediaNaturalAspect : 16 / 9;

            if (o.is45) {
                const H_cont = Math.min(o.dimensions.height, o.dimensions.width / r);
                const scaleFill = Math.max(1.0, o.dimensions.height / H_cont);
                const z = clamp(f.zoom ?? 0, 0, 200);
                const t = Math.min(100, z) / 100;
                const punchScale = z > 100 ? z / 100 : 1;
                const effScale = (1.0 + t * (scaleFill - 1.0)) * punchScale * kenBurnsMul;
                const containerH = H_cont + t * (o.dimensions.height - H_cont);
                const panX = (0.5 - (f.posX ?? 50) / 100) * (effScale - 1) * o.dimensions.width;
                const topY = getTopBoxOffsetY(f.posY, o.dimensions.height, containerH);
                const botInset = Math.max(0, o.dimensions.height - topY - containerH);
                const blurEnabled = o.draft.enableAmbientBlur !== false;
                const rawTopVisible = topY > 2;
                const rawBotVisible = topY + containerH < o.dimensions.height - 2;
                const topVisible = blurEnabled && rawTopVisible;
                const botVisible = blurEnabled && rawBotVisible;
                const anyBlurVisible = topVisible || botVisible;

                // Keep ambient visibility & crop synced at 120Hz (zero allocations & zero crop math when FILL/OFF)
                o.ambientVisibilityRef.current.topVisible = topVisible;
                o.ambientVisibilityRef.current.botVisible = botVisible;
                if (anyBlurVisible) {
                    if (effScale <= 1) {
                        o.ambientCropRef.current.xFrac = 0;
                        o.ambientCropRef.current.wFrac = 1;
                        o.ambientCropRef.current.yFrac = 0;
                        o.ambientCropRef.current.hFrac = 1;
                    } else {
                        const wFrac = Math.min(1, 1 / effScale);
                        const xFrac = clamp(0.5 - panX / (o.dimensions.width * effScale) - wFrac / 2, 0, 1 - wFrac);
                        const hFrac = Math.min(1, containerH / Math.max(1, H_cont * effScale));
                        o.ambientCropRef.current.xFrac = xFrac;
                        o.ambientCropRef.current.wFrac = wFrac;
                        o.ambientCropRef.current.yFrac = (1 - hFrac) / 2;
                        o.ambientCropRef.current.hFrac = hFrac;
                    }
                }

                const mediaY = topY - Math.max(0, H_cont * effScale - containerH) / 2;
                const cameraGliding =
                    !Number.isNaN(lastScale) && (
                        Math.abs(panX - lastPanX) > 0.05 ||
                        Math.abs(mediaY - lastTopY) > 0.05 ||
                        Math.abs(effScale - lastScale) > 0.0002
                    );
                if (o.isCameraGlidingRef) {
                    o.isCameraGlidingRef.current = cameraGliding;
                }

                const transformMoved =
                    mediaEl !== lastMediaEl ||
                    !mediaEl.style.transform ||
                    Number.isNaN(lastPanX) ||
                    Math.abs(panX - lastPanX) > 0.001 ||
                    Math.abs(mediaY - lastTopY) > 0.001 ||
                    Math.abs(effScale - lastScale) > 0.00001;
                if (transformMoved) {
                    lastMediaEl = mediaEl;
                    lastPanX = panX;
                    lastTopY = mediaY;
                    lastScale = effScale;
                    mediaEl.style.transform = `translate3d(${panX}px, ${mediaY}px, 0) scale(${effScale}) translateZ(0)`;
                }
                if (o.isImage) {
                    if (blurEnabled && o.bgBlurImgRef.current && (transformMoved || !o.bgBlurImgRef.current.style.transform)) {
                        o.bgBlurImgRef.current.style.transform = `translate3d(${panX}px, 0, 0) scale(${effScale * 1.08}) translateZ(0)`;
                    }
                    if (o.clipWrapperRef.current && transformMoved) {
                        o.clipWrapperRef.current.style.clipPath = `inset(${topY}px 0 ${botInset}px 0)`;
                    }
                }
                if (!blurEnabled) {
                    lastTopWrapEl = null;
                    lastBotWrapEl = null;
                } else {
                    const topEl = o.topAmbientWrapRef.current;
                    if (topEl) {
                        const topWrapY = topY + 4 - o.dimensions.height;
                        const topV = topVisible ? "visible" : "hidden";
                        const topNew = topEl !== lastTopWrapEl || !topEl.style.transform;
                        if (topNew || Number.isNaN(lastTopWrapY) || Math.abs(topWrapY - lastTopWrapY) > 0.001) {
                            lastTopWrapY = topWrapY;
                            topEl.style.transform = `translate3d(0, ${topWrapY}px, 0)`;
                        }
                        if (topNew || topV !== lastTopVis) {
                            lastTopVis = topV;
                            topEl.style.visibility = topV;
                        }
                        lastTopWrapEl = topEl;
                    }
                    const botEl = o.botAmbientWrapRef.current;
                    if (botEl) {
                        const botWrapY = Math.max(0, topY + containerH - 4);
                        const botV = botVisible ? "visible" : "hidden";
                        const botNew = botEl !== lastBotWrapEl || !botEl.style.transform;
                        if (botNew || Number.isNaN(lastBotWrapY) || Math.abs(botWrapY - lastBotWrapY) > 0.001) {
                            lastBotWrapY = botWrapY;
                            botEl.style.transform = `translate3d(0, ${botWrapY}px, 0)`;
                        }
                        if (botNew || botV !== lastBotVis) {
                            lastBotVis = botV;
                            botEl.style.visibility = botV;
                        }
                        lastBotWrapEl = botEl;
                    }
                }
            } else {
                const baseZoom = Math.max(1.0, (f.zoom ?? 100) / 100);
                const finalScale = baseZoom * kenBurnsMul;
                const H_cov = Math.max(o.dimensions.height, o.dimensions.width / r);
                const W_cov = H_cov * r;
                const panX = (0.5 - (f.posX ?? 50) / 100) * Math.max(0, W_cov * finalScale - o.dimensions.width);
                const cameraGliding =
                    !Number.isNaN(lastScale) && (
                        Math.abs(panX - lastPanX) > 0.05 ||
                        Math.abs(finalScale - lastScale) > 0.0002
                    );
                if (o.isCameraGlidingRef) {
                    o.isCameraGlidingRef.current = cameraGliding;
                }
                if (mediaEl !== lastMediaEl || !mediaEl.style.transform || Number.isNaN(lastPanX) || Math.abs(panX - lastPanX) > 0.001 || Math.abs(finalScale - lastScale) > 0.00001) {
                    lastMediaEl = mediaEl;
                    lastPanX = panX;
                    lastScale = finalScale;
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
            if (optsRef.current.isCameraGlidingRef) {
                optsRef.current.isCameraGlidingRef.current = false;
            }
        };
    }, [isPlaying, isScrubbing, overlayOnly]);
};
