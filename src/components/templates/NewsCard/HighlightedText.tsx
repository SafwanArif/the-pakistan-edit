"use client";

import React, { useMemo } from "react";
import Image from "next/image";
import { SOCIAL_LOGO_PATHS } from "@/config/editorial";

/** Local high-resolution flag image paths keyed by Unicode flag emoji. */
const FLAGS: Readonly<Record<string, string>> = {
    "🇵🇰": "/assets/flags/pk.png", "🇵🇸": "/assets/flags/ps.png",
    "🇬🇧": "/assets/flags/gb.png", "🇺🇸": "/assets/flags/us.png",
    "🇮🇳": "/assets/flags/in.png", "🇮🇶": "/assets/flags/iq.png",
    "🇬🇷": "/assets/flags/gr.png", "🇺🇳": "/assets/flags/un.png",
};

type StyledTokenType = 'bold' | 'italic' | 'gold' | 'green' | 'highlight' | 'whiteHighlight';
export type TokenType = 'text' | StyledTokenType | 'flag' | 'social';
export interface Token { type: TokenType; value: string; }

const DELIMITERS: readonly (readonly [open: string, close: string, type: StyledTokenType])[] = [
    ['**', '**', 'bold'],
    ['==', '==', 'gold'],
    ['<gold>', '</gold>', 'gold'],
    ['~~', '~~', 'green'],
    ['^^', '^^', 'highlight'],
    ['&&', '&&', 'whiteHighlight'],
    ['*', '*', 'italic'],
];

const TOKEN_RE = /(\*\*[\s\S]+?\*\*(?!\*)|(?<!=)==(?!=)[\s\S]+?(?<!=)==(?!=)|<gold>[\s\S]+?<\/gold>|(?<!~)~~(?!~)[\s\S]+?(?<!~)~~(?!~)|(?<!\^)\^\^(?!\^)[\s\S]+?(?<!\^)\^\^(?!\^)|(?<!&)&&(?!&)[\s\S]+?(?<!&)&&(?!&)|\*(?!\*)[\s\S]+?(?<!\*)\*|\[tt\]|\[yt\]|\[ig\]|\[x\]|\[fb\]|🇵🇰|🇵🇸|🇬🇧|🇺🇸|🇮🇳|🇮🇶|🇬🇷|🇺🇳)/g;
const MAX_NEST_DEPTH = 4;

const pushText = (tokens: Token[], value: string) => {
    const prev = tokens[tokens.length - 1];
    if (prev?.type === 'text') prev.value += value;
    else tokens.push({ type: 'text', value });
};

/** Re-entrant tokenizer for editorial inline formatting, flags, and social badges. */
export const tokenize = (text: string): Token[] => {
    const tokens: Token[] = [];
    let lastIndex = 0;

    for (const match of text.matchAll(TOKEN_RE)) {
        const idx = match.index ?? 0;
        if (idx > lastIndex) pushText(tokens, text.substring(lastIndex, idx));

        const m = match[0];
        let matched = false;
        for (const [open, close, type] of DELIMITERS) {
            if (m.length > open.length + close.length && m.startsWith(open) && m.endsWith(close)) {
                const inner = m.slice(open.length, -close.length);
                if (open === '**' && /^\*+$/.test(inner)) break;
                tokens.push({ type, value: inner });
                matched = true;
                break;
            }
        }
        if (!matched) {
            if (FLAGS[m]) tokens.push({ type: 'flag', value: m });
            else if (SOCIAL_LOGO_PATHS[m]) tokens.push({ type: 'social', value: m });
            else pushText(tokens, m);
        }
        lastIndex = idx + m.length;
    }

    if (lastIndex < text.length) pushText(tokens, text.substring(lastIndex));
    return tokens;
};

const BOX_HIGHLIGHT_BASE: React.CSSProperties = {
    position: 'relative', zIndex: 1, paddingInline: '4px', marginInline: '-4px',
    borderRadius: '2px', WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone',
};

const TOKEN_STYLES: Record<StyledTokenType, React.CSSProperties> = {
    bold: { fontWeight: 600 },
    italic: { fontStyle: 'italic' },
    gold: { color: "var(--ui-accent)" },
    green: { color: "var(--ui-indicator)" },
    highlight: { ...BOX_HIGHLIGHT_BASE, backgroundImage: 'linear-gradient(to bottom, transparent 12%, black 12%, black 97%, transparent 97%)' },
    whiteHighlight: { ...BOX_HIGHLIGHT_BASE, backgroundImage: 'linear-gradient(to bottom, transparent 12%, #ffffff 12%, #ffffff 97%, transparent 97%)', color: '#050505', textShadow: 'none' },
};

const FLAG_IMG_STYLE: React.CSSProperties = { blockSize: '1.05em', inlineSize: 'auto', verticalAlign: '-0.18em', display: 'inline-block', marginInline: '4px' };
const SOCIAL_IMG_STYLE: React.CSSProperties = { blockSize: '0.88em', inlineSize: 'auto', verticalAlign: '-0.11em', display: 'inline-block', marginInlineEnd: '4px' };
const TEXT_SPAN_STYLE: React.CSSProperties = { position: 'relative', zIndex: 2 };

const renderInlineBadge = (key: string, src: string | undefined, style: React.CSSProperties) =>
    src ? <Image key={key} src={src} alt="" aria-hidden="true" width={24} height={24} unoptimized loading="eager" decoding="sync" crossOrigin="anonymous" referrerPolicy="no-referrer" style={style} /> : null;

const renderTokens = (text: string, depth = 0): React.ReactNode => {
    if (depth >= MAX_NEST_DEPTH) return <span style={TEXT_SPAN_STYLE}>{text}</span>;
    const tokens = tokenize(text);
    if (tokens.length === 1 && tokens[0]?.type === 'text') return <span style={TEXT_SPAN_STYLE}>{tokens[0].value}</span>;

    return tokens.map((token, i) => {
        const key = `${depth}-${token.type}-${i}`;
        if (token.type === 'flag') return renderInlineBadge(key, FLAGS[token.value], FLAG_IMG_STYLE);
        if (token.type === 'social') return renderInlineBadge(key, SOCIAL_LOGO_PATHS[token.value], SOCIAL_IMG_STYLE);
        if (token.type === 'text') return <span key={key} style={TEXT_SPAN_STYLE}>{token.value}</span>;
        return <span key={key} style={TOKEN_STYLES[token.type]}>{renderTokens(token.value, depth + 1)}</span>;
    });
};

/** Renders inline-formatted editorial text, flag icons, and social badges. */
export const HighlightedText = React.memo<{ text?: string }>(({ text }) => {
    const parsedNodes = useMemo(() => (text ? renderTokens(text, 0) : null), [text]);
    return <>{parsedNodes}</>;
});

HighlightedText.displayName = "HighlightedText";
