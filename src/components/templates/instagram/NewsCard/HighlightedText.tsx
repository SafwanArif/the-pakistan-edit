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
        
        const splitRegex = new RegExp(`(\\*\\*?.+?\\*\\*?)|(_?.+?_)|${FLAG_REGEX.source}`, 'g');
        return text.split(splitRegex).filter(Boolean).map((part, i) => {
            if (part.startsWith("*") && part.endsWith("*")) {
                const inner = part.replace(/\*/g, '');
                const hColor = color || TOKENS.colors.crescentGold;
                return (
                    <span key={i} style={{ 
                        backgroundColor: hColor, 
                        color: 'white',
                        padding: '0 0.25em',
                        marginInline: '0.05em',
                        borderRadius: '2px',
                        boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                        textShadow: 'none',
                        display: 'inline'
                    }}>
                        {inner}
                    </span>
                );
            }
            if (part.startsWith("_") && part.endsWith("_")) {
                const inner = part.replace(/_/g, '');
                const hColor = TOKENS.colors.pakistanGreen;
                return (
                    <span key={i} style={{ 
                        backgroundColor: hColor, 
                        color: 'white',
                        padding: '0 0.25em',
                        marginInline: '0.05em',
                        borderRadius: '2px',
                        boxDecorationBreak: 'clone',
                        WebkitBoxDecorationBreak: 'clone',
                        textShadow: 'none',
                        display: 'inline'
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
