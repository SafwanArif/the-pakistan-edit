import { clamp, createDefaultTimelineScenes, finiteOr } from "../utils/sceneTimeline";
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
    snapMode?: "height" | "width" | "grid";
    imageWidth?: number;
    imageHeight?: number;
    imageCredit?: string;
    creditPrefix?: string;
}

export interface Draft extends SlideAsset {
    headline: string;
    category: string;
    subheading?: string;
    summary?: string;
    sourceName?: string;
    sourcePrefix?: string;
    extraSlides: { heading: string; content: string; sourceName?: string; sourcePrefix?: string }[];
    slideAssets?: Record<number, SlideAsset>;
}

// ---------------------------------------------------------------------------
// 2. Video Timeline, Keyframes & Star Motion Domain
// ---------------------------------------------------------------------------

export type PostMode = "carousel" | "video";
export type VideoHeadlinePreset = "bottom" | "center" | "top";
export type PlaybackSyncProfile = "standard" | "keyframe-scrub" | "decoupled-audio-lock";
export type SubtitleFontId = "plus-jakarta" | "onest" | "dm-sans" | "geist";
export type SubtitleBackdropId = "pill" | "glass" | "shadow" | "none";
export type FadePresetMode = "auto" | "micro" | "editorial";
export type StarSpinMode = "ccw" | "flag-tilt" | "cw-1x" | "cw-2x";
export type StarSequenceMode = "star-crescent" | "star-only" | "crescent-only";
export type StarHoldFeel = "drift" | "still";

export interface VideoFraming { zoom: number; posX: number; posY: number; }
export interface SubtitleSegment { id: string; start: number; end: number; text: string; }
export interface StarSpinCue { id: string; time: number; }
export interface VideoKeyframeState { time?: number; zoom: number; posX: number; posY?: number; }
export interface VideoKeyframeBase { id: string; time: number; zoom: number; posX: number; posY?: number; }
export type SmoothVideoKeyframe = VideoKeyframeBase & { easing?: "smooth"; pre?: never };
export type CutVideoKeyframe = VideoKeyframeBase & { easing: "snap"; pre?: VideoKeyframeState };
export type VideoKeyframe = SmoothVideoKeyframe | CutVideoKeyframe;

export interface SourceFrameIndex {
    mediaUrl: string; fps: number; nominalFps: number; startTime: number; duration: number;
    frameCount: number; cfr: boolean; keyframes: number[]; pts: number[];
}

export interface SourceMediaInfo {
    width: number; height: number; exactFps: number; nominalFps: number;
    videoCodec?: string; audioCodec?: string; hasAudio?: boolean;
    videoBitrate?: number; audioBitrate?: number; pixFmt?: string; colorTransfer?: string; isHdr: boolean;
    audioSampleRate?: number; audioChannels?: number; audioDelaySec?: number; avDurationDeltaSec?: number;
    maxGopSec?: number; avgGopSec?: number; keyframeCount?: number;
    hasBFrames?: boolean; isVfr?: boolean; isFragmented?: boolean; moovBeforeMdat?: boolean;
    container?: "mp4" | "mov" | "webm" | "unknown"; fileSize?: number;
}

export interface TimelineScene {
    id: string; title: string; subtitle?: string; duration: number;
    mediaType?: "video" | "image"; mediaUrl?: string; mediaName?: string;
    sourceName?: string; creditName?: string; clipStartOffset?: number;
    fadeOut?: boolean; fadeOutPreset?: FadePresetMode; fadeIn?: boolean; fadeInPreset?: FadePresetMode;
    showSubtitles?: boolean; shareHookText?: boolean;
}

export const DEFAULT_OUTRO_CTA = "FOLLOW @THEPAKISTANEDIT FOR VERIFIED INSTITUTIONAL INTELLIGENCE";

export interface VideoDraft {
    videoUrl: string; videoName?: string; videoDuration?: number; sourceFps?: number;
    sourceFrameLogUrl?: string; sourceFrameIndex?: SourceFrameIndex; sourceKeyframeTimes?: number[]; sourceMediaInfo?: SourceMediaInfo;
    category: string; headline: string; subtitle?: string;
    sourceName?: string; sourcePrefix?: string; creditName?: string; creditPrefix?: string;
    aspectRatio: VideoAspectRatio; headlinePreset: VideoHeadlinePreset;
    headingPresets?: Partial<Record<VideoAspectRatio, VideoHeadlinePreset>>;
    defaultFramingByRatio?: Partial<Record<VideoAspectRatio, VideoFraming>>;
    zoom?: number; posX?: number; posY?: number; volume?: number; isMuted?: boolean; normalizeAudio?: boolean;
    enableOutro: boolean; outroDuration: number; outroCta?: string;
    scenes: TimelineScene[]; keyframes?: VideoKeyframe[]; subtitles?: SubtitleSegment[];
    showSubtitles?: boolean; subtitlePosition?: "bottom" | "middle" | "high";
    subtitleFontSize?: number; subtitleFont?: SubtitleFontId; subtitleBackdrop?: SubtitleBackdropId;
    enableMotion?: boolean; enableLogo?: boolean; motionWordmark?: boolean; motionText?: boolean;
    starCues?: StarSpinCue[]; starMorphDuration?: number; starHoldDuration?: number; starScale?: number;
    starSpinMode?: StarSpinMode; starSequence?: StarSequenceMode; starHoldFeel?: StarHoldFeel;
    enableAmbientBlur?: boolean;
}

// ---------------------------------------------------------------------------
// 3. Framing Helpers, Constants, Barrel Re-Exports & Draft Factories
// ---------------------------------------------------------------------------

export const getVideoHeadingPreset = (
    draft: Pick<VideoDraft, "headlinePreset" | "headingPresets">, aspectRatio: VideoAspectRatio
): VideoHeadlinePreset => draft.headingPresets?.[aspectRatio] ?? draft.headlinePreset ?? "bottom";

export const getDefaultVideoFraming = (
    draft: Pick<VideoDraft, "aspectRatio" | "defaultFramingByRatio" | "zoom" | "posX" | "posY">,
    aspectRatio: VideoAspectRatio = draft.aspectRatio
): VideoFraming => {
    const stored = draft.defaultFramingByRatio?.[aspectRatio];
    const usesLegacy = aspectRatio === draft.aspectRatio;
    const rawZoom = finiteOr(stored?.zoom ?? (usesLegacy ? draft.zoom : undefined), aspectRatio === "4:5" ? 0 : 100);
    return {
        zoom: clamp(rawZoom, aspectRatio === "4:5" ? 0 : 100, 200),
        posX: clamp(finiteOr(stored?.posX ?? (usesLegacy ? draft.posX : undefined), 50), 0, 100),
        posY: clamp(finiteOr(stored?.posY ?? (usesLegacy ? draft.posY : undefined), 100), 0, 100),
    };
};

/** Returns true only when a 4:5 timeline can expose top/bottom letterbox margins (< 100% zoom). */
export const has45LetterboxFraming = (
    draft: Pick<VideoDraft, "aspectRatio" | "defaultFramingByRatio" | "zoom" | "posX" | "posY" | "keyframes">
): boolean => {
    if (draft.aspectRatio !== "4:5") return false;
    if (Math.round(getDefaultVideoFraming(draft, "4:5").zoom) < 100) return true;
    return Boolean(draft.keyframes?.some((kf) =>
        Math.round(kf.zoom) < 100 || (kf.easing === "snap" && kf.pre !== undefined && Math.round(kf.pre.zoom) < 100)
    ));
};

/** Switches target aspect ratio while preserving per-ratio default framing and migrating POST/PRE keyframe states. */
export const switchVideoAspectRatio = (draft: VideoDraft, nextRatio: VideoAspectRatio): VideoDraft => {
    if (draft.aspectRatio === nextRatio) return draft;
    const was45 = draft.aspectRatio === "4:5", isNext45 = nextRatio === "4:5";
    const framingByRatio: Partial<Record<VideoAspectRatio, VideoFraming>> = {
        ...draft.defaultFramingByRatio,
        [draft.aspectRatio]: getDefaultVideoFraming(draft, draft.aspectRatio),
    };
    const nextFraming = getDefaultVideoFraming({ ...draft, defaultFramingByRatio: framingByRatio }, nextRatio);
    const migrateZoom = (z: number): number => {
        const safeZ = finiteOr(z, was45 ? 0 : 100);
        if (was45 && !isNext45) return safeZ > 100 ? Math.min(200, safeZ) : 100;
        if (!was45 && isNext45) return safeZ > 100 ? Math.min(200, safeZ) : 0;
        return clamp(safeZ, 100, 200);
    };
    const nextKeyframes = draft.keyframes?.map((kf): VideoKeyframe => {
        const nextZoom = migrateZoom(kf.zoom);
        const nextPosY = isNext45 && Math.round(nextZoom) < 100 ? finiteOr(kf.posY, 100) : undefined;
        if (kf.easing === "snap") {
            const nextPre = kf.pre ? (() => {
                const preZoom = migrateZoom(kf.pre.zoom);
                return { ...kf.pre, zoom: preZoom, posY: isNext45 && Math.round(preZoom) < 100 ? finiteOr(kf.pre.posY, 100) : undefined };
            })() : undefined;
            return { ...kf, zoom: nextZoom, posY: nextPosY, pre: nextPre };
        }
        return { ...kf, zoom: nextZoom, posY: nextPosY };
    });
    return {
        ...draft, aspectRatio: nextRatio, ...nextFraming,
        defaultFramingByRatio: { ...framingByRatio, [nextRatio]: nextFraming },
        keyframes: nextKeyframes,
    };
};

export const getDefaultSubtitleFontSize = (aspectRatio?: VideoAspectRatio): number => (aspectRatio === "9:16" ? 48 : 42);

/** Computes 4:5 vertical top offset in px from `posY` (`100` = top of canvas, `50` = vertical center, `0` = bottom). */
export const getTopBoxOffsetY = (posY: number | undefined, canvasHeight: number, boxHeight: number): number => {
    const maxTop = Math.max(0, finiteOr(canvasHeight, 0) - finiteOr(boxHeight, 0));
    return ((100 - clamp(finiteOr(posY, 100), 0, 100)) / 100) * maxTop;
};

export const SUBTITLE_BACKDROP_OPTIONS = {
    shadow: { label: "Floating Shadow" },
    pill: { label: "Solid Pill" },
    glass: { label: "Glass Tint" },
    none: { label: "No Backdrop" },
} as const satisfies Record<SubtitleBackdropId, { label: string }>;

export const SUBTITLE_FONT_OPTIONS = {
    "plus-jakarta": { label: "Plus Jakarta Sans", cssFamily: "var(--font-plus-jakarta), sans-serif", assName: "Plus Jakarta Sans" },
    onest: { label: "Onest", cssFamily: "var(--font-onest), sans-serif", assName: "Onest" },
    "dm-sans": { label: "DM Sans", cssFamily: "var(--font-dm-sans), sans-serif", assName: "DM Sans" },
    geist: { label: "Geist", cssFamily: "var(--font-geist-sans), sans-serif", assName: "Geist" },
} as const satisfies Record<SubtitleFontId, { label: string; cssFamily: string; assName: string }>;

export * from "../utils/sceneTimeline";
export * from "../utils/videoTimeline";
export * from "../utils/subtitleTimeline";
export * from "../utils/starMorphMath";

export const createDefaultDraft = (): Draft => ({
    headline: "", category: "ECONOMY", summary: "", sourceName: "", sourcePrefix: "SOURCE:",
    image: "", imagePosX: 50, imagePosY: 50, imageZoom: 100, snapMode: "height",
    imageCredit: "", creditPrefix: "PHOTO:",
    extraSlides: [{ heading: "", content: "", sourceName: "", sourcePrefix: "SOURCE:" }],
    slideAssets: {},
});

export const createDefaultVideoDraft = (): VideoDraft => {
    const scenes = createDefaultTimelineScenes();
    return {
        videoUrl: "", videoName: "", category: "BREAKING",
        headline: scenes[0]?.title || "", subtitle: scenes[0]?.subtitle || "",
        sourceName: "", sourcePrefix: "SOURCE:", creditName: "", creditPrefix: "FOOTAGE:",
        aspectRatio: "9:16", headlinePreset: "bottom",
        defaultFramingByRatio: {
            "9:16": { zoom: 100, posX: 50, posY: 100 },
            "4:5": { zoom: 0, posX: 50, posY: 100 },
            "16:9": { zoom: 100, posX: 50, posY: 100 },
        },
        zoom: 100, posX: 50, posY: 100, volume: 1, isMuted: false, normalizeAudio: true,
        enableOutro: true, outroDuration: 5, outroCta: DEFAULT_OUTRO_CTA,
        enableAmbientBlur: true, enableLogo: true,
        starCues: [{ id: "star-0", time: 0 }],
        starMorphDuration: 0.45, starHoldDuration: 0.5, starScale: 100,
        starSpinMode: "ccw", starSequence: "star-crescent", starHoldFeel: "drift",
        scenes, keyframes: [],
    };
};

export const getSceneRoleColor = (idx: number, isReHook: boolean, isSetup: boolean): string =>
    idx === 0 ? "var(--ui-accent)" : isReHook ? "var(--ui-indicator)" : isSetup ? "var(--ui-pre)" : "#a78bfa";

export const getSlideCount = (draft: Draft): number => {
    const count = draft.summary?.trim() ? 2 : 1;
    if (Array.isArray(draft.extraSlides)) {
        for (let i = draft.extraSlides.length - 1; i >= 0; i--) {
            const slide = draft.extraSlides[i];
            if (slide?.content?.trim() || slide?.heading?.trim()) return Math.max(count, i + 3);
        }
    }
    return count;
};
