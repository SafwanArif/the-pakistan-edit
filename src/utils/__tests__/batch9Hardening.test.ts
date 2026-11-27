import { describe, expect, it } from "vitest";
import {
    buildSrtContent,
    clamp,
    createDefaultDraft,
    createDefaultVideoDraft,
    DEFAULT_STAR_CUES,
    ensureUniqueSceneIds,
    getDefaultVideoFraming,
    getMediaSubtitleTimelineTime,
    getSlideCount,
    getTimelineStructure,
    getTopBoxOffsetY,
    interpolateKeyframeInto,
    mediaTimeToTimelineTime,
    projectSubtitlesToTimeline,
    resolveKeyframeSpan,
    REST_CUE_STATE,
    switchVideoAspectRatio,
    timelineTimeToMediaTime,
    wrapMediaTime,
} from "@/types/news";
import { findParkedKeyframe, updateKeyframeFraming, updateKeyframeTime } from "../videoKeyframes";

describe("Batch 9 — Core Types & Pure Utils hardening (P300-P331)", () => {
    it("guards clamp(NaN) while preserving ±Infinity exactness (P302)", () => {
        expect(clamp(Number.NaN, 10, 100)).toBe(10);
        expect(clamp(Number.POSITIVE_INFINITY, 10, 100)).toBe(100);
        expect(clamp(Number.NEGATIVE_INFINITY, 10, 100)).toBe(10);
    });

    it("terminates ensureUniqueSceneIds on collisions, heals whitespace IDs, and guards missing scene.id (P317, P330)", () => {
        const scenes = [
            { id: "scene-3", title: "A", duration: 4 },
            { id: "scene-3-2", title: "B", duration: 4 },
            { id: "scene-3", title: "C", duration: 4 },
            { id: "   ", title: "D", duration: 4 },
        ];
        const unique = ensureUniqueSceneIds(scenes);
        expect(new Set(unique.map((s) => s.id)).size).toBe(4);
        expect(unique[2]?.id).toBe("scene-3-3");
        expect(unique[3]?.id).toBe("scene-4");

        const malformed = [{ id: "scene-1", title: "A", duration: 4 }, { id: undefined as unknown as string, title: "B", duration: 4 }];
        expect(getTimelineStructure(malformed).hasReHook).toBe(false);
    });

    it("preserves filled Slide 4 in getSlideCount and guards NaN framing & ratio migration posY (P300, P301, P323)", () => {
        const draft = createDefaultDraft();
        draft.summary = "Body";
        draft.extraSlides = [{ heading: "", content: "" }, { heading: "", content: "Slide 4 insight" }];
        expect(getSlideCount(draft)).toBe(4);

        const video = createDefaultVideoDraft();
        video.zoom = Number.NaN;
        video.posX = Number.NaN;
        video.posY = Number.NaN;
        expect(getDefaultVideoFraming(video, "9:16")).toEqual({ zoom: 100, posX: 50, posY: 100 });
        expect(getTopBoxOffsetY(Number.NaN, 1350, 608)).toBe(0);

        video.keyframes = [{ id: "k1", time: 2, zoom: 100, posX: 50, posY: Number.NaN, easing: "snap", pre: { zoom: 100, posX: 50, posY: Number.NaN } }];
        const migrated = switchVideoAspectRatio(video, "4:5");
        expect(migrated.keyframes?.[0]?.posY).toBe(100);
        expect(migrated.keyframes?.[0]?.easing === "snap" ? migrated.keyframes[0].pre?.posY : undefined).toBe(100);
    });

    it("freezes REST_CUE_STATE and exports DEFAULT_STAR_CUES cleanly without circularity (P305, P313)", () => {
        expect(Object.isFrozen(REST_CUE_STATE)).toBe(true);
        expect(DEFAULT_STAR_CUES).toEqual([{ id: "star-0", time: 0 }]);
    });

    it("drops NaN/non-string cues, sorts unsorted cues, terminates on Infinity duration, and guards mediaStart (P307, P315, P319, P322)", () => {
        const draft = createDefaultVideoDraft();
        draft.videoDuration = 10;
        draft.subtitles = [
            { id: "b", start: 2, end: 3, text: "Second" },
            { id: "bad", start: Number.NaN, end: 4, text: "Corrupt" },
            { id: "non-str", start: 1, end: 2, text: undefined as unknown as string },
            { id: "a", start: 0.5, end: 1.5, text: "First" },
        ];
        const projected = projectSubtitlesToTimeline(draft, {
            scenes: [{ id: "s1", title: "Hook", duration: 4 }],
            bounds: [{ start: 0, end: 4 }],
            masterDuration: 10,
        });
        expect(projected.map((c) => c.text)).toEqual(["First", "Second"]);

        const infProjected = projectSubtitlesToTimeline(draft, {
            scenes: [{ id: "s1", title: "Hook", duration: Number.POSITIVE_INFINITY }],
            bounds: [{ start: 0, end: Number.POSITIVE_INFINITY }],
            masterDuration: 10,
        });
        expect(infProjected).toEqual([]);
        expect(buildSrtContent([
            { id: "1", start: Number.NaN, end: 2, text: "Bad" },
            { id: "2", start: 0, end: 1, text: null as unknown as string },
            { id: "3", start: 1, end: 2, text: "Good" },
        ])).toContain("Good");
        expect(getMediaSubtitleTimelineTime(draft, Number.NaN)).toBe(0);
    });

    it("picks the closest parked keyframe within tolerance and rejects non-finite updates (P309, P316, P320, P329)", () => {
        const kfs = [
            { id: "k1", time: 2.0, zoom: 100, posX: 50, easing: "smooth" as const },
            { id: "k2", time: 2.04, zoom: 120, posX: 60, easing: "smooth" as const },
        ];
        expect(findParkedKeyframe(kfs, 2.038, 0.05)).toEqual({ index: 1, inferredSide: null });

        const draft = createDefaultVideoDraft();
        draft.keyframes = kfs;
        expect(updateKeyframeTime(draft, {
            existingIndex: 0, nextRawTime: Number.NaN, side: "post", duration: 10, defaultFraming: { zoom: 100, posX: 50, posY: 100 },
        })).toBeNull();
        expect(updateKeyframeFraming(draft, {
            existingIndex: 0, effectiveEditSide: "post", field: "zoom", val: Number.NaN,
            activeFraming: { zoom: 100, posX: 50, posY: 100 }, defaultFraming: { zoom: 100, posX: 50, posY: 100 },
            isTopBox45: false, isLetterboxActive: false,
        })).toBeNull();
    });

    it("handles NaN kf.time, pre.time=NaN, non-finite fallback, and negative wrapMediaTime cleanly (P311, P314, P318, P328)", () => {
        const kfs = [
            { id: "k1", time: 2, zoom: 100, posX: 50, easing: "smooth" as const },
            { id: "kbad", time: Number.NaN, zoom: 120, posX: 60, easing: "smooth" as const },
            { id: "k2", time: 6, zoom: 140, posX: 70, easing: "snap" as const, pre: { time: Number.NaN, zoom: 110, posX: 55 } },
        ];
        expect(resolveKeyframeSpan(kfs, 4, { zoom: 100, posX: 50, posY: 100 }).kind).toBe("glide");
        const out = interpolateKeyframeInto(kfs, 4, { zoom: Number.NaN, posX: Number.NaN, posY: Number.NaN }, { zoom: 0, posX: 0, posY: 0 });
        expect(Number.isFinite(out.zoom) && Number.isFinite(out.posX) && Number.isFinite(out.posY)).toBe(true);

        const draft = createDefaultVideoDraft();
        expect(timelineTimeToMediaTime(draft, -0.5)).toBe(0);
        expect(wrapMediaTime(draft, -0.5, 10)).toBe(0);
        expect(mediaTimeToTimelineTime(draft, -0.05, 10, 30)).toBeGreaterThanOrEqual(0);
    });
});
