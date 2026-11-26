import { useState, useRef, useEffect, useCallback } from 'react';
import {
    VideoDraft,
    VideoAspectRatio,
    createDefaultVideoDraft,
    getTotalVideoDuration,
    calculatePsychologyPacedScenes,
    getSceneBoundaries,
    getTimelineStructure,
    getActiveSceneAtTime,
    findSubtitleAtMediaTime,
    wrapMediaTime,
    type SourceFrameIndex,
    type SourceMediaInfo,
} from '@/types/news';
import { revokeBlobUrl } from '@/utils/idUtils';
import { del, get, set } from 'idb-keyval';
import { useDebouncedIdbSave } from './useDebouncedIdbSave';
import { canUseServerIngest, deleteServerCachedVideo } from '../utils/serverCapabilities';
import { createLivePlaybackClock } from '../utils/livePlaybackClock';
import { extractKeyframeTimesFromFrameIndex, inspectVideoBlob } from '../utils/clientMediaInspector';
import { STORAGE_KEYS } from '../utils/storageKeys';
import {
    inferAspectRatioFromDimensions,
    normalizeHydratedVideoDraft,
    probeVideoMetadata,
    resetClipBoundFields,
    revokeDraftBlobUrls,
    toPersistableDraft,
    uploadWithTelemetry,
} from '../utils/videoIngestHelpers';

export { normalizeHydratedVideoDraft, probeVideoMetadata, resetClipBoundFields };

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
    const [liveClock] = useState(() => createLivePlaybackClock(0));
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [seekNonce, setSeekNonce] = useState(0);
    const [playbackMode, setPlaybackMode] = useState<'play-all' | 'loop-angle'>('play-all');
    const isMuted = Boolean(videoDraft.isMuted);

    const { scheduleSave: scheduleDraftSave, saveNow: saveDraftNow } = useDebouncedIdbSave<VideoDraft>(
        STORAGE_KEYS.VIDEO_DRAFT,
        toPersistableDraft
    );
    const ingestAbortRef = useRef<AbortController | null>(null);
    const sceneBoundsRef = useRef(getSceneBoundaries(videoDraft.scenes));
    const rVfcAnchorRef = useRef<{ time: number; perfNow: number } | null>(null);
    const lastDiscreteKeyRef = useRef("");

    useEffect(() => {
        sceneBoundsRef.current = getSceneBoundaries(videoDraft.scenes);
    }, [videoDraft.scenes]);

    useEffect(() => {
        return () => ingestAbortRef.current?.abort();
    }, []);
    const videoDraftRef = useRef<VideoDraft>(videoDraft);
    const currentTimeRef = useRef(currentTime);
    const isPlayingRef = useRef(isPlaying);
    const playbackModeRef = useRef(playbackMode);
    const migrationStartedRef = useRef(false);

    useEffect(() => {
        videoDraftRef.current = videoDraft;
        currentTimeRef.current = currentTime;
        isPlayingRef.current = isPlaying;
        playbackModeRef.current = playbackMode;
    }, [videoDraft, currentTime, isPlaying, playbackMode]);

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
            if (previousUrl?.startsWith('blob:')) revokeBlobUrl(previousUrl);
            else deleteServerCachedVideo(previousUrl);
            const fallbackUrl = URL.createObjectURL(blob);
            setIngestStatus("INSPECTING CODECS & DURATION...");
            const [meta, inspected] = await Promise.all([
                probeVideoMetadata(fallbackUrl),
                inspectVideoBlob(blob).catch(() => null),
            ]);
            if (controller.signal.aborted) {
                revokeBlobUrl(fallbackUrl);
                return;
            }
            const base = resetClipBoundFields(videoDraftRef.current);
            const clipDuration = meta?.duration ?? inspected?.durationSec ?? base.videoDuration ?? 60;
            const ratio = meta?.aspectRatio ?? inferAspectRatioFromDimensions(inspected?.mediaInfo.width, inspected?.mediaInfo.height) ?? base.aspectRatio;
            try {
                await set(STORAGE_KEYS.VIDEO_BLOB, blob);
            } catch (quotaErr) {
                console.warn("IDB_VIDEO_BLOB_QUOTA_SKIPPED:", quotaErr);
            }
            await updateVideoDraft({
                ...base,
                videoUrl: fallbackUrl,
                videoName: displayName,
                videoDuration: clipDuration,
                sourceFps: inspected?.mediaInfo.exactFps,
                sourceKeyframeTimes: inspected?.keyframeTimes.length ? inspected.keyframeTimes : undefined,
                sourceMediaInfo: inspected?.mediaInfo,
                aspectRatio: ratio,
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
            const inspectionPromise = inspectVideoBlob(blob).catch(() => null);

            const [upload, inspected] = await Promise.all([
                uploadWithTelemetry(formData, (stage) => setIngestStatus(stage), controller.signal),
                inspectionPromise,
            ]);
            const url = upload.url;
            const mergedMediaInfo: SourceMediaInfo | undefined = upload.mediaInfo
                ? { ...inspected?.mediaInfo, ...upload.mediaInfo }
                : inspected?.mediaInfo;
            const serverRatio = inferAspectRatioFromDimensions(mergedMediaInfo?.width, mergedMediaInfo?.height);
            const serverDuration = upload.duration && upload.duration > 0 ? upload.duration : inspected?.durationSec ?? null;
            let meta: { aspectRatio: VideoAspectRatio; duration: number } | null = serverRatio && serverDuration
                ? { aspectRatio: serverRatio, duration: serverDuration }
                : null;
            if (!meta) {
                setIngestStatus("PROBING ASPECT RATIO & DURATION...");
                meta = await probeVideoMetadata(url);
            }
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
                sourceFps: upload.fps || inspected?.mediaInfo.exactFps,
                sourceFrameLogUrl: upload.frameIndexUrl,
                sourceFrameIndex,
                sourceKeyframeTimes: inspected?.keyframeTimes.length ? inspected.keyframeTimes : extractKeyframeTimesFromFrameIndex(sourceFrameIndex),
                sourceMediaInfo: mergedMediaInfo,
                aspectRatio: nextRatio,
                scenes: nextScenes,
            };

            if (previousUrl?.startsWith('blob:')) revokeBlobUrl(previousUrl);
            else if (!options?.preserveScenes && previousUrl && previousUrl !== url) deleteServerCachedVideo(previousUrl);
            await del(STORAGE_KEYS.VIDEO_BLOB).catch(() => {});
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
            const savedDraft = await get<VideoDraft>(STORAGE_KEYS.VIDEO_DRAFT);
            const savedBlob = await get<Blob>(STORAGE_KEYS.VIDEO_BLOB);
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
            const hydratedUrl = draft.videoUrl;
            setVideoDraft(draft);
            setIsMounted(true);

            // Rehydrate transient in-memory keyframe & codec inspection from IndexedDB blob on page reload
            if (savedBlob && (!draft.sourceKeyframeTimes?.length || !draft.sourceMediaInfo)) {
                void inspectVideoBlob(savedBlob).then((inspected) => {
                    if (cancelled || !inspected) return;
                    setVideoDraft((curr) => {
                        if (curr.videoUrl !== hydratedUrl) return curr;
                        return {
                            ...curr,
                            sourceFps: curr.sourceFps ?? inspected.mediaInfo.exactFps,
                            sourceKeyframeTimes: curr.sourceKeyframeTimes?.length
                                ? curr.sourceKeyframeTimes
                                : (inspected.keyframeTimes.length ? inspected.keyframeTimes : undefined),
                            sourceMediaInfo: curr.sourceMediaInfo
                                ? { ...inspected.mediaInfo, ...curr.sourceMediaInfo }
                                : inspected.mediaInfo,
                        };
                    });
                }).catch(() => {});
            }

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

    // Synthetic 120Hz clock ONLY when no native <video> is driving playback (no video, Photo scene, or Outro).
    // During native video playback, `useSmoothFramingLoop` is the single 120Hz rAF PLL emitting directly to `liveClock`.
    useEffect(() => {
        if (!isPlaying) {
            rVfcAnchorRef.current = null;
            return;
        }
        const hasNativeVideo = !!videoDraft.videoUrl;
        if (hasNativeVideo && !isOutroActive && !activeSceneIsImage) {
            return;
        }

        let animId = 0;
        let lastNow = performance.now();
        let liveT = currentTimeRef.current;
        let lastSceneIdx = getActiveSceneAtTime(videoDraftRef.current, liveT).sceneIndex;

        const tick = (now: number) => {
            const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
            lastNow = now;
            const prev = liveT;
            const next = prev + dt;
            let resolved = next;
            let wrapped = false;
            if (playbackModeRef.current === 'loop-angle') {
                const active = sceneBoundsRef.current.find(b => prev >= b.start && prev < b.end);
                if (active && next >= active.end) {
                    resolved = active.start;
                    wrapped = true;
                } else if (totalDuration > 0 && next >= totalDuration) {
                    resolved = 0;
                    wrapped = true;
                }
            } else if (totalDuration > 0 && next >= totalDuration) {
                resolved = 0;
                wrapped = true;
            }
            liveT = resolved;
            currentTimeRef.current = resolved;
            liveClock.emit(resolved);

            const nextScene = getActiveSceneAtTime(videoDraftRef.current, resolved);
            if (wrapped || nextScene.sceneIndex !== lastSceneIdx) {
                lastSceneIdx = nextScene.sceneIndex;
                setCurrentTime(resolved);
            }

            animId = requestAnimationFrame(tick);
        };

        animId = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(animId);
    }, [isPlaying, totalDuration, videoDraft.videoUrl, isOutroActive, activeSceneIsImage, liveClock]);

    const togglePlay = useCallback(() => {
        const wasPlaying = isPlayingRef.current;
        if (wasPlaying) {
            const exactPausedTime = liveClock.getTime();
            currentTimeRef.current = exactPausedTime;
            setCurrentTime(exactPausedTime);
        }
        isPlayingRef.current = !wasPlaying;
        setIsPlaying(!wasPlaying);
    }, [liveClock]);

    const seekTo = useCallback((time: number) => {
        rVfcAnchorRef.current = { time, perfNow: performance.now() };
        currentTimeRef.current = time;
        liveClock.emit(time);
        setCurrentTime(time);
        setSeekNonce((n) => n + 1);
    }, [liveClock]);

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
            const { hasReHook, preStoryDur, hookOffset, storyOffset } = getTimelineStructure(videoDraftRef.current.scenes || []);
            // Hook/Re-Hook wraps with custom jumps are owned exclusively by `syncTimelineTick` (0.022s cut) to prevent double-seeks
            const ownedByVideoSync = Boolean(active && active.start < preStoryDur && (hasReHook || hookOffset > 0 || storyOffset > 0));
            if (active && !ownedByVideoSync && mediaTime >= active.end - 0.04) {
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
        currentTimeRef.current = mediaTime;

        const curDraft = videoDraftRef.current;
        const sceneState = getActiveSceneAtTime(curDraft, mediaTime);
        const captionsOn = sceneState.scene?.showSubtitles ?? (curDraft.showSubtitles !== false);
        const activeSubId = captionsOn && curDraft.subtitles?.length
            ? (findSubtitleAtMediaTime(curDraft.subtitles, wrapMediaTime(curDraft, mediaTime, curDraft.videoDuration || 0))?.id ?? "")
            : "";
        const wordmarkPhase = mediaTime < 1.8 ? 1 : 0;
        const discreteKey = `${sceneState.sceneIndex}:${sceneState.isOutro ? 1 : 0}:${activeSubId}:${wordmarkPhase}`;

        // Only push React root state on discrete transitions (scene change, subtitle cue change, intro end, or jump)
        if (isJump || discreteKey !== lastDiscreteKeyRef.current) {
            lastDiscreteKeyRef.current = discreteKey;
            setCurrentTime(mediaTime);
        }

        if (mediaDuration && mediaDuration > 0 && !Number.isNaN(mediaDuration)) {
            if (!curDraft.videoDuration || Math.abs(curDraft.videoDuration - mediaDuration) > 1.5) {
                const updated: VideoDraft = { ...curDraft, videoDuration: mediaDuration };
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
        currentTimeRef.current = 0;
        liveClock.emit(0);
        setCurrentTime(0);
        const current = videoDraftRef.current;
        if (current.videoUrl?.startsWith('blob:')) revokeBlobUrl(current.videoUrl);
        else deleteServerCachedVideo(current.videoUrl);
        await del(STORAGE_KEYS.VIDEO_BLOB).catch(() => {});
        await updateVideoDraft({
            ...resetClipBoundFields(current),
            videoUrl: "",
            videoName: "",
            videoDuration: undefined,
            sourceName: "",
            creditName: "",
        });
    }, [liveClock, updateVideoDraft]);

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
        currentTimeRef.current = 0;
        liveClock.emit(0);
        setCurrentTime(0);
        await saveDraftNow(defaultDraft);
        await del(STORAGE_KEYS.VIDEO_BLOB).catch(() => {});
    }, [liveClock, saveDraftNow]);

    return {
        isMounted, videoDraft, updateVideoDraft, clearVideo, resetVideoDraft, isOptimisingVideo, ingestStatus, ingestVideoBlob,
        isPlaying, setIsPlaying, togglePlay, playbackMode, setPlaybackMode, currentTime, currentTimeRef, liveClock, seekNonce,
        setCurrentTime, seekTo, isMuted, toggleMute, syncTimeFromVideo
    };
};
