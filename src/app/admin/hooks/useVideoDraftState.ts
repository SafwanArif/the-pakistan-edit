"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import {
    VideoDraft,
    VideoAspectRatio,
    createDefaultVideoDraft,
    calculatePsychologyPacedScenes,
    type SourceFrameIndex,
    type SourceMediaInfo,
} from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";
import { del, get, set } from "idb-keyval";
import { useDebouncedIdbSave } from "./useDebouncedIdbSave";
import { useVideoPlaybackClock } from "./useVideoPlaybackClock";
import { canUseServerIngest, deleteServerCachedVideo } from "../utils/serverCapabilities";
import { extractAudioM4aBlob, extractKeyframeTimesFromFrameIndex, inspectVideoBlob } from "../utils/clientMediaInspector";
import { STORAGE_KEYS } from "../utils/storageKeys";
import {
    inferAspectRatioFromDimensions,
    normalizeHydratedVideoDraft,
    probeVideoMetadata,
    resetClipBoundFields,
    revokeDraftBlobUrls,
    toPersistableDraft,
    uploadWithTelemetry,
} from "../utils/videoIngestHelpers";

export { normalizeHydratedVideoDraft, probeVideoMetadata, resetClipBoundFields };

const validDuration = (d?: number | null): number | undefined =>
    typeof d === "number" && Number.isFinite(d) && d > 0 ? d : undefined;

const releaseVideoSource = (url?: string) => {
    if (!url) return;
    if (url.startsWith("blob:")) revokeBlobUrl(url);
    else deleteServerCachedVideo(url);
};

/**
 * Local-first state orchestrator for Video drafts with disk-backed HTTP 206 byte-range
 * video streaming, `.m4a` companion audio rails, and delegated 120Hz playback clock.
 */
export const useVideoDraftState = () => {
    const [isMounted, setIsMounted] = useState(false);
    const [videoDraft, setVideoDraft] = useState<VideoDraft>(createDefaultVideoDraft);
    const [isOptimisingVideo, setIsOptimisingVideo] = useState(false);
    const [ingestStatus, setIngestStatus] = useState<string | null>(null);
    const [companionAudioUrl, setCompanionAudioUrl] = useState<string | undefined>(undefined);

    const companionAudioUrlRef = useRef<string | undefined>(undefined);
    const ingestAbortRef = useRef<AbortController | null>(null);
    const videoDraftRef = useRef<VideoDraft>(videoDraft);
    const migrationStartedRef = useRef(false);
    const hasUserMutatedRef = useRef(false);

    const { scheduleSave: scheduleDraftSave, saveNow: saveDraftNow, cancel: cancelDraftSave } = useDebouncedIdbSave<VideoDraft>(
        STORAGE_KEYS.VIDEO_DRAFT,
        toPersistableDraft
    );

    useLayoutEffect(() => {
        videoDraftRef.current = videoDraft;
    });

    const replaceCompanionAudioUrl = useCallback((next?: string) => {
        if (companionAudioUrlRef.current && companionAudioUrlRef.current !== next) {
            revokeBlobUrl(companionAudioUrlRef.current);
        }
        companionAudioUrlRef.current = next;
        setCompanionAudioUrl(next);
    }, []);

    const createCompanionAudioUrlForBlob = useCallback(async (blob: Blob): Promise<string> => {
        const m4aBlob = await extractAudioM4aBlob(blob).catch(() => null);
        return URL.createObjectURL(m4aBlob ?? blob);
    }, []);

    const abortInFlightIngest = useCallback(() => {
        if (!ingestAbortRef.current) return;
        ingestAbortRef.current.abort();
        ingestAbortRef.current = null;
        setIsOptimisingVideo(false);
        setIngestStatus(null);
    }, []);

    const commitDraft = useCallback((nextDraft: VideoDraft, immediate = false) => {
        hasUserMutatedRef.current = true;
        videoDraftRef.current = nextDraft;
        setVideoDraft(nextDraft);
        return immediate ? saveDraftNow(nextDraft) : Promise.resolve(scheduleDraftSave(nextDraft));
    }, [saveDraftNow, scheduleDraftSave]);

    const handlePersistDuration = useCallback((mediaDuration: number) => {
        setVideoDraft((prev) => {
            if (prev.videoDuration && Math.abs(prev.videoDuration - mediaDuration) <= 1.5) return prev;
            const updated: VideoDraft = { ...prev, videoDuration: mediaDuration };
            videoDraftRef.current = updated;
            scheduleDraftSave(updated);
            return updated;
        });
    }, [scheduleDraftSave]);

    const playback = useVideoPlaybackClock({
        videoDraft,
        videoDraftRef,
        onPersistDuration: handlePersistDuration,
    });
    const { resetPlaybackState } = playback;

    useEffect(() => () => {
        ingestAbortRef.current?.abort();
        revokeBlobUrl(companionAudioUrlRef.current);
        companionAudioUrlRef.current = undefined;
        revokeDraftBlobUrls(videoDraftRef.current);
    }, []);

    const updateVideoDraft = useCallback((newDraft: VideoDraft) => {
        if (newDraft.videoUrl !== videoDraftRef.current.videoUrl) {
            abortInFlightIngest();
            if (!newDraft.videoUrl?.startsWith("blob:")) replaceCompanionAudioUrl(undefined);
        }
        void commitDraft(newDraft);
    }, [abortInFlightIngest, commitDraft, replaceCompanionAudioUrl]);

    /** Uploads a video blob to `/api/video/ingest` for HTTP 206 byte-range streaming (or loads directly as `blob:` on serverless). */
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
            if (options?.preserveScenes || controller.signal.aborted) return;
            const fallbackUrl = URL.createObjectURL(blob);
            setIngestStatus("INSPECTING CODECS & AUDIO RAIL...");
            const [meta, inspected, audioUrl] = await Promise.all([
                probeVideoMetadata(fallbackUrl),
                inspectVideoBlob(blob).catch(() => null),
                createCompanionAudioUrlForBlob(blob),
            ]);
            if (controller.signal.aborted) {
                revokeBlobUrl(fallbackUrl);
                revokeBlobUrl(audioUrl);
                return;
            }
            releaseVideoSource(previousUrl);
            replaceCompanionAudioUrl(audioUrl);
            const base = resetClipBoundFields(videoDraftRef.current);
            const clipDuration = validDuration(meta?.duration) ?? validDuration(inspected?.durationSec) ?? validDuration(base.videoDuration) ?? 60;
            const ratio = meta?.aspectRatio ?? inferAspectRatioFromDimensions(inspected?.mediaInfo.width, inspected?.mediaInfo.height) ?? base.aspectRatio;
            try {
                await set(STORAGE_KEYS.VIDEO_BLOB, blob);
            } catch (quotaErr) {
                console.warn("IDB_VIDEO_BLOB_QUOTA_SKIPPED:", quotaErr);
            }
            if (controller.signal.aborted) {
                revokeBlobUrl(fallbackUrl);
                replaceCompanionAudioUrl(undefined);
                return;
            }
            void commitDraft({
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
        if (!options?.preserveScenes) resetPlaybackState();

        let uploadedServerUrl: string | undefined;
        const isStaleUpload = () =>
            controller.signal.aborted || Boolean(options?.preserveScenes && videoDraftRef.current.videoUrl !== previousUrl);

        try {
            const serverIngestAvailable = await canUseServerIngest();
            if (controller.signal.aborted) return;
            if (!serverIngestAvailable) {
                await commitLocalBlobFallback();
                return;
            }

            setIngestStatus("PREPARING UPLOAD STREAM...");
            const formData = new FormData();
            formData.append("file", blob, displayName);
            const [upload, inspected] = await Promise.all([
                uploadWithTelemetry(formData, (stage) => setIngestStatus(stage), controller.signal),
                inspectVideoBlob(blob).catch(() => null),
            ]);
            uploadedServerUrl = upload.url;
            const mergedMediaInfo: SourceMediaInfo | undefined = upload.mediaInfo
                ? { ...inspected?.mediaInfo, ...upload.mediaInfo }
                : inspected?.mediaInfo;
            const serverRatio = inferAspectRatioFromDimensions(mergedMediaInfo?.width, mergedMediaInfo?.height);
            const serverDuration = validDuration(upload.duration) ?? validDuration(inspected?.durationSec);
            let meta: { aspectRatio: VideoAspectRatio; duration: number } | null = serverRatio && serverDuration
                ? { aspectRatio: serverRatio, duration: serverDuration }
                : null;
            if (!meta) {
                setIngestStatus("PROBING ASPECT RATIO & DURATION...");
                meta = await probeVideoMetadata(uploadedServerUrl);
            }
            if (isStaleUpload()) {
                deleteServerCachedVideo(uploadedServerUrl);
                uploadedServerUrl = undefined;
                return;
            }

            const current = options?.preserveScenes ? videoDraftRef.current : resetClipBoundFields(videoDraftRef.current);
            const nextRatio = options?.preserveScenes ? current.aspectRatio : (meta?.aspectRatio ?? current.aspectRatio);
            const clipDuration = validDuration(meta?.duration) ?? validDuration(current.videoDuration) ?? 60;
            const nextScenes = options?.preserveScenes && current.scenes?.length
                ? current.scenes
                : calculatePsychologyPacedScenes(clipDuration, current.scenes);

            let sourceFrameIndex: SourceFrameIndex | undefined;
            if (upload.frameIndexUrl) {
                try {
                    const frameIndexResponse = await fetch(upload.frameIndexUrl, { signal: controller.signal });
                    if (frameIndexResponse.ok) sourceFrameIndex = await frameIndexResponse.json() as SourceFrameIndex;
                } catch (err) {
                    if (err instanceof DOMException && err.name === "AbortError") throw err;
                    console.warn("SOURCE_FRAME_INDEX_LOAD_FAILED", err);
                }
            }
            if (isStaleUpload()) {
                deleteServerCachedVideo(uploadedServerUrl);
                uploadedServerUrl = undefined;
                return;
            }

            if (previousUrl?.startsWith("blob:")) revokeBlobUrl(previousUrl);
            else if (!options?.preserveScenes && previousUrl && previousUrl !== uploadedServerUrl) deleteServerCachedVideo(previousUrl);
            replaceCompanionAudioUrl(undefined);

            // Commit synchronously BEFORE fire-and-forget IDB blob cleanup to prevent post-await abort races (`P106`)
            const committedUrl = uploadedServerUrl;
            uploadedServerUrl = undefined;
            void commitDraft({
                ...current,
                videoUrl: committedUrl,
                videoName: displayName,
                videoDuration: clipDuration,
                sourceFps: upload.fps || inspected?.mediaInfo.exactFps,
                sourceFrameLogUrl: upload.frameIndexUrl,
                sourceFrameIndex,
                sourceKeyframeTimes: inspected?.keyframeTimes.length ? inspected.keyframeTimes : extractKeyframeTimesFromFrameIndex(sourceFrameIndex),
                sourceMediaInfo: mergedMediaInfo,
                aspectRatio: nextRatio,
                scenes: nextScenes,
            });
            void del(STORAGE_KEYS.VIDEO_BLOB).catch(() => {});
        } catch (err) {
            if (uploadedServerUrl) deleteServerCachedVideo(uploadedServerUrl);
            if (controller.signal.aborted) return;
            if (err instanceof DOMException && err.name === "AbortError") return;
            if (err instanceof Error && err.message === "Upload aborted") return;
            console.error("VIDEO_INGEST_CLIENT_ERROR:", err);
            await commitLocalBlobFallback();
        } finally {
            if (ingestAbortRef.current === controller) {
                ingestAbortRef.current = null;
                setIsOptimisingVideo(false);
                setIngestStatus(null);
            }
        }
    }, [commitDraft, createCompanionAudioUrlForBlob, replaceCompanionAudioUrl, resetPlaybackState]);

    useEffect(() => {
        let cancelled = false;
        const ac = new AbortController();
        const init = async () => {
            let draft = createDefaultVideoDraft();
            let savedBlob: Blob | undefined;
            let pendingMigrationBlob: Blob | undefined;

            try {
                const [savedDraft, blobRecord] = await Promise.all([
                    get<VideoDraft>(STORAGE_KEYS.VIDEO_DRAFT),
                    get<Blob>(STORAGE_KEYS.VIDEO_BLOB),
                ]);
                savedBlob = blobRecord;
                if (savedDraft) {
                    draft = normalizeHydratedVideoDraft(savedDraft, draft);
                    if (savedBlob && !draft.videoUrl?.startsWith("/api/video/ingest")) pendingMigrationBlob = savedBlob;
                    else if (draft.videoUrl?.startsWith("blob:") && !savedBlob) { draft.videoUrl = ""; draft.videoName = ""; }
                } else if (savedBlob) {
                    pendingMigrationBlob = savedBlob;
                }
            } catch (err) {
                console.warn("VIDEO_HYDRATION_FAILED:", err);
            }

            if (cancelled) return;
            if (hasUserMutatedRef.current) { setIsMounted(true); return; }
            if (pendingMigrationBlob && (!draft.videoUrl || draft.videoUrl.startsWith("blob:"))) {
                draft.videoUrl = URL.createObjectURL(pendingMigrationBlob);
            }
            const hydratedUrl = draft.videoUrl;
            videoDraftRef.current = draft;
            setVideoDraft(draft);
            setIsMounted(true);

            // Build pure `.m4a` companion audio rail for local `blob:` sessions on reload (`A5`)
            if (savedBlob && hydratedUrl?.startsWith("blob:")) {
                void createCompanionAudioUrlForBlob(savedBlob).then((audioUrl) => {
                    if (cancelled || videoDraftRef.current.videoUrl !== hydratedUrl) { revokeBlobUrl(audioUrl); return; }
                    replaceCompanionAudioUrl(audioUrl);
                }).catch(() => {});
            }

            // Rehydrate transient in-memory keyframe & codec inspection from IndexedDB blob on reload
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
                            sourceMediaInfo: curr.sourceMediaInfo ? { ...inspected.mediaInfo, ...curr.sourceMediaInfo } : inspected.mediaInfo,
                        };
                    });
                }).catch(() => {});
            }

            // Lazily rehydrate sourceFrameIndex in memory without bloating IndexedDB
            if (draft.sourceFrameLogUrl && !draft.sourceFrameIndex) {
                const frameUrl = draft.sourceFrameLogUrl;
                void fetch(frameUrl, { signal: ac.signal }).then(async (res) => {
                    if (!res.ok || cancelled) return;
                    const idx = await res.json() as SourceFrameIndex;
                    if (!cancelled) setVideoDraft((curr) => (curr.sourceFrameLogUrl === frameUrl ? { ...curr, sourceFrameIndex: idx } : curr));
                }).catch(() => {});
            }

            // Validate that a persisted local server video still exists on disk (self-heals wiped `.next/cache`)
            if (draft.videoUrl?.startsWith("/api/video/ingest")) {
                const cachedUrl = draft.videoUrl;
                void fetch(cachedUrl, { method: "HEAD", signal: ac.signal }).then((res) => {
                    if (!cancelled && res.status === 404) {
                        setVideoDraft((curr) => {
                            if (curr.videoUrl !== cachedUrl) return curr;
                            const healed: VideoDraft = { ...curr, videoUrl: "", videoName: "", sourceFrameLogUrl: undefined, sourceFrameIndex: undefined };
                            videoDraftRef.current = healed;
                            scheduleDraftSave(healed);
                            return healed;
                        });
                    }
                }).catch(() => {});
            }

            if (pendingMigrationBlob && !migrationStartedRef.current) {
                const canIngest = await canUseServerIngest();
                if (cancelled || hasUserMutatedRef.current || !canIngest || videoDraftRef.current.videoUrl !== hydratedUrl) return;
                migrationStartedRef.current = true;
                void ingestVideoBlob(pendingMigrationBlob, draft.videoName, { preserveScenes: true });
            }
        };
        void init();
        return () => { cancelled = true; ac.abort(); };
    }, [createCompanionAudioUrlForBlob, ingestVideoBlob, replaceCompanionAudioUrl, scheduleDraftSave]);

    const clearVideo = useCallback(async () => {
        abortInFlightIngest();
        cancelDraftSave();
        resetPlaybackState();
        const current = videoDraftRef.current;
        releaseVideoSource(current.videoUrl);
        replaceCompanionAudioUrl(undefined);
        await del(STORAGE_KEYS.VIDEO_BLOB).catch(() => {});
        await commitDraft({
            ...resetClipBoundFields(current),
            videoUrl: "",
            videoName: "",
            videoDuration: undefined,
            sourceName: "",
            creditName: "",
        }, true);
    }, [abortInFlightIngest, cancelDraftSave, commitDraft, replaceCompanionAudioUrl, resetPlaybackState]);

    const resetVideoDraft = useCallback(async () => {
        abortInFlightIngest();
        cancelDraftSave();
        const current = videoDraftRef.current;
        revokeDraftBlobUrls(current);
        replaceCompanionAudioUrl(undefined);
        deleteServerCachedVideo(current.videoUrl);
        for (const s of current.scenes || []) deleteServerCachedVideo(s.mediaUrl);
        resetPlaybackState();
        await commitDraft(createDefaultVideoDraft(), true);
        await del(STORAGE_KEYS.VIDEO_BLOB).catch(() => {});
    }, [abortInFlightIngest, cancelDraftSave, commitDraft, replaceCompanionAudioUrl, resetPlaybackState]);

    return {
        isMounted,
        videoDraft,
        companionAudioUrl,
        updateVideoDraft,
        clearVideo,
        resetVideoDraft,
        isOptimisingVideo,
        ingestStatus,
        ingestVideoBlob,
        isPlaying: playback.isPlaying,
        togglePlay: playback.togglePlay,
        playbackMode: playback.playbackMode,
        setPlaybackMode: playback.setPlaybackMode,
        currentTime: playback.currentTime,
        liveClock: playback.liveClock,
        seekNonce: playback.seekNonce,
        seekTo: playback.seekTo,
        isMuted: Boolean(videoDraft.isMuted),
        syncTimeFromVideo: playback.syncTimeFromVideo,
    };
};
