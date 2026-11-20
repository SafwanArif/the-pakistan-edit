export type Platform = "instagram" | "tiktok" | "square";

export interface PlatformDimension {
    readonly width: number;
    readonly height: number;
}

export interface VideoPlatformConfig extends PlatformDimension {
    readonly id: Platform;
    readonly aspectRatio: '9:16' | '4:5' | '1:1';
    readonly label: string;
}

export const aspectRatioToPlatform = (ratio: '9:16' | '4:5' | '1:1'): Platform =>
    ratio === '9:16' ? 'tiktok' : (ratio === '1:1' ? 'square' : 'instagram');

const PLATFORM_DEFAULTS = {
    tiktok: {
        width: 1080,
        height: 1350,
    },
    instagram: {
        width: 1080,
        height: 1350,
    },
    square: {
        width: 1080,
        height: 1080,
    }
} as const satisfies Record<Platform, PlatformDimension>;

export const OMNI_CONFIG = PLATFORM_DEFAULTS;

export const VIDEO_PLATFORM_CONFIGS = {
    tiktok: {
        id: 'tiktok',
        aspectRatio: '9:16',
        label: 'TikTok / Reels (9:16)',
        width: 1080,
        height: 1920
    },
    instagram: {
        id: 'instagram',
        aspectRatio: '4:5',
        label: 'Instagram Feed (4:5)',
        width: 1080,
        height: 1350
    },
    square: {
        id: 'square',
        aspectRatio: '1:1',
        label: 'X / FB (1:1)',
        width: 1080,
        height: 1080
    }
} as const satisfies Record<Platform, VideoPlatformConfig>;

