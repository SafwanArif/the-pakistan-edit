import JSZip from "jszip";
import { getFontEmbedCSS, toBlob } from "html-to-image";
import { Draft, getSlideCount, downloadBlob } from "@/types/news";
import { OMNI_CONFIG, Platform } from "@/config/omnichannel";
import React from "react";
import { NewsCard } from "@/components/templates/NewsCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";

let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

/** Clears any pending export status auto-clear timeout. */
export const clearExportStatusTimer = () => {
    if (statusClearTimer !== null) {
        clearTimeout(statusClearTimer);
        statusClearTimer = null;
    }
};

/** Returns true when `err` represents a deliberate user/component AbortError. */
export const isAbortError = (err: unknown): boolean =>
    (err instanceof DOMException && err.name === "AbortError")
    || (err instanceof Error && err.name === "AbortError");

/** Throws a standard `AbortError` DOMException if `signal` has been aborted. */
export const assertNotAborted = (signal?: AbortSignal) => {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
};

/** Updates an export status banner and cancels any previously scheduled auto-clear timer. */
export const setExportStatus = (onStatus: (s: string | null) => void, msg: string | null, autoClearMs?: number) => {
    clearExportStatusTimer();
    onStatus(msg);
    if (autoClearMs && msg !== null) {
        statusClearTimer = setTimeout(() => {
            statusClearTimer = null;
            onStatus(null);
        }, autoClearMs);
    }
};

const raceWithAbortAndTimeout = <T,>(
    work: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
    signal?: AbortSignal
): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException("Export cancelled", "AbortError")); return; }
        let settled = false;
        const finish = (err?: unknown, val?: T) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            if (err !== undefined) reject(err);
            else resolve(val as T);
        };
        const onAbort = () => finish(new DOMException("Export cancelled", "AbortError"));
        const timer = setTimeout(() => finish(new Error(timeoutMessage)), timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        work.then((v) => finish(undefined, v), (err) => finish(err));
    });

const nextFrame = (signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new DOMException("Export cancelled", "AbortError")); return; }
        const onAbort = () => { cancelAnimationFrame(rafId); reject(new DOMException("Export cancelled", "AbortError")); };
        const rafId = requestAnimationFrame(() => { signal?.removeEventListener("abort", onAbort); resolve(); });
        signal?.addEventListener("abort", onAbort, { once: true });
    });

const decodeImageThen = (img: HTMLImageElement, done: () => void) => {
    if (img.naturalWidth > 0 && typeof img.decode === "function") {
        void img.decode().catch(() => {}).finally(done);
    } else {
        done();
    }
};

/** Waits deterministically for React 19 commit, decoded `<img>` bitmaps, and paint frames (`P130`, `P144`, `P152`, `P159`). */
const waitForCaptureReady = async (node: HTMLElement, signal?: AbortSignal): Promise<void> => {
    await nextFrame(signal);
    if (!node.firstElementChild) await nextFrame(signal);
    assertNotAborted(signal);

    const images = Array.from(node.querySelectorAll("img"));
    if (images.length > 0) {
        await new Promise<void>((resolve, reject) => {
            let settled = false;
            let loaded = 0;
            const finish = (err?: unknown) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal?.removeEventListener("abort", onAbort);
                for (const img of images) { img.onload = null; img.onerror = null; }
                if (err !== undefined) reject(err);
                else resolve();
            };
            const onAbort = () => finish(new DOMException("Export cancelled", "AbortError"));
            const timer = setTimeout(() => finish(), 8000);
            signal?.addEventListener("abort", onAbort, { once: true });

            const check = () => { if (++loaded >= images.length) finish(); };
            for (const img of images) {
                if (img.complete) decodeImageThen(img, check);
                else {
                    img.onload = () => decodeImageThen(img, check);
                    img.onerror = check;
                }
            }
        });
    }
    await nextFrame(signal);
};

interface DomCaptureSession {
    capture: (
        element: React.ReactNode,
        config: {
            width: number;
            height: number;
            pixelRatio: number;
            backgroundColor: string;
            timeoutMessage: string;
            quality?: number;
            skipAutoScale?: boolean;
            style?: Record<string, string>;
        },
        signal?: AbortSignal
    ) => Promise<Blob | null>;
    dispose: () => void;
}

/**
 * Shared off-screen React capture session inside `#export-capture-surface`.
 * Caches `getFontEmbedCSS()` once per batch and waits deterministically for fonts, images, and paint frames.
 */
export const createDomCaptureSession = async (
    options: { fallbackToBody?: boolean; transparent?: boolean; signal?: AbortSignal } = {}
): Promise<DomCaptureSession> => {
    assertNotAborted(options.signal);
    const container = document.getElementById("export-capture-surface")
        ?? (options.fallbackToBody ? document.body : null);
    if (!container) throw new Error("CRITICAL_FAULT: Capture surface not found in DOM.");

    await document.fonts.ready;
    assertNotAborted(options.signal);
    const { createRoot } = await import("react-dom/client");
    assertNotAborted(options.signal);

    const temp = document.createElement("div");
    temp.style.cssText = `position:fixed;top:0;left:0;z-index:-9999;pointer-events:none;${options.transparent ? "background:transparent;" : ""}`;
    container.appendChild(temp);
    const root = createRoot(temp);
    let cachedFontEmbedCSS: string | undefined;

    return {
        async capture(element, config, signal) {
            assertNotAborted(signal);
            temp.style.width = `${config.width}px`;
            temp.style.height = `${config.height}px`;
            root.render(
                <div id="export-freeze-frame" style={options.transparent ? { background: "transparent" } : undefined}>
                    <style>{`* { transition: none !important; animation: none !important; }`}</style>
                    {element}
                </div>
            );
            await waitForCaptureReady(temp, signal);
            if (cachedFontEmbedCSS === undefined) {
                cachedFontEmbedCSS = await getFontEmbedCSS(temp, { cacheBust: false }).catch(() => "");
                assertNotAborted(signal);
            }
            return raceWithAbortAndTimeout(
                toBlob(temp, {
                    width: config.width,
                    height: config.height,
                    pixelRatio: config.pixelRatio,
                    quality: config.quality,
                    cacheBust: false,
                    fontEmbedCSS: cachedFontEmbedCSS || undefined,
                    backgroundColor: config.backgroundColor,
                    skipAutoScale: config.skipAutoScale,
                    style: config.style,
                }),
                8000,
                config.timeoutMessage,
                signal
            );
        },
        dispose() {
            try { root.unmount(); }
            finally { temp.remove(); }
        },
    };
};

/** Deterministic multi-platform Carousel PNG bundle exporter (`pixelRatio: 2`, cached fonts). */
export const runExportEngine = async (draft: Draft, onStatus: (s: string | null) => void, signal?: AbortSignal) => {
    assertNotAborted(signal);
    setExportStatus(onStatus, "Initializing Institutional Pipeline...");

    const totalSlides = getSlideCount(draft);
    const platforms: Platform[] = ["tiktok", "instagram", "square"];
    const zip = new JSZip();

    try {
        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "");
        const brandTag = "the-pakistan-edit";
        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - SEO BUNDLE\n\nANCHOR: ${anchorKW}\nTAG: ${brandTag}`);

        let count = 0;
        const total = platforms.length * totalSlides;
        const session = await createDomCaptureSession({ signal });

        try {
            for (const p of platforms) {
                for (let s = 1; s <= totalSlides; s++) {
                    assertNotAborted(signal);
                    setExportStatus(onStatus, `[${++count}/${total}] Rendering ${p} S${s}...`);

                    const blob = await session.capture(
                        <NewsCard draft={draft} step={s} platform={p} />,
                        {
                            width: OMNI_CONFIG[p].width,
                            height: OMNI_CONFIG[p].height,
                            pixelRatio: 2,
                            backgroundColor: "#050505",
                            style: { transform: "none", transition: "none" },
                            timeoutMessage: `RENDER_TIMEOUT: ${p} Slide ${s} timed out after 8s.`,
                        },
                        signal
                    );
                    assertNotAborted(signal);
                    if (!blob || blob.size < 1000) throw new Error(`RENDER_FAULT: Captured blank output for ${p} Slide ${s}.`);

                    const platformCode = p === "instagram" ? "IG" : p === "square" ? "FB" : "TT";
                    const slideAnchor = s === 1 ? anchorKW : s === 2 ? sanitize(draft.category) : sanitize(draft.extraSlides?.[s - 3]?.heading || "angle");
                    zip.file(`${`${platformCode}${s}-${brandTag}-${anchorKW}-${slideAnchor}`.substring(0, 146)}.png`, blob);
                }
            }
        } finally {
            session.dispose();
        }

        assertNotAborted(signal);
        setExportStatus(onStatus, "Packaging Institutional Bundle...");
        const content = await zip.generateAsync({ type: "blob" });
        assertNotAborted(signal);
        const headlineSlug = sanitize((draft.headline || "").split(" ").slice(0, 5).join("-")) || anchorKW;
        downloadBlob(content, `TPE-${headlineSlug}.zip`);
        setExportStatus(onStatus, "Complete! 🎉", 3000);
    } catch (e: unknown) {
        if (isAbortError(e) || signal?.aborted) {
            clearExportStatusTimer();
            throw e;
        }
        setExportStatus(onStatus, `ERROR: ${e instanceof Error ? e.message : "Export Failed"}`);
        throw e;
    }
};
