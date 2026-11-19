"use client";

import React, { useMemo, useState } from "react";
import Image from "next/image";
import { VideoDraft, SUBTITLE_FONT_OPTIONS, getActiveSceneAtTime, getTotalVideoDuration, getHookTransitionFade, wrapMediaTime, getDefaultSubtitleFontSize, getTopBoxOffsetY, findSubtitleAtMediaTime, isSharedReHookScene } from "../../../../types/news";
import { Platform, OMNI_CONFIG, VIDEO_PLATFORM_CONFIGS } from "../../../../config/omnichannel";
import { TPEVectorLogo } from "../TPEVectorLogo";
import { HighlightedText } from "../NewsCard/HighlightedText";
import { PlayIcon } from "../../../icons/TPEIcons";
import { VideoOutroCard } from "./VideoOutroCard";
import { AmbientBlurStack } from "./AmbientBlurStack";
import { useVideoElementSync } from "./useVideoElementSync";

interface VideoCardProps {
    draft: VideoDraft;
    platform?: Platform;
    isPlaying?: boolean;
    isScrubbing?: boolean;
    playbackMode?: 'play-all' | 'loop-angle';
    currentTime?: number;
    isMuted?: boolean;
    isLoadingStream?: boolean;
    ingestStatus?: string | null;
    onTimeUpdate?: (current: number, duration: number) => void;
    onTogglePlay?: () => void;
    overlayOnly?: boolean;
}

/** Unified video renderer supporting 4:5 Top-Box, 9:16 Full-Bleed, keyframe zoom/pan, and 5s outro stinger. */
export const VideoCard: React.FC<VideoCardProps> = React.memo(({
    draft,
    platform = "tiktok",
    isPlaying = false,
    isScrubbing = false,
    playbackMode = 'play-all',
    currentTime = 0,
    isMuted = false,
    isLoadingStream = false,
    ingestStatus = null,
    onTimeUpdate,
    onTogglePlay,
    overlayOnly = false
}) => {
    const dimensions = VIDEO_PLATFORM_CONFIGS[platform] || OMNI_CONFIG[platform];
    const is916 = platform === 'tiktok' || dimensions.height === 1920;
    const is45 = platform === 'instagram' || (dimensions.width === 1080 && dimensions.height === 1350);
    const [mediaNaturalAspect, setMediaNaturalAspect] = useState<number>(16 / 9);

    const { scene: activeScene, isOutro, sceneIndex } = getActiveSceneAtTime(draft, currentTime);
    const hasMedia = Boolean(activeScene?.mediaUrl || draft.videoUrl);
    const videoSrc = activeScene?.mediaUrl || draft.videoUrl || "";
    const effectiveMuted = draft.isMuted ?? isMuted;

    const { effectiveScale, containerHeightPx, H_contain } = useMemo(() => {
        if (!is45) {
            return { effectiveScale: Math.max(0.1, (draft.zoom ?? 100) / 100), containerHeightPx: dimensions.height, H_contain: dimensions.height };
        }
        const r = mediaNaturalAspect > 0 ? mediaNaturalAspect : (16 / 9);
        const H_cont = Math.min(dimensions.height, dimensions.width / r);
        const Scale_fill = Math.max(1.0, dimensions.height / H_cont);
        const z = Math.min(200, Math.max(0, draft.zoom ?? 0));
        const t = Math.min(100, z) / 100;
        const punchScale = z > 100 ? z / 100 : 1;
        return {
            effectiveScale: (1.0 + t * (Scale_fill - 1.0)) * punchScale,
            containerHeightPx: H_cont + t * (dimensions.height - H_cont),
            H_contain: H_cont
        };
    }, [is45, draft.zoom, mediaNaturalAspect, dimensions.width, dimensions.height]);

    const panXShift = is45 ? (0.5 - ((draft.posX ?? 50) / 100)) * (effectiveScale - 1) * dimensions.width : 0;
    const topOffsetY = is45 ? getTopBoxOffsetY(draft.posY, dimensions.height, containerHeightPx) : 0;
    const ambientCrop = useMemo(() => {
        if (!is45 || effectiveScale <= 1) return { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 };
        const wFrac = Math.min(1, 1 / effectiveScale);
        const xFrac = Math.max(0, Math.min(1 - wFrac, 0.5 - panXShift / (dimensions.width * effectiveScale) - wFrac / 2));
        const hFrac = Math.min(1, containerHeightPx / Math.max(1, H_contain * effectiveScale));
        return { xFrac, wFrac, yFrac: (1 - hFrac) / 2, hFrac };
    }, [is45, effectiveScale, panXShift, dimensions.width, containerHeightPx, H_contain]);

    const { videoRef, ambientCanvasRef, midEdgeCanvasRef, nearEdgeCanvasRef, topAmbientCanvasRef, topMidEdgeCanvasRef, topNearEdgeCanvasRef, refreshAmbientGlow, handleLoadedMetadata, handleTimeUpdate, handleEnded } = useVideoElementSync({
        draft,
        videoSrc,
        isPlaying,
        isScrubbing,
        isOutro,
        playbackMode,
        currentTime,
        effectiveMuted,
        overlayOnly,
        ambientCrop,
        onTimeUpdate,
        onAspectDetected: setMediaNaturalAspect
    });
    const zoomScale = Math.max(0.1, (draft.zoom ?? 100) / 100);
    const posX = draft.posX ?? 50;
    const isImage = activeScene?.mediaType === 'image' || (
        Boolean(videoSrc) && (videoSrc.startsWith('data:image') || /\.(png|jpe?g|webp|gif|svg|avif)(\?.*)?$/i.test(videoSrc))
    );

    let sceneStart = 0;
    if (draft.scenes && activeScene) {
        for (const s of draft.scenes) {
            if (s.id === activeScene.id) break;
            sceneStart += (s.duration || 0);
        }
    }
    const sceneElapsed = Math.max(0, currentTime - sceneStart);
    const kenBurnsScale = isImage
        ? zoomScale * (1 + 0.04 * Math.min(1, Math.max(0, sceneElapsed / Math.max(activeScene?.duration || 10, 0.1))))
        : zoomScale;

    const isSharedReHook = isSharedReHookScene(draft.scenes, sceneIndex);
    const textScene = isSharedReHook ? draft.scenes![0]! : activeScene;
    const textKey = isSharedReHook ? 0 : sceneIndex;
    const animateWordmark = isPlaying && !overlayOnly && draft.enableMotion !== false && currentTime < 0.65;
    const headlineText = isOutro ? (draft.outroCta || "") : (textScene?.title ?? draft.headline ?? "");
    const subtitleText = isOutro ? "" : (textScene?.subtitle ?? draft.subtitle ?? "");
    const creditText = activeScene?.creditName || draft.creditName;
    const sourceText = activeScene?.sourceName || draft.sourceName;
    const totalDuration = useMemo(
        () => getTotalVideoDuration(draft),
        [draft]
    );
    const progressPercent = Math.min(100, Math.max(0, (currentTime / (totalDuration || 1)) * 100));
    const hookFade = getHookTransitionFade(draft, currentTime);
    const activeSubtitle = useMemo(() => {
        const captionsOn = activeScene?.showSubtitles ?? (draft.showSubtitles !== false);
        if (!captionsOn || !draft.subtitles?.length) return undefined;
        return findSubtitleAtMediaTime(draft.subtitles, wrapMediaTime(draft, currentTime, draft.videoDuration || 0));
    }, [draft, activeScene?.showSubtitles, currentTime]);

    const preset = draft.headlinePreset || 'bottom';
    const presetLayout = preset === 'center'
        ? { justify: 'center', top: is916 ? '200px' : '100px', bottom: is916 ? '200px' : '100px' }
        : preset === 'top'
            ? { justify: 'flex-start', top: is916 ? '390px' : '260px', bottom: '140px' }
            : { justify: 'flex-end', top: is916 ? '200px' : '120px', bottom: is916 ? '460px' : (platform === 'square' ? '140px' : '160px') };

    const footerBottom = is45 ? '50px' : (is916 ? '140px' : '80px');
    const topBoxMediaStyle: React.CSSProperties = {
        position: 'absolute', top: 0, left: 0, width: `${dimensions.width}px`, height: `${H_contain}px`,
        objectFit: 'cover', objectPosition: 'center top', transformOrigin: 'top center', transition: 'none'
    };
    const fullBleedMediaStyle: React.CSSProperties = {
        position: 'absolute', inset: 0, inlineSize: '100%', blockSize: '100%',
        objectFit: 'cover', objectPosition: `${posX}% 50%`, transformOrigin: `${posX}% 50%`
    };
    const bgBlurFilter = 'blur(50px) brightness(0.38) saturate(1.18)';
    const bgTransform = `translate3d(${panXShift}px, 0, 0) scale(${effectiveScale * 1.08}) translateZ(0)`;
    const keyLightShadow = '0 1px 2px rgba(0,0,0,0.95), 0 8px 28px rgba(0,0,0,0.65)';
    const scrimStyle: React.CSSProperties = preset === 'center'
        ? { position: 'absolute', inset: 0, background: 'radial-gradient(ellipse at center, rgba(5,5,5,0.72) 0%, rgba(5,5,5,0.36) 52%, transparent 82%)', pointerEvents: 'none', zIndex: 9 }
        : preset === 'top'
            ? { position: 'absolute', insetInline: 0, top: 0, height: '44%', background: 'linear-gradient(to bottom, rgba(5,5,5,0.86) 0%, rgba(5,5,5,0.48) 48%, transparent 100%)', pointerEvents: 'none', zIndex: 9 }
            : { position: 'absolute', insetInline: 0, bottom: 0, height: '46%', background: 'linear-gradient(to top, rgba(5,5,5,0.88) 0%, rgba(5,5,5,0.52) 48%, transparent 100%)', pointerEvents: 'none', zIndex: 9 };

    return (
        <div
            className="tpe-news-card"
            data-slide-type="bulletin"
            data-platform={platform}
            data-motion={draft.enableMotion === false ? 'off' : 'on'}
            data-step={1}
            style={{
                '--card-w': `${dimensions.width}px`,
                '--card-h': `${dimensions.height}px`,
                '--safe-right': '140px',
                cursor: overlayOnly ? 'default' : 'pointer'
            } as React.CSSProperties}
            onClick={overlayOnly ? undefined : onTogglePlay}
        >
            {/* Ratio-Aware Progress Line */}
            <div style={{ position: 'absolute', top: is916 ? 0 : 'auto', bottom: is916 ? 'auto' : 0, left: 0, right: 0, height: '4px', background: 'rgba(255, 255, 255, 0.12)', zIndex: 35, overflow: 'hidden' }}>
                <div style={{ width: '100%', height: '100%', transform: `scaleX(${progressPercent / 100})`, transformOrigin: 'left center', background: 'var(--ui-accent)', boxShadow: '0 0 12px var(--ui-accent)', transition: isPlaying ? 'none' : 'transform 0.2s ease' }} />
            </div>

            {isOutro && (
                <VideoOutroCard outroCta={draft.outroCta} is916={is916} enableMotion={!overlayOnly && draft.enableMotion !== false} />
            )}
            <div className="tpe-full-absolute tpe-flex-col" style={{ background: '#080808', visibility: isOutro ? 'hidden' : 'visible', pointerEvents: isOutro ? 'none' : undefined }}>
                    {!overlayOnly && hasMedia && (
                        <>
                            {is45 && (
                                <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', pointerEvents: 'none', zIndex: 1 }}>
                                    {isImage ? (
                                        <Image
                                            src={videoSrc}
                                            alt=""
                                            width={dimensions.width}
                                            height={dimensions.height}
                                            unoptimized
                                            loading="eager"
                                            style={{ ...topBoxMediaStyle, filter: bgBlurFilter, transform: bgTransform }}
                                        />
                                    ) : (
                                        <>
                                            {topOffsetY > 2 && (
                                                <AmbientBlurStack direction="top" topPx={0} heightPx={topOffsetY + 2} farRef={topAmbientCanvasRef} midRef={topMidEdgeCanvasRef} nearRef={topNearEdgeCanvasRef} />
                                            )}
                                            {topOffsetY + containerHeightPx < dimensions.height - 2 && (
                                                <AmbientBlurStack direction="bottom" topPx={Math.max(0, topOffsetY + containerHeightPx - 2)} farRef={ambientCanvasRef} midRef={midEdgeCanvasRef} nearRef={nearEdgeCanvasRef} />
                                            )}
                                        </>
                                    )}
                                </div>
                            )}

                            <div style={is45 ? {
                                position: 'absolute', top: `${topOffsetY}px`, left: 0, right: 0, height: `${containerHeightPx}px`,
                                background: 'transparent', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                zIndex: 2
                            } : {
                                position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#050505', zIndex: 2
                            }}>
                                {isImage ? (
                                    <Image
                                        src={videoSrc}
                                        alt={headlineText || "Scene visual"}
                                        width={dimensions.width}
                                        height={dimensions.height}
                                        unoptimized
                                        loading="eager"
                                        onLoad={(e) => { if (e.currentTarget.naturalWidth && e.currentTarget.naturalHeight) setMediaNaturalAspect(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight); }}
                                        style={is45
                                            ? { ...topBoxMediaStyle, transform: `translate3d(${panXShift}px, 0, 0) scale(${effectiveScale})` }
                                            : { ...fullBleedMediaStyle, transform: `scale(${kenBurnsScale})`, transition: 'none' }}
                                    />
                                ) : (
                                    <video
                                        ref={videoRef}
                                        src={videoSrc}
                                        aria-label={draft.headline || "Video preview"}
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
                                            ? { ...topBoxMediaStyle, transform: `translate3d(${panXShift}px, 0, 0) scale(${effectiveScale}) translateZ(0)`, willChange: 'transform' }
                                            : { ...fullBleedMediaStyle, transform: `scale(${zoomScale}) translateZ(0)`, transition: 'none', willChange: 'transform' }}
                                    />
                                )}

                                {!overlayOnly && (
                                    <div style={{ position: 'absolute', inset: 0, backgroundColor: is45 ? '#080808' : '#050505', opacity: hookFade, visibility: hookFade > 0.005 ? 'visible' : 'hidden', pointerEvents: 'none', zIndex: 5 }} />
                                )}

                                {!isPlaying && (
                                    <div style={{
                                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 15, pointerEvents: 'none',
                                        background: 'rgba(0, 0, 0, 0.65)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255, 255, 255, 0.15)',
                                        borderRadius: '50%', width: is45 ? '68px' : '80px', height: is45 ? '68px' : '80px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)'
                                    }}>
                                        <PlayIcon width={is45 ? 30 : 32} height={is45 ? 30 : 32} fill="var(--ui-accent)" />
                                    </div>
                                )}
                            </div>
                        </>
                    )}

                    {!overlayOnly && !hasMedia && (
                        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', paddingInline: '60px', color: isLoadingStream ? 'var(--ui-accent)' : 'var(--ui-text-dim)', fontSize: '20px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', pointerEvents: 'none', zIndex: 2 }}>
                            {isLoadingStream ? `⚡ ${ingestStatus || 'LOADING & SYNCING STREAM...'}` : 'NO VIDEO LOADED'}
                        </div>
                    )}

                    {/* Subtle Top Safe-Zone Scrim for Brand Legibility (skipped when 4:5 top ambient blur is active) */}
                    {!(is45 && topOffsetY > 2) && (
                        <div style={{ position: 'absolute', insetBlockStart: 0, insetInline: 0, height: is916 ? '18%' : '15%', background: 'linear-gradient(to bottom, oklch(0% 0 0 / 0.26) 0%, transparent 100%)', pointerEvents: 'none', zIndex: 6 }} />
                    )}

                    {/* Branding Overlay (44px top in 4:5, 140px safe zone in 9:16; 60px left, 140px right) */}
                    <div className="tpe-branding-overlay tpe-flex-row" style={{ top: is45 ? '44px' : undefined, insetInlineStart: '60px', insetInlineEnd: '140px', zIndex: 20 }}>
                        <div className="tpe-brand-left"><TPEVectorLogo scale={1.8} showWordmark={true} animateWordmark={animateWordmark} wordmarkStartTime={currentTime} /></div>
                        <div className="tpe-brand-right tpe-flex-col">
                            <div className="tpe-category-tag"><span className="tpe-slash"><span className="tpe-slash-1">/</span><span className="tpe-slash-2">/</span></span> {draft.category || "ANALYSIS"}</div>
                            <div className="tpe-watermark">@thePakistanEdit</div>
                        </div>
                    </div>

                    {/* Narrative Layer */}
                    {is45 ? (
                        <div style={{ position: 'absolute', top: '640px', bottom: '110px', left: '60px', right: '140px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '16px', pointerEvents: 'none', zIndex: 10 }}>
                            {headlineText && (
                                <div key={`headline-${textKey}`} className="tpe-news-h1 tpe-kinetic-in" style={{ fontSize: '64px', lineHeight: 1.08, letterSpacing: '-0.02em', textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
                                    <HighlightedText text={headlineText} />
                                </div>
                            )}
                            {subtitleText && (
                                <div key={`subtitle-${textKey}`} className="tpe-kinetic-in-delayed" style={{ fontFamily: 'var(--tpe-font-geist)', fontSize: '32px', fontWeight: 500, lineHeight: 1.32, color: 'oklch(from var(--ui-text) l c h / 0.95)', textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
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
                                            <div key={`headline-full-${textKey}`} className="tpe-news-h1 tpe-kinetic-in" style={{ fontSize: is916 ? '76px' : (platform === 'square' ? '58px' : '64px'), lineHeight: 1.05, textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
                                                <HighlightedText text={headlineText} />
                                            </div>
                                        )}
                                        {subtitleText && (
                                            <div key={`subtitle-full-${textKey}`} className="tpe-kinetic-in-delayed" style={{ fontFamily: 'var(--tpe-font-geist)', fontSize: is916 ? '34px' : (platform === 'square' ? '28px' : '32px'), fontWeight: 500, lineHeight: 1.3, color: 'oklch(from var(--ui-text) l c h / 0.95)', textShadow: keyLightShadow, whiteSpace: 'pre-line' }}>
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
                        const ccSpanStyle: React.CSSProperties = ccBackdrop === 'none'
                            ? { padding: '4px 10px', color: '#fff', fontFamily: ccFontFamily, fontSize: `${ccFontSize}px`, fontWeight: 700, lineHeight: 1.25, textAlign: 'center', textShadow: '0 1px 4px rgba(0,0,0,0.6)' }
                            : ccBackdrop === 'shadow'
                                ? { padding: '4px 10px', color: '#fff', fontFamily: ccFontFamily, fontSize: `${ccFontSize}px`, fontWeight: 700, lineHeight: 1.25, textAlign: 'center', textShadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 18px rgba(0,0,0,0.85), -1px -1px 0 rgba(0,0,0,0.75), 1px 1px 0 rgba(0,0,0,0.75)' }
                                : ccBackdrop === 'glass'
                                    ? { padding: '10px 20px', borderRadius: '10px', background: 'rgba(8, 8, 8, 0.52)', backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.16)', color: '#fff', fontFamily: ccFontFamily, fontSize: `${ccFontSize}px`, fontWeight: 700, lineHeight: 1.25, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.45)' }
                                    : { padding: '10px 20px', borderRadius: '10px', background: 'rgba(8, 8, 8, 0.86)', border: '1px solid rgba(255,255,255,0.14)', color: '#fff', fontFamily: ccFontFamily, fontSize: `${ccFontSize}px`, fontWeight: 700, lineHeight: 1.25, textAlign: 'center', boxShadow: '0 8px 24px rgba(0,0,0,0.65)' };
                        const ccBottom = is45
                            ? (ccPos === 'high' ? '255px' : ccPos === 'middle' ? '185px' : '115px')
                            : (is916
                                ? (ccPos === 'high' ? '435px' : ccPos === 'middle' ? '340px' : '245px')
                                : (ccPos === 'high' ? '280px' : ccPos === 'middle' ? '215px' : '150px'));
                        return (
                            <div style={{ position: 'absolute', bottom: ccBottom, insetInlineStart: '60px', insetInlineEnd: '140px', display: 'flex', justifyContent: 'center', pointerEvents: 'none', zIndex: 15 }}>
                                <span style={ccSpanStyle}>
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
