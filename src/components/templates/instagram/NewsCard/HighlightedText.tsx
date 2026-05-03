import React, { useMemo } from "react";
import { TOKENS } from "./index";

/**
 * Institutional Data Registry: High-Res Flag Icons
 */
const FLAGS: Record<string, string> = { 
    "🇵🇰": "/assets/flags/pk.png", "🇵🇸": "/assets/flags/ps.png", 
    "🇬🇧": "/assets/flags/gb.png", "🇺🇸": "/assets/flags/us.png", 
    "🇮🇳": "/assets/flags/in.png", "🇮🇶": "/assets/flags/iq.png",
    "🇬🇷": "/assets/flags/gr.png", "🇺🇳": "/assets/flags/un.png"
};

const FLAG_REGEX = new RegExp(`(${Object.keys(FLAGS).join('|')})`, 'g');

/** 
 * 2027 Performance Standard: HighlightedText
 * Single-pass renderer optimized for high-density editorial content.
 */
export const HighlightedText = React.memo<{ text?: string, color?: string }>(({ text, color }) => {
    return useMemo(() => {
        if (!text) return null;
        
        const splitRegex = new RegExp(`(\\*\\*?.+?\\*\\*?)|(_?.+?_)|(##.+?##)|${FLAG_REGEX.source}`, 'g');
        return text.split(splitRegex).filter(Boolean).map((part, i) => {
            if (part.startsWith("*") && part.endsWith("*")) {
                const inner = part.replace(/\*/g, '');
                const hColor = color || TOKENS.colors.crescentGold;
                return <span key={i} style={{ color: hColor, textShadow: `0 0 12px oklch(from ${hColor} l c h / 0.3)` }}>{inner}</span>;
            }
            if (part.startsWith("_") && part.endsWith("_")) {
                const inner = part.replace(/_/g, '');
                const hColor = TOKENS.colors.pakistanGreen;
                return <span key={i} style={{ color: hColor, textShadow: `0 0 12px oklch(from ${hColor} l c h / 0.3)` }}>{inner}</span>;
            }
            if (part.startsWith("##") && part.endsWith("##")) {
                const inner = part.replace(/##/g, '');
                return (
                    <span key={i} style={{ 
                        background: TOKENS.colors.pakistanGreen, 
                        color: TOKENS.colors.paperWhite,
                        paddingInline: '8px',
                        paddingBlock: '2px',
                        borderRadius: '4px',
                        display: 'inline-block',
                        marginInline: '2px',
                        textShadow: 'none',
                        boxShadow: `0 4px 15px oklch(from ${TOKENS.colors.pakistanGreen} l c h / 0.4)`
                    }}>
                        {inner}
                    </span>
                );
            }
            if (FLAGS[part]) {
                return <img key={i} src={FLAGS[part]} alt="flag" style={{ blockSize: '1.05em', verticalAlign: '-0.18em', display: 'inline-block', marginInline: '4px' }} />;
            }
            return part;
        });
    }, [text, color]);
});

HighlightedText.displayName = "HighlightedText";
