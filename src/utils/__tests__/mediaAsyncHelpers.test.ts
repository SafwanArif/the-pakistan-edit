import { describe, expect, it } from "vitest";
import {
    seekMediaElement,
    waitForMediaEvent,
    waitForNextVideoFrame,
} from "../../components/templates/VideoCard/mediaAsyncHelpers";

describe("mediaAsyncHelpers — AbortSignal-scoped media synchronization", () => {
    it("resolves waitForMediaEvent immediately when predicate already holds or on matching event", async () => {
        const target = new EventTarget();
        const ac = new AbortController();

        expect(await waitForMediaEvent(target, ["canplay"], { signal: ac.signal, timeoutMs: 200, predicate: () => true })).toBe(true);

        const p = waitForMediaEvent(target, ["canplay"], { signal: ac.signal, timeoutMs: 200 });
        target.dispatchEvent(new Event("canplay"));
        expect(await p).toBe(true);
    });

    it("aborts waitForMediaEvent cleanly and detaches all listeners", async () => {
        const target = new EventTarget();
        let predicateCalls = 0;
        const ac = new AbortController();

        const p = waitForMediaEvent(target, ["seeked", "canplay"], {
            signal: ac.signal,
            timeoutMs: 5000,
            predicate: () => {
                predicateCalls += 1;
                return false;
            },
        });
        expect(predicateCalls).toBe(1);
        ac.abort();
        expect(await p).toBe(false);
        // Dispatching events after abort must not invoke our detached listener
        target.dispatchEvent(new Event("seeked"));
        target.dispatchEvent(new Event("canplay"));
        expect(predicateCalls).toBe(1);
    });

    it("skips seekMediaElement when within 45ms tolerance and awaits seeked otherwise", async () => {
        const target = new EventTarget();
        let currentTime = 12.02;
        let seeking = false;
        Object.defineProperties(target, {
            readyState: { value: 4 },
            currentTime: {
                get() { return currentTime; },
                set(val: number) {
                    currentTime = val;
                    seeking = true;
                    queueMicrotask(() => {
                        seeking = false;
                        target.dispatchEvent(new Event("seeked"));
                    });
                },
            },
            seeking: { get() { return seeking; } },
        });
        const fakeEl = target as unknown as HTMLMediaElement;

        const ac = new AbortController();
        // Within 45ms -> instant no-op
        expect(await seekMediaElement(fakeEl, 12.04, { signal: ac.signal })).toBe(true);
        expect(currentTime).toBe(12.02);

        // Outside 45ms -> seeks and awaits seeked
        expect(await seekMediaElement(fakeEl, 37.5, { signal: ac.signal })).toBe(true);
        expect(currentTime).toBe(37.5);
    });

    it("cancels requestVideoFrameCallback on AbortSignal abort and refuses blind launch when readyState < 3", async () => {
        const cancelledIds: number[] = [];
        const target = new EventTarget();
        const fakeVideo = Object.assign(target, {
            paused: false,
            seeking: false,
            readyState: 2,
            currentTime: 10.5,
            requestVideoFrameCallback: () => 42,
            cancelVideoFrameCallback: (id: number) => { cancelledIds.push(id); },
        }) as unknown as HTMLVideoElement;

        // Abort cancels rVFC handle 42 cleanly (eliminates ghost rVFC bug A3)
        const ac = new AbortController();
        const pAbort = waitForNextVideoFrame(fakeVideo, { signal: ac.signal, timeoutMs: 500 });
        ac.abort();
        expect(await pAbort).toBeNull();
        expect(cancelledIds).toEqual([42]);

        // Timeout with readyState < 3 returns null instead of blindly launching audio (eliminates bug A11)
        const ac2 = new AbortController();
        expect(await waitForNextVideoFrame(fakeVideo, { signal: ac2.signal, timeoutMs: 20 })).toBeNull();
    });
});
