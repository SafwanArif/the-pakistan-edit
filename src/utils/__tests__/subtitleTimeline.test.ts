import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, getSceneBoundaries, type SubtitleSegment, type VideoDraft } from "../../types/news";
import {
    buildTimelineSrtContent,
    findSubtitleAtMediaTime,
    getActiveSubtitleTimelineTimes,
    projectSubtitlesToTimeline,
} from "../subtitleTimeline";
import { buildAssSubtitles } from "../../lib/server/ffmpegFilters";

const makeDraft = (overrides: Partial<VideoDraft> = {}): VideoDraft => ({
    ...createDefaultVideoDraft(),
    videoDuration: 30,
    scenes: [
        { id: "scene-1", title: "Hook", subtitle: "", duration: 4, clipStartOffset: 10 },
        { id: "rehook-1", title: "Re-Hook", subtitle: "", duration: 4, clipStartOffset: 20, shareHookText: true },
        { id: "scene-2", title: "Story", subtitle: "", duration: 12, clipStartOffset: 2 },
    ],
    subtitles: [
        { id: "s1", start: 2.5, end: 5.0, text: "Story opening line" },
        { id: "s2", start: 10.5, end: 13.0, text: "Hook teaser punchline" },
        { id: "s3", start: 21.0, end: 23.5, text: "Re-hook twist line" },
    ],
    ...overrides,
});

describe("unified subtitle projection & O(log N) lookup", () => {
    it("projects Hook, Re-Hook, and Story subtitles with exact 1:1 timeline offsets and honours per-scene CC off", () => {
        const draft = makeDraft();
        const projected = projectSubtitlesToTimeline(draft);
        expect(projected).toEqual([
            { id: "s2", start: 0.5, end: 3.0, text: "Hook teaser punchline" },
            { id: "s3", start: 5.0, end: 7.5, text: "Re-hook twist line" },
            { id: "s1", start: 8.5, end: 11.0, text: "Story opening line" },
            { id: "s2", start: 16.5, end: 19.0, text: "Hook teaser punchline" },
        ]);

        // Turning CC off on Re-Hook removes only Re-Hook's cue
        const mutedRehook = makeDraft({
            scenes: draft.scenes.map((s, idx) => (idx === 1 ? { ...s, showSubtitles: false } : s)),
        });
        expect(getActiveSubtitleTimelineTimes(mutedRehook)).toEqual([0.5, 8.5, 16.5]);

        // Timeline-aligned SRT matches Hook/Re-Hook/Story cuts instead of raw source timestamps
        const srt = buildTimelineSrtContent(mutedRehook);
        expect(srt).toContain("00:00:00,500 --> 00:00:03,000\nHook teaser punchline");
        expect(srt).not.toContain("Re-hook twist line");

        // FFmpeg ASS burn-in matches exact same projected cue boundaries without 20ms jitter
        const ass = buildAssSubtitles(
            mutedRehook,
            mutedRehook.scenes,
            getSceneBoundaries(mutedRehook.scenes),
            1080,
            1920,
            false,
            true,
            30
        );
        expect(ass).toContain("Dialogue: 0,0:00:00.50,0:00:03.00,Default,,0,0,0,,Hook teaser punchline");
        expect(ass).toContain("Dialogue: 0,0:00:08.50,0:00:11.00,Default,,0,0,0,,Story opening line");
    });

    it("resolves cues in O(log N) for large sorted transcripts and safely falls back for unsorted arrays", () => {
        const sorted: SubtitleSegment[] = Array.from({ length: 120 }, (_, i) => ({
            id: `sub-${i}`,
            start: i * 2,
            end: i * 2 + 1.5,
            text: `Line ${i}`,
        }));
        expect(findSubtitleAtMediaTime(sorted, 0)?.id).toBe("sub-0");
        expect(findSubtitleAtMediaTime(sorted, 114.2)?.id).toBe("sub-57");
        expect(findSubtitleAtMediaTime(sorted, 115.7)).toBeUndefined();
        expect(findSubtitleAtMediaTime(sorted, 238.5)?.id).toBe("sub-119");

        const unsorted: SubtitleSegment[] = [
            ...sorted.slice(0, 10).reverse(),
        ];
        expect(findSubtitleAtMediaTime(unsorted, 4.5)?.id).toBe("sub-2");
    });
});
