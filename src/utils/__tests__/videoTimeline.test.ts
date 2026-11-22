import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, getTopBoxOffsetY, type VideoDraft, type VideoKeyframe } from "../../types/news";
import {
    autoPadToMonetisationThreshold,
    calculatePsychologyPacedScenes,
    ensureUniqueSceneIds,
    getActiveSceneAtTime,
    getHookTransitionFade,
    getSceneBoundaries,
    getSceneRoleLabel,
    getTimelineStructure,
    interpolateKeyframe,
    isSharedReHookScene,
    mediaTimeToTimelineTime,
    parseTimeInput,
    formatTimecode,
    nudgeTimeToFrame,
    timelineTimeToMediaTime,
    wrapMediaTime,
} from "../videoTimeline";
import {
    buildSrtContent,
    findSubtitleAtMediaTime,
    getActiveSubtitleTimelineTimes,
    getMediaSubtitleTimelineTime,
} from "../subtitleTimeline";
import {
    CIRCLE_PATH_R3,
    buildDotStarMorphPath,
    buildLogoEmblemPath,
    evaluateEmblemCue,
    evaluateSingleCueSpin,
    getCueTotalDuration,
    getStarAnimState,
    getStarDotTransform,
} from "../starMorphMath";
import { getKeyframeTelemetryTint, resolveKeyframeJumpStop } from "../../app/admin/utils/keyframeTelemetry";
import { resolveStudioShortcutSeek } from "../../app/admin/hooks/useStudioShortcuts";
import { VideoDraftResolver } from "../../app/admin/utils/dataAccessors";
import { parseScrubPillInput } from "../../app/admin/components/ScrubPillSlider";
import { resolveSceneSubtitleSeekTime } from "../../app/admin/components/TimelineStoryboard";
import { normalizeHydratedVideoDraft } from "../../app/admin/hooks/useVideoDraftState";
import { sanitize, getAnchorKeyword } from "../../app/admin/utils/textUtils";
import { build45BoxHExpr, build45ScaleExpr, buildTopOffsetYExpr } from "../../lib/server/ffmpegFilters";
import { buildSceneFilterStages } from "../../lib/server/ffmpegSceneGraph";
import { createByteLimitTransform } from "../../lib/server/videoMedia";

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

    describe("keyframe timecode precision", () => {
        it("formats timecodes to four decimal places", () => {
            expect(formatTimecode(0)).toBe("00:00.0000");
            expect(formatTimecode(75.5)).toBe("01:15.5000");
            expect(formatTimecode(75.5166666667)).toBe("01:15.5167");
        });

        it("nudge values at 30 fps remain frame quantized", () => {
            const nudged = Math.round((75.5 + 1 / 30) * 30) / 30;
            expect(nudged).toBeCloseTo(75.53333333333333, 10);
        });

        it("keeps manual microsecond edits exact until a frame nudge is used", () => {
            const manual = Math.round(75.5166 * 10000) / 10000;
            expect(manual).toBe(75.5166);
            expect(nudgeTimeToFrame(manual, -1, 60)).toBeCloseTo(75.5, 10);
            expect(nudgeTimeToFrame(manual, 1, 60)).toBeCloseTo(75.51666666666667, 10);
        });

        it("uses exact PTS values when nudging VFR source frame indices", () => {
            const vfrIndex = {
                mediaUrl: "/api/video/ingest?id=media-test.mp4",
                fps: 60,
                nominalFps: 60,
                startTime: 0,
                duration: 2,
                frameCount: 5,
                cfr: false,
                keyframes: [0, 3],
                pts: [0, 0.034, 0.083, 0.142, 0.200],
            };
            expect(nudgeTimeToFrame(0.083, -1, 60, vfrIndex)).toBeCloseTo(0.034, 10);
            expect(nudgeTimeToFrame(0.083, 1, 60, vfrIndex)).toBeCloseTo(0.142, 10);
        });
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
        const mid = interpolateKeyframe(kfs, 5);
        expect(mid.zoom).toBeCloseTo(50, 5);
        expect(mid.posX).toBeCloseTo(25, 5);
        expect(mid.posY).toBeCloseTo(50, 5);

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
    it("maps 100 to top (0px), 50 to true vertical center, and 0 to bottom edge (containerH - boxH)", () => {
        expect(getTopBoxOffsetY(100, 1350, 608)).toBe(0);
        expect(getTopBoxOffsetY(50, 1350, 608)).toBe(371);
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

    it("formats SRT content and resolves numeric/arrow studio shortcuts", () => {
        const srt = buildSrtContent([{ id: "1", start: 1.25, end: 3.5, text: "Hello world" }]);
        expect(srt).toBe("1\n00:00:01,250 --> 00:00:03,500\nHello world\n");

        const ctx = { sceneStarts: [0, 4, 10], outroStart: 60, enableOutro: true, activeDisplayTime: 12, duration: 65 };
        expect(resolveStudioShortcutSeek("1", false, ctx)).toBe(0);
        expect(resolveStudioShortcutSeek("3", false, ctx)).toBe(10);
        expect(resolveStudioShortcutSeek("4", false, ctx)).toBe(60);
        expect(resolveStudioShortcutSeek("0", false, ctx)).toBe(60);
        expect(resolveStudioShortcutSeek("ArrowRight", true, ctx)).toBe(17);
        expect(resolveStudioShortcutSeek("ArrowLeft", false, ctx)).toBe(11);
    });

    it("keeps VideoDraftResolver in parity with anchored vs un-anchored 02. Re-Hook copy", () => {
        const baseScenes = [
            { id: "scene-1", title: "HOOK TITLE", subtitle: "HOOK SUB", duration: 4 },
            { id: "rehook-1", title: "OWN REHOOK", subtitle: "OWN SUB", duration: 4, shareHookText: true },
            { id: "scene-2", title: "STORY TITLE", subtitle: "STORY SUB", duration: 20 },
        ];
        const anchoredDraft = makeDraft({ headline: "HOOK TITLE", subtitle: "HOOK SUB", scenes: baseScenes });

        expect(isSharedReHookScene(anchoredDraft.scenes, 1)).toBe(true);
        expect(VideoDraftResolver.get("video-headline", anchoredDraft, 5)).toBe("HOOK TITLE");
        expect(VideoDraftResolver.get("video-subtitle", anchoredDraft, 5)).toBe("HOOK SUB");

        const editedAnchored = VideoDraftResolver.set("video-headline", "UPDATED HOOK", anchoredDraft, 5);
        expect(editedAnchored.scenes[0]?.title).toBe("UPDATED HOOK");
        expect(editedAnchored.headline).toBe("UPDATED HOOK");
        expect(editedAnchored.scenes[1]?.title).toBe("OWN REHOOK");

        const unanchoredDraft = makeDraft({
            headline: "HOOK TITLE",
            subtitle: "HOOK SUB",
            scenes: baseScenes.map((s, idx) => (idx === 1 ? { ...s, shareHookText: false } : s)),
        });
        expect(isSharedReHookScene(unanchoredDraft.scenes, 1)).toBe(false);
        expect(VideoDraftResolver.get("video-headline", unanchoredDraft, 5)).toBe("OWN REHOOK");

        const editedUnanchored = VideoDraftResolver.set("video-headline", "UPDATED REHOOK", unanchoredDraft, 5);
        expect(editedUnanchored.scenes[1]?.title).toBe("UPDATED REHOOK");
        expect(editedUnanchored.scenes[0]?.title).toBe("HOOK TITLE");
        expect(editedUnanchored.headline).toBe("HOOK TITLE");
    });

    it("computes scene boundaries, unique IDs, pacing, monetisation padding, and subtitle jump targets", () => {
        const healed = ensureUniqueSceneIds([
            { id: "dup", title: "A", duration: 4 },
            { id: "dup", title: "B", duration: 4, mediaType: "image" },
            { id: "", title: "C", duration: 20 },
        ]);
        expect(new Set(healed.map((s) => s.id)).size).toBe(3);

        expect(getSceneBoundaries([])).toEqual([]);
        expect(getSceneBoundaries(healed)).toEqual([
            { id: "dup", idx: 0, start: 0, end: 4, mediaType: "video", mediaUrl: undefined },
            { id: "scene-2", idx: 1, start: 4, end: 8, mediaType: "image", mediaUrl: undefined },
            { id: "scene-3", idx: 2, start: 8, end: 28, mediaType: "video", mediaUrl: undefined },
        ]);

        const paced = calculatePsychologyPacedScenes(45, [
            { id: "scene-1", title: "H", duration: 4, clipStartOffset: 10 },
            { id: "rehook-1", title: "R", duration: 4, clipStartOffset: 20 },
            { id: "scene-2", title: "S", duration: 12, clipStartOffset: 5 },
        ]);
        expect(paced[0]?.duration).toBe(4);
        expect(paced[1]?.duration).toBe(4);
        expect(paced[2]?.duration).toBe(40);

        const shortDraft = makeDraft({
            enableOutro: true,
            outroDuration: 5,
            scenes: [
                { id: "scene-1", title: "H", duration: 4 },
                { id: "scene-2", title: "S", duration: 10 },
            ],
        });
        const padded = autoPadToMonetisationThreshold(shortDraft, 61.5);
        expect(padded.scenes[1]?.duration).toBeCloseTo(52.5, 5);

        const jumpDraft = makeDraft({
            scenes: [
                { id: "scene-1", title: "H", duration: 4, clipStartOffset: 15 },
                { id: "rehook-1", title: "R", duration: 4, clipStartOffset: 30 },
                { id: "scene-2", title: "S", duration: 40, clipStartOffset: 2 },
            ],
        });
        expect(getMediaSubtitleTimelineTime(jumpDraft, 16.5)).toBe(1.5);
        expect(getMediaSubtitleTimelineTime(jumpDraft, 32)).toBe(6);
        expect(getMediaSubtitleTimelineTime(jumpDraft, 5)).toBe(11);
    });

    it("resolves active scene at exact end-of-timeline without wrapping back to Hook when Outro is disabled", () => {
        const noOutroDraft = makeDraft({
            enableOutro: false,
            scenes: [
                { id: "scene-1", title: "H", duration: 4 },
                { id: "rehook-1", title: "R", duration: 4 },
                { id: "scene-2", title: "S", duration: 12 },
            ],
        });
        expect(getActiveSceneAtTime(noOutroDraft, 20)).toEqual({
            scene: noOutroDraft.scenes[2],
            isOutro: false,
            sceneIndex: 2,
        });

        const withOutroDraft = makeDraft({ ...noOutroDraft, enableOutro: true, outroDuration: 5 });
        expect(getActiveSceneAtTime(withOutroDraft, 20)).toEqual({
            scene: null,
            isOutro: true,
            sceneIndex: 3,
        });

        const nanPaced = calculatePsychologyPacedScenes(Number.NaN, noOutroDraft.scenes);
        expect(nanPaced[2]?.duration).toBe(4);
    });
});

describe("parseScrubPillInput (Bug #7 regression)", () => {
    it("parses integer and decimal inputs with %, ms, px, or s unit suffixes and clamps bounds", () => {
        expect(parseScrubPillInput("600ms", 100, 2000)).toBe(600);
        expect(parseScrubPillInput("36px", 12, 72)).toBe(36);
        expect(parseScrubPillInput("150%", 100, 300)).toBe(150);
        expect(parseScrubPillInput("2s", 1, 10)).toBe(2);
        expect(parseScrubPillInput(" -45 px ", -100, 100)).toBe(-45);
        expect(parseScrubPillInput("120.6%", 50, 200)).toBe(121);
        expect(parseScrubPillInput("9999ms", 100, 2000)).toBe(2000);
        expect(parseScrubPillInput("-500%", 0, 100)).toBe(0);
    });

    it("rejects empty, unit-only, non-finite, and malformed text inputs", () => {
        expect(parseScrubPillInput("", 0, 100)).toBeNull();
        expect(parseScrubPillInput("   ", 0, 100)).toBeNull();
        expect(parseScrubPillInput("ms", 0, 100)).toBeNull();
        expect(parseScrubPillInput("abc%", 0, 100)).toBeNull();
        expect(parseScrubPillInput("Infinity", 0, 100)).toBeNull();
    });
});

describe("Portion D Stage 2 regressions (Bugs #10, #12, #26)", () => {
    it("steps across split snap PRE/POST stops and wraps cleanly (Bug #10)", () => {
        const kfs: VideoKeyframe[] = [
            { id: "k2", time: 12, zoom: 120, posX: 60, easing: "snap", pre: { time: 10, zoom: 100, posX: 50 } },
            { id: "k1", time: 5, zoom: 100, posX: 50, easing: "smooth" },
            { id: "k3", time: 18, zoom: 140, posX: 40, easing: "snap" },
        ];
        expect(resolveKeyframeJumpStop(kfs, 5, "next")).toEqual({ time: 10, side: "pre" });
        expect(resolveKeyframeJumpStop(kfs, 10, "next")).toEqual({ time: 12, side: "post" });
        expect(resolveKeyframeJumpStop(kfs, 12, "prev")).toEqual({ time: 10, side: "pre" });
        expect(resolveKeyframeJumpStop(kfs, 12, "next")).toEqual({ time: 18, side: "pre" });
        expect(resolveKeyframeJumpStop(kfs, 18, "next")).toEqual({ time: 5, side: "post" });
        expect(resolveKeyframeJumpStop(kfs, 5, "prev")).toEqual({ time: 18, side: "pre" });
    });

    it("resolves telemetry PRE tint safely even when sortedKeyframes differs in order from draft.keyframes (Bug #12)", () => {
        const sortedKfs: VideoKeyframe[] = [
            { id: "g1", time: 5, zoom: 120, posX: 60, easing: "smooth" },
            { id: "s2", time: 20, zoom: 100, posX: 50, easing: "snap" },
        ];
        expect(getKeyframeTelemetryTint(sortedKfs, 20, "pre", true, true).color).toBe("var(--ui-pre)");
        expect(getKeyframeTelemetryTint(sortedKfs, 5, "post", false, true).color).toBe("var(--ui-accent)");
    });

    it("seeks card subtitles via wrapMediaTime and clamps inside card bounds (Bug #26)", () => {
        const draft = makeDraft({
            videoDuration: 30,
            scenes: [
                { id: "hook", title: "H", subtitle: "", duration: 10 },
                { id: "story", title: "S", subtitle: "", duration: 25 },
                { id: "angle", title: "A", subtitle: "", duration: 15 },
            ],
        });
        expect(resolveSceneSubtitleSeekTime(draft, { start: 35, end: 50 }, 15, 8, 10, 0)).toBe(38);
        expect(resolveSceneSubtitleSeekTime(draft, { start: 25, end: 40 }, 15, 4, 10, 0)).toBe(34);
        expect(resolveSceneSubtitleSeekTime(draft, { start: 25, end: 40 }, 15, 24, 10, 0)).toBe(25);
        expect(resolveSceneSubtitleSeekTime(draft, { start: 0, end: 10 }, 10, 15, 10, 0)).toBeCloseTo(9.95, 4);
    });
});

describe("starMorphMath", () => {
    it("morphs cleanly between circular dot (m=0) and scaled 5-point star (m=1) with zero stale scratch state", () => {
        expect(buildDotStarMorphPath(0)).toBe(CIRCLE_PATH_R3);
        expect(buildDotStarMorphPath(-1)).toBe(CIRCLE_PATH_R3);

        const starDefault = buildDotStarMorphPath(1, 100);
        const cubicCount = (starDefault.match(/ C /g) || []).length;
        expect(cubicCount).toBe(10);
        expect(starDefault.startsWith("M 0.000 -4.450")).toBe(true);
        expect(starDefault.endsWith(" Z")).toBe(true);

        const starScaled = buildDotStarMorphPath(1, 150);
        expect(starScaled.startsWith("M 0.000 -6.675")).toBe(true);
        expect(buildDotStarMorphPath(1, 100)).toBe(starDefault);
    });

    it("evaluates spin angles and morph envelope across all spin modes", () => {
        expect(evaluateSingleCueSpin(0, 0.5, 0.65, "flag-tilt")).toEqual({ morph: 0, angleDeg: 0 });
        expect(evaluateSingleCueSpin(1.65, 0.5, 0.65, "flag-tilt")).toEqual({ morph: 0, angleDeg: 0 });

        expect(evaluateSingleCueSpin(0.5, 0.5, 0.65, "flag-tilt")).toEqual({ morph: 1, angleDeg: 126 });
        expect(evaluateSingleCueSpin(0.5, 0.5, 0.65, "cw-1x")).toEqual({ morph: 1, angleDeg: 144 });
        expect(evaluateSingleCueSpin(0.5, 0.5, 0.65, "cw-2x")).toEqual({ morph: 1, angleDeg: 288 });
        expect(evaluateSingleCueSpin(0.5, 0.5, 0.65, "ccw")).toEqual({ morph: 1, angleDeg: -126 });

        const midHold = evaluateSingleCueSpin(0.5 + 0.65 * 0.5, 0.5, 0.65, "flag-tilt");
        expect(midHold.morph).toBe(1);
        expect(midHold.angleDeg).toBeCloseTo(135, 5);
    });

    it("resolves active multi-cue star animations along the playback timeline", () => {
        const cfg = {
            starCues: [
                { id: "c0", time: 0 },
                { id: "c1", time: 10 },
            ],
            morphDuration: 0.5,
            holdDuration: 0.65,
            spinMode: "cw-1x" as const,
        };
        expect(getStarAnimState(0.5, cfg)).toEqual({ morph: 1, angleDeg: 144 });
        expect(getStarAnimState(5.0, cfg)).toEqual({ morph: 0, angleDeg: 0 });
        expect(getStarAnimState(10.5, cfg)).toEqual({ morph: 1, angleDeg: 144 });
        expect(getStarAnimState(12.0, cfg)).toEqual({ morph: 0, angleDeg: 0 });
    });

    it("lifts the star upward as it expands so its bottom stays anchored on the y=42 baseline", () => {
        expect(getStarDotTransform(0, 0, 100)).toBe("translate(32 39)");
        expect(getStarDotTransform(1, 0, 100)).toBe("translate(32 37.550)");
        expect(getStarDotTransform(1, 144, 150)).toBe("translate(32 35.325) rotate(144.00)");
    });

    it("morphs Dot -> Star -> Crescent -> Dot anti-clockwise with drift vs still hold feel", () => {
        expect(getCueTotalDuration(0.45, 0.5, "star-crescent")).toBeCloseTo(2.35, 5);
        expect(getCueTotalDuration(0.45, 0.5, "star-only")).toBeCloseTo(1.4, 5);

        const starHoldMid = evaluateEmblemCue(0.45 + 0.25, 0.45, 0.5, "ccw", "star-crescent", "drift");
        expect(starHoldMid.shapeA).toBe("star");
        expect(starHoldMid.expandFactor).toBe(1);
        expect(starHoldMid.angleDeg).toBeCloseTo(-135, 3);

        const crescentHoldStill = evaluateEmblemCue(0.45 * 2 + 0.5 + 0.25, 0.45, 0.5, "ccw", "star-crescent", "still");
        expect(crescentHoldStill.shapeA).toBe("crescent");
        expect(crescentHoldStill.expandFactor).toBe(1);
        expect(crescentHoldStill.angleDeg).toBeCloseTo(-360, 3);

        const crescentPath = buildLogoEmblemPath("crescent", "crescent", 1, 100);
        expect((crescentPath.match(/ C /g) || []).length).toBe(10);
        expect(crescentPath.endsWith(" Z")).toBe(true);
    });
});

describe("Portion F Stage 2 regressions (Bug #21)", () => {
    it("sorts keyframes and starCues ascending and deduplicates scene IDs on draft hydration", () => {
        const hydrated = normalizeHydratedVideoDraft({
            scenes: [
                { id: "dup", title: "Hook", subtitle: "", duration: 4 },
                { id: "dup", title: "Story", subtitle: "", duration: 20 },
            ],
            keyframes: [
                { id: "k2", time: 18, zoom: 120, posX: 60, easing: "smooth" },
                { id: "k1", time: 4, zoom: 100, posX: 50, easing: "snap" },
            ],
            starCues: [
                { id: "c2", time: 14 },
                { id: "c1", time: 1.5 },
            ],
        });
        expect(hydrated.keyframes?.map((k) => k.id)).toEqual(["k1", "k2"]);
        expect(hydrated.starCues?.map((c) => c.id)).toEqual(["c1", "c2"]);
        expect(new Set(hydrated.scenes.map((s) => s.id)).size).toBe(2);

        const emptyScenesHydrated = normalizeHydratedVideoDraft({ scenes: [] });
        expect(emptyScenesHydrated.scenes.length).toBeGreaterThan(0);
    });

    it("sanitizes slugs and extracts anchor keywords across leading/repeated spaces", () => {
        expect(sanitize("  Karachi!! 2027--Brief ")).toBe("karachi-2027-brief");
        expect(getAnchorKeyword("STATE BANK ==DIGITAL TRADE== POLICY")).toBe("digital-trade");
        expect(getAnchorKeyword("   Breaking   Economic   Briefing   Today")).toBe("breaking-economic-briefing");
        expect(getAnchorKeyword("   ")).toBe("news");
    });
});

describe("Portion G Stage 1 regressions (Bug #5 — 4:5 zoom glide & dynamic boxH/topOffsetY parity)", () => {
    it("emits dynamic 4:5 scale, boxH, and topOffsetY expressions across 0% -> 100% zoom glides", () => {
        const draft = makeDraft({
            aspectRatio: "4:5",
            zoom: 0,
            posX: 50,
            posY: 50,
            enableAmbientBlur: true,
            keyframes: [
                { id: "k0", time: 0, zoom: 0, posX: 50, posY: 50, easing: "smooth" },
                { id: "k1", time: 5, zoom: 100, posX: 50, posY: 50, easing: "smooth" },
            ],
        });
        const hContain = 608;
        const scaleFill = 1350 / hContain;
        const scaleInfo = build45ScaleExpr(draft, 0, 5, scaleFill);
        const boxInfo = build45BoxHExpr(draft, 0, 5, 1350, hContain);
        const topInfo = buildTopOffsetYExpr(draft, 0, 5, 1350, hContain, true);

        expect(scaleInfo.isConstant).toBe(false);
        expect(scaleInfo.minV).toBeCloseTo(1, 2);
        expect(scaleInfo.maxV).toBeCloseTo(scaleFill, 2);

        expect(boxInfo.isConstant).toBe(false);
        expect(boxInfo.minH).toBeCloseTo(hContain, 0);
        expect(boxInfo.maxH).toBeCloseTo(1350, 0);

        expect(topInfo.isConstant).toBe(false);
        expect(topInfo.minY).toBeCloseTo(0, 0);
        expect(topInfo.maxY).toBeCloseTo((1350 - hContain) / 2, 0);

        const stage = buildSceneFilterStages({
            index: 0,
            scene: draft.scenes[0]!,
            scenes: draft.scenes,
            draft,
            start: 0,
            duration: 5,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: false,
            hasReHook: false,
            setupIdx: 1,
            srcWidth: 1920,
            srcHeight: 1080,
            srcHasAudio: true,
            mediaIdx: 0,
            overlayIdx: 1,
            customLoopVideoSource: null,
            customLoopAudioSource: null,
            loopTrim: "",
            aLoopTrim: "",
        });
        expect(stage.filters.some((f) => f.includes("eval=frame"))).toBe(true);
        expect(stage.filters.some((f) => f.includes("[bg_top_spill_0]"))).toBe(true);
    });

    it("applies 4:5 letterbox & ambient spill to landscape photo scenes using probed image dimensions (Bug #25)", () => {
        const draft = makeDraft({ aspectRatio: "4:5", zoom: 0, posX: 50, posY: 100, enableAmbientBlur: true });
        const stage = buildSceneFilterStages({
            index: 0,
            scene: { ...draft.scenes[0]!, mediaType: "image" },
            scenes: draft.scenes,
            draft,
            start: 0,
            duration: 5,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: true,
            hasReHook: false,
            setupIdx: 1,
            srcWidth: 1920,
            srcHeight: 1080,
            srcHasAudio: false,
            mediaIdx: 0,
            overlayIdx: 1,
            customLoopVideoSource: null,
            customLoopAudioSource: null,
            loopTrim: "",
            aLoopTrim: "",
        });
        expect(stage.filters.some((f) => f.includes("[bg_spill_0]"))).toBe(true);
    });

    it("enforces streaming byte ceiling on chunked proxy responses (Bug #22)", async () => {
        const withinLimit = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new Uint8Array(4));
                c.enqueue(new Uint8Array(4));
                c.close();
            },
        }).pipeThrough(createByteLimitTransform(10));
        const okBuf = await new Response(withinLimit).arrayBuffer();
        expect(okBuf.byteLength).toBe(8);

        const overLimit = new ReadableStream<Uint8Array>({
            start(c) {
                c.enqueue(new Uint8Array(6));
                c.enqueue(new Uint8Array(6));
                c.close();
            },
        }).pipeThrough(createByteLimitTransform(10));
        await expect(new Response(overLimit).arrayBuffer()).rejects.toThrow(/exceeds/i);
    });
});
