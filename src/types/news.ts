import { createDefaultTimelineScenes } from "../utils/videoTimeline";
import type { VideoAspectRatio } from "../config/omnichannel";
export type { VideoAspectRatio } from "../config/omnichannel";

// ---------------------------------------------------------------------------
// 1. Carousel Editorial Domain
// ---------------------------------------------------------------------------

export interface SlideAsset {
    image?: string;
    imagePosX?: number;
    imagePosY?: number;
    imagePosY_Square?: number;
    imageZoom?: number;
    snapMode?: 'height' | 'width' | 'grid';
    imageWidth?: number;
    imageHeight?: number;
    imageCredit?: string;
    creditPrefix?: string;
}

export interface Draft {
    headline: string;
    category: string;
    subheading?: string;
    summary?: string;

    sourceName?: string;
    sourcePrefix?: string;
    image?: string;
    imagePosX?: number;
    imagePosY?: number;
    imagePosY_Square?: number;
    imageZoom?: number;
    snapMode?: 'height' | 'width' | 'grid';
    imageWidth?: number;
    imageHeight?: number;
    imageCredit?: string;
    creditPrefix?: string;
    extraSlides: {
        heading: string;
        content: string;
        sourceName?: string;
        sourcePrefix?: string;
    }[];
    slideAssets?: Record<number, SlideAsset>;
}

// ---------------------------------------------------------------------------
// 2. Video Timeline & Keyframes Domain
// ---------------------------------------------------------------------------

export type PostMode = 'carousel' | 'video';
export type VideoHeadlinePreset = 'bottom' | 'center' | 'top';
export interface VideoFraming {
    zoom: number;
    posX: number;
    posY: number;
}

export interface SourceFrameIndex {
    mediaUrl: string;
    fps: number;
    nominalFps: number;
    startTime: number;
    duration: number;
    frameCount: number;
    cfr: boolean;
    keyframes: number[];
    pts: number[];
}

export type PlaybackSyncProfile = 'standard' | 'keyframe-scrub' | 'decoupled-audio-lock';

export interface SourceMediaInfo {
    width: number;
    height: number;
    exactFps: number;
    nominalFps: number;
    videoCodec?: string;
    audioCodec?: string;
    hasAudio?: boolean;
    videoBitrate?: number;
    audioBitrate?: number;
    pixFmt?: string;
    colorTransfer?: string;
    isHdr: boolean;
    audioSampleRate?: number;
    audioChannels?: number;
    audioDelaySec?: number;
    avDurationDeltaSec?: number;
    maxGopSec?: number;
    avgGopSec?: number;
    keyframeCount?: number;
    hasBFrames?: boolean;
    isVfr?: boolean;
    moovBeforeMdat?: boolean;
    container?: 'mp4' | 'mov' | 'webm' | 'unknown';
    fileSize?: number;
}
export type SubtitleFontId = 'plus-jakarta' | 'onest' | 'dm-sans' | 'geist';
export type SubtitleBackdropId = 'pill' | 'glass' | 'shadow' | 'none';
export type FadePresetMode = 'auto' | 'micro' | 'editorial';

export interface VideoKeyframeState {
    time?: number; // Optional independent incoming timestamp (<= keyframe time) for hold-before-cut dwell
    zoom: number;
    posX: number;
    posY?: number;
}

export interface VideoKeyframeBase {
    id: string;
    time: number; // in seconds
    zoom: number; // 0 to 100% in 4:5 Contain, 100 to 200% in Full Bleed (outgoing / post state)
    posX: number; // 0 to 100%
    posY?: number; // 4:5 vertical ceiling (only meaningful in 4:5 letterbox zoom < 100)
}

export type SmoothVideoKeyframe = VideoKeyframeBase & {
    easing?: 'smooth';
    pre?: never;
};

export type CutVideoKeyframe = VideoKeyframeBase & {
    easing: 'snap';
    /** Optional incoming state right before `time` (t < time). Omit to hold the previous keyframe until `time`. */
    pre?: VideoKeyframeState;
};

export type VideoKeyframe = SmoothVideoKeyframe | CutVideoKeyframe;

export interface TimelineScene {
    id: string;
    title: string;
    subtitle?: string;
    duration: number; // in seconds
    mediaType?: 'video' | 'image';
    mediaUrl?: string; // Optional per-scene asset override
    mediaName?: string;
    sourceName?: string;
    creditName?: string;
    clipStartOffset?: number; // In-point timestamp (in seconds) within the master video clip (e.g. Juicy Hook Cold Open Teaser)
    fadeOut?: boolean; // Optional dip-to-black + breath-bridge audio fade-out at end of scene
    fadeOutPreset?: FadePresetMode; // 'auto' (boundary-aware) | 'micro' (0.06s) | 'editorial' (0.12s)
    fadeIn?: boolean; // Optional fade-in from black at start of scene
    fadeInPreset?: FadePresetMode; // 'auto' (boundary-aware) | 'micro' (0.08s) | 'editorial' (0.18s)
    showSubtitles?: boolean; // Optional per-card closed caption override
    shareHookText?: boolean; // When true on 02 Re-Hook, shares 01 The Hook's headline/subheading with zero re-animation
}

export interface SubtitleSegment {
    id: string;
    start: number;
    end: number;
    text: string;
}

// ---------------------------------------------------------------------------
// 3. On-Demand P. Star Motion Domain
// ---------------------------------------------------------------------------

export type StarSpinMode = 'ccw' | 'flag-tilt' | 'cw-1x' | 'cw-2x';
export type StarSequenceMode = 'star-crescent' | 'star-only' | 'crescent-only';
export type StarHoldFeel = 'drift' | 'still';

export interface StarSpinCue {
    id: string;
    time: number; // Timeline timestamp in seconds where the P. dot morphs into the 5-point star and back
}

export const DEFAULT_STAR_CUES: readonly StarSpinCue[] = [{ id: 'star-0', time: 0 }];

export interface VideoDraft {
    videoUrl: string;
    videoName?: string;
    videoDuration?: number; // Detected native media duration in seconds
    sourceFps?: number; // Detected source/export frame rate for exact frame nudging
    sourceFrameLogUrl?: string;
    sourceFrameIndex?: SourceFrameIndex;
    sourceKeyframeTimes?: number[]; // In-memory IDR keyframe timestamps (seconds), stripped before IndexedDB save
    sourceMediaInfo?: SourceMediaInfo;
    category: string;
    headline: string;
    subtitle?: string;
    sourceName?: string;
    sourcePrefix?: string;
    creditName?: string;
    creditPrefix?: string;
    aspectRatio: VideoAspectRatio; // '9:16' | '4:5' | '16:9'
    headlinePreset: VideoHeadlinePreset; // 'top' (Upper Third) | 'center' (Optical Center) | 'bottom' (Lower Third)
    headingPresets?: Partial<Record<VideoAspectRatio, VideoHeadlinePreset>>;
    defaultFramingByRatio?: Partial<Record<VideoAspectRatio, VideoFraming>>;
    zoom?: number;
    posX?: number;
    posY?: number; // 4:5 vertical ceiling (100 = glued to top 0px, 0 = pulled down)
    volume?: number;
    isMuted?: boolean;
    normalizeAudio?: boolean;

    // Dedicated Video Timeline Engine
    enableOutro: boolean; // default true
    outroDuration: number; // default 5s
    outroCta?: string; // e.g. "FOLLOW FOR VERIFIED STRATEGIC INTELLIGENCE"
    scenes: TimelineScene[];
    keyframes?: VideoKeyframe[]; // Smooth timeline framing keyframes
    subtitles?: SubtitleSegment[];
    showSubtitles?: boolean;
    subtitlePosition?: 'bottom' | 'middle' | 'high';
    subtitleFontSize?: number;
    subtitleFont?: SubtitleFontId;
    subtitleBackdrop?: SubtitleBackdropId;
    enableMotion?: boolean;
    enableLogo?: boolean;
    motionWordmark?: boolean;
    motionText?: boolean;
    starCues?: StarSpinCue[];
    starMorphDuration?: number;
    starHoldDuration?: number;
    starScale?: number;
    starSpinMode?: StarSpinMode;
    starSequence?: StarSequenceMode;
    starHoldFeel?: StarHoldFeel;
    enableAmbientBlur?: boolean;
}

export const getVideoHeadingPreset = (
    draft: Pick<VideoDraft, 'headlinePreset' | 'headingPresets'>,
    aspectRatio: VideoAspectRatio
): VideoHeadlinePreset => draft.headingPresets?.[aspectRatio] ?? draft.headlinePreset ?? 'bottom';

export const getDefaultVideoFraming = (
    draft: Pick<VideoDraft, 'aspectRatio' | 'defaultFramingByRatio' | 'zoom' | 'posX' | 'posY'>,
    aspectRatio: VideoAspectRatio = draft.aspectRatio
): VideoFraming => {
    const stored = draft.defaultFramingByRatio?.[aspectRatio];
    const usesLegacyValues = aspectRatio === draft.aspectRatio;
    const rawZoom = stored?.zoom ?? (usesLegacyValues ? draft.zoom : undefined) ?? (aspectRatio === '4:5' ? 0 : 100);
    return {
        zoom: aspectRatio === '4:5' ? Math.max(0, Math.min(200, rawZoom)) : Math.max(100, Math.min(200, rawZoom)),
        posX: stored?.posX ?? (usesLegacyValues ? draft.posX : undefined) ?? 50,
        posY: stored?.posY ?? (usesLegacyValues ? draft.posY : undefined) ?? 100,
    };
};

/**
 * Returns true only when a 4:5 timeline can actually expose top/bottom letterbox margins
 * (either default framing < 100% or any keyframe POST/PRE state < 100%).
 * Returns false in 4:5 FILL (>= 100%) and non-4:5 ratios so ambient blur canvases/GPU work stay completely unmounted.
 */
export const has45LetterboxFraming = (
    draft: Pick<VideoDraft, 'aspectRatio' | 'defaultFramingByRatio' | 'zoom' | 'posX' | 'posY' | 'keyframes'>
): boolean => {
    if (draft.aspectRatio !== '4:5') return false;
    if (Math.round(getDefaultVideoFraming(draft, '4:5').zoom) < 100) return true;
    return Boolean(draft.keyframes?.some((kf) =>
        Math.round(kf.zoom) < 100 || (kf.easing === 'snap' && kf.pre !== undefined && Math.round(kf.pre.zoom) < 100)
    ));
};

/** Switches target aspect ratio while preserving per-ratio default framing and migrating both POST and PRE keyframe states. */
export const switchVideoAspectRatio = (draft: VideoDraft, nextRatio: VideoAspectRatio): VideoDraft => {
    if (draft.aspectRatio === nextRatio) return draft;
    const was45 = draft.aspectRatio === '4:5';
    const isNext45 = nextRatio === '4:5';
    const currentFraming = getDefaultVideoFraming(draft, draft.aspectRatio);
    const framingByRatio: Partial<Record<VideoAspectRatio, VideoFraming>> = {
        ...draft.defaultFramingByRatio,
        [draft.aspectRatio]: currentFraming,
    };
    const nextFraming = getDefaultVideoFraming({ ...draft, defaultFramingByRatio: framingByRatio }, nextRatio);
    const migrateZoom = (z: number): number => {
        if (was45 && !isNext45) return z > 100 ? Math.min(200, z) : 100;
        if (!was45 && isNext45) return z > 100 ? Math.min(200, z) : 0;
        return Math.max(100, Math.min(200, z));
    };
    const nextKeyframes = draft.keyframes?.map((kf): VideoKeyframe => {
        const nextZoom = migrateZoom(kf.zoom);
        const nextPosY = isNext45 && Math.round(nextZoom) < 100 ? (kf.posY ?? 100) : undefined;
        if (kf.easing === 'snap') {
            const nextPre = kf.pre
                ? {
                    ...kf.pre,
                    zoom: migrateZoom(kf.pre.zoom),
                    posY: isNext45 && Math.round(migrateZoom(kf.pre.zoom)) < 100 ? (kf.pre.posY ?? 100) : undefined,
                }
                : undefined;
            return { ...kf, zoom: nextZoom, posY: nextPosY, pre: nextPre };
        }
        return { ...kf, zoom: nextZoom, posY: nextPosY };
    });
    return {
        ...draft,
        aspectRatio: nextRatio,
        ...nextFraming,
        defaultFramingByRatio: { ...framingByRatio, [nextRatio]: nextFraming },
        keyframes: nextKeyframes,
    };
};

// ---------------------------------------------------------------------------
// 4. Pure Framing Helpers, Constants, Barrel Re-Exports & Draft Factories
// ---------------------------------------------------------------------------

export const getDefaultSubtitleFontSize = (aspectRatio?: VideoAspectRatio): number => (
    aspectRatio === '9:16' ? 48 : 42
);

/** Computes 4:5 vertical top offset in px from `posY` (`100` = top of canvas, `50` = true vertical center, `0` = bottom edge). */
export const getTopBoxOffsetY = (posY: number | undefined, canvasHeight: number, boxHeight: number): number => {
    const maxTop = Math.max(0, canvasHeight - boxHeight);
    const clamped = Math.max(0, Math.min(100, posY ?? 100));
    const progress = (100 - clamped) / 100;
    return progress * maxTop;
};

export const SUBTITLE_BACKDROP_OPTIONS = {
    shadow: { label: 'Floating Shadow' },
    pill: { label: 'Solid Pill' },
    glass: { label: 'Glass Tint' },
    none: { label: 'No Backdrop' },
} as const satisfies Record<SubtitleBackdropId, { label: string }>;

export const SUBTITLE_FONT_OPTIONS = {
    'plus-jakarta': { label: 'Plus Jakarta Sans', cssFamily: 'var(--font-plus-jakarta), sans-serif', assName: 'Plus Jakarta Sans' },
    'onest': { label: 'Onest', cssFamily: 'var(--font-onest), sans-serif', assName: 'Onest' },
    'dm-sans': { label: 'DM Sans', cssFamily: 'var(--font-dm-sans), sans-serif', assName: 'DM Sans' },
    'geist': { label: 'Geist', cssFamily: 'var(--font-geist-sans), sans-serif', assName: 'Geist' },
} as const satisfies Record<SubtitleFontId, { label: string; cssFamily: string; assName: string }>;

export * from "../utils/videoTimeline";
export * from "../utils/subtitleTimeline";
export * from "../utils/starMorphMath";

export const createDefaultDraft = (): Draft => ({
    headline: "",
    category: "ECONOMY",
    summary: "",
    sourceName: "",
    sourcePrefix: "SOURCE:",
    image: "",
    imagePosX: 50,
    imagePosY: 50,
    imageZoom: 100,
    snapMode: 'height',
    imageCredit: "",
    creditPrefix: "PHOTO:",
    extraSlides: [
        { heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" } // Slide 3 (Missing Context)
    ],
    slideAssets: {}
});

export const createDefaultVideoDraft = (): VideoDraft => {
    const scenes = createDefaultTimelineScenes();
    return {
        videoUrl: "",
        videoName: "",
        category: "BREAKING",
        headline: scenes[0]?.title || "",
        subtitle: scenes[0]?.subtitle || "",
        sourceName: "",
        sourcePrefix: "SOURCE:",
        creditName: "",
        creditPrefix: "FOOTAGE:",
        aspectRatio: '9:16',
        headlinePreset: 'bottom',
        defaultFramingByRatio: {
            '9:16': { zoom: 100, posX: 50, posY: 100 },
            '4:5': { zoom: 0, posX: 50, posY: 100 },
            '16:9': { zoom: 100, posX: 50, posY: 100 },
        },
        zoom: 100,
        posX: 50,
        posY: 100,
        volume: 1,
        isMuted: false,
        normalizeAudio: true,
        enableOutro: true,
        outroDuration: 5,
        outroCta: "FOLLOW @THEPAKISTANEDIT FOR VERIFIED INSTITUTIONAL INTELLIGENCE",
        enableAmbientBlur: true,
        enableLogo: true,
        starCues: [{ id: 'star-0', time: 0 }],
        starMorphDuration: 0.45,
        starHoldDuration: 0.5,
        starScale: 100,
        starSpinMode: 'ccw',
        starSequence: 'star-crescent',
        starHoldFeel: 'drift',
        scenes,
        keyframes: [],
    };
};

export const getSceneRoleColor = (idx: number, isReHook: boolean, isSetup: boolean): string => {
    if (idx === 0) return 'var(--ui-accent)';
    if (isReHook) return 'var(--ui-indicator)';
    if (isSetup) return 'var(--ui-pre)';
    return '#a78bfa';
};

export const getSlideCount = (draft: Draft): number => {
    let count = 1;
    if (draft.summary?.trim()) count = 2;

    if (draft.extraSlides && draft.extraSlides.length > 0 && draft.extraSlides[0]?.content?.trim()) {
        count = 3;

        if (draft.extraSlides.length > 1) {
            count += (draft.extraSlides.length - 1);
        }
    }
    return count;
};

