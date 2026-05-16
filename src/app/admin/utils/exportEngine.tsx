import JSZip from "jszip";
import { toBlob } from "html-to-image";
import { Draft, getSlideCount } from "../../../types/news";
import { OMNI_CONFIG, Platform } from "../../../config/omnichannel";
import React from "react";
import { NewsCard } from "../../../components/templates/instagram/NewsCard/index";
import { sanitize, getGoldKeywords, getAnchorKeyword } from "./textUtils";

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

        // 🏛️ 2027 Optimized: Single render root per export batch
        const temp = document.createElement("div");
        temp.style.position = "absolute";
        temp.style.insetInlineStart = "-5000px";
        container.appendChild(temp);
        const root = createRoot(temp);

        for (const p of platforms) {
            for (let s = 1; s <= totalSlides; s++) {
                count++;
                onStatus(`[${count}/${total}] Rendering ${p} S${s}...`);
                
                temp.style.width = `${OMNI_CONFIG[p].width}px`;
                temp.style.height = `${OMNI_CONFIG[p].height}px`;

                // 🏛️ Fixed: NewsCard props mapping
                root.render(<NewsCard draft={draft} step={s} platform={p} />);
                
                await new Promise(r => setTimeout(r, 200)); 
                await document.fonts.ready;
                
                // Wait for all images in the card to load
                const images = Array.from(temp.querySelectorAll('img'));
                await Promise.all(images.map(img => {
                    if (img.complete) return Promise.resolve();
                    return new Promise(resolve => { img.onload = resolve; img.onerror = resolve; });
                }));

                await new Promise(r => requestAnimationFrame(r));
                
                const blob = await toBlob(temp, { 
                    width: OMNI_CONFIG[p].width, 
                    height: OMNI_CONFIG[p].height, 
                    pixelRatio: 1, 
                    backgroundColor: '#050505',
                    style: { transform: 'none', transition: 'none' }
                });

                if (!blob || blob.size < 1000) {
                    throw new Error(`RENDER_FAULT: Captured blank output for ${p} Slide ${s}.`);
                }

                // 🏛️ Deterministic Naming
                const platformCode = p === "instagram" ? "IG" : p === "square" ? "FB" : "TT";
                const slideAnchor = s === 1 ? anchorKW : (s === 2 ? sanitize(draft.category) : sanitize(draft.extraSlides?.[s-3]?.heading || "angle"));
                const fileName = `${platformCode}${s}-${brandTag}-${anchorKW}-${slideAnchor}.png`.substring(0, 150);

                zip.file(fileName, blob);
            }
        }

        onStatus("Packaging Institutional Bundle...");
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(content);
        link.href = url;
        link.download = `TPE-${sanitize(draft.headline.split(' ').slice(0, 5).join('-'))}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        
        root.unmount();
        container.removeChild(temp);
        
        onStatus("Complete! 🎉");
        setTimeout(() => onStatus(null), 3000);
    } catch (e: any) {
        onStatus(`ERROR: ${e.message || "Export Failed"}`);
        throw e;
    }
};
