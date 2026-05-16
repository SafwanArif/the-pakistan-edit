import { TikTokIcon, InstagramIcon, XIcon, FacebookIcon } from "../components/icons/TPEIcons";

/**
 * Institutional Data Registry: Emojis
 */
export const EMOJIS = [
    { label: 'PAKISTAN', icon: '🇵🇰' },
    { label: 'PALESTINE', icon: '🇵🇸' },
    { label: 'GREECE', icon: '🇬🇷' },
    { label: 'UNITED NATIONS', icon: '🇺🇳' },
    { label: 'UNITED STATES', icon: '🇺🇸' },
    { label: 'UNITED KINGDOM', icon: '🇬🇧' },
    { label: 'INDIA', icon: '🇮🇳' },
    { label: 'IRAQ', icon: '🇮🇶' },
    { label: 'World', icon: '🌍' }, { label: 'Chart', icon: '📈' }, 
    { label: 'Rocket', icon: '🚀' }, { label: 'Warning', icon: '⚠️' }, 
    { label: 'Money', icon: '💰' }, { label: 'Police', icon: '🚨' }, 
    { label: 'Check', icon: '✅' }, { label: 'Cross', icon: '❌' }, 
    { label: 'Fire', icon: '🔥' }
];

/**
 * Institutional Data Registry: Social Icons
 */
export const SOCIAL_ICONS = [
    { label: 'TikTok', icon: '🎵 ', color: '#000000', logo: <TikTokIcon /> },
    { label: 'Instagram', icon: '📷 ', color: 'linear-gradient(45deg, #f09433 0%, #e6683c 25%, #dc2743 50%, #cc2366 75%, #bc1888 100%)', logo: <InstagramIcon /> },
    { label: 'X', icon: '𝕏 ', color: '#000000', logo: <XIcon /> },
    { label: 'Facebook', icon: '𝗙 ', color: '#1877F2', logo: <FacebookIcon /> }
];

/**
 * Institutional Editorial Workflow Configuration
 * Streamlined 2027 Model: Core Meta + Narrative Architecture
 */
export const EDITORIAL_STEPS = [
    { 
        step: 1, 
        label: 'The Bulletin', 
        fields: ['category', 'headline'],
        required: ['category', 'headline', 'image'],
        tools: ['emoji', 'asset']
    },
    { 
        step: 2, 
        label: 'Core Story', 
        fields: ['summary'],
        required: ['summary'],
        tools: ['emoji', 'asset', 'source']
    },
    { 
        step: 3, 
        label: 'Missing Context', 
        fields: ['extra-heading-0', 'extra-content-0'],
        required: ['extra-content-0'],
        tools: ['emoji', 'asset', 'source']
    }
];
