export type Platform = "instagram" | "tiktok" | "square";
export type VideoAspectRatio = '9:16' | '4:5' | '16:9';

interface PlatformDimension {
    readonly width: number;
    readonly height: number;
}

interface VideoFormatConfig extends PlatformDimension {
    readonly label: string;
}

export const OMNI_CONFIG = {
    tiktok: { width: 1080, height: 1350 },
    instagram: { width: 1080, height: 1350 },
    square: { width: 1080, height: 1080 },
} as const satisfies Record<Platform, PlatformDimension>;

export const VIDEO_FORMAT_CONFIGS = {
    '9:16': { label: 'TikTok 9:16', width: 1080, height: 1920 },
    '4:5': { label: 'TikTok 4:5', width: 1080, height: 1350 },
    '16:9': { label: 'TikTok 16:9', width: 1920, height: 1080 },
} as const satisfies Record<VideoAspectRatio, VideoFormatConfig>;
