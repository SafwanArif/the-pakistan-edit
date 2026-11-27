/** Text sanitisation and keyword extraction helpers for export filenames and SEO metadata. */

const NON_ALPHANUM_RE = /[^a-z0-9]+/g;
const EDGE_HYPHENS_RE = /^-+|-+$/g;
const GOLD_MATCH_RE = /==([\s\S]*?)==|<gold>([\s\S]*?)<\/gold>/g;
const WHITESPACE_SPLIT_RE = /\s+/;

/** Sanitises text into lowercase, hyphenated alphanumeric slugs. */
export const sanitize = (text: string): string =>
    text ? text.toLowerCase().replace(NON_ALPHANUM_RE, "-").replace(EDGE_HYPHENS_RE, "") : "";

/** Resolves a deterministic anchor keyword from highlighted headline terms or the first three words. */
export const getAnchorKeyword = (headline: string): string => {
    if (!headline) return "news";
    for (const match of headline.matchAll(GOLD_MATCH_RE)) {
        const slug = sanitize(match[1] ?? match[2] ?? "");
        if (slug) return slug;
    }
    const words = headline.trim().split(WHITESPACE_SPLIT_RE).slice(0, 3).join("-");
    return sanitize(words) || "news";
};
