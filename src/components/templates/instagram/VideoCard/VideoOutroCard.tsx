import React from "react";
import { TPEVectorLogo } from "../TPEVectorLogo";
import { HighlightedText } from "../NewsCard/HighlightedText";

interface VideoOutroCardProps {
    outroCta?: string;
    is916: boolean;
    enableMotion?: boolean;
}

/** Branded 5-second outro end-card rendered at the end of a video timeline. */
export const VideoOutroCard: React.FC<VideoOutroCardProps> = React.memo(({ outroCta, is916, enableMotion = true }) => (
    <div
        className={`tpe-full-absolute tpe-flex-col${enableMotion ? ' tpe-kinetic-in' : ''}`}
        style={{
            background: 'radial-gradient(circle at center, #141414 0%, #050505 100%)',
            zIndex: 25,
            alignItems: 'center',
            justifyContent: 'center',
            padding: '100px 60px',
            textAlign: 'center',
            gap: '28px'
        }}
    >
        <div style={{ transform: 'scale(1.4)' }}>
            <TPEVectorLogo scale={2.5} showWordmark={true} />
        </div>
        <div style={{ width: '80px', height: '3px', background: 'var(--ui-accent)', marginBlock: '8px' }} />
        <div style={{
            fontSize: is916 ? '42px' : '32px',
            fontWeight: 800,
            fontFamily: 'var(--tpe-font-geist)',
            letterSpacing: '0.04em',
            lineHeight: 1.25,
            color: 'var(--ui-text)',
            textTransform: 'uppercase',
            maxWidth: '900px'
        }}>
            <HighlightedText text={outroCta || "FOLLOW FOR VERIFIED STRATEGIC INTELLIGENCE"} />
        </div>
        <div style={{
            fontSize: '22px',
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: '0.2em',
            color: 'var(--ui-accent)',
            textTransform: 'uppercase'
        }}>
            @THEPAKISTANEDIT
        </div>
        <div style={{
            position: 'absolute',
            bottom: '80px',
            fontSize: '14px',
            fontWeight: 600,
            letterSpacing: '0.15em',
            color: 'oklch(from var(--ui-text) l c h / 0.3)',
            textTransform: 'uppercase'
        }}>
            INSTITUTIONAL CONTENT ENGINE // VERIFIED
        </div>
    </div>
));

VideoOutroCard.displayName = "VideoOutroCard";
