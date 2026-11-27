"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
    VideoDraft,
    SUBTITLE_FONT_OPTIONS,
    clamp,
    getActiveSceneAtTime,
    getSceneBoundaries,
    getTotalVideoDuration,
    getHookTransitionFade,
    wrapMediaTime,
    getDefaultSubtitleFontSize,
    findSubtitleAtMediaTime,
    interpolateKeyframe,
    isSharedReHookScene,
    getVideoHeadingPreset,
    getDefaultVideoFraming,
    has45LetterboxFraming,
    type TimelineScene,
} from "@/types/news";
import { VIDEO_FORMAT_CONFIGS } from "@/config/omnichannel";
import { TPEVectorLogo, type LogoMotionConfig } from "../TPEVectorLogo";
import { HighlightedText } from "../NewsCard/HighlightedText";
import { PlayIcon } from "../../icons/TPEIcons";
import { VideoOutroCard } from "./VideoOutroCard";
import { AmbientBlurStack } from "./AmbientBlurStack";
import { useVideoElementSync } from "./useVideoElementSync";
import { useSmoothFramingLoop } from "./useSmoothFramingLoop";
import { shouldUseStandbyDeck } from "./dualDeckHelpers";
import {
    compute45FrameLayout,
    computeAmbientCropInto,
    computeFullBleedLayout,
    computeKenBurnsMul,
    getInitialMediaAspect,
    resolveCaptionBottom,
    resolvePresetLayout,
    sanitizeAspect,
} from "./videoCardGeometry";
import { useMediaQuery } from "@/app/admin/hooks/useMediaQuery";
import { classifyPlaybackProfile, extractKeyframeTimesFromFrameIndex } from "@/app/admin/utils/clientMediaInspector";
import type { LivePlaybackClock } from "@/app/admin/utils/livePlaybackClock";

const IMAGE_URL_RE = /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i;
const INGEST_PCT_RE = /(\d{1,3})%/;
const BG_BLUR_FILTER = 'blur(50px) brightness(0.38) saturate(1.18)';
const KEY_LIGHT_SHADOW = '0 1px 2px rgba(0,0,0,0.95), 0 8px 28px rgba(0,0,0,0.65)';

const SCRIM_STYLES: Record<'top' | 'center' | 'bottom', React.CSSProperties> = {
    center: { position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(5,5,5,0.72) 0%, rgba(5,5,5,0.36) 52%, transparent 82%)', pointerEvents: 'none', zIndex: 9 },
    top: { position: 'absolute', insetInline: 0, top: 0, height: '44%', background: 'linear-gradient(to bottom, rgba(5,5,5,0.86) 0%, rgba(5,5,5,0.48) 48%, transparent 100%)', pointerEvents: 'none', zIndex: 9 },
    bottom: { position: 'absolute', insetInline: 0, bottom: 0, height: '46%', background: 'linear-gradient(to top, rgba(5,5,5,0.88) 0%, rgba(5,5,5,0.52) 48%, transparent 100%)', pointerEvents: 'none', zIndex: 9 },
};

const CC_BACKDROP_STYLES: Record<string, React.CSSProperties> = {
    none: { padding: '4px 10px', textShadow: '0 1px 4px rgba(0,0,0,0.6)' },
    shadow: { padding: '4px 10px', textShadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.85), -1px -1px 0 rgba(0,0,0,0.75), 1px 1px 0 rgba(0,0,0,0.75)' },
    glass: { padding: '10px 20px', borderRadius: '10px', background: 'rgba(8, 8, 8, 0.52)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.16)', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' },
    pill: { padding: '10px 20px', borderRadius: '10px', background: 'rgba(8, 8, 8, 0.86)', border: '1px solid rgba(255,255,255,0.14)', boxShadow: '0 8px 24px rgba(0,0,0,0.65)' },
};

const STATIC_STYLES = {
    audioHidden: { display: 'none' } satisfies React.CSSProperties,
    ambientBackdrop: { position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: 1 } satisfies React.CSSProperties,
    emptyStateBase: { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', textAlign: 'center', paddingInline: '60px', fontSize: '20px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 } satisfies React.CSSProperties,
    ingestTrack: { width: '360px', height: '6px', borderRadius: '99px', background: 'rgba(255, 255, 255, 0.1)', overflow: 'hidden' } satisfies React.CSSProperties,
    playIconBase: { position: 'absolute', zIndex: 15, pointerEvents: 'none', background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.15)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)' } satisfies React.CSSProperties,
    bulletinGroup: { display: 'flex', flexDirection: 'column', gap: '16px', marginBlockStart: 0, marginBlockEnd: 0 } satisfies React.CSSProperties,
    subtitleWrapBase: { position: 'absolute', insetInlineStart: '60px', insetInlineEnd: '140px', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 15 } satisfies React.CSSProperties,
    footerEndCluster: { marginInlineStart: 'auto', textAlign: 'end' } satisfies React.CSSProperties,
} as const;

const appendIngestQuery = (url: string, param: string): string => `${url}${url.includes('?') ? '&' : '?'}${param}`;

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
    onRegisterAudioUnlock?: (unlock: (() => void) | null) => void;
    companionAudioUrl?: string;
    overlayOnly?: boolean;
    pausedFramingOverride?: { zoom: number; posX: number; posY: number };
    starPreviewNonce?: number;
    liveClock?: LivePlaybackClock;
}

interface OverlayLayersProps {
    draft: VideoDraft;
    activeScene: TimelineScene | null | undefined;
    isOutro: boolean;
    is45: boolean;
    is916: boolean;
    currentTime: number;
    headlineText: string;
    subtitleText: string;
    topScrimHidden: boolean;
    animateWordmark: boolean;
    wordmarkStartTime: number;
    logoMotionConfig: LogoMotionConfig;
    logoWordmarkDriveRef?: React.MutableRefObject<((elapsedSec: number) => void) | null>;
}

/** Shared broadcast graphics layer rendered identically in live preview and off-screen FFmpeg overlay PNG exports. */
const VideoCardOverlayLayers: React.FC<OverlayLayersProps> = ({
    draft, activeScene, isOutro, is45, is916, currentTime, headlineText, subtitleText,
    topScrimHidden, animateWordmark, wordmarkStartTime, logoMotionConfig, logoWordmarkDriveRef,
}) => {
    const textKey = `${headlineText}::${subtitleText}`;
    const creditText = activeScene?.creditName || draft.creditName;
    const sourceText = activeScene?.sourceName || draft.sourceName;
    const preset = getVideoHeadingPreset(draft, draft.aspectRatio);
    const presetLayout = resolvePresetLayout(is45, is916, preset);
    const footerBottom = is45 ? '50px' : (is916 ? '140px' : '80px');

    const captionsOn = !isOutro && (activeScene?.showSubtitles ?? (draft.showSubtitles !== false));
    const activeSubtitle = captionsOn && draft.subtitles?.length
        ? findSubtitleAtMediaTime(draft.subtitles, wrapMediaTime(draft, currentTime, draft.videoDuration || 0))
        : undefined;

    const rawFontSize = draft.subtitleFontSize;
    const ccFontSize = rawFontSize !== undefined && Number.isFinite(rawFontSize) && rawFontSize > 0
        ? rawFontSize
        : getDefaultSubtitleFontSize(draft.aspectRatio);
    const ccFontFamily = SUBTITLE_FONT_OPTIONS[draft.subtitleFont || 'plus-jakarta']?.cssFamily || 'var(--font-plus-jakarta), sans-serif';
    const ccBackdrop = draft.subtitleBackdrop || 'pill';

    const headlineStyle: React.CSSProperties = is45
        ? { fontSize: '64px', lineHeight: 1.08, letterSpacing: '-0.02em', textShadow: KEY_LIGHT_SHADOW, whiteSpace: 'pre-line' }
        : { fontSize: is916 ? '76px' : '64px', lineHeight: 1.05, textShadow: KEY_LIGHT_SHADOW, whiteSpace: 'pre-line' };
    const subtitleStyle: React.CSSProperties = {
        fontFamily: 'var(--tpe-font-geist)', fontSize: !is45 && is916 ? '34px' : '32px', fontWeight: 500,
        lineHeight: is45 ? 1.32 : 1.3, color: 'oklch(from var(--ui-text) l c h / 0.95)', textShadow: KEY_LIGHT_SHADOW, whiteSpace: 'pre-line',
    };
    const narrativeBlocks = (
        <>
            {headlineText && (
                <div key={`headline-${is45 ? '45' : 'full'}-${textKey}`} dir="auto" className="tpe-news-h1 tpe-kinetic-in" style={headlineStyle}>
                    <HighlightedText text={headlineText} />
                </div>
            )}
            {subtitleText && (
                <div key={`subtitle-${is45 ? '45' : 'full'}-${textKey}`} dir="auto" className="tpe-kinetic-in-delayed" style={subtitleStyle}>
                    <HighlightedText text={subtitleText} />
                </div>
            )}
        </>
    );

    return (
        <>
            {/* Subtle Top Safe-Zone Scrim (kept mounted and hidden via visibility when 4:5 top blur is active) */}
            <div aria-hidden="true" style={{ position: 'absolute', insetBlockStart: 0, insetInline: 0, height: is916 ? '18%' : '15%', background: 'linear-gradient(to bottom, oklch(0% 0 0 / 0.26) 0%, transparent 100%)', visibility: topScrimHidden ? 'hidden' : 'visible', pointerEvents: 'none', zIndex: 6 }} />

            {/* Branding Overlay */}
            <div className="tpe-branding-overlay tpe-flex-row" style={{ top: is45 ? '44px' : undefined, insetInlineStart: '60px', insetInlineEnd: '140px', zIndex: 20 }}>
                <div className="tpe-brand-left" translate="no">
                    <TPEVectorLogo scale={1.8} showWordmark={true} animateWordmark={animateWordmark} wordmarkStartTime={wordmarkStartTime} externalDriveRef={logoWordmarkDriveRef} motionConfig={logoMotionConfig} />
                </div>
                <div className="tpe-brand-right tpe-flex-col">
                    <div className="tpe-category-tag" dir="auto"><span className="tpe-slash" aria-hidden="true"><span className="tpe-slash-1">/</span><span className="tpe-slash-2">/</span></span> {draft.category || "ANALYSIS"}</div>
                    <div className="tpe-watermark" translate="no">@thePakistanEdit</div>
                </div>
            </div>

            {/* Narrative Layer */}
            {is45 ? (
                <div style={{ position: 'absolute', top: presetLayout.top, bottom: presetLayout.bottom, insetInlineStart: '60px', insetInlineEnd: '140px', display: 'flex', flexDirection: 'column', justifyContent: presetLayout.justify, gap: '16px', pointerEvents: 'none', zIndex: 10 }}>
                    {narrativeBlocks}
                </div>
            ) : (
                (headlineText || subtitleText) && (
                    <>
                        <div aria-hidden="true" style={SCRIM_STYLES[preset] ?? SCRIM_STYLES.bottom} />
                        <div className="tpe-news-inner tpe-flex-col tpe-full-absolute" style={{ pointerEvents: 'none', justifyContent: presetLayout.justify, paddingBlockStart: presetLayout.top, paddingBlockEnd: presetLayout.bottom, paddingInlineStart: '60px', paddingInlineEnd: '140px', zIndex: 10 }}>
                            <div className="tpe-bulletin-group" style={STATIC_STYLES.bulletinGroup}>{narrativeBlocks}</div>
                        </div>
                    </>
                )
            )}

            {/* Live Voice-Detected Caption Overlay */}
            {activeSubtitle && (
                <div style={{ ...STATIC_STYLES.subtitleWrapBase, bottom: resolveCaptionBottom(is45, is916, draft.subtitlePosition || 'bottom') }}>
                    <span dir="auto" style={{ color: '#fff', fontWeight: 700, lineHeight: 1.25, textAlign: 'center', ...(CC_BACKDROP_STYLES[ccBackdrop] ?? CC_BACKDROP_STYLES.pill), fontFamily: ccFontFamily, fontSize: `${ccFontSize}px` }}>
                        {activeSubtitle.text}
                    </span>
                </div>
            )}

            {/* Footer: Footage & Source */}
            {(creditText || sourceText) && (
                <div className="tpe-news-footer tpe-flex-row" style={{ position: 'absolute', bottom: footerBottom, insetInlineStart: '60px', insetInlineEnd: '140px', width: 'auto', zIndex: 10 }}>
                    <div className="tpe-metadata-cluster tpe-flex-row">
                        {sourceText && <span dir="auto"><span className="tpe-meta-label">{draft.sourcePrefix || "SOURCE:"}</span> <HighlightedText text={sourceText} /></span>}
                    </div>
                    <div className="tpe-metadata-cluster tpe-flex-row" style={STATIC_STYLES.footerEndCluster}>
                        {creditText && <span dir="auto"><span className="tpe-meta-label">{draft.creditPrefix || "FOOTAGE:"}</span> <HighlightedText text={creditText} /></span>}
                    </div>
                </div>
            )}
        </>
    );
};

/** Zero-playback-hook export surface for `<VideoCard overlayOnly />` (avoids ~135 media/rAF/canvas hooks per PNG capture). */
const VideoCardOverlayOnly: React.FC<VideoCardProps> = ({ draft, isPlaying = false, currentTime = 0, pausedFramingOverride, starPreviewNonce = 0 }) => {
    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio] ?? VIDEO_FORMAT_CONFIGS['9:16'];
    const is916 = draft.aspectRatio === '9:16';
    const is45 = draft.aspectRatio === '4:5';
    const { scene: activeScene, isOutro, sceneIndex } = getActiveSceneAtTime(draft, currentTime);
    const defaultFraming = getDefaultVideoFraming(draft, draft.aspectRatio);
    const cardFraming = pausedFramingOverride ?? (draft.keyframes?.length ? interpolateKeyframe(draft.keyframes, currentTime, defaultFraming) : defaultFraming);
    const topOffsetY = is45 ? compute45FrameLayout(dimensions, getInitialMediaAspect(draft), cardFraming).topY : 0;
    const textScene = isSharedReHookScene(draft.scenes, sceneIndex) ? (draft.scenes?.[0] ?? activeScene) : activeScene;
    const headlineText = isOutro ? (draft.outroCta || "") : (textScene?.title ?? draft.headline ?? "");
    const subtitleText = isOutro ? "" : (textScene?.subtitle ?? draft.subtitle ?? "");
    const logoMotionConfig: LogoMotionConfig = {
        enableLogo: draft.enableLogo !== false, enableWordmark: draft.motionWordmark !== false,
        starCues: draft.starCues, morphDuration: draft.starMorphDuration, holdDuration: draft.starHoldDuration,
        starScale: draft.starScale, spinMode: draft.starSpinMode, sequence: draft.starSequence,
        holdFeel: draft.starHoldFeel, previewNonce: starPreviewNonce,
    };
    const outroMotionConfig: LogoMotionConfig = { ...logoMotionConfig, starCues: [{ id: 'outro-star', time: 0 }] };

    return (
        <div
            className="tpe-news-card" data-slide-type="bulletin" data-platform="tiktok" data-motion="off"
            data-playing={isPlaying ? 'true' : 'false'} data-overlay-only="true" data-step={1}
            style={{ '--card-w': `${dimensions.width}px`, '--card-h': `${dimensions.height}px`, '--safe-right': '140px', cursor: 'default', backgroundColor: !isOutro ? 'transparent' : undefined } as React.CSSProperties}
        >
            {isOutro && <VideoOutroCard outroCta={draft.outroCta} is916={is916} enableMotion={false} motionConfig={outroMotionConfig} />}
            <div className="tpe-full-absolute tpe-flex-col" style={{ background: !isOutro ? 'transparent' : '#080808', visibility: isOutro ? 'hidden' : 'visible', pointerEvents: isOutro ? 'none' : undefined }}>
                <VideoCardOverlayLayers
                    draft={draft} activeScene={activeScene} isOutro={isOutro} is45={is45} is916={is916} currentTime={currentTime}
                    headlineText={headlineText} subtitleText={subtitleText}
                    topScrimHidden={is45 && draft.enableAmbientBlur !== false && topOffsetY > 2}
                    animateWordmark={false} wordmarkStartTime={0} logoMotionConfig={logoMotionConfig}
                />
            </div>
        </div>
    );
};

/** Interactive broadcast video monitor supporting 4:5 Contain, 9:16 Full-Bleed, and 16:9 Landscape formats. */
const VideoCardInteractive: React.FC<VideoCardProps> = ({
    draft, isPlaying = false, isScrubbing = false, playbackMode = 'play-all', currentTime = 0, seekNonce = 0,
    isMuted = false, isLoadingStream = false, ingestStatus = null, onTimeUpdate, onTogglePlay,
    onRegisterAudioUnlock, companionAudioUrl, pausedFramingOverride, starPreviewNonce = 0, liveClock,
}) => {
    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio] ?? VIDEO_FORMAT_CONFIGS['9:16'];
    const is916 = draft.aspectRatio === '9:16';
    const is45 = draft.aspectRatio === '4:5';
    const [mediaNaturalAspect, setMediaNaturalAspect] = useState<number>(() => getInitialMediaAspect(draft));
    const handleAspectDetected = useCallback((aspect: number) => {
        if (Number.isFinite(aspect) && aspect > 0) setMediaNaturalAspect(aspect);
    }, []);
    const safeAspect = sanitizeAspect(mediaNaturalAspect);

    const { scene: activeScene, isOutro, sceneIndex } = getActiveSceneAtTime(draft, currentTime);
    const hasMedia = Boolean(activeScene?.mediaUrl || draft.videoUrl);
    const videoSrc = activeScene?.mediaUrl || draft.videoUrl || "";
    const effectiveMuted = draft.isMuted ?? isMuted;

    const sceneStart = isOutro ? 0 : (getSceneBoundaries(draft.scenes)[sceneIndex]?.start ?? 0);
    const sceneDuration = activeScene?.duration || 10;
    const isLiveLoopActive = isPlaying && !isScrubbing;
    const isLiveMediaLoop = isLiveLoopActive && !isOutro;
    const staticFramingTime = isLiveLoopActive ? sceneStart : currentTime;

    const isImage = activeScene?.mediaType === 'image' || (Boolean(videoSrc) && (videoSrc.startsWith('data:image') || IMAGE_URL_RE.test(videoSrc)));
    const hasVideoElement = !isImage && hasMedia;
    const kenBurnsMul = computeKenBurnsMul(isImage, staticFramingTime, sceneStart, sceneDuration);

    const defaultFraming = getDefaultVideoFraming(draft, draft.aspectRatio);
    const cardFraming = pausedFramingOverride ?? (draft.keyframes?.length ? interpolateKeyframe(draft.keyframes, staticFramingTime, defaultFraming) : defaultFraming);
    const layout45 = is45 ? compute45FrameLayout(dimensions, safeAspect, cardFraming, kenBurnsMul) : null;
    const layoutFull = is45 ? null : computeFullBleedLayout(dimensions, safeAspect, cardFraming, kenBurnsMul);

    const effectiveScale = layout45 ? layout45.effScale : (layoutFull?.finalScale ?? 1);
    const containerHeightPx = layout45 ? layout45.containerH : dimensions.height;
    const H_contain = layout45 ? layout45.H_cont : dimensions.height;
    const panXShift = layout45 ? layout45.panX : 0;
    const topOffsetY = layout45 ? layout45.topY : 0;
    const mediaOffsetY45 = layout45 ? layout45.mediaY : 0;

    const ambientBlurActive = is45 && draft.enableAmbientBlur !== false && has45LetterboxFraming(draft);
    const needsTopAmbient = ambientBlurActive && (
        (defaultFraming.posY ?? 100) < 99.5 || Boolean(draft.keyframes?.some((kf) => (kf.posY ?? 100) < 99.5 || (kf.pre?.posY ?? 100) < 99.5))
    );
    const ambientVisibility = {
        topVisible: ambientBlurActive && topOffsetY > 2,
        botVisible: ambientBlurActive && topOffsetY + containerHeightPx < dimensions.height - 2,
    };
    const ambientCrop = ambientBlurActive
        ? computeAmbientCropInto(dimensions, H_contain, containerHeightPx, effectiveScale, panXShift, { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 })
        : { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 };

    const clipWrapperRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const bgBlurImgRef = useRef<HTMLImageElement>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const fadeOverlayRef = useRef<HTMLDivElement>(null);
    const topAmbientWrapRef = useRef<HTMLDivElement>(null);
    const botAmbientWrapRef = useRef<HTMLDivElement>(null);
    const logoWordmarkDriveRef = useRef<((elapsedSec: number) => void) | null>(null);

    const isCompactOrTouch = useMediaQuery("(max-width: 900px), (pointer: coarse)");
    const isMasterMedia = !activeScene?.mediaUrl || activeScene.mediaUrl === draft.videoUrl;
    const activeMediaInfo = isMasterMedia ? draft.sourceMediaInfo : undefined;
    const playbackProfile = classifyPlaybackProfile(activeMediaInfo, isCompactOrTouch, videoSrc.startsWith('blob:'));
    const useDecoupledAudioLock = hasVideoElement && playbackProfile === 'decoupled-audio-lock';
    const isServerIngest = videoSrc.startsWith('/api/video/ingest');
    const companionAudioSrc = isServerIngest ? appendIngestQuery(videoSrc, 'track=audio') : (isMasterMedia && companionAudioUrl ? companionAudioUrl : videoSrc);
    const standbyVideoSrc = isServerIngest ? appendIngestQuery(videoSrc, 'deck=standby') : videoSrc;
    const keyframeTimes = useMemo(
        () => (isMasterMedia ? (draft.sourceKeyframeTimes ?? extractKeyframeTimesFromFrameIndex(draft.sourceFrameIndex)) : undefined),
        [isMasterMedia, draft.sourceKeyframeTimes, draft.sourceFrameIndex]
    );
    const useStandbyDeck = hasVideoElement && shouldUseStandbyDeck(draft, isCompactOrTouch);

    const {
        videoRef, standbyVideoRef, companionAudioRef, activeVideoRef, audioOutputRef, engineStateRef,
        currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef, ambientCanvases,
        isCompanionFallback, unlockCompanionAudio, handleCompanionAudioError, handleCompanionAudioEnded,
        handleCompanionAudioLoadedMetadata, refreshAmbientGlow, handleLoadedMetadata,
        handleStandbyLoadedMetadata, handleTimeUpdate, handleEnded,
    } = useVideoElementSync({
        draft, videoSrc, hasVideoElement, isPlaying, isScrubbing, isOutro, playbackMode, playbackProfile,
        keyframeTimes, currentTime, seekNonce, useStandbyDeck, effectiveMuted, ambientBlurActive,
        ambientCrop, ambientVisibility, onTimeUpdate, onAspectDetected: handleAspectDetected,
    });

    useEffect(() => {
        if (!onRegisterAudioUnlock) return;
        onRegisterAudioUnlock(unlockCompanionAudio);
        return () => onRegisterAudioUnlock(null);
    }, [onRegisterAudioUnlock, unlockCompanionAudio]);

    useSmoothFramingLoop({
        draft, is45, isImage, isPlaying, isScrubbing, isOutro, currentTime, sceneStart, sceneDuration,
        mediaNaturalAspect: safeAspect, dimensions, liveTimelineTimeRef: currentTimeRef, ambientCropRef, ambientVisibilityRef, isCameraGlidingRef,
        videoRef: activeVideoRef, audioOutputRef, engineStateRef, imageRef, bgBlurImgRef, clipWrapperRef, progressBarRef, fadeOverlayRef, topAmbientWrapRef, botAmbientWrapRef, logoWordmarkDriveRef, liveClock,
    });

    const {
        enableLogo, motionWordmark, starCues, starMorphDuration, starHoldDuration,
        starScale, starSpinMode, starSequence, starHoldFeel,
    } = draft;
    const logoMotionConfig = useMemo<LogoMotionConfig>(() => ({
        enableLogo: enableLogo !== false, enableWordmark: motionWordmark !== false, starCues,
        morphDuration: starMorphDuration, holdDuration: starHoldDuration, starScale,
        spinMode: starSpinMode, sequence: starSequence, holdFeel: starHoldFeel, previewNonce: starPreviewNonce,
    }), [enableLogo, motionWordmark, starCues, starMorphDuration, starHoldDuration, starScale, starSpinMode, starSequence, starHoldFeel, starPreviewNonce]);
    const outroMotionConfig = useMemo<LogoMotionConfig>(() => ({ ...logoMotionConfig, starCues: [{ id: 'outro-star', time: 0 }] }), [logoMotionConfig]);

    const textScene = isSharedReHookScene(draft.scenes, sceneIndex) ? (draft.scenes?.[0] ?? activeScene) : activeScene;
    const headlineText = isOutro ? (draft.outroCta || "") : (textScene?.title ?? draft.headline ?? "");
    const subtitleText = isOutro ? "" : (textScene?.subtitle ?? draft.subtitle ?? "");
    const progressPercent = clamp((currentTime / (getTotalVideoDuration(draft) || 1)) * 100, 0, 100);
    const hookFade = isLiveMediaLoop ? 0 : getHookTransitionFade(draft, currentTime);

    const coverW = layoutFull?.coverW ?? dimensions.width;
    const coverH = layoutFull?.coverH ?? dimensions.height;
    const mediaBoxStyle: React.CSSProperties = is45
        ? { position: 'absolute', top: 0, left: 0, width: `${dimensions.width}px`, height: `${H_contain}px`, objectFit: 'cover', objectPosition: 'center top', transformOrigin: 'top center', transition: 'none' }
        : { position: 'absolute', left: `${(dimensions.width - coverW) / 2}px`, top: `${(dimensions.height - coverH) / 2}px`, width: `${coverW}px`, height: `${coverH}px`, objectFit: 'cover', objectPosition: 'center center', transformOrigin: 'center center', transition: 'none' };
    const staticTransform = isLiveMediaLoop ? undefined : is45
        ? `translate3d(${panXShift}px, ${mediaOffsetY45}px, 0) scale(${effectiveScale}) translateZ(0)`
        : `translate3d(${layoutFull?.panX ?? 0}px, 0, 0) scale(${layoutFull?.finalScale ?? 1}) translateZ(0)`;
    const activeMediaStyle: React.CSSProperties = { ...mediaBoxStyle, ...(staticTransform ? { transform: staticTransform } : {}), willChange: 'transform' };
    const sharedVideoProps = {
        width: dimensions.width, height: dimensions.height, crossOrigin: "anonymous" as const, playsInline: true,
        preload: "auto" as const, disablePictureInPicture: true, disableRemotePlayback: true,
        onLoadedData: refreshAmbientGlow, onSeeked: refreshAmbientGlow, onTimeUpdate: handleTimeUpdate, onEnded: handleEnded,
    };

    const pctMatch = !hasMedia && isLoadingStream && ingestStatus ? INGEST_PCT_RE.exec(ingestStatus) : null;
    const ingestPct = pctMatch ? clamp(Number(pctMatch[1]), 0, 100) : null;

    return (
        <div
            className="tpe-news-card" data-slide-type="bulletin" data-platform="tiktok"
            data-motion={draft.enableMotion === false || draft.motionText === false || isScrubbing ? 'off' : 'on'}
            data-playing={isPlaying ? 'true' : 'false'} data-step={1}
            style={{ '--card-w': `${dimensions.width}px`, '--card-h': `${dimensions.height}px`, '--safe-right': '140px', cursor: 'pointer' } as React.CSSProperties}
            onClick={() => { if (!onRegisterAudioUnlock) unlockCompanionAudio(); onTogglePlay?.(); }}
        >
            {/* Ratio-Aware Progress Line */}
            <div style={{ position: 'absolute', top: is916 ? 0 : 'auto', bottom: is916 ? 'auto' : 0, left: 0, right: 0, height: '4px', background: 'rgba(255, 255, 255, 0.12)', zIndex: 35, overflow: 'hidden' }}>
                <div ref={progressBarRef} style={{ width: '100%', height: '100%', ...(isLiveLoopActive ? {} : { transform: `scaleX(${progressPercent / 100})` }), transformOrigin: 'left center', background: 'var(--ui-accent)', boxShadow: '0 0 12px var(--ui-accent)', transition: (isPlaying || isScrubbing) ? 'none' : 'transform 0.2s ease', willChange: 'transform' }} />
            </div>

            {isOutro && <VideoOutroCard outroCta={draft.outroCta} is916={is916} enableMotion={!isScrubbing && draft.enableMotion !== false} motionConfig={outroMotionConfig} />}
            <div className="tpe-full-absolute tpe-flex-col" style={{ background: '#080808', visibility: isOutro ? 'hidden' : 'visible', pointerEvents: isOutro ? 'none' : undefined }}>
                {hasMedia ? (
                    <>
                        {ambientBlurActive && (
                            <div aria-hidden="true" style={STATIC_STYLES.ambientBackdrop}>
                                {isImage ? (
                                    <Image
                                        ref={bgBlurImgRef} src={videoSrc} alt="" width={dimensions.width} height={dimensions.height}
                                        unoptimized loading="eager" decoding="sync" crossOrigin="anonymous" referrerPolicy="no-referrer"
                                        style={{ ...mediaBoxStyle, filter: BG_BLUR_FILTER, ...(isLiveMediaLoop ? {} : { transform: `translate3d(${panXShift}px, 0, 0) scale(${effectiveScale * 1.08}) translateZ(0)` }), willChange: 'transform' }}
                                    />
                                ) : (
                                    <>
                                        {needsTopAmbient && (
                                            <AmbientBlurStack direction="top" translateY={topOffsetY + 4 - dimensions.height} visible={topOffsetY > 2} liveMode={isLiveMediaLoop} wrapperRef={topAmbientWrapRef} farRef={ambientCanvases.topFar} midRef={ambientCanvases.topMid} nearRef={ambientCanvases.topNear} />
                                        )}
                                        <AmbientBlurStack direction="bottom" translateY={Math.max(0, topOffsetY + containerHeightPx - 4)} visible={topOffsetY + containerHeightPx < dimensions.height - 2} liveMode={isLiveMediaLoop} wrapperRef={botAmbientWrapRef} farRef={ambientCanvases.far} midRef={ambientCanvases.mid} nearRef={ambientCanvases.near} />
                                    </>
                                )}
                            </div>
                        )}

                        <div ref={clipWrapperRef} style={is45 && isImage ? {
                            position: 'absolute', inset: 0, width: '100%', height: '100%',
                            ...(isLiveMediaLoop ? {} : { clipPath: `inset(${topOffsetY}px 0 ${layout45?.botInset ?? 0}px 0)` }),
                            background: 'transparent', overflow: 'hidden', zIndex: 2, willChange: 'clip-path'
                        } : {
                            position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', backgroundColor: is45 ? 'transparent' : '#050505', zIndex: 2
                        }}>
                            {isImage ? (
                                <Image
                                    ref={imageRef} src={videoSrc} alt={headlineText || "Scene visual"} width={dimensions.width} height={dimensions.height}
                                    unoptimized loading="eager" decoding="sync" crossOrigin="anonymous" referrerPolicy="no-referrer"
                                    onLoad={(e) => { if (e.currentTarget.naturalWidth && e.currentTarget.naturalHeight) handleAspectDetected(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight); }}
                                    style={activeMediaStyle}
                                />
                            ) : (
                                <>
                                    <video
                                        ref={videoRef} src={videoSrc} aria-label={draft.headline || "Video preview"}
                                        muted={useDecoupledAudioLock && !isCompanionFallback ? true : effectiveMuted}
                                        onLoadedMetadata={handleLoadedMetadata} style={activeMediaStyle} {...sharedVideoProps}
                                    />
                                    {useDecoupledAudioLock && (
                                        <audio
                                            ref={companionAudioRef} src={companionAudioSrc} preload="auto" crossOrigin="anonymous" muted={effectiveMuted}
                                            onLoadedMetadata={handleCompanionAudioLoadedMetadata} onEnded={handleCompanionAudioEnded} onError={handleCompanionAudioError}
                                            style={STATIC_STYLES.audioHidden}
                                        />
                                    )}
                                    {useStandbyDeck && (
                                        <video
                                            ref={standbyVideoRef} src={standbyVideoSrc} aria-hidden="true" muted
                                            onLoadedMetadata={handleStandbyLoadedMetadata} style={{ ...activeMediaStyle, pointerEvents: 'none' }} {...sharedVideoProps}
                                        />
                                    )}
                                </>
                            )}

                            {!isPlaying && (
                                <div aria-hidden="true" style={{
                                    ...STATIC_STYLES.playIconBase,
                                    ...(is45 ? { insetInline: 0, marginInline: 'auto', top: `${topOffsetY + containerHeightPx / 2 - 34}px` } : { inset: 0, margin: 'auto' }),
                                    width: is45 ? '68px' : '80px', height: is45 ? '68px' : '80px',
                                }}>
                                    <PlayIcon width={is45 ? 30 : 32} height={is45 ? 30 : 32} fill="var(--ui-accent)" />
                                </div>
                            )}
                        </div>
                        <div ref={fadeOverlayRef} aria-hidden="true" style={{ position: 'absolute', inset: 0, backgroundColor: is45 ? '#080808' : '#050505', ...(isLiveMediaLoop ? {} : { opacity: hookFade, visibility: hookFade > 0.0005 ? 'visible' : 'hidden' }), pointerEvents: 'none', zIndex: 5 }} />
                    </>
                ) : (
                    <div style={{ ...STATIC_STYLES.emptyStateBase, color: isLoadingStream ? 'var(--ui-accent)' : 'var(--ui-text-dim)' }}>
                        <span className="tpe-tabular-nums">{isLoadingStream ? `⚡ ${ingestStatus || 'LOADING & SYNCING STREAM...'}` : 'NO VIDEO LOADED'}</span>
                        {isLoadingStream && ingestPct !== null && (
                            <div style={STATIC_STYLES.ingestTrack}>
                                <div style={{ width: '100%', height: '100%', background: 'var(--ui-accent)', transform: `scaleX(${ingestPct / 100})`, transformOrigin: 'left center', transition: 'transform 0.12s linear', willChange: 'transform' }} />
                            </div>
                        )}
                    </div>
                )}

                <VideoCardOverlayLayers
                    draft={draft} activeScene={activeScene} isOutro={isOutro} is45={is45} is916={is916} currentTime={currentTime}
                    headlineText={headlineText} subtitleText={subtitleText}
                    topScrimHidden={is45 && draft.enableAmbientBlur !== false && topOffsetY > 2}
                    animateWordmark={isPlaying && draft.enableMotion !== false}
                    wordmarkStartTime={draft.enableMotion !== false ? currentTime : 0}
                    logoMotionConfig={logoMotionConfig} logoWordmarkDriveRef={logoWordmarkDriveRef}
                />
            </div>
        </div>
    );
};

/** Unified video renderer supporting 4:5 Contain, 9:16 Full-Bleed, and 16:9 Landscape formats. */
export const VideoCard: React.FC<VideoCardProps> = React.memo((props) =>
    props.overlayOnly ? <VideoCardOverlayOnly {...props} /> : <VideoCardInteractive {...props} />
);

VideoCard.displayName = "VideoCard";
