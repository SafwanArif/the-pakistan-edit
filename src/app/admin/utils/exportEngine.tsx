import JSZip from "jszip";
import { getFontEmbedCSS, toBlob } from "html-to-image";
import { Draft, getSlideCount, downloadBlob } from "../../../types/news";
import { OMNI_CONFIG, Platform } from "../../../config/omnichannel";
import React from "react";
import { NewsCard } from "../../../components/templates/NewsCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";

/** Renders a DOM node to a PNG Blob with an explicit timeout guard. */
export const renderNodeToBlobWithTimeout = (
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

/**
 * Institutional Export Engine: Deterministic Asset Generation Pipeline
 * v2027.Simplified: Streamlined root management and centralized naming.
 */
export const runExportEngine = async (draft: Draft, onStatus: (s: string | null) => void) => {
    onStatus("Initializing Institutional Pipeline...");
    
    const totalSlides = getSlideCount(draft);
    const platforms: Platform[] = ["tiktok", "instagram", "square"];
    const zip = new JSZip();

    try {
        const container = document.getElementById('export-capture-surface');
        if (!container) throw new Error("CRITICAL_FAULT: Capture surface not found in DOM.");

        const anchorKW = getAnchorKeyword(draft.headline);
        const brandTag = "the-pakistan-edit";

        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - SEO BUNDLE\n\nANCHOR: ${anchorKW}\nTAG: ${brandTag}`);

        let count = 0;
        const total = platforms.length * totalSlides;
        const { createRoot } = await import("react-dom/client");

        // Single render root per export batch
        const temp = document.createElement("div");
        temp.style.position = "fixed";
        temp.style.top = "0";
        temp.style.left = "0";
        temp.style.zIndex = "-9999";
        container.appendChild(temp);
        const root = createRoot(temp);
        let cachedFontEmbedCSS: string | undefined;

        try {
            for (const p of platforms) {
                for (let s = 1; s <= totalSlides; s++) {
                    count++;
                    onStatus(`[${count}/${total}] Rendering ${p} S${s}...`);
                    
                    temp.style.width = `${OMNI_CONFIG[p].width}px`;
                    temp.style.height = `${OMNI_CONFIG[p].height}px`;

                    root.render(
                        <div id="export-freeze-frame">
                            <style>{`* { transition: none !important; animation: none !important; }`}</style>
                            <NewsCard draft={draft} step={s} platform={p} />
                        </div>
                    );
                    
                    await document.fonts.ready;
                    
                    // Wait for all images in the card to fully load deterministically (with 8s safety timeout)
                    await new Promise<void>((resolve) => {
                        requestAnimationFrame(() => {
                            const images = Array.from(temp.querySelectorAll('img'));
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
                            images.forEach(img => {
                                if (img.complete) check();
                                else {
                                    img.onload = check;
                                    img.onerror = check;
                                }
                            });
                        });
                    });

                    // Final font & frame paint flush
                    await document.fonts.ready;
                    await new Promise(r => requestAnimationFrame(r));
                    if (cachedFontEmbedCSS === undefined) {
                        cachedFontEmbedCSS = await getFontEmbedCSS(temp, { cacheBust: false }).catch(() => "");
                    }

                    const blob = await renderNodeToBlobWithTimeout(
                        temp,
                        {
                            width: OMNI_CONFIG[p].width,
                            height: OMNI_CONFIG[p].height,
                            pixelRatio: 2,
                            cacheBust: false,
                            fontEmbedCSS: cachedFontEmbedCSS || undefined,
                            backgroundColor: '#050505',
                            style: { transform: 'none', transition: 'none' }
                        },
                        8000,
                        `RENDER_TIMEOUT: ${p} Slide ${s} timed out after 8s.`
                    );

                    if (!blob || blob.size < 1000) {
                        throw new Error(`RENDER_FAULT: Captured blank output for ${p} Slide ${s}.`);
                    }

                    const platformCode = p === "instagram" ? "IG" : p === "square" ? "FB" : "TT";
                    const slideAnchor = s === 1 ? anchorKW : (s === 2 ? sanitize(draft.category) : sanitize(draft.extraSlides?.[s-3]?.heading || "angle"));
                    const fileName = `${platformCode}${s}-${brandTag}-${anchorKW}-${slideAnchor}.png`.substring(0, 150);

                    zip.file(fileName, blob);
                }
            }
        } finally {
            root.unmount();
            temp.remove();
        }

        onStatus("Packaging Institutional Bundle...");
        const content = await zip.generateAsync({ type: "blob" });
        downloadBlob(content, `TPE-${sanitize(draft.headline.split(' ').slice(0, 5).join('-'))}.zip`);
        
        onStatus("Complete! 🎉");
        setTimeout(() => onStatus(null), 3000);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Export Failed";
        onStatus(`ERROR: ${msg}`);
        throw e;
    }
};
