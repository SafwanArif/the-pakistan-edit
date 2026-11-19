/**
 * Text sanitisation and keyword extraction helpers for export filenames and SEO metadata.
 */

/** Sanitises text into lowercase, hyphenated alphanumeric slugs. */
export const sanitize = (text: string): string => {
    if (!text) return "";
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

/** Extracts highlighted keywords wrapped in ==...== (or legacy <gold>...</gold>). */
const getGoldKeywords = (text: string): string[] => {
    if (!text) return [];
    const matches = text.match(/==(.*?)==|<gold>(.*?)<\/gold>/g) || [];
    return [...new Set(matches.map(m => sanitize(m.replace(/^==|==$|<\/?gold>/g, ''))))].filter(Boolean);
};

/** Resolves a deterministic anchor keyword from highlighted headline terms or the first three words. */
export const getAnchorKeyword = (headline: string): string => {
    const gold = getGoldKeywords(headline);
    if (gold.length > 0 && gold[0]) return gold[0];

    const words = headline.split(' ').slice(0, 3).join('-');
    return sanitize(words) || "news";
};
