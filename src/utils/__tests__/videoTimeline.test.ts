import { describe, expect, it } from "vitest";
import { createDefaultDraft, createDefaultVideoDraft, getTopBoxOffsetY, has45LetterboxFraming, switchVideoAspectRatio, type VideoDraft, type VideoKeyframe } from "@/types/news";
import {
    autoPadToMonetisationThreshold,
    calculatePsychologyPacedScenes,
    ensureUniqueSceneIds,
    evaluateSceneTransition,
    getActiveSceneAtTime,
    getHookTransitionFade,
    getSceneBoundaries,
    getSceneRoleLabel,
    getTimelineStructure,
    isSharedReHookScene,
    resolveAudioBoundaryModes,
    resolveSceneFade,
    setSceneClipStartOffset,
} from "../sceneTimeline";
import {
    interpolateKeyframe,
    mediaTimeToTimelineTime,
    parseTimeInput,
    formatTimecode,
    formatPreciseTimecode,
    resolveKeyframeSpan,
    snapTimeToSourceFrame,
    nudgeTimeToFrame,
    timelineTimeToMediaTime,
    wrapMediaTime,
} from "../videoTimeline";
import {
    buildSrtContent,
    buildTimelineSrtContent,
    findSubtitleAtMediaTime,
    getActiveSubtitleTimelineTimes,
    getMediaSubtitleTimelineTime,
    projectSubtitlesToTimeline,
} from "../subtitleTimeline";
import {
    CIRCLE_PATH_R3,
    buildLogoEmblemPath,
    evaluateEmblemCue,
    getCueTotalDuration,
    getLogoEmblemState,
    getStarDotTransform,
} from "../starMorphMath";
import { getKeyframeTelemetryTint, resolveKeyframeJumpStop } from "@/app/admin/utils/keyframeTelemetry";
import { resolveStudioShortcutSeek } from "@/app/admin/hooks/useStudioShortcuts";
import { DraftResolver, VideoDraftResolver } from "@/app/admin/utils/dataAccessors";
import { consumeNdjsonStream } from "@/app/admin/utils/ndjsonStream";
import { parseScrubPillInput } from "@/app/admin/components/ScrubPillSlider";
import { resolveSceneSubtitleSeekTime } from "@/app/admin/components/TimelineStoryboard";
import { normalizeHydratedVideoDraft } from "@/app/admin/hooks/useVideoDraftState";
import { sanitize, getAnchorKeyword } from "@/app/admin/utils/textUtils";
import { build45BoxHExpr, build45ScaleExpr, buildAudioFadeFilters, buildTopOffsetYExpr } from "@/lib/server/ffmpegFilters";
import { buildSceneFilterStages } from "@/lib/server/ffmpegSceneGraph";
import { clampMediaTarget, shouldUseStandbyDeck } from "@/components/templates/VideoCard/dualDeckHelpers";
import { classifyFrameTimestamps, computeExportVbvCeiling, createByteLimitTransform, parseVideoFrameRate, parseWhisperProgressLine, withExportSlot } from "@/lib/server/videoMedia";

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
        it("formats compact transport timecodes to MM:SS.d and precise keyframe timecodes to MM:SS.ssss", () => {
            expect(formatTimecode(0)).toBe("00:00.0");
            expect(formatTimecode(75.5)).toBe("01:15.5");
            expect(formatPreciseTimecode(0)).toBe("00:00.0000");
            expect(formatPreciseTimecode(75.5)).toBe("01:15.5000");
            expect(formatPreciseTimecode(75.5166666667)).toBe("01:15.5167");
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

        it("uses exact PTS values when snapping and nudging VFR source frame indices", () => {
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
            expect(snapTimeToSourceFrame(0.09, 60, vfrIndex)).toBeCloseTo(0.083, 10);
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

    it("interpolates smoothly between keyframes, holds letterbox posY across FILL transitions, and respects snap", () => {
        const letterboxKfs = [
            { id: "k1", time: 0, zoom: 0, posX: 50, posY: 100, easing: "smooth" as const },
            { id: "k2", time: 10, zoom: 50, posX: 0, posY: 0, easing: "smooth" as const },
        ];
        const midLetterbox = interpolateKeyframe(letterboxKfs, 5);
        expect(midLetterbox.zoom).toBeCloseTo(25, 5);
        expect(midLetterbox.posX).toBeCloseTo(25, 5);
        expect(midLetterbox.posY).toBeCloseTo(50, 5);

        // FILL (100%, posY undefined/100) -> CONTAIN (0%, CTR posY=50) holds posY=50 so top & bottom pull in 50/50
        const fillToCenter = [
            { id: "f1", time: 0, zoom: 100, posX: 50, easing: "smooth" as const },
            { id: "f2", time: 10, zoom: 0, posX: 50, posY: 50, easing: "smooth" as const },
        ];
        const midFillToCenter = interpolateKeyframe(fillToCenter, 5);
        expect(midFillToCenter.zoom).toBeCloseTo(50, 5);
        expect(midFillToCenter.posX).toBeCloseTo(50, 5);
        expect(midFillToCenter.posY).toBe(50);

        // CONTAIN (0%, CTR posY=50) -> FILL (100%) holds posY=50 so top & bottom expand outward 50/50
        const centerToFill = [
            { id: "c1", time: 0, zoom: 0, posX: 50, posY: 50, easing: "smooth" as const },
            { id: "c2", time: 10, zoom: 100, posX: 50, easing: "smooth" as const },
        ];
        const midCenterToFill = interpolateKeyframe(centerToFill, 5);
        expect(midCenterToFill.zoom).toBeCloseTo(50, 5);
        expect(midCenterToFill.posX).toBeCloseTo(50, 5);
        expect(midCenterToFill.posY).toBe(50);

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
    it("morphs cleanly between circular dot (mix=0) and scaled 5-point star (mix=1) with zero stale scratch state", () => {
        expect(buildLogoEmblemPath("dot", "star", 0)).toBe(CIRCLE_PATH_R3);
        expect(buildLogoEmblemPath("dot", "star", -1)).toBe(CIRCLE_PATH_R3);

        const starDefault = buildLogoEmblemPath("dot", "star", 1, 100);
        const cubicCount = (starDefault.match(/ C /g) || []).length;
        expect(cubicCount).toBe(10);
        expect(starDefault.startsWith("M 0.000 -4.450")).toBe(true);
        expect(starDefault.endsWith(" Z")).toBe(true);

        const starScaled = buildLogoEmblemPath("dot", "star", 1, 150);
        expect(starScaled.startsWith("M 0.000 -6.675")).toBe(true);
        expect(buildLogoEmblemPath("dot", "star", 1, 100)).toBe(starDefault);
    });

    it("evaluates spin angles and morph envelope across all spin modes", () => {
        expect(evaluateEmblemCue(0, 0.5, 0.65, "flag-tilt", "star-only", "drift")).toMatchObject({ expandFactor: 0, angleDeg: 0 });
        expect(evaluateEmblemCue(1.65, 0.5, 0.65, "flag-tilt", "star-only", "drift")).toMatchObject({ expandFactor: 0, angleDeg: 0 });

        expect(evaluateEmblemCue(0.5, 0.5, 0.65, "flag-tilt", "star-only", "drift")).toMatchObject({ expandFactor: 1, angleDeg: 126 });
        expect(evaluateEmblemCue(0.5, 0.5, 0.65, "cw-1x", "star-only", "drift")).toMatchObject({ expandFactor: 1, angleDeg: 144 });
        expect(evaluateEmblemCue(0.5, 0.5, 0.65, "cw-2x", "star-only", "drift")).toMatchObject({ expandFactor: 1, angleDeg: 288 });
        expect(evaluateEmblemCue(0.5, 0.5, 0.65, "ccw", "star-only", "drift")).toMatchObject({ expandFactor: 1, angleDeg: -126 });

        const midHold = evaluateEmblemCue(0.5 + 0.65 * 0.5, 0.5, 0.65, "flag-tilt", "star-only", "drift");
        expect(midHold.expandFactor).toBe(1);
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
            sequence: "star-only" as const,
            holdFeel: "drift" as const,
        };
        expect(getLogoEmblemState(0.5, cfg)).toMatchObject({ expandFactor: 1, angleDeg: 144 });
        expect(getLogoEmblemState(5.0, cfg)).toMatchObject({ expandFactor: 0, angleDeg: 0 });
        expect(getLogoEmblemState(10.5, cfg)).toMatchObject({ expandFactor: 1, angleDeg: 144 });
        expect(getLogoEmblemState(12.0, cfg)).toMatchObject({ expandFactor: 0, angleDeg: 0 });
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
            scenes: draft.scenes,
            draft,
            start: 0,
            duration: 5,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: false,
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
            scenes: draft.scenes,
            draft,
            start: 0,
            duration: 5,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: true,
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

describe("Deep-Clean Merger Regressions (Ingest Metadata, Logo Motion & Aspect Migration)", () => {
    it("parses broadcast frame rates accurately and rejects broken container timebases (>125fps)", () => {
        expect(parseVideoFrameRate("30000/1001", "30000/1001")).toEqual({ exactFps: 29.97, nominalFps: 30 });
        expect(parseVideoFrameRate("24000/1001", "24000/1001")).toEqual({ exactFps: 23.976, nominalFps: 24 });
        expect(parseVideoFrameRate("60000/1001", "60000/1001")).toEqual({ exactFps: 59.94, nominalFps: 60 });
        expect(parseVideoFrameRate("90000/1", "30/1")).toEqual({ exactFps: 30, nominalFps: 30 });
        expect(parseVideoFrameRate("90000/1", "90000/1")).toEqual({ exactFps: 30, nominalFps: 30 });
    });

    it("classifies 29.97fps timebase jitter as CFR while flagging genuine VFR clips", () => {
        // Simulate 29.97fps frames in 1/90000 container timebase (3003 +/- 3 ticks -> ~0.00033s jitter)
        const ntsc2997 = Array.from({ length: 120 }, (_, i) => Number((i * (1001 / 30000) + (i % 3 === 0 ? 0.0003 : 0)).toFixed(6)));
        expect(classifyFrameTimestamps(ntsc2997).cfr).toBe(true);

        const genuineVfr = [0, 0.016, 0.052, 0.068, 0.125, 0.141, 0.210, 0.226];
        expect(classifyFrameTimestamps(genuineVfr).cfr).toBe(false);
    });

    it("computes H.264 Level 4.2 VBV ceilings with 16Mbps broadcast floor and 50Mbps cap", () => {
        expect(computeExportVbvCeiling(undefined)).toBeNull();
        expect(computeExportVbvCeiling(4_000_000)).toEqual({ maxrateKbps: 16_000, bufsizeKbps: 32_000 });
        expect(computeExportVbvCeiling(20_000_000)).toEqual({ maxrateKbps: 30_000, bufsizeKbps: 60_000 });
        expect(computeExportVbvCeiling(80_000_000)).toEqual({ maxrateKbps: 50_000, bufsizeKbps: 100_000 });
    });

    it("honours enableLogo: false in getLogoEmblemState during live playback and scrubbing", () => {
        const disabled = getLogoEmblemState(0.5, { enableLogo: false, starCues: [{ id: "s0", time: 0 }] });
        expect(disabled).toEqual({ shapeA: "dot", shapeB: "dot", mix: 0, expandFactor: 0, angleDeg: 0 });
    });

    it("migrates both POST and PRE snap keyframe zoom/posY cleanly on aspect ratio switch", () => {
        const draft45 = makeDraft({
            aspectRatio: "4:5",
            zoom: 0,
            posX: 40,
            posY: 60,
            keyframes: [
                {
                    id: "k1",
                    time: 4,
                    zoom: 0,
                    posX: 50,
                    posY: 50,
                    easing: "snap",
                    pre: { time: 3, zoom: 0, posX: 25, posY: 80 },
                },
            ],
        });
        const switched916 = switchVideoAspectRatio(draft45, "9:16");
        expect(switched916.aspectRatio).toBe("9:16");
        expect(switched916.zoom).toBe(100);
        const kf = switched916.keyframes?.[0];
        expect(kf?.zoom).toBe(100);
        expect(kf?.posY).toBeUndefined();
        if (kf?.easing === "snap") {
            expect(kf.pre?.zoom).toBe(100);
            expect(kf.pre?.posY).toBeUndefined();
        }
    });

    it("migrates legacy /api/video/ingest/frame-index?name=... URLs on draft hydration", () => {
        const hydrated = normalizeHydratedVideoDraft({
            sourceFrameLogUrl: "/api/video/ingest/frame-index?name=media-123.mp4.tpe-frame-index.json",
        });
        expect(hydrated.sourceFrameLogUrl).toBe("/api/video/ingest?frameIndex=media-123.mp4.tpe-frame-index.json");
    });

    it("deactivates 4:5 ambient blur completely in FILL (>=100%) across DOM detection and FFmpeg filtergraph", () => {
        const fillDraft = makeDraft({
            aspectRatio: "4:5",
            zoom: 100,
            defaultFramingByRatio: { "4:5": { zoom: 100, posX: 50, posY: 100 } },
            enableAmbientBlur: true,
            keyframes: [],
        });
        expect(has45LetterboxFraming(fillDraft)).toBe(false);
        expect(has45LetterboxFraming({ ...fillDraft, aspectRatio: "9:16" })).toBe(false);

        // Keyframe gliding 100% -> 140% (always FILL) must still report false and emit zero FFmpeg blur filters
        const fillPunchDraft = makeDraft({
            ...fillDraft,
            keyframes: [
                { id: "k1", time: 0, zoom: 100, posX: 50, easing: "smooth" },
                { id: "k2", time: 5, zoom: 140, posX: 50, easing: "smooth" },
            ],
        });
        expect(has45LetterboxFraming(fillPunchDraft)).toBe(false);
        const stage = buildSceneFilterStages({
            index: 0,
            scenes: fillPunchDraft.scenes,
            draft: fillPunchDraft,
            start: 0,
            duration: 5,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: false,
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
        expect(stage.filters.some((f) => f.includes("boxblur") || f.includes("bg_spill"))).toBe(false);

        // If any keyframe dips below 100% (POST or snap PRE), ambient blur remains eligible
        const mixedDraft = makeDraft({
            ...fillDraft,
            keyframes: [{ id: "k3", time: 3, zoom: 100, posX: 50, easing: "snap", pre: { zoom: 0, posX: 50, posY: 100 } }],
        });
        expect(has45LetterboxFraming(mixedDraft)).toBe(true);
    });

    it("parses whisper.cpp -pp progress lines and timestamped transcript lines into percentages", () => {
        expect(parseWhisperProgressLine("whisper_print_progress_callback: progress =  45%", 60)).toBe(45);
        expect(parseWhisperProgressLine("whisper_print_progress_callback: progress = 100%", 60)).toBe(100);
        expect(parseWhisperProgressLine("[00:00:12.000 --> 00:00:30.000]  Hello Pakistan", 60)).toBe(50);
        expect(parseWhisperProgressLine("whisper_init_from_file_with_params: loading model", 60)).toBeNull();
    });

    it("atomically patches Carousel slide fields for Slide 1 and Slide 2+ via DraftResolver.patchSlide", () => {
        const base = createDefaultDraft();
        const patchedS1 = DraftResolver.patchSlide(1, { image: "hero.png", imageWidth: 1920, imageHeight: 1080, imageZoom: 120 }, base);
        expect(patchedS1.image).toBe("hero.png");
        expect(patchedS1.imageWidth).toBe(1920);
        expect(patchedS1.imageZoom).toBe(120);
        expect(patchedS1.slideAssets).toEqual({});

        const patchedS2 = DraftResolver.patchSlide(2, { image: "s2.png", imagePosX: 35, snapMode: "width" }, patchedS1);
        expect(patchedS2.image).toBe("hero.png");
        expect(patchedS2.slideAssets?.[2]).toEqual({ image: "s2.png", imagePosX: 35, snapMode: "width" });
    });

    it("streams multi-chunk NDJSON responses with split UTF-8 lines and trailing buffer flush", async () => {
        const enc = new TextEncoder();
        const chunks = [
            enc.encode('{"stage":"A","percent":10}\n{"stage":'),
            enc.encode('"B","percent":55}\n{"stage":"DONE","percent":100}'),
        ];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const c of chunks) controller.enqueue(c);
                controller.close();
            },
        });
        const events: Array<{ stage: string; percent: number }> = [];
        await consumeNdjsonStream<{ stage: string; percent: number }>(new Response(stream), (evt) => events.push(evt));
        expect(events).toEqual([
            { stage: "A", percent: 10 },
            { stage: "B", percent: 55 },
            { stage: "DONE", percent: 100 },
        ]);
    });

    it("resolves canonical keyframe spans across smooth glides, split pre.time holds, and FILL <-> CONTAIN posY stability", () => {
        const kfs: VideoKeyframe[] = [
            { id: "k2", time: 8, zoom: 120, posX: 60, posY: 100, easing: "snap", pre: { time: 6, zoom: 0, posX: 40, posY: 50 } },
            { id: "k1", time: 2, zoom: 100, posX: 50, posY: 100, easing: "smooth" },
        ];
        // Unsorted input still resolves [2, 6] FILL(100%, posY=100) -> CONTAIN(0%, posY=50) holding posY=50 throughout
        expect(resolveKeyframeSpan(kfs, 4)).toEqual({
            kind: "glide",
            gStart: 2,
            gEnd: 6,
            start: { zoom: 100, posX: 50, posY: 50 },
            end: { zoom: 0, posX: 40, posY: 50 },
        });
        // Dwell hold across [6, 8) stays constant at pre state
        expect(resolveKeyframeSpan(kfs, 7)).toEqual({
            kind: "constant",
            framing: { zoom: 0, posX: 40, posY: 50 },
        });
        // At cut t=8, snaps to post state
        expect(resolveKeyframeSpan(kfs, 8)).toEqual({
            kind: "constant",
            framing: { zoom: 120, posX: 60, posY: 100 },
        });
    });

    it("keeps buildTopOffsetYExpr and build45BoxHExpr in parity across unsorted FILL -> CONTAIN + pre.time dwell curves", () => {
        const draft = makeDraft({
            aspectRatio: "4:5",
            zoom: 100,
            posX: 50,
            posY: 100,
            keyframes: [
                { id: "k2", time: 6, zoom: 100, posX: 50, posY: 100, easing: "snap", pre: { time: 4, zoom: 0, posX: 50, posY: 50 } },
                { id: "k1", time: 0, zoom: 100, posX: 50, posY: 100, easing: "smooth" },
            ],
        });
        const hContain = 608;
        const boxInfo = build45BoxHExpr(draft, 0, 6, 1350, hContain);
        const topInfo = buildTopOffsetYExpr(draft, 0, 6, 1350, hContain, true);

        expect(boxInfo.isConstant).toBe(false);
        expect(boxInfo.minH).toBeCloseTo(hContain, 0);
        expect(boxInfo.maxH).toBeCloseTo(1350, 0);
        // Glide [0, 4] + dwell [4, 6) both hold posY=50, so topOffsetY reaches exact center (371px) instead of drifting to 0px
        expect(topInfo.isConstant).toBe(false);
        expect(topInfo.minY).toBeCloseTo(0, 0);
        expect(topInfo.maxY).toBeCloseTo((1350 - hContain) / 2, 0);
        expect(topInfo.expr).toContain("if(lt(t,4.000),");
        expect(topInfo.expr).toContain("if(lt(t,6.000),371.0000,");
    });

    it("unifies scene fade enablement, audio boundary modes, and live preview transition gain with FFmpeg", () => {
        const draft = makeDraft({
            enableOutro: false,
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4 },
                { id: "rehook-1", title: "R", subtitle: "S", duration: 4, shareHookText: true },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 20 },
            ],
        });

        // Anchored Hook -> Re-Hook uses micro dip (0.06s out / 0.08s in); Re-Hook -> Story uses editorial dip (0.12s / 0.18s)
        const hookFade = resolveSceneFade(draft.scenes, 0);
        const rehookFade = resolveSceneFade(draft.scenes, 1);
        const storyFade = resolveSceneFade(draft.scenes, 2);
        expect(hookFade).toMatchObject({ inEnabled: false, outEnabled: true, outMode: "micro", inDur: 0, outDur: 0.06 });
        expect(rehookFade).toMatchObject({ inEnabled: true, outEnabled: true, inMode: "micro", outMode: "editorial", inDur: 0.08, outDur: 0.12 });
        expect(storyFade).toMatchObject({ inEnabled: true, outEnabled: false, inMode: "editorial", inDur: 0.18, outDur: 0 });

        // Audio boundary modes match FFmpeg: outer start/end = full, symmetric internal = breath
        expect(resolveAudioBoundaryModes(draft.scenes, 0, false)).toEqual({ inAudioMode: "full", outAudioMode: "breath" });
        expect(resolveAudioBoundaryModes(draft.scenes, 1, false)).toEqual({ inAudioMode: "breath", outAudioMode: "breath" });
        expect(resolveAudioBoundaryModes(draft.scenes, 2, false)).toEqual({ inAudioMode: "breath", outAudioMode: "full" });

        // Preview audio gain matches: mid-scene returns 1, symmetric internal peak dips to 0.25 (-12dB), outer fade-in dips to 0.0
        expect(getHookTransitionFade(draft, 15)).toBe(0);
        expect(evaluateSceneTransition(draft, 15).audioGain).toBe(1);
        expect(evaluateSceneTransition(draft, 4.0).audioGain).toBeCloseTo(0.25, 5);

        const outerFadeInDraft = makeDraft({
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, fadeIn: true },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 20, fadeIn: false },
            ],
        });
        expect(getHookTransitionFade(outerFadeInDraft, 0)).toBeCloseTo(1, 5);
        expect(evaluateSceneTransition(outerFadeInDraft, 0).audioGain).toBeCloseTo(0, 5);
        // One-sided internal fade (Hook out ON, Story in OFF) uses declick -> steady 1.0 audio gain
        expect(resolveAudioBoundaryModes(outerFadeInDraft.scenes, 0, false).outAudioMode).toBe("declick");
        expect(evaluateSceneTransition(outerFadeInDraft, 3.98).audioGain).toBe(1);
    });

    it("clamps Hook/Re-Hook/Story clipStartOffset cleanly and auto-adapts Story duration to avoid silent tail-looping", () => {
        const draft = makeDraft({
            videoDuration: 100,
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4 },
                { id: "rehook-1", title: "R", subtitle: "S", duration: 4 },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 100 },
            ],
        });
        // Hook offset clamps to clipDur - hookDur (96s)
        const hookClamped = setSceneClipStartOffset(draft, 0, 99.5);
        expect(hookClamped.scenes[0]?.clipStartOffset).toBe(96);

        // Story offset trims 12.5s off front and auto-adapts Story duration 100s -> 87.5s
        const storyTrimmed = setSceneClipStartOffset(draft, 2, 12.5);
        expect(storyTrimmed.scenes[2]?.clipStartOffset).toBe(12.5);
        expect(storyTrimmed.scenes[2]?.duration).toBe(87.5);

        // Resetting Story offset restores full 100s adapted duration
        const storyReset = setSceneClipStartOffset(storyTrimmed, 2, undefined);
        expect(storyReset.scenes[2]?.clipStartOffset).toBeUndefined();
        expect(storyReset.scenes[2]?.duration).toBe(100);

        // Custom manual Story duration (e.g. 24s) is preserved untouched when nudging Story offset
        const manualStoryDraft = makeDraft({
            videoDuration: 100,
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4 },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 24 },
            ],
        });
        const manualTrimmed = setSceneClipStartOffset(manualStoryDraft, 1, 10);
        expect(manualTrimmed.scenes[1]?.clipStartOffset).toBe(10);
        expect(manualTrimmed.scenes[1]?.duration).toBe(24);
    });

    it("enables dual-deck only on desktop non-contiguous timelines, clamps media targets, and skips unity FFmpeg volume filter", () => {
        const cutDraft = makeDraft({
            scenes: [
                { id: "scene-1", title: "H", subtitle: "S", duration: 4, clipStartOffset: 12 },
                { id: "scene-2", title: "Story", subtitle: "S", duration: 40 },
            ],
        });
        expect(shouldUseStandbyDeck(cutDraft, false)).toBe(true);
        expect(shouldUseStandbyDeck(cutDraft, true)).toBe(false);
        expect(clampMediaTarget(105, 100)).toBe(99.99);
        expect(clampMediaTarget(19.6, 100)).toBeCloseTo(19.6, 5);

        // Single-pass evaluateSceneTransition returns identical frozen object mid-scene (zero allocation)
        const midA = evaluateSceneTransition(cutDraft, 20);
        const midB = evaluateSceneTransition(cutDraft, 25);
        expect(midA).toBe(midB);
        expect(midA).toEqual({ fade: 0, audioGain: 1 });

        // Unity gain omits redundant `volume=1.000`, non-unity preserves explicit gain
        const unityFilters = buildAudioFadeFilters(1, 10, 0.18, 0.12, "breath", "full");
        expect(unityFilters.some((f) => f === "volume=1.000")).toBe(false);
        const scaledFilters = buildAudioFadeFilters(0.5, 10, 0.18, 0.12, "breath", "full");
        expect(scaledFilters[0]).toBe("volume=0.500");
    });
});

describe("Code Hygiene & Edge-Case Audit Regressions", () => {
    it("serializes withExportSlot properly when a queued waiter aborts mid-queue", async () => {
        let releaseFirst!: () => void;
        let running = 0;
        let maxConcurrent = 0;

        const first = withExportSlot(async () => {
            running += 1;
            maxConcurrent = Math.max(maxConcurrent, running);
            await new Promise<void>((r) => { releaseFirst = r; });
            running -= 1;
            return "first";
        });

        const ac = new AbortController();
        const secondAborted = withExportSlot(async () => "second", ac.signal);
        const third = withExportSlot(async () => {
            running += 1;
            maxConcurrent = Math.max(maxConcurrent, running);
            await new Promise<void>((r) => setTimeout(r, 10));
            running -= 1;
            return "third";
        });

        ac.abort();
        await expect(secondAborted).rejects.toThrow(/aborted/i);
        expect(running).toBe(1);
        releaseFirst();
        await expect(first).resolves.toBe("first");
        await expect(third).resolves.toBe("third");
        expect(maxConcurrent).toBe(1);
    });

    it("rejects malformed/negative time inputs, supports HH:MM:SS, and guards non-finite timecodes", () => {
        expect(parseTimeInput(":")).toBeNull();
        expect(parseTimeInput(":30")).toBeNull();
        expect(parseTimeInput("1:")).toBeNull();
        expect(parseTimeInput("1:-30")).toBeNull();
        expect(parseTimeInput("-5")).toBeNull();
        expect(parseTimeInput("01:02:03.5")).toBe(3723.5);

        expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe("00:00.0");
        expect(formatTimecode(Number.NEGATIVE_INFINITY)).toBe("00:00.0");
        expect(formatPreciseTimecode(Number.POSITIVE_INFINITY)).toBe("00:00.0000");
        expect(formatPreciseTimecode(-1)).toBe("00:00.0000");
    });

    it("nudges VFR intermediate timestamps strictly to adjacent frames and sanitizes NaN / zero delta", () => {
        const vfr = {
            mediaUrl: "clip.mp4",
            fps: 30,
            nominalFps: 30,
            startTime: 0,
            duration: 1,
            frameCount: 4,
            cfr: false,
            keyframes: [0],
            pts: [0, 0.04, 0.09, 0.14],
        };
        expect(nudgeTimeToFrame(0.039, 1, 30, vfr)).toBeCloseTo(0.04, 6);
        expect(nudgeTimeToFrame(0.039, -1, 30, vfr)).toBeCloseTo(0, 6);
        expect(nudgeTimeToFrame(0.039, 0, 30, vfr)).toBeCloseTo(0.04, 6);
        expect(nudgeTimeToFrame(Number.NaN, 1, 30, vfr)).toBeCloseTo(0.04, 6);
        expect(nudgeTimeToFrame(Number.NaN, 0, 30)).toBe(0);
    });

    it("returns storyIdx = -1 on 1-scene and [Hook, Re-Hook] timelines without mutating Hook as Story", () => {
        const oneScene = [{ id: "scene-1", title: "H", duration: 4, clipStartOffset: 10 }];
        expect(getTimelineStructure(oneScene).storyIdx).toBe(-1);
        expect(getTimelineStructure(oneScene).storyOffset).toBe(0);
        expect(getSceneRoleLabel(oneScene, 0)).toBe("01. HOOK");
        expect(resolveSceneFade(oneScene, 0).inEnabled).toBe(false);

        const twoHookRehook = [
            { id: "scene-1", title: "H", duration: 4 },
            { id: "rehook-1", title: "R", duration: 4 },
        ];
        expect(getTimelineStructure(twoHookRehook).storyIdx).toBe(-1);
        expect(getSceneRoleLabel(twoHookRehook, 1)).toBe("02. RE-HOOK");
    });

    it("tints parked SNAP POST gold and SNAP PRE blue in keyframeTelemetry", () => {
        const kfs: VideoKeyframe[] = [
            { id: "s1", time: 5, zoom: 120, posX: 50, easing: "snap", pre: { time: 4, zoom: 100, posX: 50 } },
            { id: "s2", time: 10, zoom: 140, posX: 60, easing: "smooth" },
        ];
        expect(getKeyframeTelemetryTint(kfs, 5, "post", true, true).color).toBe("var(--ui-accent)");
        expect(getKeyframeTelemetryTint(kfs, 5, "pre", true, true).color).toBe("var(--ui-pre)");
    });

    it("handles options.scenes, unsorted subtitle arrays, looped tails, and hidden-CC SRT export", () => {
        const unsorted = [
            { id: "b", start: 5, end: 7, text: "Second" },
            { id: "a", start: 1, end: 3, text: "First" },
        ];
        expect(findSubtitleAtMediaTime(unsorted, 2)?.id).toBe("a");
        expect(findSubtitleAtMediaTime(unsorted, 6)?.id).toBe("b");

        const loopedDraft = makeDraft({
            videoDuration: 10,
            showSubtitles: false,
            subtitles: [{ id: "s1", start: 2, end: 4, text: "Loop line" }],
            scenes: [
                { id: "scene-1", title: "H", duration: 4 },
                { id: "scene-2", title: "Story", duration: 18 },
            ],
        });
        expect(buildTimelineSrtContent(loopedDraft)).toContain("Loop line");

        const shownLooped = { ...loopedDraft, showSubtitles: true };
        const times = getActiveSubtitleTimelineTimes(shownLooped);
        expect(times.length).toBeGreaterThanOrEqual(2);

        const customScenes = [{ id: "scene-1", title: "H", duration: 4, clipStartOffset: 2 }];
        const projected = projectSubtitlesToTimeline(
            { ...shownLooped, scenes: [{ id: "scene-1", title: "H", duration: 4, clipStartOffset: 0 }] },
            { scenes: customScenes }
        );
        expect(projected[0]?.start).toBeCloseTo(0, 4);
    });

    it("guards evaluateEmblemCue against NaN and non-positive morph durations", () => {
        expect(evaluateEmblemCue(Number.NaN, 0.45, 0.5, "ccw")).toEqual({
            shapeA: "dot",
            shapeB: "dot",
            mix: 0,
            expandFactor: 0,
            angleDeg: 0,
        });
        expect(evaluateEmblemCue(0.2, 0, 0.5, "ccw")).toEqual({
            shapeA: "dot",
            shapeB: "dot",
            mix: 0,
            expandFactor: 0,
            angleDeg: 0,
        });
    });

    it("applies static 4:5 punch-in zoom >100% and avoids double-scaling dynamic 4:5 punch-in", () => {
        const staticPunch = makeDraft({
            aspectRatio: "4:5",
            zoom: 150,
            defaultFramingByRatio: { "4:5": { zoom: 150, posX: 50, posY: 100 } },
            keyframes: [],
        });
        const staticStage = buildSceneFilterStages({
            index: 0,
            scenes: staticPunch.scenes,
            draft: staticPunch,
            start: 0,
            duration: 4,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: false,
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
        expect(staticStage.filters.some((f) => f.includes("scale=1620:2026:force_original_aspect_ratio=increase"))).toBe(true);

        const dynamicPunch = makeDraft({
            aspectRatio: "4:5",
            zoom: 100,
            defaultFramingByRatio: { "4:5": { zoom: 100, posX: 50, posY: 100 } },
            keyframes: [
                { id: "k0", time: 0, zoom: 100, posX: 50, easing: "smooth" },
                { id: "k1", time: 4, zoom: 150, posX: 50, easing: "smooth" },
            ],
        });
        const dynStage = buildSceneFilterStages({
            index: 0,
            scenes: dynamicPunch.scenes,
            draft: dynamicPunch,
            start: 0,
            duration: 4,
            width: 1080,
            height: 1350,
            targetFps: 30,
            is45: true,
            isImage: false,
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
        expect(dynStage.filters.some((f) => f.includes("scale=w='ceil(1080*") && !f.includes("scale=1080:1350"))).toBe(true);
    });
});
