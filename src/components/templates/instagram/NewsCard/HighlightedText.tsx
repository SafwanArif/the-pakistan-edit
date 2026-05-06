import React, { useMemo } from "react";


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
    const parseText = (content: string, isNested: boolean = false): React.ReactNode[] => {
        if (!content) return [];
        
        // Simplified Single-Character Regex Registry (2027 Minimalist Standard)
        const splitRegex = new RegExp(`(\\^[^\\^]+?\\^)|(\\*[^\\*]+?\\*)|(_[^_]+?_)|(#[^#]+?#)|(%[^%]+?%)|(\\/[^\\/]+?\\/)|${FLAG_REGEX.source}`, 'g');
        return content.split(splitRegex).filter(Boolean).map((part, i) => {
            const key = `${part}-${i}`;
            
            // 1. GOLD TEXT ACCENT (^)
            if (part.startsWith("^") && part.endsWith("^")) {
                const inner = part.slice(1, -1);
                const hColor = "var(--ui-accent)";
                return <span key={key} style={{ color: hColor, textShadow: isNested ? 'none' : `0 0 12px oklch(from ${hColor} l c h / 0.3)` }}>{parseText(inner, true)}</span>;
            }
            
            // 1B. BOLD TEXT ACCENT (*)
            if (part.startsWith("*") && part.endsWith("*")) {
                const inner = part.slice(1, -1);
                return <span key={key} style={{ fontWeight: 600 }}>{parseText(inner, true)}</span>;
            }
            
            // 2. GREEN TEXT ACCENT (_)
            if (part.startsWith("_") && part.endsWith("_")) {
                const inner = part.slice(1, -1);
                const hColor = "var(--ui-indicator)";
                return <span key={key} style={{ color: hColor, textShadow: isNested ? 'none' : `0 0 12px oklch(from ${hColor} l c h / 0.3)` }}>{parseText(inner, true)}</span>;
            }
            
            // 3. GREEN BLOCK HIGHLIGHT (#)
            if (part.startsWith("#") && part.endsWith("#")) {
                const inner = part.slice(1, -1);
                return (
                    <span key={key} style={{ 
                        backgroundImage: "linear-gradient(to bottom, transparent 12%, var(--ui-indicator) 12%, var(--ui-indicator) 97%, transparent 97%)", 
                        color: "var(--ui-text)",
                        paddingInline: '4px', marginInline: '-4px',
                        borderRadius: '2px',
                        WebkitBoxDecorationBreak: 'clone',
                        boxDecorationBreak: 'clone'
                    }}>
                        {parseText(inner, true)}
                    </span>
                );
            }

            // 4. BLACK BLOCK HIGHLIGHT (%)
            if (part.startsWith("%") && part.endsWith("%")) {
                const inner = part.slice(1, -1);
                return (
                    <span key={key} style={{ 
                        backgroundImage: 'linear-gradient(to bottom, transparent 12%, black 12%, black 97%, transparent 97%)', 
                        paddingInline: '4px', marginInline: '-4px',
                        borderRadius: '2px',
                        WebkitBoxDecorationBreak: 'clone',
                        boxDecorationBreak: 'clone'
                    }}>
                        {parseText(inner, true)}
                    </span>
                );
            }

            // 5. ITALIC TEXT ACCENT (/)
            if (part.startsWith("/") && part.endsWith("/")) {
                const inner = part.slice(1, -1);
                return <span key={key} style={{ fontStyle: 'italic' }}>{parseText(inner, true)}</span>;
            }

            // 6. FLAG ICON REGISTRY
            if (FLAGS[part]) {
                return <img key={key} src={FLAGS[part]} alt="flag" style={{ blockSize: '1.05em', verticalAlign: '-0.18em', display: 'inline-block', marginInline: '4px' }} />;
            }
            
            return part;
        });
    };

    return useMemo(() => {
        if (!text) return null;
        return parseText(text, !!color);
    }, [text, color]);
});

HighlightedText.displayName = "HighlightedText";
