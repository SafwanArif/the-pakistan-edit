import { useState, useRef, useEffect, useCallback } from 'react';
import {
    VideoDraft,
    createDefaultVideoDraft,
    getTotalVideoDuration,
    calculatePsychologyPacedScenes,
    ensureUniqueSceneIds,
    getSceneBoundaries,
} from '../../../types/news';
import { get, set } from 'idb-keyval';

const uploadWithTelemetry = (
    formData: FormData,
    onStatus: (msg: string) => void,
    signal?: AbortSignal
): Promise<string> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(new Error("Upload aborted"));
            return;
        }
        const xhr = new XMLHttpRequest();
        let parsedOffset = 0;
        let finalUrl = "";
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
                        const evt = JSON.parse(line) as { stage?: string; url?: string; error?: string };
                        if (evt.error) {
                            finishReject(new Error(evt.error));
                            return;
                        }
                        if (evt.stage) onStatus(evt.stage);
                        if (evt.url) finalUrl = evt.url;
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
                resolve(finalUrl);
            } else {
                settled = true;
                reject(new Error(`Ingest failed (${xhr.status})`));
            }
        };
        xhr.onerror = () => finishReject(new Error("Network error during video ingest"));
        xhr.send(formData);
    });

export const probeVideoMetadata = (url: string): Promise<{ aspectRatio: '9:16' | '4:5'; duration: number } | null> =>
    new Promise((resolve) => {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        let settled = false;
        const finish = (result: { aspectRatio: '9:16' | '4:5'; duration: number } | null) => {
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
            const aspectRatio: '9:16' | '4:5' =
                vid.videoWidth && vid.videoHeight && (vid.videoHeight / vid.videoWidth) >= 1.5 ? '9:16' : '4:5';
            const duration = vid.duration && !Number.isNaN(vid.duration) && vid.duration > 0 ? vid.duration : 60;
            finish({ aspectRatio, duration });
        };
        vid.onerror = () => finish(null);
        vid.src = url;
    });

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
    const [playbackMode, setPlaybackMode] = useState<'play-all' | 'loop-angle'>('play-all');
    const isMuted = Boolean(videoDraft.isMuted);

    const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
    const ingestAbortRef = useRef<AbortController | null>(null);
    const sceneBoundsRef = useRef(getSceneBoundaries(videoDraft.scenes));

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

            const url = await uploadWithTelemetry(formData, (stage) => setIngestStatus(stage), controller.signal);
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

            const nextDraft: VideoDraft = {
                ...current,
                videoUrl: url,
                videoName: displayName,
                videoDuration: clipDuration,
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
                draft = { ...draft, ...savedDraft };
                if (!draft.scenes || draft.scenes.length === 0) {
                    draft.scenes = createDefaultVideoDraft().scenes;
                } else {
                    draft.scenes = ensureUniqueSceneIds(draft.scenes);
                }
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

    // Run rAF timeline clock when no native video is loaded or when the Outro screen is active (video element unmounted)
    useEffect(() => {
        if (!isPlaying) return;
        const hasNativeVideo = !!videoDraft.videoUrl;
        if (hasNativeVideo && !isOutroActive) return;

        let animId: number;
        let lastRenderTime = performance.now();

        const tick = (now: number) => {
            const elapsedSinceRender = now - lastRenderTime;

            if (elapsedSinceRender >= 40) {
                const delta = elapsedSinceRender / 1000;
                lastRenderTime = now;

                setCurrentTime((prev: number) => {
                    const next = prev + delta;
                    if (playbackModeRef.current === 'loop-angle') {
                        const active = sceneBoundsRef.current.find(b => prev >= b.start && prev < b.end);
                        if (active && next >= active.end) return active.start;
                    }
                    if (totalDuration > 0 && next >= totalDuration) return 0;
                    return next;
                });
            }

            animId = requestAnimationFrame(tick);
        };

        animId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animId);
    }, [isPlaying, totalDuration, videoDraft.videoUrl, isOutroActive]);

    useEffect(() => () => {
        if (saveTimeout.current) clearTimeout(saveTimeout.current);
    }, []);

    const togglePlay = useCallback(() => {
        setIsPlaying((prev: boolean) => !prev);
    }, []);

    const seekTo = useCallback((time: number) => {
        setCurrentTime(time);
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

        setCurrentTime((prev: number) => {
            if (Math.abs(prev - mediaTime) >= 0.025) {
                return mediaTime;
            }
            return prev;
        });

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
        isMounted,
        videoDraft,
        updateVideoDraft,
        resetVideoDraft,
        isOptimisingVideo,
        ingestStatus,
        ingestVideoBlob,
        // Playback Sync
        isPlaying,
        setIsPlaying,
        togglePlay,
        playbackMode,
        setPlaybackMode,
        currentTime,
        setCurrentTime,
        seekTo,
        isMuted,
        toggleMute,
        syncTimeFromVideo
    };
};
