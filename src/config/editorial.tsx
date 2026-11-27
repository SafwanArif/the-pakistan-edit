import type { CSSProperties, ReactElement } from "react";
import Image from "next/image";

interface SocialIconConfig {
    readonly label: string;
    readonly icon: string;
    readonly color: string;
    readonly logo: ReactElement;
}

interface EditorialStepConfig {
    readonly step: number;
    readonly label: string;
    readonly fields: readonly string[];
    readonly required: readonly string[];
}

const SOCIAL_LOGO_STYLE: CSSProperties = { objectFit: 'contain' };

/** Canonical social token -> Brand Asset PNG lookup shared by EditorialTools and HighlightedText. */
export const SOCIAL_LOGO_PATHS: Readonly<Record<string, string>> = {
    '[tt]': '/assets/social/trimmed/tt.png',
    '[yt]': '/assets/social/trimmed/yt.png',
    '[ig]': '/assets/social/trimmed/ig.png',
    '[x]': '/assets/social/trimmed/x.png',
    '[fb]': '/assets/social/trimmed/fb.png',
};

const makeSocialIcon = (token: keyof typeof SOCIAL_LOGO_PATHS, label: string, color: string): SocialIconConfig => ({
    label,
    icon: `${token} `,
    color,
    logo: <Image src={SOCIAL_LOGO_PATHS[token]!} alt="" aria-hidden="true" width={14} height={14} unoptimized style={SOCIAL_LOGO_STYLE} />,
});

/** Social network quick-insert options backed by official Brand Asset PNGs in public/assets/social/trimmed/. */
export const SOCIAL_ICONS: readonly SocialIconConfig[] = [
    makeSocialIcon('[tt]', 'TikTok', '#000000'),
    makeSocialIcon('[yt]', 'YouTube', '#FF0000'),
    makeSocialIcon('[ig]', 'Instagram', 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)'),
    makeSocialIcon('[x]', 'X', '#000000'),
    makeSocialIcon('[fb]', 'Facebook', '#1877F2'),
];

/** Carousel step definitions and required field validation rules. */
export const EDITORIAL_STEPS: readonly EditorialStepConfig[] = [
    { step: 1, label: 'The Bulletin', fields: ['category', 'headline'], required: ['category', 'headline', 'image'] },
    { step: 2, label: 'Core Story', fields: ['summary'], required: ['summary'] },
    { step: 3, label: 'Missing Context', fields: ['extra-heading-0', 'extra-content-0'], required: ['extra-content-0'] },
];
