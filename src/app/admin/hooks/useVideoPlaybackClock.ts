"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import {
    clamp,
    findSubtitleAtMediaTime,
    getActiveSceneAtTime,
    getSceneBoundaries,
    getTimelineStructure,
    getTotalVideoDuration,
    wrapMediaTime,
    type VideoDraft,
} from "@/types/news";
import { createLivePlaybackClock } from "../utils/livePlaybackClock";

export type VideoPlaybackMode = "play-all" | "loop-angle";

interface UseVideoPlaybackClockOptions {
    videoDraft: VideoDraft;
    videoDraftRef: MutableRefObject<VideoDraft>;
    onPersistDuration: (mediaDuration: number) => void;
}

/**
 * Isolated 120Hz Video Studio transport & playback clock hook.
 * Drives `liveClock` directly at 120Hz for Photo/Outro/no-video timelines and filters native
 * `<video>` ticks into discrete root React state transitions (scene, subtitle, intro, or jump).
 */
export function useVideoPlaybackClock({
    videoDraft,
    videoDraftRef,
    onPersistDuration,
}: UseVideoPlaybackClockOptions) {
    const [liveClock] = useState(() => createLivePlaybackClock(0));
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [seekNonce, setSeekNonce] = useState(0);
    const [playbackMode, setPlaybackModeState] = useState<VideoPlaybackMode>("play-all");

    const totalDuration = getTotalVideoDuration(videoDraft);
    const activeSceneState = getActiveSceneAtTime(videoDraft, currentTime);
    const isOutroActive = activeSceneState.isOutro;
    const activeSceneIsImage = !isOutroActive && activeSceneState.scene?.mediaType === "image";

    const sceneBoundsRef = useRef(getSceneBoundaries(videoDraft.scenes));
    const rVfcAnchorRef = useRef<{ time: number; perfNow: number } | null>(null);
    const lockedLoopSceneIdxRef = useRef<number | null>(null);
    const lastDiscreteKeyRef = useRef("");
    const currentTimeRef = useRef(currentTime);
    const isPlayingRef = useRef(isPlaying);
    const playbackModeRef = useRef(playbackMode);
    const totalDurationRef = useRef(totalDuration);

    useLayoutEffect(() => {
        sceneBoundsRef.current = getSceneBoundaries(videoDraft.scenes);
        currentTimeRef.current = currentTime;
        isPlayingRef.current = isPlaying;
        playbackModeRef.current = playbackMode;
        totalDurationRef.current = totalDuration;
    });

    const resetPlaybackState = useCallback(() => {
        isPlayingRef.current = false;
        currentTimeRef.current = 0;
        rVfcAnchorRef.current = null;
        lockedLoopSceneIdxRef.current = null;
        lastDiscreteKeyRef.current = "";
        liveClock.emit(0);
        setIsPlaying(false);
        setCurrentTime(0);
        setSeekNonce((n) => n + 1);
    }, [liveClock]);

    const setPlaybackMode = useCallback((next: VideoPlaybackMode | ((prev: VideoPlaybackMode) => VideoPlaybackMode)) => {
        lockedLoopSceneIdxRef.current = null;
        setPlaybackModeState(next);
    }, []);

    // Synthetic 120Hz clock ONLY when no native <video> is driving playback (no video, Photo scene, or Outro).
    // During native video playback, `useSmoothFramingLoop` is the single 120Hz rAF PLL emitting directly to `liveClock`.
    useEffect(() => {
        if (!isPlaying) {
            rVfcAnchorRef.current = null;
            return;
        }
        if (videoDraft.videoUrl && !isOutroActive && !activeSceneIsImage) return;

        let animId = 0;
        let lastNow = performance.now();
        let liveT = currentTimeRef.current;
        let lastSceneIdx = getActiveSceneAtTime(videoDraftRef.current, liveT).sceneIndex;

        const tick = (now: number) => {
            const dt = clamp((now - lastNow) / 1000, 0, 0.05);
            lastNow = now;
            const prev = liveT;
            const next = prev + dt;
            const curTotal = totalDurationRef.current;
            let resolved = next;
            let wrapped = false;

            if (playbackModeRef.current === "loop-angle") {
                const lockedIdx = lockedLoopSceneIdxRef.current;
                const active = (lockedIdx !== null ? sceneBoundsRef.current[lockedIdx] : undefined)
                    ?? sceneBoundsRef.current.find((b) => prev >= b.start && prev < b.end);
                if (active && lockedIdx === null) lockedLoopSceneIdxRef.current = active.idx;
                if (active && next >= active.end) {
                    resolved = active.start;
                    wrapped = true;
                } else if (curTotal > 0 && next >= curTotal) {
                    resolved = 0;
                    wrapped = true;
                }
            } else if (curTotal > 0 && next >= curTotal) {
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
    }, [isPlaying, videoDraft.videoUrl, isOutroActive, activeSceneIsImage, liveClock, videoDraftRef]);

    const togglePlay = useCallback(() => {
        const wasPlaying = isPlayingRef.current;
        if (wasPlaying) {
            const rawPaused = liveClock.getTime();
            const exactPausedTime = Number.isFinite(rawPaused) ? Math.max(0, rawPaused) : currentTimeRef.current;
            currentTimeRef.current = exactPausedTime;
            setCurrentTime(exactPausedTime);
            lockedLoopSceneIdxRef.current = null;
        } else if (playbackModeRef.current === "loop-angle") {
            const t = currentTimeRef.current;
            const idx = sceneBoundsRef.current.findIndex((b) => t >= b.start && t < b.end);
            lockedLoopSceneIdxRef.current = idx >= 0 ? idx : null;
        }
        isPlayingRef.current = !wasPlaying;
        setIsPlaying(!wasPlaying);
    }, [liveClock]);

    const seekTo = useCallback((time: number) => {
        const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
        rVfcAnchorRef.current = { time: safeTime, perfNow: performance.now() };
        currentTimeRef.current = safeTime;
        if (playbackModeRef.current === "loop-angle") {
            const idx = sceneBoundsRef.current.findIndex((b) => safeTime >= b.start && safeTime < b.end);
            lockedLoopSceneIdxRef.current = idx >= 0 ? idx : null;
        } else {
            lockedLoopSceneIdxRef.current = null;
        }
        liveClock.emit(safeTime);
        setCurrentTime(safeTime);
        setSeekNonce((n) => n + 1);
    }, [liveClock]);

    const syncTimeFromVideo = useCallback((mediaTime: number, mediaDuration?: number) => {
        if (!Number.isFinite(mediaTime)) return;
        const safeTime = Math.max(0, mediaTime);
        const curTotal = totalDurationRef.current;

        if (playbackModeRef.current === "loop-angle") {
            const prev = currentTimeRef.current;
            const lockedIdx = lockedLoopSceneIdxRef.current;
            const active = (lockedIdx !== null ? sceneBoundsRef.current[lockedIdx] : undefined)
                ?? sceneBoundsRef.current.find((b) => prev >= b.start && prev < b.end);
            if (active && lockedIdx === null) lockedLoopSceneIdxRef.current = active.idx;
            const { hasReHook, preStoryDur, hookOffset, storyOffset } = getTimelineStructure(videoDraftRef.current.scenes || []);
            // Hook/Re-Hook wraps with custom jumps are owned exclusively by `syncTimelineTick` (0.022s cut) to prevent double-seeks
            const ownedByVideoSync = Boolean(active && active.start < preStoryDur && (hasReHook || hookOffset > 0 || storyOffset > 0));
            if (active && !ownedByVideoSync && safeTime >= active.end - 0.04) {
                seekTo(active.start);
                return;
            }
        }
        if (curTotal > 0 && safeTime >= curTotal) {
            seekTo(0);
            return;
        }

        const now = performance.now();
        const prevAnchor = rVfcAnchorRef.current;
        // Widen elapsed clamp to 1.0s so a single 350ms 4K decode hiccup doesn't trigger `isJump` root re-renders (`A17`)
        const expectedT = prevAnchor
            ? prevAnchor.time + clamp((now - prevAnchor.perfNow) / 1000, 0, 1.0)
            : currentTimeRef.current;
        const isJump = Math.abs(safeTime - expectedT) >= 0.35;
        rVfcAnchorRef.current = { time: safeTime, perfNow: now };
        currentTimeRef.current = safeTime;

        const curDraft = videoDraftRef.current;
        const sceneState = getActiveSceneAtTime(curDraft, safeTime);
        const captionsOn = sceneState.scene?.showSubtitles ?? (curDraft.showSubtitles !== false);
        const activeSubId = captionsOn && curDraft.subtitles?.length
            ? (findSubtitleAtMediaTime(curDraft.subtitles, wrapMediaTime(curDraft, safeTime, curDraft.videoDuration || 0))?.id ?? "")
            : "";
        const discreteKey = `${sceneState.sceneIndex}:${sceneState.isOutro ? 1 : 0}:${activeSubId}:${safeTime < 1.8 ? 1 : 0}`;

        if (isJump || discreteKey !== lastDiscreteKeyRef.current) {
            lastDiscreteKeyRef.current = discreteKey;
            setCurrentTime(safeTime);
        }

        if (mediaDuration !== undefined && Number.isFinite(mediaDuration) && mediaDuration > 0) {
            if (!curDraft.videoDuration || Math.abs(curDraft.videoDuration - mediaDuration) > 1.5) {
                onPersistDuration(mediaDuration);
            }
        }
    }, [onPersistDuration, seekTo, videoDraftRef]);

    return {
        isPlaying,
        togglePlay,
        playbackMode,
        setPlaybackMode,
        currentTime,
        liveClock,
        seekNonce,
        seekTo,
        syncTimeFromVideo,
        resetPlaybackState,
    };
}
