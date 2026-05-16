/**
 * 2027 Institutional Standard: TextUtils
 * Centralized logic for text sanitization, keyword extraction, and SEO formatting.
 */

/**
 * Sanitizes text for use in file names and IDs.
 * Lowercase, hyphenated, alphanumeric only.
 */
export const sanitize = (text: string): string => {
    if (!text) return "";
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
};

/**
 * Extracts "Gold" keywords (wrapped in ^...^) from text.
 * Used for SEO anchors and highlight logic.
 */
export const getGoldKeywords = (text: string): string[] => {
    if (!text) return [];
    const matches = text.match(/\^([^/^]+)\^/g) || [];
    return [...new Set(matches.map(m => sanitize(m.replace(/\^/g, ''))))].filter(Boolean);
};

/**
 * Resolves a deterministic anchor keyword for a draft.
 * Prioritizes Gold keywords from the headline, falling back to the first 3 words.
 */
export const getAnchorKeyword = (headline: string): string => {
    const gold = getGoldKeywords(headline);
    if (gold.length > 0) return gold[0];
    
    const words = headline.split(' ').slice(0, 3).join('-');
    return sanitize(words) || "news";
};
