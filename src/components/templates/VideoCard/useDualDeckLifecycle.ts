"use client";

import { useCallback, useRef, type MutableRefObject, type RefObject } from "react";

export const clearTimerRef = (ref: MutableRefObject<ReturnType<typeof setTimeout> | null>): void => {
    if (ref.current !== null) {
        clearTimeout(ref.current);
        ref.current = null;
    }
};

export const setDeckVisibility = (el: HTMLVideoElement | null, visible: boolean): void => {
    if (!el) return;
    el.style.opacity = visible ? '1' : '0';
    el.style.zIndex = visible ? '2' : '1';
};

/**
 * Owns dual-deck `<video>` DOM refs, StrictMode-safe hardware decoder teardown on detach/unmount,
 * and single-handle `requestVideoFrameCallback` ownership across instant deck swaps.
 */
export const useDualDeckLifecycle = (ctxRef: RefObject<{ isPlaying: boolean }>) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const standbyVideoRef = useRef<HTMLVideoElement>(null);
    const activeVideoRef = useRef<HTMLVideoElement | null>(null);
    const activeDeckRef = useRef<0 | 1>(0);
    const rVfcHandleRef = useRef<{ el: HTMLVideoElement; id: number } | null>(null);
    const rVfcCallbackRef = useRef<VideoFrameRequestCallback | null>(null);
    const lastPrimaryElRef = useRef<HTMLVideoElement | null>(null);
    const lastStandbyElRef = useRef<HTMLVideoElement | null>(null);

    const releaseDetachedDeck = useCallback((el: HTMLMediaElement | null) => {
        if (!el || el.isConnected) return;
        try {
            el.pause();
            el.removeAttribute("src");
            el.load();
        } catch { /* ignore detached media element teardown errors */ }
    }, []);

    const getActiveVideo = useCallback(() => activeVideoRef.current ?? videoRef.current, []);
    const getStandbyVideo = useCallback(() => (activeDeckRef.current === 0 ? standbyVideoRef.current : videoRef.current), []);

    const cancelRvfc = useCallback(() => {
        const handle = rVfcHandleRef.current;
        if (handle && typeof handle.el.cancelVideoFrameCallback === 'function') {
            try { handle.el.cancelVideoFrameCallback(handle.id); } catch { /* ignore detached cancel */ }
        }
        rVfcHandleRef.current = null;
    }, []);

    const scheduleRvfc = useCallback((el: HTMLVideoElement | null) => {
        cancelRvfc();
        if (!el || !rVfcCallbackRef.current || typeof el.requestVideoFrameCallback !== 'function' || !ctxRef.current.isPlaying) return;
        rVfcHandleRef.current = { el, id: el.requestVideoFrameCallback(rVfcCallbackRef.current) };
    }, [cancelRvfc, ctxRef]);

    const syncMountedDecks = useCallback((useStandbyDeck: boolean) => {
        const prevPrimary = lastPrimaryElRef.current;
        const prevStandby = lastStandbyElRef.current;
        lastPrimaryElRef.current = videoRef.current;
        lastStandbyElRef.current = standbyVideoRef.current;
        if (prevPrimary && prevPrimary !== videoRef.current) releaseDetachedDeck(prevPrimary);
        if (prevStandby && prevStandby !== standbyVideoRef.current) releaseDetachedDeck(prevStandby);

        if ((!activeVideoRef.current || !activeVideoRef.current.isConnected || (!useStandbyDeck && activeDeckRef.current === 1)) && videoRef.current) {
            activeVideoRef.current = videoRef.current;
            activeDeckRef.current = 0;
            setDeckVisibility(videoRef.current, true);
        }
    }, [releaseDetachedDeck]);

    const resetDecksToPrimary = useCallback(() => {
        activeDeckRef.current = 0;
        activeVideoRef.current = videoRef.current;
        setDeckVisibility(videoRef.current, true);
        setDeckVisibility(standbyVideoRef.current, false);
    }, []);

    const releaseAllVideoDecks = useCallback(() => {
        cancelRvfc();
        releaseDetachedDeck(lastPrimaryElRef.current);
        releaseDetachedDeck(lastStandbyElRef.current);
    }, [cancelRvfc, releaseDetachedDeck]);

    return {
        videoRef, standbyVideoRef, activeVideoRef, activeDeckRef, rVfcHandleRef, rVfcCallbackRef,
        getActiveVideo, getStandbyVideo, releaseDetachedDeck, cancelRvfc, scheduleRvfc,
        syncMountedDecks, resetDecksToPrimary, releaseAllVideoDecks,
    };
};
