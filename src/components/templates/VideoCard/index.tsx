"use client";

import React, { useMemo, useRef, useState } from "react";
import Image from "next/image";
import { VideoDraft, SUBTITLE_FONT_OPTIONS, getActiveSceneAtTime, getTotalVideoDuration, getHookTransitionFade, wrapMediaTime, getDefaultSubtitleFontSize, getTopBoxOffsetY, findSubtitleAtMediaTime, interpolateKeyframe, isSharedReHookScene, getVideoHeadingPreset, getDefaultVideoFraming, has45LetterboxFraming } from "../../../types/news";
import { VIDEO_FORMAT_CONFIGS } from "../../../config/omnichannel";
import { TPEVectorLogo, type LogoMotionConfig } from "../TPEVectorLogo";
import { HighlightedText } from "../NewsCard/HighlightedText";
import { PlayIcon } from "../../icons/TPEIcons";
import { VideoOutroCard } from "./VideoOutroCard";
import { AmbientBlurStack } from "./AmbientBlurStack";
import { useVideoElementSync } from "./useVideoElementSync";
import { useSmoothFramingLoop } from "./useSmoothFramingLoop";
import { shouldUseStandbyDeck } from "./dualDeckHelpers";
import { useMediaQuery } from "../../../app/admin/hooks/useMediaQuery";
import type { LivePlaybackClock } from "../../../app/admin/utils/livePlaybackClock";

const SCRIM_STYLES: Record<'top' | 'center' | 'bottom', React.CSSProperties> = {
    center: { position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(5,5,5,0.72) 0%, rgba(5,5,5,0.36) 52%, transparent 82%)', pointerEvents: 'none', zIndex: 9 },
    top: { position: 'absolute', insetInline: 0, top: 0, height: '44%', background: 'linear-gradient(to bottom, rgba(5,5,5,0.86) 0%, rgba(5,5,5,0.48) 48%, transparent 100%)', pointerEvents: 'none', zIndex: 9 },
    bottom: { position: 'absolute', insetInline: 0, bottom: 0, height: '46%', background: 'linear-gradient(to top, rgba(5,5,5,0.88) 0%, rgba(5,5,5,0.52) 48%, transparent 100%)', pointerEvents: 'none', zIndex: 9 },
};

const CC_BASE_STYLE: React.CSSProperties = {
    color: '#fff',
    fontWeight: 700,
    lineHeight: 1.25,
    textAlign: 'center',
};

const CC_BACKDROP_STYLES: Record<string, React.CSSProperties> = {
    none: { padding: '4px 10px', textShadow: '0 1px 4px rgba(0,0,0,0.6)' },
    shadow: { padding: '4px 10px', textShadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.85), -1px -1px 0 rgba(0,0,0,0.75), 1px 1px 0 rgba(0,0,0,0.75)' },
    glass: { padding: '10px 20px', borderRadius: '10px', background: 'rgba(8, 8, 8, 0.52)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.16)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' },
    pill: { padding: '10px 20px', borderRadius: '10px', background: 'rgba(8, 8, 8, 0.86)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 8px 24px rgba(0,0,0,0.65)' },
};

const getCaptionSpanStyle = (backdrop: string, fontFamily: string, fontSize: number): React.CSSProperties => ({
    ...CC_BASE_STYLE,
    ...(CC_BACKDROP_STYLES[backdrop] ?? CC_BACKDROP_STYLES.pill),
    fontFamily,
    fontSize: `${fontSize}px`,
});

interface VideoCardProps {
    draft: VideoDraft;
    isPlaying?: boolean;
    isScrubbing?: boolean;
    playbackMode?: 'play-all' | 'loop-angle';
    currentTime?: number;
    seekNonce?: number;
    isMuted?: boolean;
    isLoadingStream?: boolean;
    ingestStatus?: string | null;
    onTimeUpdate?: (current: number, duration: number) => void;
    onTogglePlay?: () => void;
    overlayOnly?: boolean;
    pausedFramingOverride?: { zoom: number; posX: number; posY: number };
    starPreviewNonce?: number;
    liveClock?: LivePlaybackClock;
}

/** Unified video renderer supporting 4:5 Contain, 9:16 Full-Bleed, and 16:9 Landscape formats. */
export const VideoCard: React.FC<VideoCardProps> = React.memo(({
    draft,
    isPlaying = false,
    isScrubbing = false,
    playbackMode = 'play-all',
    currentTime = 0,
    seekNonce = 0,
    isMuted = false,
    isLoadingStream = false,
    ingestStatus = null,
    onTimeUpdate,
    onTogglePlay,
    overlayOnly = false,
    pausedFramingOverride,
    starPreviewNonce = 0,
    liveClock,
}) => {
    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio];
    const is916 = draft.aspectRatio === '9:16';
    const is45 = draft.aspectRatio === '4:5';
    const [mediaNaturalAspect, setMediaNaturalAspect] = useState<number>(16 / 9);

    const { scene: activeScene, isOutro, sceneIndex } = getActiveSceneAtTime(draft, currentTime);
    const hasMedia = Boolean(activeScene?.mediaUrl || draft.videoUrl);
    const videoSrc = activeScene?.mediaUrl || draft.videoUrl || "";
    const effectiveMuted = draft.isMuted ?? isMuted;

    const sceneStart = useMemo(() => {
        if (isOutro || !draft.scenes?.length) return 0;
        let sum = 0;
        for (let i = 0; i < sceneIndex && i < draft.scenes.length; i++) {
            sum += (draft.scenes[i]?.duration || 0);
        }
        return sum;
    }, [draft.scenes, isOutro, sceneIndex]);
    const sceneDuration = activeScene?.duration || 10;
    const isLiveLoopActive = isPlaying && !isScrubbing && !overlayOnly;
    const isLiveMediaLoop = isLiveLoopActive && !isOutro;
    const staticFramingTime = isPlaying && !isScrubbing && !overlayOnly ? sceneStart : currentTime;

    const defaultFraming = useMemo(
        () => getDefaultVideoFraming(draft, draft.aspectRatio),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draft.aspectRatio, draft.defaultFramingByRatio, draft.zoom, draft.posX, draft.posY]
    );
    const cardFraming = useMemo(
        () => pausedFramingOverride ?? (draft.keyframes?.length
            ? interpolateKeyframe(draft.keyframes, staticFramingTime, defaultFraming)
            : defaultFraming),
        [pausedFramingOverride, draft.keyframes, defaultFraming, staticFramingTime]
    );

    const { effectiveScale, containerHeightPx, H_contain } = useMemo(() => {
        if (!is45) {
            return { effectiveScale: Math.max(1.0, (cardFraming.zoom ?? 100) / 100), containerHeightPx: dimensions.height, H_contain: dimensions.height };
        }
        const r = mediaNaturalAspect > 0 ? mediaNaturalAspect : (16 / 9);
        const H_cont = Math.min(dimensions.height, dimensions.width / r);
        const Scale_fill = Math.max(1.0, dimensions.height / H_cont);
        const z = Math.min(200, Math.max(0, cardFraming.zoom ?? 0));
        const t = Math.min(100, z) / 100;
        const punchScale = z > 100 ? z / 100 : 1;
        return {
            effectiveScale: (1.0 + t * (Scale_fill - 1.0)) * punchScale,
            containerHeightPx: H_cont + t * (dimensions.height - H_cont),
            H_contain: H_cont
        };
    }, [is45, cardFraming.zoom, mediaNaturalAspect, dimensions.width, dimensions.height]);

    const panXShift = is45 ? (0.5 - ((cardFraming.posX ?? 50) / 100)) * (effectiveScale - 1) * dimensions.width : 0;
    const topOffsetY = is45 ? getTopBoxOffsetY(cardFraming.posY, dimensions.height, containerHeightPx) : 0;
    const mediaOffsetY45 = is45 ? topOffsetY - Math.max(0, H_contain * effectiveScale - containerHeightPx) / 2 : 0;
    const has45Letterbox = useMemo(() => (is45 ? has45LetterboxFraming(draft) : false), [is45, draft]);
    const ambientBlurActive = is45 && !overlayOnly && draft.enableAmbientBlur !== false && has45Letterbox;
    const ambientVisibility = useMemo(() => ({
        topVisible: ambientBlurActive && topOffsetY > 2,
        botVisible: ambientBlurActive && topOffsetY + containerHeightPx < dimensions.height - 2,
    }), [ambientBlurActive, topOffsetY, containerHeightPx, dimensions.height]);
    const ambientCrop = useMemo(() => {
        if (!ambientBlurActive || effectiveScale <= 1) return { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 };
        const wFrac = Math.min(1, 1 / effectiveScale);
        const xFrac = Math.max(0, Math.min(1 - wFrac, 0.5 - panXShift / (dimensions.width * effectiveScale) - wFrac / 2));
        const hFrac = Math.min(1, containerHeightPx / Math.max(1, H_contain * effectiveScale));
        return { xFrac, wFrac, yFrac: (1 - hFrac) / 2, hFrac };
    }, [ambientBlurActive, effectiveScale, panXShift, dimensions.width, containerHeightPx, H_contain]);

    const clipWrapperRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const bgBlurImgRef = useRef<HTMLImageElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const fadeOverlayRef = useRef<HTMLDivElement>(null);
    const topAmbientWrapRef = useRef<HTMLDivElement>(null);
    const botAmbientWrapRef = useRef<HTMLDivElement>(null);
    const logoWordmarkDriveRef = useRef<((elapsedSec: number) => void) | null>(null);

    const isCompactOrTouch = useMediaQuery("(max-width: 900px), (pointer: coarse)");
    const isImage = activeScene?.mediaType === 'image' || (
        Boolean(videoSrc) && (videoSrc.startsWith('data:image') || /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(videoSrc))
    );
    const useStandbyDeck = !isImage && !overlayOnly && shouldUseStandbyDeck(draft, isCompactOrTouch);

    const { videoRef, standbyVideoRef, activeVideoRef, currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef, ambientCanvasRef, midEdgeCanvasRef, nearEdgeCanvasRef, topAmbientCanvasRef, topMidEdgeCanvasRef, topNearEdgeCanvasRef, refreshAmbientGlow, handleLoadedMetadata, handleStandbyLoadedMetadata, handleTimeUpdate, handleEnded } = useVideoElementSync({
        draft,
        videoSrc,
        isPlaying,
        isScrubbing,
        isOutro,
        playbackMode,
        currentTime,
        seekNonce,
        useStandbyDeck,
        effectiveMuted,
        overlayOnly,
        ambientBlurActive,
        ambientCrop,
        ambientVisibility,
        onTimeUpdate,
        onAspectDetected: setMediaNaturalAspect
    });
    const zoomScale = Math.max(1.0, (cardFraming.zoom ?? 100) / 100);
    const posX = cardFraming.posX ?? 50;
    const rSafe = mediaNaturalAspect > 0 ? mediaNaturalAspect : 16 / 9;
    const coverH = Math.max(dimensions.height, dimensions.width / rSafe);
    const coverW = coverH * rSafe;

    useSmoothFramingLoop({
        draft, is45, isImage, isPlaying, isScrubbing, isOutro, overlayOnly, currentTime, sceneStart, sceneDuration,
        mediaNaturalAspect, dimensions, liveTimelineTimeRef: currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef,
        videoRef: activeVideoRef, imageRef, bgBlurImgRef, clipWrapperRef, progressBarRef, fadeOverlayRef, topAmbientWrapRef, botAmbientWrapRef, logoWordmarkDriveRef, liveClock,
    });
    const sceneElapsed = Math.max(0, currentTime - sceneStart);
    const kenBurnsScale = isImage
        ? zoomScale * (1 + 0.04 * Math.min(1, Math.max(0, sceneElapsed / Math.max(sceneDuration, 0.1))))
        : zoomScale;
    const fullBleedPanX = (0.5 - posX / 100) * Math.max(0, coverW * (isImage ? kenBurnsScale : zoomScale) - dimensions.width);

    const isSharedReHook = isSharedReHookScene(draft.scenes, sceneIndex);
    const textScene = isSharedReHook ? draft.scenes![0]! : activeScene;
    const animateWordmark = isPlaying && !overlayOnly && draft.enableMotion !== false;
    const logoMotionConfig = useMemo<LogoMotionConfig>(() => ({
        enableLogo: draft.enableLogo !== false,
        enableWordmark: draft.motionWordmark !== false,
        starCues: draft.starCues,
        morphDuration: draft.starMorphDuration,
        holdDuration: draft.starHoldDuration,
        starScale: draft.starScale,
        spinMode: draft.starSpinMode,
        sequence: draft.starSequence,
        holdFeel: draft.starHoldFeel,
        previewNonce: starPreviewNonce,
    }), [draft.enableLogo, draft.motionWordmark, draft.starCues, draft.starMorphDuration, draft.starHoldDuration, draft.starScale, draft.starSpinMode, draft.starSequence, draft.starHoldFeel, starPreviewNonce]);
    const outroMotionConfig = useMemo<LogoMotionConfig>(() => ({
        ...logoMotionConfig,
        starCues: [{ id: 'outro-star', time: 0 }],
    }), [logoMotionConfig]);
    const headlineText = isOutro ? (draft.outroCta || "") : (textScene?.title ?? draft.headline ?? "");
    const subtitleText = isOutro ? "" : (textScene?.subtitle ?? draft.subtitle ?? "");
    const textKey = `${headlineText}::${subtitleText}`;
    const creditText = activeScene?.creditName || draft.creditName;
    const sourceText = activeScene?.sourceName || draft.sourceName;
    const totalDuration = useMemo(
        () => getTotalVideoDuration(draft),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [draft.scenes, draft.enableOutro, draft.outroDuration]
    );
    const progressPercent = Math.min(100, Math.max(0, (currentTime / (totalDuration || 1)) * 100));
    const hookFade = isLiveMediaLoop || overlayOnly ? 0 : getHookTransitionFade(draft, currentTime);
    const activeSubtitle = useMemo(() => {
        const captionsOn = activeScene?.showSubtitles ?? (draft.showSubtitles !== false);
        if (!captionsOn || !draft.subtitles?.length) return undefined;
        return findSubtitleAtMediaTime(draft.subtitles, wrapMediaTime(draft, currentTime, draft.videoDuration || 0));
    }, [draft, activeScene?.showSubtitles, currentTime]);

    const preset = getVideoHeadingPreset(draft, draft.aspectRatio);
    const presetLayout = is45
        ? preset === 'center'
            ? { justify: 'center', top: '200px', bottom: '200px' }
            : preset === 'top'
                ? { justify: 'flex-start', top: '200px', bottom: '160px' }
                : { justify: 'flex-end', top: '160px', bottom: '200px' }
        : preset === 'center'
            ? { justify: 'center', top: is916 ? '200px' : '100px', bottom: is916 ? '200px' : '100px' }
            : preset === 'top'
                ? { justify: 'flex-start', top: is916 ? '390px' : '260px', bottom: '140px' }
                : { justify: 'flex-end', top: is916 ? '200px' : '120px', bottom: is916 ? '460px' : '160px' };

    const footerBottom = is45 ? '50px' : (is916 ? '140px' : '80px');
    const topBoxMediaStyle: React.CSSProperties = {
        position: 'absolute', top: 0, left: 0, width: `${dimensions.width}px`, height: `${H_contain}px`,
        objectFit: 'cover', objectPosition: 'center top', transformOrigin: 'top center', transition: 'none'
    };
    const fullBleedMediaStyle: React.CSSProperties = {
        position: 'absolute', left: `${(dimensions.width - coverW) / 2}px`, top: `${(dimensions.height - coverH) / 2}px`,
        width: `${coverW}px`, height: `${coverH}px`, objectFit: 'cover', objectPosition: 'center center', transformOrigin: 'center center', transition: 'none',
    };
    const bgBlurFilter = 'blur(50px) brightness(0.38) saturate(1.18)';
    const bgTransform = `translate3d(${panXShift}px, 0, 0) scale(${effectiveScale * 1.08}) translateZ(0)`;
    const keyLightShadow = '0 1px 2px rgba(0,0,0,0.95), 0 8px 28px rgba(0,0,0,0.65)';
    const scrimStyle = SCRIM_STYLES[preset] ?? SCRIM_STYLES.bottom;

    return (
        <div
            className="tpe-news-card"
            data-slide-type="bulletin"
            data-platform="tiktok"
            data-motion={draft.enableMotion === false || draft.motionText === false || isScrubbing ? 'off' : 'on'}
            data-playing={isPlaying ? 'true' : 'false'}
            data-overlay-only={overlayOnly ? "true" : undefined}
            data-step={1}
            style={{
                '--card-w': `${dimensions.width}px`,
                '--card-h': `${dimensions.height}px`,
                '--safe-right': '140px',
                cursor: overlayOnly ? 'default' : 'pointer',
                backgroundColor: (overlayOnly && !isOutro) ? 'transparent' : undefined,
            } as React.CSSProperties}
            onClick={overlayOnly ? undefined : onTogglePlay}
        >
            {/* Ratio-Aware Progress Line */}
            {!overlayOnly && (
                <div style={{ position: 'absolute', top: is916 ? 0 : 'auto', bottom: is916 ? 'auto' : 0, left: 0, right: 0, height: '4px', background: 'rgba(255, 255, 255, 0.12)', zIndex: 35, overflow: 'hidden' }}>
                    <div ref={progressBarRef} style={{ width: '100%', height: '100%', ...(isLiveLoopActive ? {} : { transform: `scaleX(${progressPercent / 100})` }), transformOrigin: 'left center', background: 'var(--ui-accent)', boxShadow: '0 0 12px var(--ui-accent)', transition: (isPlaying || isScrubbing) ? 'none' : 'transform 0.2s ease', willChange: 'transform' }} />
                </div>
            )}

            {isOutro && (
                <VideoOutroCard outroCta={draft.outroCta} is916={is916} enableMotion={!overlayOnly && !isScrubbing && draft.enableMotion !== false} motionConfig={outroMotionConfig} />
            )}
            <div className="tpe-full-absolute tpe-flex-col" style={{ background: (overlayOnly && !isOutro) ? 'transparent' : '#080808', visibility: isOutro ? 'hidden' : 'visible', pointerEvents: isOutro ? 'none' : undefined }}>
                {!overlayOnly && hasMedia && (
                    <>
                        {ambientBlurActive && (
                            <div aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
                                {isImage ? (
                                    <Image
                                        ref={bgBlurImgRef}
                                        src={videoSrc}
                                        alt=""
                                        width={dimensions.width}
                                        height={dimensions.height}
                                        unoptimized
                                        loading="eager"
                                        decoding="sync"
                                        referrerPolicy="no-referrer"
                                        style={{ ...topBoxMediaStyle, filter: bgBlurFilter, ...(isLiveMediaLoop ? {} : { transform: bgTransform }), willChange: 'transform' }}
                                    />
                                ) : (
                                    <>
                                        <AmbientBlurStack direction="top" translateY={topOffsetY + 4 - dimensions.height} visible={topOffsetY > 2} liveMode={isLiveMediaLoop} wrapperRef={topAmbientWrapRef} farRef={topAmbientCanvasRef} midRef={topMidEdgeCanvasRef} nearRef={topNearEdgeCanvasRef} />
                                        <AmbientBlurStack direction="bottom" translateY={Math.max(0, topOffsetY + containerHeightPx - 4)} visible={topOffsetY + containerHeightPx < dimensions.height - 2} liveMode={isLiveMediaLoop} wrapperRef={botAmbientWrapRef} farRef={ambientCanvasRef} midRef={midEdgeCanvasRef} nearRef={nearEdgeCanvasRef} />
                                    </>
                                )}
                            </div>
                        )}

                        <div ref={clipWrapperRef} style={is45 && isImage ? {
                            position: 'absolute', inset: 0, width: '100%', height: '100%',
                            ...(isLiveMediaLoop ? {} : { clipPath: `inset(${topOffsetY}px 0 ${Math.max(0, dimensions.height - topOffsetY - containerHeightPx)}px 0)` }),
                            background: 'transparent', overflow: 'hidden', zIndex: 2, willChange: 'clip-path'
                        } : {
                            position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', backgroundColor: is45 ? 'transparent' : '#050505', zIndex: 2
                        }}>
                            {isImage ? (
                                <Image
                                    ref={imageRef}
                                    src={videoSrc}
                                    alt={headlineText || "Scene visual"}
                                    width={dimensions.width}
                                    height={dimensions.height}
                                    unoptimized
                                    loading="eager"
                                    decoding="sync"
                                    referrerPolicy="no-referrer"
                                    onLoad={(e) => { if (e.currentTarget.naturalWidth && e.currentTarget.naturalHeight) setMediaNaturalAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight); }}
                                    style={is45
                                        ? { ...topBoxMediaStyle, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${panXShift}px, ${mediaOffsetY45}px, 0) scale(${effectiveScale}) translateZ(0)` }), willChange: 'transform' }
                                        : { ...fullBleedMediaStyle, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${fullBleedPanX}px, 0, 0) scale(${kenBurnsScale}) translateZ(0)` }), willChange: 'transform' }}
                                />
                            ) : (
                                <>
                                    <video
                                        ref={videoRef}
                                        src={videoSrc}
                                        width={dimensions.width}
                                        height={dimensions.height}
                                        aria-label={draft.headline || "Video preview"}
                                        crossOrigin="anonymous"
                                        playsInline
                                        muted={effectiveMuted}
                                        preload="auto"
                                        disablePictureInPicture
                                        disableRemotePlayback
                                        onLoadedMetadata={handleLoadedMetadata}
                                        onLoadedData={refreshAmbientGlow}
                                        onSeeked={refreshAmbientGlow}
                                        onTimeUpdate={handleTimeUpdate}
                                        onEnded={handleEnded}
                                        style={is45
                                            ? { ...topBoxMediaStyle, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${panXShift}px, ${mediaOffsetY45}px, 0) scale(${effectiveScale}) translateZ(0)` }), willChange: 'transform' }
                                            : { ...fullBleedMediaStyle, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${fullBleedPanX}px, 0, 0) scale(${zoomScale}) translateZ(0)` }), willChange: 'transform' }}
                                    />
                                    {useStandbyDeck && (
                                        <video
                                            ref={standbyVideoRef}
                                            src={videoSrc}
                                            width={dimensions.width}
                                            height={dimensions.height}
                                            aria-hidden="true"
                                            crossOrigin="anonymous"
                                            playsInline
                                            muted
                                            preload="auto"
                                            disablePictureInPicture
                                            disableRemotePlayback
                                            onLoadedMetadata={handleStandbyLoadedMetadata}
                                            onLoadedData={refreshAmbientGlow}
                                            onSeeked={refreshAmbientGlow}
                                            onTimeUpdate={handleTimeUpdate}
                                            onEnded={handleEnded}
                                            style={is45
                                                ? { ...topBoxMediaStyle, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${panXShift}px, ${mediaOffsetY45}px, 0) scale(${effectiveScale}) translateZ(0)` }), pointerEvents: 'none', willChange: 'transform' }
                                                : { ...fullBleedMediaStyle, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${fullBleedPanX}px, 0, 0) scale(${zoomScale}) translateZ(0)` }), pointerEvents: 'none', willChange: 'transform' }}
                                        />
                                    )}
                                </>
                            )}

                            {!isPlaying && (
                                <div style={{
                                    position: 'absolute',
                                    ...(is45 ? { insetInline: 0, marginInline: 'auto', top: `${topOffsetY + containerHeightPx / 2 - 34}px` } : { inset: 0, margin: 'auto' }),
                                    zIndex: 15, pointerEvents: 'none',
                                    background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.15)',
                                    borderRadius: '50%', width: is45 ? '68px' : '80px', height: is45 ? '68px' : '80px',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)'
                                }}>
                                    <PlayIcon width={is45 ? 30 : 32} height={is45 ? 30 : 32} fill="var(--ui-accent)" />
                                </div>
                            )}
                        </div>
                        {!overlayOnly && (
                            <div ref={fadeOverlayRef} style={{ position: 'absolute', inset: 0, backgroundColor: is45 ? '#080808' : '#050505', ...(isLiveMediaLoop ? {} : { opacity: hookFade, visibility: hookFade > 0.0005 ? 'visible' : 'hidden' }), pointerEvents: 'none', willChange: 'opacity', zIndex: 5 }} />
                        )}
                    </>
                )}

                {!overlayOnly && !hasMedia && (() => {
                    const pctMatch = isLoadingStream && ingestStatus ? /(\d{1,3})%/.exec(ingestStatus) : null;
                    const ingestPct = pctMatch ? Math.min(100, Math.max(0, Number(pctMatch[1]))) : null;
                    return (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', textAlign: 'center', paddingInline: '60px', color: isLoadingStream ? 'var(--ui-accent)' : 'var(--ui-text-dim)', fontSize: '20px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 }}>
                            <span className="tpe-tabular-nums">{isLoadingStream ? `⚡ ${ingestStatus || 'LOADING & SYNCING STREAM...'}` : 'NO VIDEO LOADED'}</span>
                            {isLoadingStream && ingestPct !== null && (
                                <div style={{ width: '360px', height: '6px', borderRadius: '99px', background: 'rgba(255, 255, 255, 0.1)', overflow: 'hidden' }}>
                                    <div style={{ width: '100%', height: '100%', background: 'var(--ui-accent)', transform: `scaleX(${ingestPct / 100})`, transformOrigin: 'left center', transition: 'transform 0.12s linear', willChange: 'transform' }} />
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Subtle Top Safe-Zone Scrim for Brand Legibility (kept mounted and hidden via visibility when 4:5 top blur is active) */}
                <div style={{ position: 'absolute', insetBlockStart: 0, insetInline: 0, height: is916 ? '18%' : '15%', background: 'linear-gradient(to bottom, oklch(0% 0 0 / 0.26) 0%, transparent 100%)', visibility: (is45 && draft.enableAmbientBlur !== false && topOffsetY > 2) ? 'hidden' : 'visible', pointerEvents: 'none', zIndex: 6 }} />

                {/* Branding Overlay (44px top in 4:5, 140px safe zone in 9:16; 60px left, 140px right) */}
                <div className="tpe-branding-overlay tpe-flex-row" style={{ top: is45 ? '44px' : undefined, insetInlineStart: '60px', insetInlineEnd: '140px', zIndex: 20 }}>
                    <div className="tpe-brand-left" translate="no"><TPEVectorLogo scale={1.8} showWordmark={true} animateWordmark={animateWordmark} wordmarkStartTime={!overlayOnly && draft.enableMotion !== false ? currentTime : 0} externalDriveRef={logoWordmarkDriveRef} motionConfig={logoMotionConfig} /></div>
                    <div className="tpe-brand-right tpe-flex-col">
                        <div className="tpe-category-tag"><span className="tpe-slash" aria-hidden="true"><span className="tpe-slash-1">/</span><span className="tpe-slash-2">/</span></span> {draft.category || "ANALYSIS"}</div>
                        <div className="tpe-watermark" translate="no">@thePakistanEdit</div>
                    </div>
                </div>

                {/* Narrative Layer */}
                {is45 ? (
                    <div style={{ position: 'absolute', top: presetLayout.top, bottom: presetLayout.bottom, left: '60px', right: '140px', display: 'flex', flexDirection: 'column', justifyContent: presetLayout.justify, gap: '16px', pointerEvents: 'none', zIndex: 10 }}>
                        {headlineText && (
                            <div key={`headline-${textKey}`} dir="auto" className="tpe-news-h1 tpe-kinetic-in" style={{ fontSize: '64px', lineHeight: 1.08, letterSpacing: '-0.02em', textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
                                <HighlightedText text={headlineText} />
                            </div>
                        )}
                        {subtitleText && (
                            <div key={`subtitle-${textKey}`} dir="auto" className="tpe-kinetic-in-delayed" style={{ fontFamily: 'var(--tpe-font-geist)', fontSize: '32px', fontWeight: 500, lineHeight: 1.32, color: 'oklch(from var(--ui-text) l c h / 0.95)', textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
                                <HighlightedText text={subtitleText} />
                            </div>
                        )}
                    </div>
                ) : (
                    (headlineText || subtitleText) && (
                        <>
                            <div style={scrimStyle} />
                            <div className="tpe-news-inner tpe-flex-col tpe-full-absolute" style={{ pointerEvents: 'none', justifyContent: presetLayout.justify, paddingBlockStart: presetLayout.top, paddingBlockEnd: presetLayout.bottom, paddingInlineStart: '60px', paddingInlineEnd: '140px', zIndex: 10 }}>
                                <div className="tpe-bulletin-group" style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBlockStart: 0, marginBlockEnd: 0 }}>
                                    {headlineText && (
                                        <div key={`headline-full-${textKey}`} dir="auto" className="tpe-news-h1 tpe-kinetic-in" style={{ fontSize: is916 ? '76px' : '64px', lineHeight: 1.05, textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
                                            <HighlightedText text={headlineText} />
                                        </div>
                                    )}
                                    {subtitleText && (
                                        <div key={`subtitle-full-${textKey}`} dir="auto" className="tpe-kinetic-in-delayed" style={{ fontFamily: 'var(--tpe-font-geist)', fontSize: is916 ? '34px' : '32px', fontWeight: 500, lineHeight: 1.3, color: 'oklch(from var(--ui-text) l c h / 0.95)', textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
                                            <HighlightedText text={subtitleText} />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </>
                    )
                )}

                {/* Live Voice-Detected Caption Overlay */}
                {activeSubtitle && (() => {
                    const ccPos = draft.subtitlePosition || 'bottom';
                    const ccFontSize = draft.subtitleFontSize ?? getDefaultSubtitleFontSize(draft.aspectRatio);
                    const ccFontFamily = SUBTITLE_FONT_OPTIONS[draft.subtitleFont || 'plus-jakarta']?.cssFamily || 'var(--font-plus-jakarta), sans-serif';
                    const ccBackdrop = draft.subtitleBackdrop || 'pill';
                    const ccSpanStyle = getCaptionSpanStyle(ccBackdrop, ccFontFamily, ccFontSize);
                    const ccBottom = is45
                        ? (ccPos === 'high' ? '255px' : ccPos === 'middle' ? '185px' : '115px')
                        : (is916
                            ? (ccPos === 'high' ? '435px' : ccPos === 'middle' ? '340px' : '245px')
                            : (ccPos === 'high' ? '280px' : ccPos === 'middle' ? '215px' : '150px'));
                    return (
                        <div style={{ position: 'absolute', bottom: ccBottom, insetInlineStart: '60px', insetInlineEnd: '140px', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 15 }}>
                            <span dir="auto" style={ccSpanStyle}>
                                {activeSubtitle.text}
                            </span>
                        </div>
                    );
                })()}

                {/* Footer: Footage & Source (60px Left, 140px Right) */}
                {(creditText || sourceText) && (
                    <div className="tpe-news-footer tpe-flex-row" style={{ position: 'absolute', bottom: footerBottom, insetInlineStart: '60px', insetInlineEnd: '140px', width: 'auto', zIndex: 10 }}>
                        <div className="tpe-metadata-cluster tpe-flex-row">
                            {sourceText && <span className="tpe-meta-item"><span className="tpe-meta-label">{draft.sourcePrefix || "SOURCE:"}</span> <HighlightedText text={sourceText} /></span>}
                        </div>
                        <div className="tpe-metadata-cluster tpe-flex-row" style={{ marginLeft: 'auto', textAlign: 'right' }}>
                            {creditText && <span className="tpe-meta-item"><span className="tpe-meta-label">{draft.creditPrefix || "FOOTAGE:"}</span> <HighlightedText text={creditText} /></span>}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
});

VideoCard.displayName = "VideoCard";
