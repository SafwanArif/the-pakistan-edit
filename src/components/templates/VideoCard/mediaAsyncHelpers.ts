/**
 * Zero-leak, `AbortSignal`-scoped Web Platform media synchronization primitives.
 * Eliminates manual `removeEventListener`, timer leaks, and stale `rVFC` ghost callbacks.
 */

interface MediaWaitOptions {
    signal: AbortSignal;
    timeoutMs: number;
    predicate?: () => boolean;
}

/** Resolves `true` when `predicate` holds or any listed event fires; `false` on timeout or `signal.abort`. */
export const waitForMediaEvent = (
    target: EventTarget,
    events: readonly string[],
    { signal, timeoutMs, predicate }: MediaWaitOptions
): Promise<boolean> => {
    if (signal.aborted) return Promise.resolve(false);
    if (predicate?.()) return Promise.resolve(true);

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
        const onEvent = () => {
            if (!predicate || predicate()) finish(true);
        };

        const timer = setTimeout(() => finish(Boolean(predicate?.())), timeoutMs);
        signal.addEventListener("abort", onAbort, { once: true });
        for (const ev of events) {
            target.addEventListener(ev, onEvent, { signal: local.signal });
        }
    });
};

/** Coalesced seek helper: instant no-op within `toleranceSec`, otherwise awaits `'seeked'` with `AbortSignal` cleanup. */
export const seekMediaElement = async (
    el: HTMLMediaElement,
    targetSec: number,
    options: { signal: AbortSignal; toleranceSec?: number; timeoutMs?: number }
): Promise<boolean> => {
    const { signal, toleranceSec = 0.045, timeoutMs = 4000 } = options;
    if (signal.aborted || el.readyState < 1) return false;
    if (!el.seeking && Math.abs(el.currentTime - targetSec) <= toleranceSec) return true;

    for (let attempt = 0; attempt < 2; attempt++) {
        if (signal.aborted) return false;
        const alreadySeeking = el.seeking;
        const waitPromise = waitForMediaEvent(el, ["seeked"], {
            signal,
            timeoutMs,
            predicate: () => !el.seeking && Math.abs(el.currentTime - targetSec) <= toleranceSec,
        });
        if (!alreadySeeking) {
            el.currentTime = targetSec;
        }
        await waitPromise;
        if (signal.aborted) return false;
        if (!el.seeking && Math.abs(el.currentTime - targetSec) <= toleranceSec) return true;
    }
    return !signal.aborted && !el.seeking;
};

/**
 * Awaits the next actually-painted video frame via `requestVideoFrameCallback` (auto-cancelling on `signal.abort`).
 * Never resolves with a bogus timestamp if `video.readyState < 3` on timeout (prevents blind audio launch).
 */
export const waitForNextVideoFrame = (
    video: HTMLVideoElement,
    { signal, timeoutMs }: { signal: AbortSignal; timeoutMs: number }
): Promise<number | null> => {
    if (signal.aborted) return Promise.resolve(null);

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
                    video.cancelVideoFrameCallback(rVfcId);
                    rVfcId = null;
                }
                resolve(mediaTime);
            };

            const onAbort = () => finish(null);
            const timer = setTimeout(() => {
                finish(!video.paused && !video.seeking && video.readyState >= 3 ? video.currentTime : null);
            }, timeoutMs);

            signal.addEventListener("abort", onAbort, { once: true });
            rVfcId = video.requestVideoFrameCallback((_now, meta) => {
                rVfcId = null;
                finish(meta.mediaTime);
            });
        });
    }

    return waitForMediaEvent(video, ["playing", "timeupdate", "canplay"], {
        signal,
        timeoutMs,
        predicate: () => !video.paused && !video.seeking && video.readyState >= 3,
    }).then((ok) => (ok && !signal.aborted ? video.currentTime : null));
};
