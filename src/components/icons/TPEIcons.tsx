/**
 * Institutional Icon Registry (2027)
 * Centralized SVG storage to purge bloat from components.
 */

interface IconProps {
    width?: number;
    height?: number;
    fill?: string;
    stroke?: string;
}

export const TikTokIcon = ({ width = 14, height = 14, fill = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.59-1.01V14c0 1.5-.4 3-1.35 4.16-1.35 1.7-3.66 2.51-5.74 1.94-2.1-.57-3.8-2.6-3.8-4.78 0-2.31 1.84-4.32 4.14-4.51.6-.05 1.2.06 1.76.28v4.03c-.45-.18-.95-.23-1.42-.14-.94.18-1.57 1.13-1.42 2.06.12.78.85 1.35 1.64 1.28.84-.04 1.48-.82 1.48-1.65V.02z"/>
    </svg>
);

export const XIcon = ({ width = 12, height = 12, fill = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
);

export const InstagramIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
    </svg>
);

export const UploadIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
);

export const LinkIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
);

export const CloseIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
);

export const VideoIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="23 7 16 12 23 17 23 7" fill={stroke} />
        <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
);

export const CarouselIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="3" width="13" height="18" rx="2" />
        <path d="M19 6v12" />
        <path d="M22 8v8" />
    </svg>
);

export const PlayIcon = ({ width = 14, height = 14, fill = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

export const PauseIcon = ({ width = 14, height = 14, fill = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <rect x="6" y="4" width="4" height="16" />
        <rect x="14" y="4" width="4" height="16" />
    </svg>
);

export const VolumeIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
    </svg>
);

export const VolumeMuteIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <line x1="23" y1="9" x2="17" y2="15" />
        <line x1="17" y1="9" x2="23" y2="15" />
    </svg>
);

export const ChevronLeftIcon = ({ width = 10, height = 10, stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6" />
    </svg>
);

export const ChevronRightIcon = ({ width = 10, height = 10, stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
    </svg>
);

export const PowerIcon = ({ width = 10, height = 10, stroke = "currentColor" }: IconProps) => (
    <svg aria-hidden="true" focusable="false" width={width} height={height} viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
);

