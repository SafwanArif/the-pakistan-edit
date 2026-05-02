export type Platform = "instagram" | "tiktok" | "square";

export const PLATFORM_DEFAULTS = {
    tiktok: {
        width: 1080,
        height: 1350,
        padding: { top: 140, right: 160, bottom: 60, left: 60 },
        offsets: { top: 350, bottom: 150 },
        logoScale: 2.0,
        catFontSize: '20px',
        handleFontSize: '14px',
        typography: {
            h1: "86px",
            slide2: "50px",
            slide3Heading: "27px",
            slide3: "41px",
            prompt: "27px"
        }
    },
    instagram: {
        width: 1080,
        height: 1350,
        padding: { top: 70, right: 50, bottom: 150, left: 50 },
        offsets: { top: 320, bottom: 206 },
        logoScale: 2.0,
        catFontSize: '20px',
        handleFontSize: '14px',
        typography: {
            h1: "86px",
            slide2: "50px",
            slide3Heading: "27px",
            slide3: "41px",
            prompt: "27px"
        }
    },
    square: {
        width: 1080,
        height: 1080,
        padding: { top: 70, right: 80, bottom: 80, left: 80 },
        offsets: { top: 160, bottom: 80 },
        logoScale: 1.8,
        catFontSize: '18px',
        handleFontSize: '12px',
        typography: {
            h1: "76px",
            slide2: "44px",
            slide3Heading: "24px",
            slide3: "36px",
            prompt: "24px"
        }
    }
};

export const OMNI_CONFIG = PLATFORM_DEFAULTS;
