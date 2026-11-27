/**
 * Zero-leak, `AbortSignal`-scoped Web Platform media synchronization primitives.
 * Eliminates manual `removeEventListener`, timer leaks, and stale `rVFC` ghost callbacks.
 */
import { getTotalVideoDuration, type VideoDraft } from "@/types/news";

interface MediaWaitOptions {
    signal: AbortSignal;
    timeoutMs: number;
    predicate?: () => boolean;
}

const normalizeTimeoutMs = (timeoutMs: number): number => (Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0);

/** Formats media playback errors consistently for live A/V sync diagnostics. */
export const formatMediaError = (err: unknown): string =>
    err instanceof Error ? `${err.name}: ${err.message}` : String(err);

/** Writes `el.currentTime` guarded against non-finite values and detached-element exceptions. */
export const safeSetMediaTime = (el: HTMLMediaElement, targetSec: number): boolean => {
    if (!Number.isFinite(targetSec)) return false;
    try {
        el.currentTime = Math.max(0, targetSec);
        return true;
    } catch {
        return false;
    }
};

/** Returns finite video duration, falling back to draft duration for loaded headerless WebM (`duration === Infinity`). */
export const getFiniteDuration = (video: HTMLVideoElement, draft?: VideoDraft): number | null => {
    if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
    if (video.readyState >= 1 && video.duration === Infinity && draft) {
        if (Number.isFinite(draft.videoDuration) && (draft.videoDuration ?? 0) > 0.05) return draft.videoDuration!;
        const fallback = getTotalVideoDuration(draft);
        if (Number.isFinite(fallback) && fallback > 0.05) return fallback;
    }
    return null;
};

/** Resolves `true` when `predicate` holds or any listed event fires; `false` on timeout or `signal.abort`. */
export const waitForMediaEvent = (
    target: EventTarget,
    events: readonly string[],
    { signal, timeoutMs, predicate }: MediaWaitOptions
): Promise<boolean> => {
    if (signal.aborted) return Promise.resolve(false);
    if (predicate?.()) return Promise.resolve(true);

    const safeTimeoutMs = normalizeTimeoutMs(timeoutMs);
    return new Promise<boolean>((resolve) => {
        const local = new AbortController();
        let settled = false;

        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", onAbort);
            local.abort();
            resolve(ok);
        };

        const onAbort = () => finish(false);
        const onEvent = () => { if (!predicate || predicate()) finish(true); };

        const timer = setTimeout(() => finish(Boolean(predicate?.())), safeTimeoutMs);
        signal.addEventListener("abort", onAbort, { once: true });
        for (const ev of events) target.addEventListener(ev, onEvent, { signal: local.signal });
    });
};

/** Coalesced seek helper: instant no-op within `toleranceSec`, otherwise awaits `'seeked'` with `AbortSignal` cleanup. */
export const seekMediaElement = async (
    el: HTMLMediaElement,
    targetSec: number,
    options: { signal: AbortSignal; toleranceSec?: number; timeoutMs?: number }
): Promise<boolean> => {
    const { signal, toleranceSec = 0.045, timeoutMs = 4000 } = options;
    if (signal.aborted || el.readyState < 1 || !Number.isFinite(targetSec)) return false;
    const safeTarget = Math.max(0, targetSec);
    const safeTolerance = Number.isFinite(toleranceSec) && toleranceSec >= 0 ? toleranceSec : 0.045;
    const safeTimeoutMs = normalizeTimeoutMs(timeoutMs);
    if (!el.seeking && Math.abs(el.currentTime - safeTarget) <= safeTolerance) return true;

    for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) return false;
        const alreadySeeking = el.seeking;
        const waitPromise = waitForMediaEvent(el, ["seeked"], {
            signal,
            timeoutMs: safeTimeoutMs,
            predicate: () => !el.seeking && Math.abs(el.currentTime - safeTarget) <= safeTolerance,
        });
        if (!alreadySeeking && !safeSetMediaTime(el, safeTarget)) return false;
        await waitPromise;
        if (signal.aborted) return false;
        if (!el.seeking && Math.abs(el.currentTime - safeTarget) <= safeTolerance) return true;
    }
    return !signal.aborted && !el.seeking;
};

/** Awaits the next painted video frame via `requestVideoFrameCallback` (auto-cancelling on `signal.abort`). */
export const waitForNextVideoFrame = (
    video: HTMLVideoElement,
    { signal, timeoutMs }: { signal: AbortSignal; timeoutMs: number }
): Promise<number | null> => {
    if (signal.aborted) return Promise.resolve(null);
    const safeTimeoutMs = normalizeTimeoutMs(timeoutMs);

    if (typeof video.requestVideoFrameCallback === "function") {
        return new Promise<number | null>((resolve) => {
            let settled = false;
            let rVfcId: number | null = null;

            const finish = (mediaTime: number | null) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                if (rVfcId !== null && typeof video.cancelVideoFrameCallback === "function") {
                    try { video.cancelVideoFrameCallback(rVfcId); } catch { /* ignore detached cancel */ }
                    rVfcId = null;
                }
                resolve(mediaTime);
            };

            const onAbort = () => finish(null);
            const timer = setTimeout(() => {
                finish(!video.paused && !video.seeking && video.readyState >= 3 ? video.currentTime : null);
            }, safeTimeoutMs);

            signal.addEventListener("abort", onAbort, { once: true });
            rVfcId = video.requestVideoFrameCallback((_now, meta) => {
                rVfcId = null;
                finish(Number.isFinite(meta.mediaTime) ? meta.mediaTime : video.currentTime);
            });
        });
    }

    return waitForMediaEvent(video, ["playing", "timeupdate", "canplay"], {
        signal,
        timeoutMs: safeTimeoutMs,
        predicate: () => !video.paused && !video.seeking && video.readyState >= 3,
    }).then((ok) => (ok && !signal.aborted ? video.currentTime : null));
};
