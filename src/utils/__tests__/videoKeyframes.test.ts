import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, type VideoDraft, type VideoKeyframe } from "../../types/news";
import {
    findParkedKeyframe,
    toggleKeyframeEasing,
    updateKeyframeFraming,
    updateKeyframeTime,
    upsertKeyframe,
} from "../videoKeyframes";

const makeDraft = (keyframes: VideoKeyframe[] = []): VideoDraft => ({
    ...createDefaultVideoDraft(),
    sourceFps: 25,
    keyframes,
});

describe("videoKeyframes pure mutation engine", () => {
    it("auto-infers PRE vs POST side when parked on a split SNAP keyframe", () => {
        const kfs: VideoKeyframe[] = [
            { id: "k1", time: 6.0, zoom: 140, posX: 60, easing: "snap", pre: { time: 5.2, zoom: 100, posX: 50 } },
        ];
        expect(findParkedKeyframe(kfs, 5.21)).toEqual({ index: 0, inferredSide: "pre" });
        expect(findParkedKeyframe(kfs, 5.99)).toEqual({ index: 0, inferredSide: "post" });
        expect(findParkedKeyframe(kfs, 2.0)).toEqual({ index: -1, inferredSide: null });
    });

    it("deduplicates frame-snapped timestamp collisions instead of inserting duplicate keyframes", () => {
        const draft = makeDraft([{ id: "k1", time: 2.0, zoom: 110, posX: 50, easing: "smooth" }]);
        // activeDisplayTime 2.01 snaps to 2.00 @ 25fps even if caller passes existingIndex = -1
        const { keyframes } = upsertKeyframe(draft, {
            activeDisplayTime: 2.01,
            existingIndex: -1,
            effectiveEditSide: "post",
            activeFraming: { zoom: 150, posX: 30, posY: 100 },
            isLetterboxActive: false,
            kind: "smooth",
        });
        expect(keyframes).toHaveLength(1);
        expect(keyframes[0]?.zoom).toBe(150);
        expect(keyframes[0]?.posX).toBe(30);
    });

    it("initializes pre framing cleanly when toggling GLIDE -> SNAP and clears pre on SNAP -> GLIDE", () => {
        const draft = makeDraft([{ id: "k1", time: 3.0, zoom: 135, posX: 25, easing: "smooth" }]);
        const snapped = toggleKeyframeEasing(draft, 0)!;
        expect(snapped[0]?.easing).toBe("snap");
        expect(snapped[0]?.pre).toEqual({ zoom: 135, posX: 25, posY: undefined });

        const glided = toggleKeyframeEasing(makeDraft(snapped), 0)!;
        expect(glided[0]?.easing).toBe("smooth");
        expect(glided[0]?.pre).toBeUndefined();
    });

    it("clamps SNAP PRE time strictly between the previous keyframe and its own POST time", () => {
        const draft = makeDraft([
            { id: "k1", time: 4.0, zoom: 110, posX: 50, easing: "smooth" },
            { id: "k2", time: 8.0, zoom: 160, posX: 70, easing: "snap", pre: { time: 7.5, zoom: 110, posX: 50 } },
        ]);
        const clampedLow = updateKeyframeTime(draft, {
            existingIndex: 1,
            nextRawTime: 2.0,
            side: "pre",
            duration: 30,
            defaultFraming: { zoom: 100, posX: 50, posY: 100 },
        });
        expect(clampedLow?.seekTime).toBe(4.0);
        expect(clampedLow?.keyframes[1]?.pre?.time).toBe(4.0);

        const clampedHigh = updateKeyframeTime(draft, {
            existingIndex: 1,
            nextRawTime: 10.0,
            side: "pre",
            duration: 30,
            defaultFraming: { zoom: 100, posX: 50, posY: 100 },
        });
        expect(clampedHigh?.seekTime).toBe(8.0);
    });

    it("updates PRE and POST framing independently on a SNAP keyframe", () => {
        const draft = makeDraft([
            { id: "k1", time: 4.0, zoom: 150, posX: 75, easing: "snap", pre: { zoom: 100, posX: 50 } },
        ]);
        const updatedPre = updateKeyframeFraming(draft, {
            existingIndex: 0,
            effectiveEditSide: "pre",
            field: "posX",
            val: 20,
            activeFraming: { zoom: 100, posX: 50, posY: 100 },
            defaultFraming: { zoom: 100, posX: 50, posY: 100 },
            isTopBox45: false,
            isLetterboxActive: false,
        });
        expect(updatedPre?.[0]?.pre?.posX).toBe(20);
        expect(updatedPre?.[0]?.posX).toBe(75);
    });
});
