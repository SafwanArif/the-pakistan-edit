import JSZip from "jszip";
import { getFontEmbedCSS } from "html-to-image";
import { VideoDraft, getSceneBoundaries, isSharedReHookScene, downloadBlob } from "../../../types/news";
import { OMNI_CONFIG, Platform, VIDEO_PLATFORM_CONFIGS, aspectRatioToPlatform } from "../../../config/omnichannel";
import React from "react";
import { VideoCard } from "../../../components/templates/instagram/VideoCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";
import { renderNodeToBlobWithTimeout } from "./exportEngine";

/** Exports transparent PNG overlays for 9:16, 4:5, and 1:1 canvases. */
export const runVideoOverlayExport = async (draft: VideoDraft, onStatus: (s: string | null) => void) => {
    onStatus("Initializing Institutional Overlay Pipeline...");
    const platforms: Platform[] = ["tiktok", "instagram", "square"];
    const zip = new JSZip();

    try {
        const container = document.getElementById('export-capture-surface');
        if (!container) throw new Error("CRITICAL_FAULT: Capture surface not found in DOM.");

        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "video");
        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - VIDEO OVERLAY BUNDLE\n\nANCHOR: ${anchorKW}\nCATEGORY: ${draft.category}\nTAG: the-pakistan-edit-video`);

        const { createRoot } = await import("react-dom/client");
        const temp = document.createElement("div");
        temp.style.cssText = "position:fixed;top:0;left:0;z-index:-9999;background:transparent;";
        container.appendChild(temp);
        const root = createRoot(temp);
        let cachedFontEmbedCSS: string | undefined;

        try {
            for (let i = 0; i < platforms.length; i++) {
                const p = platforms[i]!;
                const dimensions = VIDEO_PLATFORM_CONFIGS[p] || OMNI_CONFIG[p];
                onStatus(`[${i + 1}/${platforms.length}] Rendering ${p} Overlay...`);
                temp.style.width = `${dimensions.width}px`;
                temp.style.height = `${dimensions.height}px`;

                root.render(
                    <div id="export-freeze-frame" style={{ background: 'transparent' }}>
                        <style>{`* { transition: none !important; animation: none !important; }`}</style>
                        <VideoCard draft={draft} platform={p} overlayOnly={true} />
                    </div>
                );

                await document.fonts.ready;
                await new Promise((r) => setTimeout(r, 200));
                if (cachedFontEmbedCSS === undefined) {
                    cachedFontEmbedCSS = await getFontEmbedCSS(temp, { cacheBust: false }).catch(() => "");
                }

                const blob = await renderNodeToBlobWithTimeout(
                    temp,
                    {
                        width: dimensions.width,
                        height: dimensions.height,
                        pixelRatio: 1,
                        quality: 1,
                        cacheBust: false,
                        fontEmbedCSS: cachedFontEmbedCSS || undefined,
                        backgroundColor: 'transparent',
                        skipAutoScale: true,
                    },
                    8000,
                    `Overlay render timed out for ${p}.`
                );
                if (blob) zip.file(`overlay_${p}_${dimensions.width}x${dimensions.height}_${sanitize(anchorKW)}.png`, blob);
            }
        } finally {
            root.unmount();
            temp.remove();
        }

        onStatus("Generating ZIP Archive...");
        const zipBlob = await zip.generateAsync({ type: "blob" });
        downloadBlob(zipBlob, `tpe-video-overlays-${anchorKW}.zip`);
        onStatus("Overlays exported successfully!");
        setTimeout(() => onStatus(null), 1500);
    } catch (err: unknown) {
        console.error("VIDEO_OVERLAY_EXPORT_ERROR:", err);
        onStatus(`Export Error: ${err instanceof Error ? err.message : "Unknown export error"}`);
        setTimeout(() => onStatus(null), 4000);
    }
};

/** Exports a broadcast-grade H.264 / 48kHz AAC MP4 via native server-side FFmpeg compositing. */
export const runVideoMP4Export = async (draft: VideoDraft, onStatus: (s: string | null) => void) => {
    const targetPlatform = aspectRatioToPlatform(draft.aspectRatio);
    const dimensions = VIDEO_PLATFORM_CONFIGS[targetPlatform] || OMNI_CONFIG[targetPlatform];
    const { width, height } = dimensions;
    const scenes = draft.scenes?.length ? draft.scenes : [];

    try {
        if (!draft.videoUrl?.includes('/api/video/ingest')) {
            throw new Error("Please upload a video clip first so FFmpeg can composite the stream.");
        }

        const sceneBounds = getSceneBoundaries(scenes);
        const outroStart = sceneBounds.length > 0 ? sceneBounds[sceneBounds.length - 1]!.end : 0;
        const formData = new FormData();
        formData.append("draft", JSON.stringify(draft));

        const { createRoot } = await import("react-dom/client");
        const container = document.getElementById('export-capture-surface') ?? document.body;
        const temp = document.createElement("div");
        temp.style.cssText = `position:fixed;top:0;left:0;z-index:-9999;background:transparent;width:${width}px;height:${height}px;pointer-events:none;`;
        container.appendChild(temp);
        const root = createRoot(temp);

        let cachedFontEmbedCSS: string | undefined;
        const captureOverlay = async (overrideDraft: VideoDraft, currentTime: number): Promise<Blob> => {
            root.render(
                <div style={{ background: 'transparent' }}>
                    <style>{`* { transition: none !important; animation: none !important; }`}</style>
                    <VideoCard draft={{ ...overrideDraft, showSubtitles: false }} platform={targetPlatform} overlayOnly={true} currentTime={currentTime} />
                </div>
            );
            await document.fonts.ready;
            await new Promise((r) => setTimeout(r, 150));
            if (cachedFontEmbedCSS === undefined) {
                cachedFontEmbedCSS = await getFontEmbedCSS(temp, { cacheBust: false }).catch(() => "");
            }
            const blob = await renderNodeToBlobWithTimeout(
                temp,
                {
                    width,
                    height,
                    pixelRatio: 1,
                    cacheBust: false,
                    fontEmbedCSS: cachedFontEmbedCSS || undefined,
                    backgroundColor: 'transparent',
                    skipAutoScale: true,
                },
                8000,
                "Scene overlay render timed out after 8s."
            );
            if (!blob) throw new Error("Scene overlay render failed — DOM fonts not loaded.");
            return blob;
        };

        try {
            for (let i = 0; i < scenes.length; i++) {
                onStatus(`Rendering overlay ${i + 1}/${scenes.length}...`);
                const s = scenes[i]!;
                const isShared = isSharedReHookScene(scenes, i);
                const textScene = isShared ? scenes[0]! : s;
                const ovBlob = await captureOverlay(
                    { ...draft, headline: textScene.title, subtitle: textScene.subtitle, sourceName: s.sourceName || draft.sourceName, creditName: s.creditName || draft.creditName },
                    sceneBounds[i]!.start
                );
                formData.append(`overlay_${i}`, ovBlob, `overlay_${i}.png`);

                if (s.mediaUrl && (s.mediaUrl.startsWith("data:") || s.mediaUrl.startsWith("blob:"))) {
                    const mediaBlob = await fetch(s.mediaUrl).then((r) => r.blob());
                    formData.append(`sceneMedia_${i}`, mediaBlob, `scene_${i}`);
                }
            }

            if (draft.enableOutro) {
                onStatus("Rendering branded outro card...");
                const outroBlob = await captureOverlay({ ...draft, scenes: [], enableOutro: true }, outroStart);
                formData.append("outroOverlay", outroBlob, "outro.png");
            }
        } finally {
            root.unmount();
            temp.remove();
        }

        onStatus("Rendering crisp H.264 + 48kHz AAC MP4 via FFmpeg...");
        const response = await fetch("/api/video/export", { method: "POST", body: formData });
        if (!response.ok) {
            const errPayload = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(errPayload.error || `Export failed (${response.status})`);
        }

        const mp4Blob = await response.blob();
        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "video");
        downloadBlob(mp4Blob, `the-pakistan-edit-${anchorKW}.mp4`);
        onStatus("✅ Broadcast MP4 exported!");
        setTimeout(() => onStatus(null), 2000);
    } catch (err: unknown) {
        console.error("VIDEO_MP4_EXPORT_ERROR:", err);
        onStatus(`Export Error: ${err instanceof Error ? err.message : "Unknown export error"}`);
        setTimeout(() => onStatus(null), 4000);
    }
};
