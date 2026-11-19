import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, getTopBoxOffsetY, type VideoDraft } from "../../types/news";
import {
    getHookTransitionFade,
    getSceneRoleLabel,
    getTimelineStructure,
    interpolateKeyframe,
    isSharedReHookScene,
    mediaTimeToTimelineTime,
    parseTimeInput,
    timelineTimeToMediaTime,
    wrapMediaTime,
} from "../videoTimeline";
import {
    findSubtitleAtMediaTime,
    getActiveSubtitleTimelineTimes,
} from "../subtitleTimeline";
import { getKeyframeTelemetryTint } from "../../app/admin/utils/keyframeTelemetry";

const makeDraft = (overrides: Partial<VideoDraft> = {}): VideoDraft => ({
    ...createDefaultVideoDraft(),
    ...overrides,
});

describe("parseTimeInput", () => {
    it("parses raw seconds and MM:SS.d strings", () => {
        expect(parseTimeInput("19.7")).toBe(19.7);
        expect(parseTimeInput("01:15.5")).toBe(75.5);
        expect(parseTimeInput("  00:04  ")).toBe(4);
    });

    it("rejects empty or invalid strings", () => {
        expect(parseTimeInput("")).toBeNull();
        expect(parseTimeInput("   ")).toBeNull();
        expect(parseTimeInput("abc")).toBeNull();
        expect(parseTimeInput("01:xx")).toBeNull();
    });
});

describe("getTimelineStructure", () => {
    it("detects Hook, Re-Hook, and Story indices and offsets", () => {
        const draft = makeDraft({
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, clipStartOffset: 10 },
                { id: "rehook-1", title: "R", subtitle: "S", duration: 3, clipStartOffset: 22 },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 55, clipStartOffset: 2 },
            ],
        });
        expect(getTimelineStructure(draft.scenes)).toEqual({
            hasReHook: true,
            storyIdx: 2,
            hookDur: 4,
            rehookDur: 3,
            preStoryDur: 7,
            hookOffset: 10,
            rehookOffset: 22,
            storyOffset: 2,
        });
    });

    it("handles timelines without a Re-Hook", () => {
        const draft = makeDraft({
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 5 },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 55, clipStartOffset: 3 },
            ],
        });
        expect(getTimelineStructure(draft.scenes)).toEqual({
            hasReHook: false,
            storyIdx: 1,
            hookDur: 5,
            rehookDur: 0,
            preStoryDur: 5,
            hookOffset: 0,
            rehookOffset: 0,
            storyOffset: 3,
        });
    });
});

describe("interpolateKeyframe", () => {
    it("returns fallbacks when no keyframes exist", () => {
        expect(interpolateKeyframe(undefined, 2, { zoom: 110, posX: 40, posY: 80 })).toEqual({
            zoom: 110,
            posX: 40,
            posY: 80,
        });
    });

    it("interpolates smoothly between keyframes and respects snap", () => {
        const kfs = [
            { id: "k1", time: 0, zoom: 0, posX: 50, posY: 100, easing: "smooth" as const },
            { id: "k2", time: 10, zoom: 100, posX: 0, posY: 0, easing: "smooth" as const },
        ];
        expect(interpolateKeyframe(kfs, 5)).toEqual({ zoom: 50, posX: 25, posY: 50 });

        const snapKfs = [
            { id: "k1", time: 0, zoom: 10, posX: 20, posY: 100, easing: "smooth" as const },
            { id: "k2", time: 10, zoom: 90, posX: 80, posY: 0, easing: "snap" as const },
        ];
        expect(interpolateKeyframe(snapKfs, 5)).toEqual({ zoom: 10, posX: 20, posY: 100 });
        expect(interpolateKeyframe(snapKfs, 10)).toEqual({ zoom: 90, posX: 80, posY: 0 });
    });

    it("supports single-keyframe dual-state Pre/Post cuts", () => {
        const dualKfs = [
            { id: "k1", time: 0, zoom: 100, posX: 50, posY: 100, easing: "smooth" as const },
            {
                id: "k2",
                time: 5,
                zoom: 140,
                posX: 80,
                posY: 0,
                easing: "snap" as const,
                pre: { zoom: 120, posX: 50, posY: 100 },
            },
        ];
        // Eases toward pre-state before t=5
        expect(interpolateKeyframe(dualKfs, 2.5)).toEqual({ zoom: 110, posX: 50, posY: 100 });
        // At t=5, hard-cuts to post-state
        expect(interpolateKeyframe(dualKfs, 5)).toEqual({ zoom: 140, posX: 80, posY: 0 });
    });

    it("supports independent pre.time for hold-before-cut dwell inside one Cut Keyframe", () => {
        const dwellKfs = [
            { id: "k1", time: 0, zoom: 100, posX: 50, posY: 100, easing: "smooth" as const },
            {
                id: "k2",
                time: 5,
                zoom: 140,
                posX: 80,
                posY: 100,
                easing: "snap" as const,
                pre: { time: 4, zoom: 120, posX: 50, posY: 100 },
            },
        ];
        // Halfway through [0, 4] -> zoom 110
        expect(interpolateKeyframe(dwellKfs, 2)).toEqual({ zoom: 110, posX: 50, posY: 100 });
        // Holds pre-state across [4, 5)
        expect(interpolateKeyframe(dwellKfs, 4.5)).toEqual({ zoom: 120, posX: 50, posY: 100 });
        // Cuts to post-state at t=5
        expect(interpolateKeyframe(dwellKfs, 5)).toEqual({ zoom: 140, posX: 80, posY: 100 });
    });

    it("holds base fallback framing before the first keyframe when no kf-0 exists at t=0", () => {
        const singleCut = [{ id: "k1", time: 5, zoom: 135, posX: 75, posY: 100, easing: "snap" as const }];
        const fb = { zoom: 100, posX: 50, posY: 100 };
        expect(interpolateKeyframe(singleCut, 2.5, fb)).toEqual({ zoom: 100, posX: 50, posY: 100 });
        expect(interpolateKeyframe(singleCut, 5, fb)).toEqual({ zoom: 135, posX: 75, posY: 100 });
    });

    it("defaults starting framing (0s -> cut) to the first Cut Keyframe's pre state when no earlier keyframe exists", () => {
        const firstCutWithPre = [
            { id: "k1", time: 5, zoom: 145, posX: 80, posY: 100, easing: "snap" as const, pre: { zoom: 120, posX: 30, posY: 100 } },
        ];
        const fb = { zoom: 100, posX: 50, posY: 100 };
        expect(interpolateKeyframe(firstCutWithPre, 0, fb)).toEqual({ zoom: 120, posX: 30, posY: 100 });
        expect(interpolateKeyframe(firstCutWithPre, 2.5, fb)).toEqual({ zoom: 120, posX: 30, posY: 100 });
        expect(interpolateKeyframe(firstCutWithPre, 5, fb)).toEqual({ zoom: 145, posX: 80, posY: 100 });
    });
});

describe("getTopBoxOffsetY", () => {
    it("maps 100 to top (0px) and 0 to bottom edge (containerH - boxH)", () => {
        expect(getTopBoxOffsetY(100, 1350, 608)).toBe(0);
        expect(getTopBoxOffsetY(0, 1350, 608)).toBe(742);
        expect(getTopBoxOffsetY(undefined, 1350, 608)).toBe(0);
    });
});

describe("getHookTransitionFade", () => {
    it("returns micro-dip fade near anchored Hook -> Re-Hook boundary and 0 mid-scene", () => {
        const draft = makeDraft();
        expect(getHookTransitionFade(draft, 2)).toBe(0);
        expect(getHookTransitionFade(draft, 3.99)).toBeGreaterThan(0.5);
        expect(getHookTransitionFade(draft, 4.0)).toBeCloseTo(1, 5);
    });
});

describe("timelineTimeToMediaTime, wrapMediaTime & mediaTimeToTimelineTime", () => {
    const draft = makeDraft({
        videoDuration: 30,
        scenes: [
            { id: "scene-1", title: "H", subtitle: "S", duration: 4, clipStartOffset: 12 },
            { id: "rehook-1", title: "R", subtitle: "S", duration: 4, clipStartOffset: 20 },
            { id: "scene-2", title: "Story", subtitle: "S", duration: 55, clipStartOffset: 2 },
        ],
    });

    it("maps Hook, Re-Hook, and Story timeline timestamps to media time", () => {
        expect(timelineTimeToMediaTime(draft, 1.5)).toBe(13.5);
        expect(timelineTimeToMediaTime(draft, 5.0)).toBe(21.0);
        expect(timelineTimeToMediaTime(draft, 10.0)).toBe(4.0);
    });

    it("wraps Story media time within [storyOffset, clipDuration]", () => {
        // preStoryDur=8, storyOffset=2, clipDuration=30 -> span=28.
        // timelineTime=38 -> raw=2+(38-8)=32 -> 2 + (30 % 28) = 4
        expect(wrapMediaTime(draft, 38, 30)).toBe(4);
    });

    it("maps media time back to timeline time across scenes", () => {
        expect(mediaTimeToTimelineTime(draft, 13.5, 1.5)).toBe(1.5);
        expect(mediaTimeToTimelineTime(draft, 21.0, 5.0)).toBe(5.0);
        expect(mediaTimeToTimelineTime(draft, 4.0, 10.0)).toBe(10.0);
    });
});

describe("getActiveSubtitleTimelineTimes", () => {
    const subs = [
        { id: "s1", start: 0.5, end: 2.0, text: "Before story offset" },
        { id: "s2", start: 2.5, end: 4.5, text: "First story line" },
        { id: "s3", start: 13.0, end: 15.0, text: "Inside hook and story" },
        { id: "s4", start: 21.0, end: 23.0, text: "Inside rehook and later angle" },
    ];

    it("starts from Story clip start when Hook and Re-Hook CCs are switched off", () => {
        const draft = makeDraft({
            showSubtitles: true,
            subtitles: subs,
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, clipStartOffset: 12, showSubtitles: false },
                { id: "rehook-1", title: "R", subtitle: "S", duration: 4, clipStartOffset: 20, showSubtitles: false },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 30, clipStartOffset: 2 },
            ],
        });
        // preStoryDur=8, storyOffset=2 -> s1(0.5)<2 skipped; s2(2.5)->8.5; s3(13)->19; s4(21)->27
        expect(getActiveSubtitleTimelineTimes(draft)).toEqual([8.5, 19, 27]);
    });

    it("includes Hook cue times when Hook CC is on and skips mid-story cards with CC off", () => {
        const draft = makeDraft({
            showSubtitles: true,
            subtitles: subs,
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, clipStartOffset: 12, showSubtitles: true },
                { id: "rehook-1", title: "R", subtitle: "S", duration: 4, clipStartOffset: 20, showSubtitles: false },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 15, clipStartOffset: 2 },
                { id: "scene-3", title: "Angle", subtitle: "S", duration: 15, showSubtitles: false },
            ],
        });
        // Hook: s3(13) -> 13-12 = 1.0
        // Story [8, 23): s2(2.5)->8.5, s3(13)->19.0
        // Angle [23, 38) CC off: s4(21)->27.0 skipped
        expect(getActiveSubtitleTimelineTimes(draft)).toEqual([1, 8.5, 19]);
    });

    it("respects Hook CC off when no custom offsets or Re-Hook are set", () => {
        const draft = makeDraft({
            showSubtitles: true,
            subtitles: [
                { id: "a", start: 1.5, end: 3.0, text: "Hook region" },
                { id: "b", start: 5.0, end: 7.0, text: "Story region" },
            ],
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, showSubtitles: false },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 20 },
            ],
        });
        expect(getActiveSubtitleTimelineTimes(draft)).toEqual([5]);
    });

    it("includes a subtitle straddling storyOffset at preStoryDur (10.0s) instead of skipping to the second cue", () => {
        const draft = makeDraft({
            showSubtitles: true,
            subtitles: [
                { id: "c1", start: 0.0, end: 2.8, text: "Like, look, us South Asian man, right?" },
                { id: "c2", start: 2.8, end: 4.5, text: "We've been here for a long time." },
                { id: "c3", start: 4.5, end: 7.0, text: "You know, like, a lot of immigrant groups." },
            ],
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, clipStartOffset: 19.6, showSubtitles: false },
                { id: "rehook-1", title: "R", subtitle: "S", duration: 6, clipStartOffset: 161.7, showSubtitles: false },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 167, clipStartOffset: 0.9 },
            ],
        });
        expect(getActiveSubtitleTimelineTimes(draft)).toEqual([10, 11.9, 13.6]);
    });
});

describe("findSubtitleAtMediaTime, getSceneRoleLabel, isSharedReHookScene & getKeyframeTelemetryTint", () => {
    it("absorbs IEEE-754 float drift at half-open subtitle boundaries", () => {
        const subs = [
            { id: "1", start: 0, end: 2.8, text: "First" },
            { id: "2", start: 2.8, end: 4.5, text: "Second" },
            { id: "3", start: 4.5, end: 7.0, text: "Third" },
        ];
        expect(findSubtitleAtMediaTime(subs, 0.9 + (11.9 - 10))?.id).toBe("2");
        expect(findSubtitleAtMediaTime(subs, 0.9 + (13.6 - 10))?.id).toBe("3");
    });

    it("resolves canonical scene role labels and shared Re-Hook state", () => {
        const scenes = createDefaultVideoDraft().scenes;
        expect(getSceneRoleLabel(scenes, 0)).toBe("01. HOOK");
        expect(getSceneRoleLabel(scenes, 1)).toBe("02. RE-HOOK");
        expect(getSceneRoleLabel(scenes, 2)).toBe("03. STORY");
        expect(isSharedReHookScene(scenes, 1)).toBe(true);
        expect(isSharedReHookScene(scenes, 0)).toBe(false);
    });

    it("blends keyframe telemetry tint smoothly from PRE blue to GLIDE gold", () => {
        const kfs = [
            { id: "k1", time: 4, zoom: 120, posX: 50, easing: "snap" as const, pre: { time: 2, zoom: 100, posX: 50 } },
            { id: "k2", time: 10, zoom: 150, posX: 60, easing: "smooth" as const },
        ];
        expect(getKeyframeTelemetryTint(kfs, 1, "post", -1).color).toBe("var(--ui-text-dim)");
        expect(getKeyframeTelemetryTint(kfs, 3, "post", -1).color).toBe("var(--ui-pre)");
        expect(getKeyframeTelemetryTint(kfs, 7, "post", -1).color).toBe("color-mix(in oklch, var(--ui-accent) 50%, var(--ui-pre))");
        expect(getKeyframeTelemetryTint(kfs, 15, "post", -1).color).toBe("var(--ui-accent)");
    });
});
