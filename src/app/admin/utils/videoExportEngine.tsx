import JSZip from "jszip";
import { VideoDraft, VideoAspectRatio, getSceneBoundaries, isSharedReHookScene, downloadBlob } from "../../../types/news";
import { VIDEO_FORMAT_CONFIGS } from "../../../config/omnichannel";
import React from "react";
import { VideoCard } from "../../../components/templates/VideoCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";
import { createDomCaptureSession } from "./exportEngine";

/** Exports transparent PNG overlays for TikTok 9:16, 4:5, and 16:9 canvases. */
export const runVideoOverlayExport = async (draft: VideoDraft, onStatus: (s: string | null) => void) => {
    onStatus("Initializing Institutional Overlay Pipeline...");
    const aspectRatios: VideoAspectRatio[] = ["9:16", "4:5", "16:9"];
    const zip = new JSZip();

    try {
        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "video");
        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - VIDEO OVERLAY BUNDLE\n\nANCHOR: ${anchorKW}\nCATEGORY: ${draft.category}\nTAG: the-pakistan-edit-video`);

        const session = await createDomCaptureSession({ transparent: true });
        try {
            for (let i = 0; i < aspectRatios.length; i++) {
                const aspectRatio = aspectRatios[i]!;
                const format = VIDEO_FORMAT_CONFIGS[aspectRatio];
                onStatus(`[${i + 1}/${aspectRatios.length}] Rendering ${format.label} Overlay...`);

                const blob = await session.capture(
                    <VideoCard draft={{ ...draft, aspectRatio }} overlayOnly={true} />,
                    {
                        width: format.width,
                        height: format.height,
                        pixelRatio: 1,
                        quality: 1,
                        backgroundColor: "transparent",
                        skipAutoScale: true,
                        timeoutMessage: `Overlay render timed out for ${format.label}.`,
                    }
                );
                if (blob) zip.file(`overlay_tiktok_${aspectRatio.replace(':', 'x')}_${format.width}x${format.height}_${sanitize(anchorKW)}.png`, blob);
            }
        } finally {
            session.dispose();
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
    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio] ?? VIDEO_FORMAT_CONFIGS['9:16'];
    const { width, height } = dimensions;
    const scenes = draft.scenes?.length ? draft.scenes : [];

    try {
        if (!draft.videoUrl?.includes('/api/video/ingest')) {
            throw new Error("Please upload a video clip first so FFmpeg can composite the stream.");
        }

        const sceneBounds = getSceneBoundaries(scenes);
        const outroStart = sceneBounds.length > 0 ? sceneBounds[sceneBounds.length - 1]!.end : 0;
        const formData = new FormData();
        // Omit large in-memory sourceFrameIndex PTS arrays from the multipart export payload
        const exportDraft = { ...draft, sourceFrameIndex: undefined };
        formData.append("draft", JSON.stringify(exportDraft));

        const session = await createDomCaptureSession({ fallbackToBody: true, transparent: true });
        const captureOverlay = async (overrideDraft: VideoDraft, currentTime: number): Promise<Blob> => {
            const blob = await session.capture(
                <VideoCard draft={{ ...overrideDraft, showSubtitles: false }} overlayOnly={true} currentTime={currentTime} />,
                {
                    width,
                    height,
                    pixelRatio: 1,
                    backgroundColor: "transparent",
                    skipAutoScale: true,
                    timeoutMessage: "Scene overlay render timed out after 8s.",
                }
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
            session.dispose();
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
