import { useState, useRef, useEffect, useCallback } from 'react';
import {
    VideoDraft,
    VideoAspectRatio,
    createDefaultVideoDraft,
    getTotalVideoDuration,
    calculatePsychologyPacedScenes,
    ensureUniqueSceneIds,
    getSceneBoundaries,
    type VideoFraming,
} from '../../../types/news';
import { get, set } from 'idb-keyval';

const uploadWithTelemetry = (
    formData: FormData,
    onStatus: (msg: string) => void,
    signal?: AbortSignal
): Promise<{ url: string; fps: number; frameIndexUrl?: string }> =>
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
                        const evt = JSON.parse(line) as { stage?: string; url?: string; fps?: string; frameIndexUrl?: string; error?: string };
                        if (evt.error) {
                            finishReject(new Error(evt.error));
                            return;
                        }
                        if (evt.stage) onStatus(evt.stage);
                        if (evt.url) finalUrl = evt.url;
                        if (evt.frameIndexUrl) finalFrameIndexUrl = evt.frameIndexUrl;
                        if (evt.fps) {
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
                resolve({ url: finalUrl, fps: finalFps, frameIndexUrl: finalFrameIndexUrl });
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
    if (!draft.scenes || draft.scenes.length === 0) {
        draft.scenes = baseDraft.scenes;
    } else {
        draft.scenes = ensureUniqueSceneIds(draft.scenes);
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

    const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
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

        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        saveTimeout.current = setTimeout(async () => {
            await set('tpe_video_draft', newDraft);
        }, 150);
    }, []);

    /** Uploads a video blob to `/api/video/ingest` for untouched HTTP 206 byte-range streaming. */
    const ingestVideoBlob = useCallback(async (
        blob: Blob,
        name?: string,
        options?: { preserveScenes?: boolean }
    ) => {
        setIsOptimisingVideo(true);
        setIngestStatus("PREPARING UPLOAD STREAM...");
        if (!options?.preserveScenes) {
            setIsPlaying(false);
            setCurrentTime(0);
        }

        const displayName =
            name || (blob instanceof File ? blob.name : videoDraftRef.current.videoName) || "Imported Video.mp4";
        const previousUrl = videoDraftRef.current.videoUrl;
        ingestAbortRef.current?.abort();
        const controller = new AbortController();
        ingestAbortRef.current = controller;

        try {
            const formData = new FormData();
            formData.append('file', blob, displayName);

            const upload = await uploadWithTelemetry(formData, (stage) => setIngestStatus(stage), controller.signal);
            const url = upload.url;
            setIngestStatus("PROBING ASPECT RATIO & DURATION...");
            const meta = await probeVideoMetadata(url);
            const current = videoDraftRef.current;

            const nextRatio = options?.preserveScenes
                ? current.aspectRatio
                : (meta?.aspectRatio ?? current.aspectRatio);
            const clipDuration = meta?.duration ?? current.videoDuration ?? 60;
            const nextScenes = options?.preserveScenes && current.scenes?.length
                ? current.scenes
                : calculatePsychologyPacedScenes(clipDuration, current.scenes);

            let sourceFrameIndex = undefined;
            if (upload.frameIndexUrl) {
                try {
                    const frameIndexResponse = await fetch(upload.frameIndexUrl, { signal: controller.signal });
                    if (frameIndexResponse.ok) {
                        sourceFrameIndex = await frameIndexResponse.json();
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
                aspectRatio: nextRatio,
                scenes: nextScenes,
            };

            if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
            await set('tpe_video_blob', undefined);
            await updateVideoDraft(nextDraft);
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            console.error("VIDEO_INGEST_CLIENT_ERROR:", err);
            if (!options?.preserveScenes) {
                if (previousUrl?.startsWith('blob:')) URL.revokeObjectURL(previousUrl);
                const fallbackUrl = URL.createObjectURL(blob);
                await set('tpe_video_blob', blob);
                await updateVideoDraft({
                    ...videoDraftRef.current,
                    videoUrl: fallbackUrl,
                    videoName: displayName,
                });
            }
        } finally {
            setIsOptimisingVideo(false);
            setIngestStatus(null);
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

            if (pendingMigrationBlob && !migrationStartedRef.current) {
                migrationStartedRef.current = true;
                void ingestVideoBlob(pendingMigrationBlob, draft.videoName, { preserveScenes: true });
            }
        };
        void init();
        return () => { cancelled = true; };
    }, [ingestVideoBlob]);

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

    useEffect(() => () => {
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
    }, []);

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
                if (saveTimeout.current) clearTimeout(saveTimeout.current);
                saveTimeout.current = setTimeout(async () => {
                    await set('tpe_video_draft', updated);
                }, 150);
            }
        }
    }, [totalDuration, seekTo]);

    const resetVideoDraft = useCallback(async () => {
        const prevUrl = videoDraftRef.current.videoUrl;
        if (prevUrl?.startsWith('blob:')) URL.revokeObjectURL(prevUrl);
        const defaultDraft = createDefaultVideoDraft();
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
        setVideoDraft(defaultDraft);
        setIsPlaying(false);
        setCurrentTime(0);
        await set('tpe_video_draft', defaultDraft);
        await set('tpe_video_blob', undefined);
    }, []);

    return {
        isMounted, videoDraft, updateVideoDraft, resetVideoDraft, isOptimisingVideo, ingestStatus, ingestVideoBlob,
        isPlaying, setIsPlaying, togglePlay, playbackMode, setPlaybackMode, currentTime, currentTimeRef, seekNonce,
        setCurrentTime, seekTo, isMuted, toggleMute, syncTimeFromVideo
    };
};
