import type { CSSProperties, ReactElement } from "react";
import Image from "next/image";

export interface SocialIconConfig {
    readonly label: string;
    readonly icon: string;
    readonly color: string;
    readonly logo: ReactElement;
}

export interface EditorialStepConfig {
    readonly step: number;
    readonly label: string;
    readonly fields: readonly string[];
    readonly required: readonly string[];
}

const SOCIAL_LOGO_STYLE: CSSProperties = { objectFit: 'contain' };

/** Social network quick-insert options backed by official Brand Asset PNGs in public/assets/social/trimmed/. */
export const SOCIAL_ICONS: readonly SocialIconConfig[] = [
    { label: 'TikTok', icon: '[tt] ', color: '#000000', logo: <Image src="/assets/social/trimmed/tt.png" alt="TikTok" width={14} height={14} style={SOCIAL_LOGO_STYLE} /> },
    { label: 'YouTube', icon: '[yt] ', color: '#FF0000', logo: <Image src="/assets/social/trimmed/yt.png" alt="YouTube" width={14} height={14} style={SOCIAL_LOGO_STYLE} /> },
    { label: 'Instagram', icon: '[ig] ', color: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', logo: <Image src="/assets/social/trimmed/ig.png" alt="Instagram" width={14} height={14} style={SOCIAL_LOGO_STYLE} /> },
    { label: 'X', icon: '[x] ', color: '#000000', logo: <Image src="/assets/social/trimmed/x.png" alt="X" width={14} height={14} style={SOCIAL_LOGO_STYLE} /> },
    { label: 'Facebook', icon: '[fb] ', color: '#1877F2', logo: <Image src="/assets/social/trimmed/fb.png" alt="Facebook" width={14} height={14} style={SOCIAL_LOGO_STYLE} /> }
];

/** Carousel step definitions and required field validation rules. */
export const EDITORIAL_STEPS: readonly EditorialStepConfig[] = [
    { 
        step: 1, 
        label: 'The Bulletin', 
        fields: ['category', 'headline'],
        required: ['category', 'headline', 'image'],
    },
    { 
        step: 2, 
        label: 'Core Story', 
        fields: ['summary'],
        required: ['summary'],
    },
    { 
        step: 3, 
        label: 'Missing Context', 
        fields: ['extra-heading-0', 'extra-content-0'],
        required: ['extra-content-0'],
    }
];
