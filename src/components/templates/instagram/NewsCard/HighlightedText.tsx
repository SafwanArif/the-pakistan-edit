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
    const parseText = (content: string, parentColor?: string): React.ReactNode[] => {
        if (!content) return [];
        
        const splitRegex = new RegExp(`(\\*\\*?.+?\\*\\*?)|(_?.+?_)|(##.+?##)|(%%.+?%%)|${FLAG_REGEX.source}`, 'g');
        return content.split(splitRegex).filter(Boolean).map((part, i) => {
            const key = `${part}-${i}`;
            
            // 1. GOLD TEXT ACCENT
            if (part.startsWith("*") && part.endsWith("*")) {
                const inner = part.replace(/\*/g, '');
                const hColor = parentColor || TOKENS.colors.crescentGold;
                return <span key={key} style={{ color: hColor, textShadow: parentColor ? 'none' : `0 0 12px oklch(from ${hColor} l c h / 0.3)` }}>{parseText(inner, hColor)}</span>;
            }
            
            // 2. GREEN TEXT ACCENT
            if (part.startsWith("_") && part.endsWith("_")) {
                const inner = part.replace(/_/g, '');
                const hColor = TOKENS.colors.pakistanGreen;
                return <span key={key} style={{ color: hColor, textShadow: parentColor ? 'none' : `0 0 12px oklch(from ${hColor} l c h / 0.3)` }}>{parseText(inner, hColor)}</span>;
            }
            
            // 3. GREEN BLOCK HIGHLIGHT
            if (part.startsWith("##") && part.endsWith("##")) {
                const inner = part.replace(/##/g, '');
                return (
                    <span key={key} style={{ 
                        background: TOKENS.colors.pakistanGreen, 
                        color: TOKENS.colors.paperWhite,
                        paddingInline: '8px', paddingBlock: '2px', borderRadius: '4px',
                        display: 'inline-block', marginInline: '2px',
                        boxShadow: `0 4px 15px oklch(from ${TOKENS.colors.pakistanGreen} l c h / 0.4)`
                    }}>
                        {parseText(inner, TOKENS.colors.paperWhite)}
                    </span>
                );
            }

            // 4. WHITE BLOCK HIGHLIGHT
            if (part.startsWith("%%") && part.endsWith("%%")) {
                const inner = part.replace(/%%/g, '');
                return (
                    <span key={key} style={{ 
                        background: TOKENS.colors.paperWhite, 
                        color: TOKENS.colors.deepPine,
                        paddingInline: '8px', paddingBlock: '2px', borderRadius: '4px',
                        display: 'inline-block', marginInline: '2px',
                        boxShadow: `0 4px 15px oklch(from black l c h / 0.2)`
                    }}>
                        {parseText(inner, TOKENS.colors.deepPine)}
                    </span>
                );
            }

            // 5. FLAG ICON REGISTRY
            if (FLAGS[part]) {
                return <img key={key} src={FLAGS[part]} alt="flag" style={{ blockSize: '1.05em', verticalAlign: '-0.18em', display: 'inline-block', marginInline: '4px' }} />;
            }
            
            return part;
        });
    };

    return useMemo(() => {
        if (!text) return null;
        return parseText(text, color);
    }, [text, color]);
});

HighlightedText.displayName = "HighlightedText";
