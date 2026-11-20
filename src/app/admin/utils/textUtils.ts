/**
 * Text sanitisation and keyword extraction helpers for export filenames and SEO metadata.
 */

const NON_ALPHANUM_RE = /[^a-z0-9]+/g;
const EDGE_HYPHENS_RE = /^-+|-+$/g;
const GOLD_MATCH_RE = /==(.*?)==|<gold>(.*?)<\/gold>/g;
const GOLD_STRIP_RE = /^==|==$|<\/?gold>/g;
const WHITESPACE_SPLIT_RE = /\s+/;

/** Sanitises text into lowercase, hyphenated alphanumeric slugs. */
export const sanitize = (text: string): string => {
    if (!text) return "";
    return text
        .toLowerCase()
        .replace(NON_ALPHANUM_RE, '-')
        .replace(EDGE_HYPHENS_RE, '');
};

/** Extracts highlighted keywords wrapped in ==...== (or legacy <gold>...</gold>). */
const getGoldKeywords = (text: string): string[] => {
    if (!text) return [];
    const matches = text.match(GOLD_MATCH_RE) || [];
    return [...new Set(matches.map(m => sanitize(m.replace(GOLD_STRIP_RE, ''))))].filter(Boolean);
};

/** Resolves a deterministic anchor keyword from highlighted headline terms or the first three words. */
export const getAnchorKeyword = (headline: string): string => {
    const gold = getGoldKeywords(headline);
    if (gold.length > 0 && gold[0]) return gold[0];

    const words = headline.trim().split(WHITESPACE_SPLIT_RE).slice(0, 3).join('-');
    return sanitize(words) || "news";
};
