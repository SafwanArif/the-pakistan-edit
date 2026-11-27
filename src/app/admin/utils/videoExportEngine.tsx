import JSZip from "jszip";
import { VideoDraft, VideoAspectRatio, getSceneBoundaries, getVideoHeadingPreset, isSharedReHookScene, downloadBlob } from "@/types/news";
import { VIDEO_FORMAT_CONFIGS } from "@/config/omnichannel";
import { VideoCard } from "@/components/templates/VideoCard/index";
import { sanitize, getAnchorKeyword } from "./textUtils";
import { assertNotAborted, createDomCaptureSession, isAbortError, setExportStatus } from "./exportEngine";

const handleVideoExportCatch = (err: unknown, signal: AbortSignal | undefined, onStatus: (s: string | null) => void, tag: string) => {
    if (signal?.aborted || isAbortError(err)) {
        setExportStatus(onStatus, null);
        return;
    }
    console.error(tag, err);
    setExportStatus(onStatus, `Export Error: ${err instanceof Error ? err.message : "Unknown export error"}`);
};

/** Exports transparent PNG overlays for TikTok 9:16, 4:5, and 16:9 canvases (`pixelRatio: 1`, cached fonts). */
export const runVideoOverlayExport = async (
    draft: VideoDraft,
    onStatus: (s: string | null) => void,
    signal?: AbortSignal
) => {
    setExportStatus(onStatus, "Initializing Institutional Overlay Pipeline...");
    const aspectRatios: VideoAspectRatio[] = ["9:16", "4:5", "16:9"];
    const zip = new JSZip();

    try {
        assertNotAborted(signal);
        const anchorKW = getAnchorKeyword(draft.headline || draft.category || "video");
        zip.file("seo-metadata.txt", `THE PAKISTAN EDIT - VIDEO OVERLAY BUNDLE\n\nANCHOR: ${anchorKW}\nCATEGORY: ${draft.category}\nTAG: the-pakistan-edit-video`);

        const session = await createDomCaptureSession({ transparent: true, signal });
        try {
            for (let i = 0; i < aspectRatios.length; i++) {
                assertNotAborted(signal);
                const aspectRatio = aspectRatios[i]!;
                const format = VIDEO_FORMAT_CONFIGS[aspectRatio];
                setExportStatus(onStatus, `[${i + 1}/${aspectRatios.length}] Rendering ${format.label} Overlay...`);

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
                    },
                    signal
                );
                assertNotAborted(signal);
                if (!blob || blob.size === 0) throw new Error(`Overlay render failed for ${format.label}.`);
                zip.file(`overlay_tiktok_${aspectRatio.replace(":", "x")}_${format.width}x${format.height}_${sanitize(anchorKW)}.png`, blob);
            }
        } finally {
            session.dispose();
        }

        assertNotAborted(signal);
        setExportStatus(onStatus, "Generating ZIP Archive...");
        const zipBlob = await zip.generateAsync({ type: "blob" });
        assertNotAborted(signal);
        downloadBlob(zipBlob, `tpe-video-overlays-${anchorKW}.zip`);
        setExportStatus(onStatus, "Overlays exported successfully!", 1500);
    } catch (err: unknown) {
        handleVideoExportCatch(err, signal, onStatus, "VIDEO_OVERLAY_EXPORT_ERROR:");
    }
};

/** Exports a broadcast-grade H.264 / 48kHz AAC MP4 via native server-side FFmpeg compositing. */
export const runVideoMP4Export = async (
    draft: VideoDraft,
    onStatus: (s: string | null) => void,
    signal?: AbortSignal
) => {
    const { width, height } = VIDEO_FORMAT_CONFIGS[draft.aspectRatio] ?? VIDEO_FORMAT_CONFIGS["9:16"];
    const scenes = draft.scenes?.length ? draft.scenes : [];
    const headingPreset = getVideoHeadingPreset(draft, draft.aspectRatio);

    try {
        assertNotAborted(signal);
        setExportStatus(onStatus, "Preparing broadcast MP4 export...");
        if (!draft.videoUrl?.includes("/api/video/ingest")) {
            throw new Error(
                draft.videoUrl?.startsWith("blob:")
                    ? "Final MP4 compositing requires the local FFmpeg studio server — use PNG Overlays (.ZIP) or run locally for MP4 export."
                    : "Please upload a video clip first so FFmpeg can composite the stream."
            );
        }
        if (scenes.length === 0 && !draft.enableOutro) throw new Error("Add at least one scene before exporting.");

        const sceneBounds = getSceneBoundaries(scenes);
        const outroStart = sceneBounds.length > 0 ? sceneBounds[sceneBounds.length - 1]!.end : 0;
        const formData = new FormData();
        const exportDraft = { ...draft, sourceFrameIndex: undefined, sourceKeyframeTimes: undefined };
        formData.append("draft", JSON.stringify(exportDraft));

        const session = await createDomCaptureSession({ fallbackToBody: true, transparent: true, signal });
        const captureOverlay = async (overrideDraft: VideoDraft, currentTime: number): Promise<Blob> => {
            const blob = await session.capture(
                <VideoCard draft={{ ...overrideDraft, showSubtitles: false }} overlayOnly={true} currentTime={currentTime} />,
                {
                    width, height, pixelRatio: 1, backgroundColor: "transparent",
                    skipAutoScale: true, timeoutMessage: "Scene overlay render timed out after 8s.",
                },
                signal
            );
            assertNotAborted(signal);
            if (!blob || blob.size === 0) throw new Error("Scene overlay render failed — DOM fonts not loaded.");
            return blob;
        };

        try {
            const overlayCache = new Map<string, Blob>();
            for (let i = 0; i < scenes.length; i++) {
                assertNotAborted(signal);
                const s = scenes[i]!;
                const textScene = isSharedReHookScene(scenes, i) ? scenes[0]! : s;
                const resolvedSource = s.sourceName || draft.sourceName || "";
                const resolvedCredit = s.creditName || draft.creditName || "";
                const sceneStart = sceneBounds[i]!.start;
                const cacheKey = JSON.stringify([
                    textScene.title || "", textScene.subtitle || "", resolvedSource, resolvedCredit,
                    draft.category || "", headingPreset, sceneStart < 1.8,
                ]);
                let ovBlob = overlayCache.get(cacheKey);
                if (!ovBlob) {
                    setExportStatus(onStatus, `Rendering overlay ${i + 1}/${scenes.length}...`);
                    ovBlob = await captureOverlay(
                        { ...draft, headline: textScene.title, subtitle: textScene.subtitle, sourceName: resolvedSource, creditName: resolvedCredit },
                        sceneStart
                    );
                    overlayCache.set(cacheKey, ovBlob);
                }
                assertNotAborted(signal);
                formData.append(`overlay_${i}`, ovBlob, `overlay_${i}.png`);

                if (s.mediaUrl && (s.mediaUrl.startsWith("data:") || s.mediaUrl.startsWith("blob:"))) {
                    const mediaRes = await fetch(s.mediaUrl, { signal });
                    if (!mediaRes.ok) throw new Error(`Failed to read scene ${i + 1} media (${mediaRes.status}).`);
                    const mediaBlob = await mediaRes.blob();
                    if (mediaBlob.size === 0) throw new Error(`Scene ${i + 1} media is empty.`);
                    formData.append(`sceneMedia_${i}`, mediaBlob, `scene_${i}`);
                }
            }

            if (draft.enableOutro) {
                assertNotAborted(signal);
                setExportStatus(onStatus, "Rendering branded outro card...");
                const outroBlob = await captureOverlay({ ...draft, scenes: [], enableOutro: true }, outroStart);
                assertNotAborted(signal);
                formData.append("outroOverlay", outroBlob, "outro.png");
            }
        } finally {
            session.dispose();
        }

        assertNotAborted(signal);
        setExportStatus(onStatus, "Rendering crisp H.264 + 48kHz AAC MP4 via FFmpeg...");
        const response = await fetch("/api/video/export", { method: "POST", body: formData, signal });
        if (!response.ok) {
            const errPayload = await response.json().catch(() => ({})) as { error?: string };
            throw new Error(errPayload.error || `Export failed (${response.status})`);
        }

        const mp4Blob = await response.blob();
        assertNotAborted(signal);
        downloadBlob(mp4Blob, `the-pakistan-edit-${getAnchorKeyword(draft.headline || draft.category || "video")}.mp4`);
        setExportStatus(onStatus, "✅ Broadcast MP4 exported!", 2000);
    } catch (err: unknown) {
        handleVideoExportCatch(err, signal, onStatus, "VIDEO_MP4_EXPORT_ERROR:");
    }
};
