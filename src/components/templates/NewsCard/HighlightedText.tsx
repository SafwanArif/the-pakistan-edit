import React, { useMemo } from "react";
import Image from "next/image";

/** Local high-resolution flag image paths keyed by Unicode flag emoji. */
const FLAGS: Record<string, string> = {
    "🇵🇰": "/assets/flags/pk.png", "🇵🇸": "/assets/flags/ps.png",
    "🇬🇧": "/assets/flags/gb.png", "🇺🇸": "/assets/flags/us.png",
    "🇮🇳": "/assets/flags/in.png", "🇮🇶": "/assets/flags/iq.png",
    "🇬🇷": "/assets/flags/gr.png", "🇺🇳": "/assets/flags/un.png"
};

const SOCIAL_LOGOS: Record<string, string> = {
    "[tt]": "/assets/social/trimmed/tt.png",
    "[yt]": "/assets/social/trimmed/yt.png",
    "[ig]": "/assets/social/trimmed/ig.png",
    "[x]": "/assets/social/trimmed/x.png",
    "[fb]": "/assets/social/trimmed/fb.png",
};

type TokenType = 'text' | 'bold' | 'italic' | 'gold' | 'green' | 'highlight' | 'whiteHighlight' | 'flag' | 'social';
interface Token { type: TokenType; value: string; }

/**
 * Tokenises editorial inline formatting (**bold**, *italic*, ==gold==, ~~green~~,
 * ^^black^^, &&white&&, legacy <gold>...</gold>, flag emojis, and [tt]/[yt]/[ig]/[x]/[fb] social badges).
 */
const tokenize = (text: string): Token[] => {
    const tokens: Token[] = [];
    const regex = /(\*\*[\s\S]*?\*\*|==[\s\S]*?==|<gold>[\s\S]*?<\/gold>|~~[\s\S]*?~~|\^\^[\s\S]*?\^\^|&&[\s\S]*?&&|\*[\s\S]*?\*|\[tt\]|\[yt\]|\[ig\]|\[x\]|\[fb\]|🇵🇰|🇵🇸|🇬🇧|🇺🇸|🇮🇳|🇮🇶|🇬🇷|🇺🇳)/g;

    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ type: 'text', value: text.substring(lastIndex, match.index) });
        }

        const m = match[0];

        if (m.startsWith('**') && m.endsWith('**')) tokens.push({ type: 'bold', value: m.slice(2, -2) });
        else if (m.startsWith('==') && m.endsWith('==')) tokens.push({ type: 'gold', value: m.slice(2, -2) });
        else if (m.startsWith('<gold>') && m.endsWith('</gold>')) tokens.push({ type: 'gold', value: m.slice(6, -7) });
        else if (m.startsWith('~~') && m.endsWith('~~')) tokens.push({ type: 'green', value: m.slice(2, -2) });
        else if (m.startsWith('^^') && m.endsWith('^^')) tokens.push({ type: 'highlight', value: m.slice(2, -2) });
        else if (m.startsWith('&&') && m.endsWith('&&')) tokens.push({ type: 'whiteHighlight', value: m.slice(2, -2) });
        else if (m.startsWith('*') && m.endsWith('*')) tokens.push({ type: 'italic', value: m.slice(1, -1) });
        else if (FLAGS[m]) tokens.push({ type: 'flag', value: m });
        else if (SOCIAL_LOGOS[m]) tokens.push({ type: 'social', value: m });
        else tokens.push({ type: 'text', value: m });

        lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
        tokens.push({ type: 'text', value: text.substring(lastIndex) });
    }

    return tokens;
};

const BOLD_STYLE: React.CSSProperties = { fontWeight: 600 };
const ITALIC_STYLE: React.CSSProperties = { fontStyle: 'italic' };
const GOLD_STYLE: React.CSSProperties = { color: "var(--ui-accent)" };
const GREEN_STYLE: React.CSSProperties = { color: "var(--ui-indicator)" };
const BLACK_BOX_STYLE: React.CSSProperties = {
    position: 'relative',
    zIndex: 1,
    backgroundImage: 'linear-gradient(to bottom, transparent 12%, black 12%, black 97%, transparent 97%)',
    paddingInline: '4px',
    marginInline: '-4px',
    borderRadius: '2px',
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone',
};
const WHITE_BOX_STYLE: React.CSSProperties = {
    position: 'relative',
    zIndex: 1,
    backgroundImage: 'linear-gradient(to bottom, transparent 12%, #ffffff 12%, #ffffff 97%, transparent 97%)',
    color: '#050505',
    textShadow: 'none',
    paddingInline: '4px',
    marginInline: '-4px',
    borderRadius: '2px',
    WebkitBoxDecorationBreak: 'clone',
    boxDecorationBreak: 'clone',
};
const FLAG_IMG_STYLE: React.CSSProperties = {
    blockSize: '1.05em',
    inlineSize: 'auto',
    verticalAlign: '-0.18em',
    display: 'inline-block',
    marginInline: '4px',
};
const SOCIAL_IMG_STYLE: React.CSSProperties = {
    blockSize: '0.88em',
    inlineSize: 'auto',
    verticalAlign: '-0.11em',
    display: 'inline-block',
    marginInlineEnd: '4px',
};
const TEXT_SPAN_STYLE: React.CSSProperties = { position: 'relative', zIndex: 2 };

/** Renders inline-formatted editorial text and flag icons. */
export const HighlightedText = React.memo<{ text?: string }>(({ text }) => {
    const parsedNodes = useMemo(() => {
        if (!text) return null;

        return tokenize(text).map((token, i) => {
            const key = `${token.type}-${i}`;

            switch (token.type) {
                case 'bold':
                    return <span key={key} style={BOLD_STYLE}><HighlightedText text={token.value} /></span>;
                case 'italic':
                    return <span key={key} style={ITALIC_STYLE}><HighlightedText text={token.value} /></span>;
                case 'gold':
                    return <span key={key} style={GOLD_STYLE}><HighlightedText text={token.value} /></span>;
                case 'green':
                    return <span key={key} style={GREEN_STYLE}><HighlightedText text={token.value} /></span>;
                case 'highlight':
                    return (
                        <span key={key} style={BLACK_BOX_STYLE}>
                            <HighlightedText text={token.value} />
                        </span>
                    );
                case 'whiteHighlight':
                    return (
                        <span key={key} style={WHITE_BOX_STYLE}>
                            <HighlightedText text={token.value} />
                        </span>
                    );
                case 'flag': {
                    const flagSrc = FLAGS[token.value];
                    return flagSrc ? <Image key={key} src={flagSrc} alt="" width={24} height={24} unoptimized loading="eager" decoding="sync" style={FLAG_IMG_STYLE} /> : null;
                }
                case 'social': {
                    const socialSrc = SOCIAL_LOGOS[token.value];
                    return socialSrc ? <Image key={key} src={socialSrc} alt="" width={24} height={24} unoptimized loading="eager" decoding="sync" style={SOCIAL_IMG_STYLE} /> : null;
                }
                default:
                    return <span key={key} style={TEXT_SPAN_STYLE}>{token.value}</span>;
            }
        });
    }, [text]);

    return <>{parsedNodes}</>;
});

HighlightedText.displayName = "HighlightedText";
