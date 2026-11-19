import Image from "next/image";

/** Social network quick-insert options backed by official Brand Asset PNGs in public/assets/social/trimmed/. */
export const SOCIAL_ICONS = [
    { label: 'TikTok', icon: '[tt] ', color: '#000000', logo: <Image src="/assets/social/trimmed/tt.png" alt="TikTok" width={14} height={14} style={{ objectFit: 'contain' }} /> },
    { label: 'YouTube', icon: '[yt] ', color: '#FF0000', logo: <Image src="/assets/social/trimmed/yt.png" alt="YouTube" width={14} height={14} style={{ objectFit: 'contain' }} /> },
    { label: 'Instagram', icon: '[ig] ', color: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', logo: <Image src="/assets/social/trimmed/ig.png" alt="Instagram" width={14} height={14} style={{ objectFit: 'contain' }} /> },
    { label: 'X', icon: '[x] ', color: '#000000', logo: <Image src="/assets/social/trimmed/x.png" alt="X" width={14} height={14} style={{ objectFit: 'contain' }} /> },
    { label: 'Facebook', icon: '[fb] ', color: '#1877F2', logo: <Image src="/assets/social/trimmed/fb.png" alt="Facebook" width={14} height={14} style={{ objectFit: 'contain' }} /> }
];

/** Carousel step definitions and required field validation rules. */
export const EDITORIAL_STEPS = [
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
