import JSZip from "jszip";
import { VideoDraft, VideoAspectRatio, getSceneBoundaries, getVideoHeadingPreset, isSharedReHookScene, downloadBlob } from "@/types/news";
import { VIDEO_FORMAT_CONFIGS } from "@/config/omnichannel";
import { VideoCard } from "@/components/templates/VideoCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";
import { createDomCaptureSession, setExportStatus } from "./exportEngine";

const isAbortError = (err: unknown): boolean =>
    (err instanceof DOMException && err.name === "AbortError")
    || (err instanceof Error && err.name === "AbortError");

/** Exports transparent PNG overlays for TikTok 9:16, 4:5, and 16:9 canvases. */
export const runVideoOverlayExport = async (
    draft: VideoDraft,
    onStatus: (s: string | null) => void,
    signal?: AbortSignal
) => {
    setExportStatus(onStatus, "Initializing Institutional Overlay Pipeline...");
    const aspectRatios: VideoAspectRatio[] = ["9:16", "4:5", "16:9"];
    const zip = new JSZip();

    try {
        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "video");
        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - VIDEO OVERLAY BUNDLE\n\nANCHOR: ${anchorKW}\nCATEGORY: ${draft.category}\nTAG: the-pakistan-edit-video`);

        const session = await createDomCaptureSession({ transparent: true });
        try {
            for (let i = 0; i < aspectRatios.length; i++) {
                if (signal?.aborted) return;
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
                if (signal?.aborted) return;
                if (blob) zip.file(`overlay_tiktok_${aspectRatio.replace(':', 'x')}_${format.width}x${format.height}_${sanitize(anchorKW)}.png`, blob);
            }
        } finally {
            session.dispose();
        }

        if (signal?.aborted) return;
        onStatus("Generating ZIP Archive...");
        const zipBlob = await zip.generateAsync({ type: "blob" });
        if (signal?.aborted) return;
        downloadBlob(zipBlob, `tpe-video-overlays-${anchorKW}.zip`);
        setExportStatus(onStatus, "Overlays exported successfully!", 1500);
    } catch (err: unknown) {
        if (signal?.aborted || isAbortError(err)) {
            setExportStatus(onStatus, null);
            return;
        }
        console.error("VIDEO_OVERLAY_EXPORT_ERROR:", err);
        setExportStatus(onStatus, `Export Error: ${err instanceof Error ? err.message : "Unknown export error"}`, 4000);
    }
};

/** Exports a broadcast-grade H.264 / 48kHz AAC MP4 via native server-side FFmpeg compositing. */
export const runVideoMP4Export = async (
    draft: VideoDraft,
    onStatus: (s: string | null) => void,
    signal?: AbortSignal
) => {
    const dimensions = VIDEO_FORMAT_CONFIGS[draft.aspectRatio] ?? VIDEO_FORMAT_CONFIGS['9:16'];
    const { width, height } = dimensions;
    const scenes = draft.scenes?.length ? draft.scenes : [];
    const headingPreset = getVideoHeadingPreset(draft, draft.aspectRatio);

    try {
        setExportStatus(onStatus, "Preparing broadcast MP4 export...");
        if (!draft.videoUrl?.includes('/api/video/ingest')) {
            throw new Error(
                draft.videoUrl?.startsWith('blob:')
                    ? "Final MP4 compositing requires the local FFmpeg studio server — use PNG Overlays (.ZIP) or run locally for MP4 export."
                    : "Please upload a video clip first so FFmpeg can composite the stream."
            );
        }

        const sceneBounds = getSceneBoundaries(scenes);
        const outroStart = sceneBounds.length > 0 ? sceneBounds[sceneBounds.length - 1]!.end : 0;
        const formData = new FormData();
        // Omit large in-memory PTS & keyframe timestamp arrays from the multipart export payload
        const exportDraft = { ...draft, sourceFrameIndex: undefined, sourceKeyframeTimes: undefined };
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
            // Content-keyed cache avoids re-capturing identical 1080x1920 PNGs (e.g. Anchored 01. Hook + 02. Re-Hook)
            const overlayCache = new Map<string, Blob>();
            for (let i = 0; i < scenes.length; i++) {
                if (signal?.aborted) return;
                const s = scenes[i]!;
                const isShared = isSharedReHookScene(scenes, i);
                const textScene = isShared ? scenes[0]! : s;
                const resolvedSource = s.sourceName || draft.sourceName || "";
                const resolvedCredit = s.creditName || draft.creditName || "";
                const cacheKey = JSON.stringify([
                    textScene.title || "",
                    textScene.subtitle || "",
                    resolvedSource,
                    resolvedCredit,
                    draft.category || "",
                    headingPreset,
                ]);
                let ovBlob = overlayCache.get(cacheKey);
                if (!ovBlob) {
                    setExportStatus(onStatus, `Rendering overlay ${i + 1}/${scenes.length}...`);
                    ovBlob = await captureOverlay(
                        { ...draft, headline: textScene.title, subtitle: textScene.subtitle, sourceName: resolvedSource, creditName: resolvedCredit },
                        sceneBounds[i]!.start
                    );
                    overlayCache.set(cacheKey, ovBlob);
                }
                if (signal?.aborted) return;
                formData.append(`overlay_${i}`, ovBlob, `overlay_${i}.png`);

                if (s.mediaUrl && (s.mediaUrl.startsWith("data:") || s.mediaUrl.startsWith("blob:"))) {
                    const mediaBlob = await fetch(s.mediaUrl, { signal }).then((r) => r.blob());
                    formData.append(`sceneMedia_${i}`, mediaBlob, `scene_${i}`);
                }
            }

            if (draft.enableOutro) {
                if (signal?.aborted) return;
                setExportStatus(onStatus, "Rendering branded outro card...");
                const outroBlob = await captureOverlay({ ...draft, scenes: [], enableOutro: true }, outroStart);
                formData.append("outroOverlay", outroBlob, "outro.png");
            }
        } finally {
            session.dispose();
        }

        if (signal?.aborted) return;
        setExportStatus(onStatus, "Rendering crisp H.264 + 48kHz AAC MP4 via FFmpeg...");
        const response = await fetch("/api/video/export", { method: "POST", body: formData, signal });
        if (!response.ok) {
            const errPayload = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(errPayload.error || `Export failed (${response.status})`);
        }

        const mp4Blob = await response.blob();
        if (signal?.aborted) return;
        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "video");
        downloadBlob(mp4Blob, `the-pakistan-edit-${anchorKW}.mp4`);
        setExportStatus(onStatus, "✅ Broadcast MP4 exported!", 2000);
    } catch (err: unknown) {
        if (signal?.aborted || isAbortError(err)) {
            setExportStatus(onStatus, null);
            return;
        }
        console.error("VIDEO_MP4_EXPORT_ERROR:", err);
        setExportStatus(onStatus, `Export Error: ${err instanceof Error ? err.message : "Unknown export error"}`, 4000);
    }
};
