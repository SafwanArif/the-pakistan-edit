import { describe, expect, it, vi } from "vitest";
import type { VideoKeyframe } from "../../types/news";
import { interpolateKeyframe, interpolateKeyframeInto } from "../videoTimeline";
import { createLivePlaybackClock } from "../../app/admin/utils/livePlaybackClock";

describe("120Hz zero-allocation helpers", () => {
    it("interpolateKeyframeInto matches interpolateKeyframe identically across smooth, snap, pre-snap, and 4:5 transitions", () => {
        const keyframes: VideoKeyframe[] = [
            { id: "k1", time: 2.0, zoom: 0, posX: 20, posY: 40, easing: "smooth" },
            { id: "k2", time: 5.0, zoom: 140, posX: 80, easing: "snap", pre: { time: 4.0, zoom: 100, posX: 60, posY: 70 } },
            { id: "k3", time: 8.0, zoom: 50, posX: 30, posY: 25, easing: "smooth" },
        ];
        const fallback = { zoom: 0, posX: 50, posY: 100 };
        const out = { zoom: 0, posX: 0, posY: 0 };

        for (const t of [0, 0.5, 1.9, 2.0, 3.0, 4.0, 4.5, 5.0, 6.5, 8.0, 10.0]) {
            const expected = interpolateKeyframe(keyframes, t, fallback);
            const result = interpolateKeyframeInto(keyframes, t, fallback, out);
            expect(result).toBe(out);
            expect(result.zoom).toBeCloseTo(expected.zoom, 6);
            expect(result.posX).toBeCloseTo(expected.posX, 6);
            expect(result.posY).toBeCloseTo(expected.posY, 6);
        }
    });

    it("createLivePlaybackClock emits live frames to subscribers and stops notifying after unsubscribe", () => {
        const clock = createLivePlaybackClock(1.25);
        expect(clock.getTime()).toBe(1.25);

        const seen: number[] = [];
        const listener = vi.fn((frame: { time: number }) => seen.push(frame.time));
        const unsub = clock.subscribe(listener);

        clock.emit(2.5, 120, 45, 100, false);
        clock.emit(3.75, 130, 55, 100, false);
        expect(clock.getTime()).toBe(3.75);
        expect(seen).toEqual([2.5, 3.75]);

        unsub();
        clock.emit(5.0);
        expect(clock.getTime()).toBe(5.0);
        expect(seen).toEqual([2.5, 3.75]);
    });
});
