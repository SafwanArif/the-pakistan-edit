/**
 * Generates an 8-char random ID safely across both HTTPS secure contexts (`crypto.randomUUID`)
 * and non-HTTPS LAN origins (`crypto.getRandomValues` fallback).
 */
export const generateShortId = (): string => {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID().slice(0, 8);
    }
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
        const bytes = new Uint8Array(4);
        crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    }
    return Math.random().toString(16).slice(2, 10).padEnd(8, "0");
};

/** Revokes a `blob:` Object URL safely if present. */
export const revokeBlobUrl = (url?: string | null): void => {
    if (url && url.startsWith("blob:") && typeof URL !== "undefined" && typeof URL.revokeObjectURL === "function") {
        URL.revokeObjectURL(url);
    }
};
