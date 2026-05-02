import JSZip from "jszip";
import { toBlob } from "html-to-image";
import { Draft, getSlideCount } from "../../../types/news";
import { OMNI_CONFIG, Platform } from "../../../config/omnichannel";
import React from "react";
import { NewsCard } from "../../../components/templates/instagram/NewsCard/index";

/**
 * Institutional Export Engine: Deterministic Asset Generation Pipeline
 */
export const runExportEngine = async (draft: Draft, onStatus: (s: string | null) => void) => {
    onStatus("Initializing Export Engine...");
    const totalSlides = getSlideCount(draft);
    const platforms: Platform[] = ["tiktok", "instagram", "square"];
    const zip = new JSZip();

    try {
        const container = document.getElementById('export-capture-surface');
        if (!container) throw new Error("Capture surface fault");

        const sanitize = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        const getGold = (t: string) => [...new Set((t.match(/\*([^*]+)\*/g) || []).map(m => sanitize(m.replace(/\*/g, ''))))];

        const anchorKW = getGold(draft.headline)[0] || sanitize(draft.headline.split(' ').slice(0, 3).join('-')) || "news";
        const brandTag = "the-pakistan-edit";

        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - SEO BUNDLE\n\nANCHOR: ${anchorKW}\nTAG: ${brandTag}`);

        let count = 0;
        const total = platforms.length * totalSlides;
        const { createRoot } = await import("react-dom/client");

        for (const p of platforms) {
            for (let s = 1; s <= totalSlides; s++) {
                count++;
                onStatus(`[${count}/${total}] Rendering ${p} S${s}...`);
                
                const temp = document.createElement("div");
                temp.style.inlineSize = `${OMNI_CONFIG[p].width}px`;
                temp.style.blockSize = `${OMNI_CONFIG[p].height}px`;
                container.innerHTML = ""; container.appendChild(temp);

                const root = createRoot(temp);
                root.render(<NewsCard {...draft} slide={s} platform={p} totalSlides={totalSlides} />);
                
                await new Promise(r => requestAnimationFrame(r));
                await document.fonts.ready;
                
                const images = Array.from(temp.querySelectorAll('img'));
                await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; })));

                await new Promise(r => setTimeout(r, 50));
                
                const blob = await toBlob(temp, { width: OMNI_CONFIG[p].width, height: OMNI_CONFIG[p].height, pixelRatio: 1, backgroundColor: '#050505', cacheBust: true });
                if (!blob) throw new Error(`Render fault: ${p} S${s}`);

                const platformCode = p === "instagram" ? "IG" : p === "square" ? "FB" : "TT";
                const curText = s === 1 ? draft.headline : s === 2 ? (draft.summary || "") : `${draft.extraSlides?.[s-3]?.heading} ${draft.extraSlides?.[s-3]?.content}`;
                const kwCurrent = getGold(curText).filter(k => k !== anchorKW);
                
                let fileName = `${platformCode}${s}-${brandTag}-${anchorKW}${kwCurrent.length > 0 ? `-${kwCurrent.join('-')}` : ""}.png`;
                if (fileName.length > 150) fileName = fileName.substring(0, 146) + ".png";

                zip.file(fileName, blob);
                root.unmount();
            }
        }

        onStatus("Packaging Bundle...");
        const content = await zip.generateAsync({ type: "blob" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(content);
        link.href = url;
        link.download = `TPE-${sanitize(draft.headline.split(' ').slice(0, 5).join('-'))}.zip`;
        link.click();
        URL.revokeObjectURL(url);
        
        onStatus("Complete! 🎉");
        setTimeout(() => onStatus(null), 2500);
    } catch (e) {
        console.error("EXPORT_ENGINE_CRITICAL:", e);
        throw e;
    }
};
