import {
    createDefaultVideoDraft,
    ensureUniqueSceneIds,
    getDefaultVideoFraming,
    type SourceMediaInfo,
    type VideoAspectRatio,
    type VideoDraft,
    type VideoFraming,
} from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";

/** Clears clip-specific state (subtitles, keyframes, star cues, master clipStartOffsets, probe metadata) when loading a new video. */
export const resetClipBoundFields = (draft: VideoDraft): VideoDraft => ({
    ...draft,
    subtitles: [],
    keyframes: [],
    starCues: undefined,
    sourceFps: undefined,
    sourceFrameLogUrl: undefined,
    sourceFrameIndex: undefined,
    sourceKeyframeTimes: undefined,
    sourceMediaInfo: undefined,
    scenes: (draft.scenes || []).map((s) => {
        if (s.mediaUrl || s.clipStartOffset === undefined) return s;
        const copy = { ...s };
        delete copy.clipStartOffset;
        return copy;
    }),
});

export const revokeDraftBlobUrls = (draft: VideoDraft): void => {
    revokeBlobUrl(draft.videoUrl);
    for (const s of draft.scenes || []) {
        revokeBlobUrl(s.mediaUrl);
    }
};

/** Migrates legacy `/api/video/ingest/frame-index?name=...` URLs to the active `?frameIndex=...` route. */
const normalizeFrameLogUrl = (raw?: string): string | undefined => {
    if (!raw) return undefined;
    try {
        const parsed = new URL(raw, "http://localhost");
        if (parsed.pathname === "/api/video/ingest/frame-index") {
            const name = parsed.searchParams.get("name");
            return name ? `/api/video/ingest?frameIndex=${encodeURIComponent(name)}` : undefined;
        }
        return raw;
    } catch {
        return raw;
    }
};

/** Strips bulky in-memory PTS & keyframe timestamp arrays before writing drafts to IndexedDB. */
export const toPersistableDraft = (draft: VideoDraft): VideoDraft => {
    if (!draft.sourceFrameIndex && !draft.sourceKeyframeTimes) return draft;
    const { sourceFrameIndex: _omitFrame, sourceKeyframeTimes: _omitKf, ...rest } = draft;
    void _omitFrame;
    void _omitKf;
    return rest;
};

export const uploadWithTelemetry = (
    formData: FormData,
    onStatus: (msg: string) => void,
    signal?: AbortSignal
): Promise<{ url: string; fps: number; duration?: number; frameIndexUrl?: string; mediaInfo?: SourceMediaInfo }> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Upload aborted"));
            return;
        }
        const xhr = new XMLHttpRequest();
        let parsedOffset = 0;
        let finalUrl = "";
        let finalFps = 30;
        let finalDuration: number | undefined;
        let finalFrameIndexUrl: string | undefined;
        let finalMediaInfo: SourceMediaInfo | undefined;
        let settled = false;

        const finishReject = (err: Error) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            try { xhr.abort(); } catch { /* ignore already-closed XHR */ }
            reject(err);
        };

        const onAbort = () => finishReject(new Error("Upload aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });

        const parseChunk = () => {
            const text = xhr.responseText || "";
            const lines = text.slice(parsedOffset).split("\n");
            if (lines.length > 1) {
                parsedOffset = text.lastIndexOf("\n") + 1;
                for (const line of lines.slice(0, -1)) {
                    if (!line.trim()) continue;
                    try {
                        const evt = JSON.parse(line) as { stage?: string; url?: string; fps?: number | string; duration?: number | string; frameIndexUrl?: string; mediaInfo?: SourceMediaInfo; error?: string };
                        if (evt.error) {
                            finishReject(new Error(evt.error));
                            return;
                        }
                        if (evt.stage) onStatus(evt.stage);
                        if (evt.url) finalUrl = evt.url;
                        if (evt.frameIndexUrl) finalFrameIndexUrl = evt.frameIndexUrl;
                        if (evt.mediaInfo) finalMediaInfo = evt.mediaInfo;
                        if (evt.duration !== undefined) {
                            const parsedDur = Number(evt.duration);
                            if (Number.isFinite(parsedDur) && parsedDur > 0) finalDuration = parsedDur;
                        }
                        if (evt.fps !== undefined) {
                            const parsedFps = Number(evt.fps);
                            if (Number.isFinite(parsedFps) && parsedFps > 0) finalFps = parsedFps;
                        }
                    } catch { /* wait for complete NDJSON line */ }
                }
            }
        };

        xhr.open("POST", "/api/video/ingest");
        xhr.setRequestHeader("Accept", "application/x-ndjson");
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const pct = Math.min(99, Math.round((e.loaded / e.total) * 100));
                onStatus(`UPLOADING STREAM (${pct}%)...`);
            }
        };
        xhr.onprogress = parseChunk;
        xhr.onload = () => {
            parseChunk();
            if (settled) return;
            signal?.removeEventListener("abort", onAbort);
            if (xhr.status >= 200 && xhr.status < 300 && finalUrl) {
                settled = true;
                resolve({ url: finalUrl, fps: finalFps, duration: finalDuration, frameIndexUrl: finalFrameIndexUrl, mediaInfo: finalMediaInfo });
            } else {
                settled = true;
                reject(new Error(`Ingest failed (${xhr.status})`));
            }
        };
        xhr.onerror = () => finishReject(new Error("Network error during video ingest"));
        xhr.send(formData);
    });

export const inferAspectRatioFromDimensions = (width?: number, height?: number): VideoAspectRatio | null => {
    if (!width || !height || width <= 0 || height <= 0) return null;
    if (height / width >= 1.5) return '9:16';
    if (width / height >= 1.5) return '16:9';
    return '4:5';
};

export const probeVideoMetadata = (url: string): Promise<{ aspectRatio: VideoAspectRatio; duration: number } | null> =>
    new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        let settled = false;
        const finish = (result: { aspectRatio: VideoAspectRatio; duration: number } | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            vid.onloadedmetadata = null;
            vid.onerror = null;
            vid.removeAttribute('src');
            vid.load();
            resolve(result);
        };
        const timer = setTimeout(() => finish(null), 8000);
        vid.onloadedmetadata = () => {
            const aspectRatio: VideoAspectRatio = inferAspectRatioFromDimensions(vid.videoWidth, vid.videoHeight) ?? '4:5';
            const duration = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 60;
            finish({ aspectRatio, duration });
        };
        vid.onerror = () => finish(null);
        vid.src = url;
    });

/** Normalizes hydrated IndexedDB drafts by restoring missing/duplicate scenes and sorting keyframes and star cues ascending by time. */
export const normalizeHydratedVideoDraft = (
    savedDraft: Omit<Partial<VideoDraft>, 'aspectRatio'> & { aspectRatio?: VideoAspectRatio | '1:1' },
    baseDraft: VideoDraft = createDefaultVideoDraft()
): VideoDraft => {
    const draft: VideoDraft = {
        ...baseDraft,
        ...savedDraft,
        aspectRatio: savedDraft.aspectRatio === '1:1' ? '16:9' : (savedDraft.aspectRatio ?? baseDraft.aspectRatio),
    };
    const defaultFramingByRatio: Partial<Record<VideoAspectRatio, VideoFraming>> = {
        ...baseDraft.defaultFramingByRatio,
        ...savedDraft.defaultFramingByRatio,
    };
    const hasLegacyFraming = savedDraft.zoom !== undefined || savedDraft.posX !== undefined || savedDraft.posY !== undefined;
    if (!savedDraft.defaultFramingByRatio?.[draft.aspectRatio] && hasLegacyFraming) {
        const ratioDefaults = draft.aspectRatio === '4:5'
            ? { zoom: 0, posX: 50, posY: 100 }
            : { zoom: 100, posX: 50, posY: 100 };
        const base = baseDraft.defaultFramingByRatio?.[draft.aspectRatio] ?? ratioDefaults;
        defaultFramingByRatio[draft.aspectRatio] = {
            zoom: savedDraft.zoom ?? base.zoom,
            posX: savedDraft.posX ?? base.posX,
            posY: savedDraft.posY ?? base.posY,
        };
    }
    draft.defaultFramingByRatio = defaultFramingByRatio;
    const activeFraming = getDefaultVideoFraming(draft, draft.aspectRatio);
    draft.zoom = activeFraming.zoom;
    draft.posX = activeFraming.posX;
    draft.posY = activeFraming.posY;
    draft.sourceFrameLogUrl = normalizeFrameLogUrl(draft.sourceFrameLogUrl);
    if (!draft.scenes || draft.scenes.length === 0) {
        draft.scenes = baseDraft.scenes;
    } else {
        draft.scenes = ensureUniqueSceneIds(draft.scenes).map((s) =>
            s.mediaUrl?.startsWith('blob:')
                ? { ...s, mediaUrl: undefined, mediaName: undefined, mediaType: 'video' }
                : s
        );
    }
    if (draft.keyframes?.length) {
        draft.keyframes = [...draft.keyframes].sort((a, b) => a.time - b.time);
    }
    if (draft.starCues?.length) {
        draft.starCues = [...draft.starCues].sort((a, b) => a.time - b.time);
    }
    return draft;
};
