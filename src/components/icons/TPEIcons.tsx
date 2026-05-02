import React from "react";

/**
 * Institutional Icon Registry (2027)
 * Centralized SVG storage to purge bloat from components.
 */

interface IconProps {
    width?: number;
    height?: number;
    className?: string;
    fill?: string;
    stroke?: string;
}

export const TikTokIcon = ({ width = 14, height = 14, fill = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <path d="M12.53.02C13.84 0 15.14.01 16.44 0c.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.59-1.01V14c0 1.5-.4 3-1.35 4.16-1.35 1.7-3.66 2.51-5.74 1.94-2.1-.57-3.8-2.6-3.8-4.78 0-2.31 1.84-4.32 4.14-4.51.6-.05 1.2.06 1.76.28v4.03c-.45-.18-.95-.23-1.42-.14-.94.18-1.57 1.13-1.42 2.06.12.78.85 1.35 1.64 1.28.84-.04 1.48-.82 1.48-1.65V.02z"/>
    </svg>
);

export const XIcon = ({ width = 12, height = 12, fill = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
    </svg>
);

export const InstagramIcon = ({ width = 14, height = 14, fill = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
        <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
        <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
    </svg>
);

export const FacebookIcon = ({ width = 14, height = 14, fill = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill}>
        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
);

export const UploadIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
    </svg>
);

export const LinkIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
    </svg>
);

export const CloseIcon = ({ width = 14, height = 14, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="6" x2="6" y2="18"/>
        <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
);

export const BackIcon = ({ width = 16, height = 16, fill = "none", stroke = "currentColor" }: IconProps) => (
    <svg width={width} height={height} viewBox="0 0 24 24" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M15 18l-6-6 6-6"/>
    </svg>
);
