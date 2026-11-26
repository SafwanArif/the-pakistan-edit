import JSZip from "jszip";
import { getFontEmbedCSS, toBlob } from "html-to-image";
import { Draft, getSlideCount, downloadBlob } from "@/types/news";
import { OMNI_CONFIG, Platform } from "@/config/omnichannel";
import React from "react";
import { NewsCard } from "@/components/templates/NewsCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";

let statusClearTimer: ReturnType<typeof setTimeout> | null = null;

/** Updates an export status banner and cancels any previously scheduled auto-clear timer. */
export const setExportStatus = (onStatus: (s: string | null) => void, msg: string | null, autoClearMs?: number) => {
    if (statusClearTimer !== null) {
        clearTimeout(statusClearTimer);
        statusClearTimer = null;
    }
    onStatus(msg);
    if (autoClearMs && msg !== null) {
        statusClearTimer = setTimeout(() => {
            statusClearTimer = null;
            onStatus(null);
        }, autoClearMs);
    }
};

/** Renders a DOM node to a PNG Blob with an explicit timeout guard. */
const renderNodeToBlobWithTimeout = (
    node: HTMLElement,
    options: Parameters<typeof toBlob>[1],
    timeoutMs: number,
    timeoutMessage: string
): Promise<Blob | null> =>
    new Promise<Blob | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
        toBlob(node, options).then(
            (b) => { clearTimeout(timer); resolve(b); },
            (err) => { clearTimeout(timer); reject(err); }
        );
    });

/** Waits deterministically for all `<img>` nodes inside `node` to settle and flushes two paint frames. */
const waitForCaptureReady = async (node: HTMLElement): Promise<void> => {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            const images = Array.from(node.querySelectorAll("img"));
            if (images.length === 0) {
                resolve();
                return;
            }
            let settled = false;
            let loaded = 0;
            const finish = () => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve();
            };
            const timer = setTimeout(finish, 8000);
            const check = () => {
                loaded++;
                if (loaded >= images.length) finish();
            };
            images.forEach((img) => {
                if (img.complete) check();
                else {
                    img.onload = check;
                    img.onerror = check;
                }
            });
        });
    });
    await new Promise((r) => requestAnimationFrame(r));
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
        }
    ) => Promise<Blob | null>;
    dispose: () => void;
}

/**
 * Shared off-screen React capture session inside `#export-capture-surface`.
 * Caches `getFontEmbedCSS()` once per batch and waits deterministically for fonts, images, and paint frames.
 */
export const createDomCaptureSession = async (
    options: { fallbackToBody?: boolean; transparent?: boolean } = {}
): Promise<DomCaptureSession> => {
    const container = document.getElementById("export-capture-surface")
        ?? (options.fallbackToBody ? document.body : null);
    if (!container) throw new Error("CRITICAL_FAULT: Capture surface not found in DOM.");

    await document.fonts.ready;
    const { createRoot } = await import("react-dom/client");
    const temp = document.createElement("div");
    temp.style.cssText = `position:fixed;top:0;left:0;z-index:-9999;pointer-events:none;${options.transparent ? "background:transparent;" : ""}`;
    container.appendChild(temp);
    const root = createRoot(temp);
    let cachedFontEmbedCSS: string | undefined;

    return {
        async capture(element, config) {
            temp.style.width = `${config.width}px`;
            temp.style.height = `${config.height}px`;
            root.render(
                <div id="export-freeze-frame" style={options.transparent ? { background: "transparent" } : undefined}>
                    <style>{`* { transition: none !important; animation: none !important; }`}</style>
                    {element}
                </div>
            );
            await waitForCaptureReady(temp);
            if (cachedFontEmbedCSS === undefined) {
                cachedFontEmbedCSS = await getFontEmbedCSS(temp, { cacheBust: false }).catch(() => "");
            }
            return renderNodeToBlobWithTimeout(
                temp,
                {
                    width: config.width,
                    height: config.height,
                    pixelRatio: config.pixelRatio,
                    quality: config.quality,
                    cacheBust: false,
                    fontEmbedCSS: cachedFontEmbedCSS || undefined,
                    backgroundColor: config.backgroundColor,
                    skipAutoScale: config.skipAutoScale,
                    style: config.style,
                },
                8000,
                config.timeoutMessage
            );
        },
        dispose() {
            root.unmount();
            temp.remove();
        },
    };
};

/**
 * Deterministic multi-platform Carousel PNG bundle exporter (`pixelRatio: 2`, cached fonts).
 */
export const runExportEngine = async (draft: Draft, onStatus: (s: string | null) => void) => {
    setExportStatus(onStatus, "Initializing Institutional Pipeline...");
    
    const totalSlides = getSlideCount(draft);
    const platforms: Platform[] = ["tiktok", "instagram", "square"];
    const zip = new JSZip();

    try {
        const anchorKW = getAnchorKeyword(draft.headline);
        const brandTag = "the-pakistan-edit";

        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - SEO BUNDLE\n\nANCHOR: ${anchorKW}\nTAG: ${brandTag}`);

        let count = 0;
        const total = platforms.length * totalSlides;
        const session = await createDomCaptureSession();

        try {
            for (const p of platforms) {
                for (let s = 1; s <= totalSlides; s++) {
                    count++;
                    setExportStatus(onStatus, `[${count}/${total}] Rendering ${p} S${s}...`);

                    const blob = await session.capture(
                        <NewsCard draft={draft} step={s} platform={p} />,
                        {
                            width: OMNI_CONFIG[p].width,
                            height: OMNI_CONFIG[p].height,
                            pixelRatio: 2,
                            backgroundColor: "#050505",
                            style: { transform: "none", transition: "none" },
                            timeoutMessage: `RENDER_TIMEOUT: ${p} Slide ${s} timed out after 8s.`,
                        }
                    );

                    if (!blob || blob.size < 1000) {
                        throw new Error(`RENDER_FAULT: Captured blank output for ${p} Slide ${s}.`);
                    }

                    const platformCode = p === "instagram" ? "IG" : p === "square" ? "FB" : "TT";
                    const slideAnchor = s === 1 ? anchorKW : (s === 2 ? sanitize(draft.category) : sanitize(draft.extraSlides?.[s-3]?.heading || "angle"));
                    const fileStem = `${platformCode}${s}-${brandTag}-${anchorKW}-${slideAnchor}`.substring(0, 146);
                    const fileName = `${fileStem}.png`;

                    zip.file(fileName, blob);
                }
            }
        } finally {
            session.dispose();
        }

        setExportStatus(onStatus, "Packaging Institutional Bundle...");
        const content = await zip.generateAsync({ type: "blob" });
        const zipSlug = sanitize(draft.headline.split(' ').slice(0, 5).join('-')) || anchorKW;
        downloadBlob(content, `TPE-${zipSlug}.zip`);
        
        setExportStatus(onStatus, "Complete! 🎉", 3000);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Export Failed";
        setExportStatus(onStatus, `ERROR: ${msg}`);
        throw e;
    }
};
