export type Platform = "instagram" | "tiktok" | "square";

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
};

export const OMNI_CONFIG = PLATFORM_DEFAULTS;

export const VIDEO_PLATFORM_CONFIGS = {
    'tiktok': {
        id: 'tiktok' as Platform,
        aspectRatio: '9:16' as const,
        label: 'TikTok / Reels (9:16)',
        width: 1080,
        height: 1920
    },
    'instagram': {
        id: 'instagram' as Platform,
        aspectRatio: '4:5' as const,
        label: 'Instagram Feed (4:5)',
        width: 1080,
        height: 1350
    },
    'square': {
        id: 'square' as Platform,
        aspectRatio: '1:1' as const,
        label: 'X / FB (1:1)',
        width: 1080,
        height: 1080
    }
};

