import { useState, useRef, useEffect, useCallback } from 'react';
import {
    VideoDraft,
    VideoAspectRatio,
    createDefaultVideoDraft,
    getDefaultVideoFraming,
    getTotalVideoDuration,
    calculatePsychologyPacedScenes,
    ensureUniqueSceneIds,
    getSceneBoundaries,
    type SourceFrameIndex,
    type SourceMediaInfo,
    type VideoFraming,
} from '../../../types/news';
import { del, get, set } from 'idb-keyval';
import { useDebouncedIdbSave } from './useDebouncedIdbSave';
import { canUseServerIngest, deleteServerCachedVideo } from '../utils/serverCapabilities';

/** Clears clip-specific state (subtitles, keyframes, star cues, master clipStartOffsets, probe metadata) when loading a new video. */
export const resetClipBoundFields = (draft: VideoDraft): VideoDraft => ({
    ...draft,
    subtitles: [],
    keyframes: [],
    starCues: undefined,
    sourceFps: undefined,
    sourceFrameLogUrl: undefined,
    sourceFrameIndex: undefined,
    sourceMediaInfo: undefined,
    scenes: (draft.scenes || []).map((s) => {
        if (s.mediaUrl || s.clipStartOffset === undefined) return s;
        const copy = { ...s };
        delete copy.clipStartOffset;
        return copy;
    }),
});

const revokeDraftBlobUrls = (draft: VideoDraft) => {
    if (draft.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.videoUrl);
    for (const s of draft.scenes || []) {
        if (s.mediaUrl?.startsWith('blob:')) URL.revokeObjectURL(s.mediaUrl);
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

/** Strips bulky in-memory PTS arrays before writing drafts to IndexedDB. */
const toPersistableDraft = (draft: VideoDraft): VideoDraft => {
    if (!draft.sourceFrameIndex) return draft;
    const { sourceFrameIndex: _omit, ...rest } = draft;
    void _omit;
    return rest;
};

const uploadWithTelemetry = (
    formData: FormData,
    onStatus: (msg: string) => void,
    signal?: AbortSignal
): Promise<{ url: string; fps: number; frameIndexUrl?: string; mediaInfo?: SourceMediaInfo }> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Upload aborted"));
            return;
        }
        const xhr = new XMLHttpRequest();
        let parsedOffset = 0;
        let finalUrl = "";
        let finalFps = 30;
        let finalFrameIndexUrl: string | undefined;
        let finalMediaInfo: SourceMediaInfo | undefined;
        let settled = false;

        const finishReject = (err: Error) => {
            if (settled) return;
            settled = true;
            signal?.removeEventListener("abort", onAbort);
            try { xhr.abort(); } catch {}
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
                        const evt = JSON.parse(line) as { stage?: string; url?: string; fps?: number | string; frameIndexUrl?: string; mediaInfo?: SourceMediaInfo; error?: string };
                        if (evt.error) {
                            finishReject(new Error(evt.error));
                            return;
                        }
                        if (evt.stage) onStatus(evt.stage);
                        if (evt.url) finalUrl = evt.url;
                        if (evt.frameIndexUrl) finalFrameIndexUrl = evt.frameIndexUrl;
                        if (evt.mediaInfo) finalMediaInfo = evt.mediaInfo;
                        if (evt.fps !== undefined) {
                            const parsedFps = Number(evt.fps);
                            if (Number.isFinite(parsedFps) && parsedFps > 0) finalFps = parsedFps;
                        }
                    } catch { /* wait for complete line */ }
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
                resolve({ url: finalUrl, fps: finalFps, frameIndexUrl: finalFrameIndexUrl, mediaInfo: finalMediaInfo });
            } else {
                settled = true;
                reject(new Error(`Ingest failed (${xhr.status})`));
            }
        };
        xhr.onerror = () => finishReject(new Error("Network error during video ingest"));
        xhr.send(formData);
    });

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
            const aspectRatio: VideoAspectRatio = vid.videoWidth && vid.videoHeight
                ? (vid.videoHeight / vid.videoWidth >= 1.5
                    ? '9:16'
                    : vid.videoWidth / vid.videoHeight >= 1.5
                        ? '16:9'
                        : '4:5')
                : '4:5';
            const duration = vid.duration && !Number.isNaN(vid.duration) && vid.duration > 0 ? vid.duration : 60;
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

/**
 * Local-first state orchestrator for Video drafts with synchronised multi-preview playback
 * and disk-backed HTTP 206 byte-range video streaming (bit-for-bit original quality).
 */
export const useVideoDraftState = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [videoDraft, setVideoDraft] = useState<VideoDraft>(createDefaultVideoDraft());
    const [isOptimisingVideo, setIsOptimisingVideo] = useState(false);
    const [ingestStatus, setIngestStatus] = useState<string | null>(null);

    // Playback state synchronised across all preview cards
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [seekNonce, setSeekNonce] = useState(0);
    const [playbackMode, setPlaybackMode] = useState<'play-all' | 'loop-angle'>('play-all');
    const isMuted = Boolean(videoDraft.isMuted);

    const { scheduleSave: scheduleDraftSave, saveNow: saveDraftNow } = useDebouncedIdbSave<VideoDraft>('tpe_video_draft', toPersistableDraft);
    const ingestAbortRef = useRef<AbortController | null>(null);
    const sceneBoundsRef = useRef(getSceneBoundaries(videoDraft.scenes));
    const rVfcAnchorRef = useRef<{ time: number; perfNow: number } | null>(null);

    useEffect(() => {
        sceneBoundsRef.current = getSceneBoundaries(videoDraft.scenes);
    }, [videoDraft.scenes]);

    useEffect(() => {
        return () => ingestAbortRef.current?.abort();
    }, []);
    const videoDraftRef = useRef<VideoDraft>(videoDraft);
    const currentTimeRef = useRef(currentTime);
    const playbackModeRef = useRef(playbackMode);
    const migrationStartedRef = useRef(false);

    useEffect(() => {
        videoDraftRef.current = videoDraft;
        currentTimeRef.current = currentTime;
        playbackModeRef.current = playbackMode;
    }, [videoDraft, currentTime, playbackMode]);

    const totalDuration = getTotalVideoDuration(videoDraft);
    const scenesDuration = (videoDraft.scenes || []).reduce((acc, s) => acc + (s.duration || 0), 0);
    const isOutroActive = Boolean(videoDraft.enableOutro && currentTime >= scenesDuration);
    const activeSceneIsImage = (() => {
        let elapsed = 0;
        for (const s of videoDraft.scenes || []) {
            const next = elapsed + (s.duration || 0);
            if (currentTime >= elapsed && currentTime < next) return s.mediaType === 'image';
            elapsed = next;
        }
        return false;
    })();

    const updateVideoDraft = useCallback(async (newDraft: VideoDraft) => {
        setVideoDraft(newDraft);
        scheduleDraftSave(newDraft);
    }, [scheduleDraftSave]);

    /** Uploads a video blob to `/api/video/ingest` for untouched HTTP 206 byte-range streaming (or loads directly as `blob:` on serverless). */
    const ingestVideoBlob = useCallback(async (
        blob: Blob,
        name?: string,
        options?: { preserveScenes?: boolean }
    ) => {
        const displayName =
            name || (blob instanceof File ? blob.name : videoDraftRef.current.videoName) || "Imported Video.mp4";
        const previousUrl = videoDraftRef.current.videoUrl;
        ingestAbortRef.current?.abort();
        const controller = new AbortController();
        ingestAbortRef.current = controller;

        const commitLocalBlobFallback = async () => {
            if (options?.preserveScenes) return;
            if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
            else deleteServerCachedVideo(previousUrl);
            const fallbackUrl = URL.createObjectURL(blob);
            setIngestStatus("PROBING ASPECT RATIO & DURATION...");
            const meta = await probeVideoMetadata(fallbackUrl);
            if (controller.signal.aborted) {
                URL.revokeObjectURL(fallbackUrl);
                return;
            }
            const base = resetClipBoundFields(videoDraftRef.current);
            const clipDuration = meta?.duration ?? base.videoDuration ?? 60;
            try {
                await set('tpe_video_blob', blob);
            } catch (quotaErr) {
                console.warn("IDB_VIDEO_BLOB_QUOTA_SKIPPED:", quotaErr);
            }
            await updateVideoDraft({
                ...base,
                videoUrl: fallbackUrl,
                videoName: displayName,
                videoDuration: clipDuration,
                aspectRatio: meta?.aspectRatio ?? base.aspectRatio,
                scenes: calculatePsychologyPacedScenes(clipDuration, base.scenes),
            });
        };

        setIsOptimisingVideo(true);
        setIngestStatus("PREPARING STREAM...");
        if (!options?.preserveScenes) {
            setIsPlaying(false);
            setCurrentTime(0);
        }

        try {
            const serverIngestAvailable = await canUseServerIngest();
            if (controller.signal.aborted) return;
            if (!serverIngestAvailable) {
                await commitLocalBlobFallback();
                return;
            }

            setIngestStatus("PREPARING UPLOAD STREAM...");
            const formData = new FormData();
            formData.append('file', blob, displayName);

            const upload = await uploadWithTelemetry(formData, (stage) => setIngestStatus(stage), controller.signal);
            const url = upload.url;
            setIngestStatus("PROBING ASPECT RATIO & DURATION...");
            const meta = await probeVideoMetadata(url);
            if (controller.signal.aborted) return;
            const current = options?.preserveScenes ? videoDraftRef.current : resetClipBoundFields(videoDraftRef.current);

            const nextRatio = options?.preserveScenes
                ? current.aspectRatio
                : (meta?.aspectRatio ?? current.aspectRatio);
            const clipDuration = meta?.duration ?? current.videoDuration ?? 60;
            const nextScenes = options?.preserveScenes && current.scenes?.length
                ? current.scenes
                : calculatePsychologyPacedScenes(clipDuration, current.scenes);

            let sourceFrameIndex: SourceFrameIndex | undefined = undefined;
            if (upload.frameIndexUrl) {
                try {
                    const frameIndexResponse = await fetch(upload.frameIndexUrl, { signal: controller.signal });
                    if (frameIndexResponse.ok) {
                        sourceFrameIndex = await frameIndexResponse.json() as SourceFrameIndex;
                    }
                } catch (err) {
                    if (err instanceof DOMException && err.name === 'AbortError') throw err;
                    console.warn("SOURCE_FRAME_INDEX_LOAD_FAILED", err);
                }
            }

            const nextDraft: VideoDraft = {
                ...current,
                videoUrl: url,
                videoName: displayName,
                videoDuration: clipDuration,
                sourceFps: upload.fps,
                sourceFrameLogUrl: upload.frameIndexUrl,
                sourceFrameIndex,
                sourceMediaInfo: upload.mediaInfo,
                aspectRatio: nextRatio,
                scenes: nextScenes,
            };

            if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
            else if (!options?.preserveScenes && previousUrl && previousUrl !== url) deleteServerCachedVideo(previousUrl);
            await del('tpe_video_blob').catch(() => {});
            await updateVideoDraft(nextDraft);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            if (err instanceof Error && err.message === 'Upload aborted') return;
            console.error("VIDEO_INGEST_CLIENT_ERROR:", err);
            await commitLocalBlobFallback();
        } finally {
            if (ingestAbortRef.current === controller) {
                setIsOptimisingVideo(false);
                setIngestStatus(null);
            }
        }
    }, [updateVideoDraft]);

    useEffect(() => {
        let cancelled = false;
        const init = async () => {
            let draft = createDefaultVideoDraft();
            const savedDraft = await get<VideoDraft>('tpe_video_draft');
            const savedBlob = await get<Blob>('tpe_video_blob');
            let pendingMigrationBlob: Blob | undefined;

            if (savedDraft) {
                draft = normalizeHydratedVideoDraft(savedDraft, draft);
                if (savedBlob && !draft.videoUrl?.startsWith('/api/video/ingest')) {
                    pendingMigrationBlob = savedBlob;
                } else if (draft.videoUrl?.startsWith('blob:') && !savedBlob) {
                    draft.videoUrl = "";
                    draft.videoName = "";
                }
            } else if (savedBlob) {
                pendingMigrationBlob = savedBlob;
            }

            if (cancelled) return;
            if (pendingMigrationBlob && (!draft.videoUrl || draft.videoUrl.startsWith('blob:'))) {
                draft.videoUrl = URL.createObjectURL(pendingMigrationBlob);
            }
            setVideoDraft(draft);
            setIsMounted(true);

            // Lazily rehydrate sourceFrameIndex in memory without bloating IndexedDB
            if (draft.sourceFrameLogUrl && !draft.sourceFrameIndex) {
                const frameUrl = draft.sourceFrameLogUrl;
                void fetch(frameUrl).then(async (res) => {
                    if (!res.ok || cancelled) return;
                    const idx = await res.json() as SourceFrameIndex;
                    if (!cancelled) {
                        setVideoDraft((curr) => (curr.sourceFrameLogUrl === frameUrl ? { ...curr, sourceFrameIndex: idx } : curr));
                    }
                }).catch(() => {});
            }

            // Validate that a persisted local server video still exists on disk (self-heals wiped `.next/cache`)
            if (draft.videoUrl?.startsWith('/api/video/ingest')) {
                const cachedUrl = draft.videoUrl;
                void fetch(cachedUrl, { method: 'HEAD' }).then((res) => {
                    if (!cancelled && res.status === 404) {
                        setVideoDraft((curr) => {
                            if (curr.videoUrl !== cachedUrl) return curr;
                            const healed: VideoDraft = {
                                ...curr,
                                videoUrl: "",
                                videoName: "",
                                sourceFrameLogUrl: undefined,
                                sourceFrameIndex: undefined,
                            };
                            scheduleDraftSave(healed);
                            return healed;
                        });
                    }
                }).catch(() => {});
            }

            if (pendingMigrationBlob && !migrationStartedRef.current) {
                migrationStartedRef.current = true;
                if (await canUseServerIngest()) {
                    void ingestVideoBlob(pendingMigrationBlob, draft.videoName, { preserveScenes: true });
                }
            }
        };
        void init();
        return () => { cancelled = true; };
    }, [ingestVideoBlob, scheduleDraftSave]);

    // Native-VSync rAF timeline clock (60/120/144/240Hz): glides playheads & telemetry smoothly even on 24/30fps video, Photo scenes, or Outro
    useEffect(() => {
        if (!isPlaying) {
            rVfcAnchorRef.current = null;
            return;
        }
        const hasNativeVideo = !!videoDraft.videoUrl;
        let animId = 0;
        let lastReactPushNow = performance.now();

        const tick = (now: number) => {
            const elapsedPushMs = now - lastReactPushNow;
            const pushIntervalMs = (!hasNativeVideo || isOutroActive || activeSceneIsImage) ? 32 : 100;
            // Pace React root state updates to 10Hz (~100ms, matching 0.1s MM:SS.d timecode resolution) during native video playback;
            // all VideoCard motion (zoom, pan, posY, ambient, fades, progress bar, logo) runs at full 120/144Hz via rAF refs.
            if (elapsedPushMs >= pushIntervalMs) {
                const pushDt = elapsedPushMs / 1000;
                lastReactPushNow = now;
                if (!hasNativeVideo || isOutroActive || activeSceneIsImage) {
                    setCurrentTime((prev: number) => {
                        const next = prev + pushDt;
                        let resolved = next;
                        if (playbackModeRef.current === 'loop-angle') {
                            const active = sceneBoundsRef.current.find(b => prev >= b.start && prev < b.end);
                            if (active && next >= active.end) {
                                resolved = active.start;
                            } else if (totalDuration > 0 && next >= totalDuration) {
                                resolved = 0;
                            }
                        } else if (totalDuration > 0 && next >= totalDuration) {
                            resolved = 0;
                        }
                        currentTimeRef.current = resolved;
                        return resolved;
                    });
                } else {
                    const anchor = rVfcAnchorRef.current;
                    if (anchor) {
                        const elapsed = Math.min(0.12, Math.max(0, (now - anchor.perfNow) / 1000));
                        const rawTarget = totalDuration > 0 ? Math.min(totalDuration, anchor.time + elapsed) : anchor.time + elapsed;
                        // Never extrapolate across an upcoming scene cut before requestVideoFrameCallback executes the deck swap
                        const activeScene = sceneBoundsRef.current.find(b => anchor.time >= b.start && anchor.time < b.end);
                        const target = activeScene ? Math.min(rawTarget, activeScene.end - 0.001) : rawTarget;
                        currentTimeRef.current = target;
                        setCurrentTime((prev: number) => {
                            const diff = target - prev;
                            if (Math.abs(diff) >= 0.08) return target;
                            if (diff > 0.002) return target;
                            return prev;
                        });
                    }
                }
            }

            animId = requestAnimationFrame(tick);
        };

        animId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animId);
    }, [isPlaying, totalDuration, videoDraft.videoUrl, isOutroActive, activeSceneIsImage]);

    const togglePlay = useCallback(() => {
        setIsPlaying((prev: boolean) => !prev);
    }, []);

    const seekTo = useCallback((time: number) => {
        rVfcAnchorRef.current = { time, perfNow: performance.now() };
        setCurrentTime(time);
        setSeekNonce((n) => n + 1);
    }, []);

    const toggleMute = useCallback(() => {
        const nextDraft: VideoDraft = {
            ...videoDraftRef.current,
            isMuted: !videoDraftRef.current.isMuted
        };
        void updateVideoDraft(nextDraft);
    }, [updateVideoDraft]);

    const syncTimeFromVideo = useCallback((mediaTime: number, mediaDuration?: number) => {
        if (playbackModeRef.current === 'loop-angle') {
            const prev = currentTimeRef.current;
            const active = sceneBoundsRef.current.find(b => prev >= b.start && prev < b.end);
            if (active && mediaTime >= active.end - 0.04) {
                seekTo(active.start);
                return;
            }
        }
        if (totalDuration > 0 && mediaTime >= totalDuration) {
            seekTo(0);
            return;
        }

        const now = performance.now();
        const prevAnchor = rVfcAnchorRef.current;
        const expectedT = prevAnchor
            ? prevAnchor.time + Math.min(0.12, Math.max(0, (now - prevAnchor.perfNow) / 1000))
            : currentTimeRef.current;
        const isJump = Math.abs(mediaTime - expectedT) >= 0.22;
        rVfcAnchorRef.current = { time: mediaTime, perfNow: now };

        if (isJump) {
            currentTimeRef.current = mediaTime;
            setCurrentTime(mediaTime);
        }

        if (mediaDuration && mediaDuration > 0 && !Number.isNaN(mediaDuration)) {
            const prevDraft = videoDraftRef.current;
            if (!prevDraft.videoDuration || Math.abs(prevDraft.videoDuration - mediaDuration) > 1.5) {
                const updated: VideoDraft = { ...prevDraft, videoDuration: mediaDuration };
                setVideoDraft(updated);
                scheduleDraftSave(updated);
            }
        }
    }, [totalDuration, seekTo, scheduleDraftSave]);

    const clearVideo = useCallback(async () => {
        ingestAbortRef.current?.abort();
        ingestAbortRef.current = null;
        setIsOptimisingVideo(false);
        setIngestStatus(null);
        setIsPlaying(false);
        setCurrentTime(0);
        const current = videoDraftRef.current;
        if (current.videoUrl?.startsWith('blob:')) URL.revokeObjectURL(current.videoUrl);
        else deleteServerCachedVideo(current.videoUrl);
        await del('tpe_video_blob').catch(() => {});
        await updateVideoDraft({
            ...resetClipBoundFields(current),
            videoUrl: "",
            videoName: "",
            videoDuration: undefined,
            sourceName: "",
            creditName: "",
        });
    }, [updateVideoDraft]);

    const resetVideoDraft = useCallback(async () => {
        ingestAbortRef.current?.abort();
        ingestAbortRef.current = null;
        setIsOptimisingVideo(false);
        setIngestStatus(null);
        const current = videoDraftRef.current;
        revokeDraftBlobUrls(current);
        deleteServerCachedVideo(current.videoUrl);
        const defaultDraft = createDefaultVideoDraft();
        setVideoDraft(defaultDraft);
        setIsPlaying(false);
        setCurrentTime(0);
        await saveDraftNow(defaultDraft);
        await del('tpe_video_blob').catch(() => {});
    }, [saveDraftNow]);

    return {
        isMounted, videoDraft, updateVideoDraft, clearVideo, resetVideoDraft, isOptimisingVideo, ingestStatus, ingestVideoBlob,
        isPlaying, setIsPlaying, togglePlay, playbackMode, setPlaybackMode, currentTime, currentTimeRef, seekNonce,
        setCurrentTime, seekTo, isMuted, toggleMute, syncTimeFromVideo
    };
};
