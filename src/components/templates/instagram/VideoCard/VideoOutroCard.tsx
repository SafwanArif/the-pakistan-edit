import React from "react";
import { TPEVectorLogo, type LogoMotionConfig } from "../TPEVectorLogo";
import { HighlightedText } from "../NewsCard/HighlightedText";

interface VideoOutroCardProps {
    outroCta?: string;
    is916: boolean;
    enableMotion?: boolean;
    motionConfig?: LogoMotionConfig;
}

const OUTRO_CONTAINER_STYLE: React.CSSProperties = {
    background: 'radial-gradient(circle at center, #141414 0%, #050505 100%)',
    zIndex: 25,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '100px 60px',
    textAlign: 'center',
    gap: '28px',
};

const LOGO_WRAP_STYLE: React.CSSProperties = { transform: 'scale(1.4)' };
const DIVIDER_STYLE: React.CSSProperties = { width: '80px', height: '3px', background: 'var(--ui-accent)', marginBlock: '8px' };

const CTA_BASE_STYLE: React.CSSProperties = {
    fontWeight: 800,
    fontFamily: 'var(--tpe-font-geist)',
    letterSpacing: '0.04em',
    lineHeight: 1.25,
    color: 'var(--ui-text)',
    textTransform: 'uppercase',
    maxWidth: '900px',
};

const HANDLE_STYLE: React.CSSProperties = {
    fontSize: '22px',
    fontFamily: 'monospace',
    fontWeight: 700,
    letterSpacing: '0.2em',
    color: 'var(--ui-accent)',
    textTransform: 'uppercase',
};

const BADGE_STYLE: React.CSSProperties = {
    position: 'absolute',
    bottom: '80px',
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.15em',
    color: 'oklch(from var(--ui-text) l c h / 0.3)',
    textTransform: 'uppercase',
};

/** Branded 5-second outro end-card rendered at the end of a video timeline. */
export const VideoOutroCard: React.FC<VideoOutroCardProps> = React.memo(({ outroCta, is916, enableMotion = true, motionConfig }) => (
    <div
        className={`tpe-full-absolute tpe-flex-col${enableMotion ? ' tpe-kinetic-in' : ''}`}
        style={OUTRO_CONTAINER_STYLE}
    >
        <div style={LOGO_WRAP_STYLE}>
            <TPEVectorLogo scale={2.5} showWordmark={true} animateWordmark={enableMotion} motionConfig={motionConfig} />
        </div>
        <div style={DIVIDER_STYLE} />
        <div style={{ ...CTA_BASE_STYLE, fontSize: is916 ? '42px' : '32px' }}>
            <HighlightedText text={outroCta || "FOLLOW FOR VERIFIED STRATEGIC INTELLIGENCE"} />
        </div>
        <div style={HANDLE_STYLE}>
            @THEPAKISTANEDIT
        </div>
        <div style={BADGE_STYLE}>
            INSTITUTIONAL CONTENT ENGINE // VERIFIED
        </div>
    </div>
));

VideoOutroCard.displayName = "VideoOutroCard";
