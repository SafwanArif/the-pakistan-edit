import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, type VideoDraft } from "../../../../types/news";
import { getMasterChecklistItems } from "../MasterChecklistPopover";

const makeDraft = (overrides: Partial<VideoDraft> = {}): VideoDraft => ({
    ...createDefaultVideoDraft(),
    ...overrides,
});

describe("getMasterChecklistItems", () => {
    it("scores Whisper Subtitles card from 0/3 (red) through 3/3 (green)", () => {
        const zeroDraft = makeDraft({
            aspectRatio: "9:16",
            subtitleFontSize: 32,
            subtitleBackdrop: "none",
            subtitles: [],
        });
        const zeroItem = getMasterChecklistItems(zeroDraft).find((i) => i.id === "whisper-cc");
        expect(zeroItem?.tone).toBe("red");
        expect(zeroItem?.passed).toBe(false);
        expect(zeroItem?.label).toContain("(0/3)");

        const twoDraft = makeDraft({
            aspectRatio: "9:16",
            subtitleFontSize: 48,
            subtitleBackdrop: "shadow",
            subtitles: [],
        });
        const twoItem = getMasterChecklistItems(twoDraft).find((i) => i.id === "whisper-cc");
        expect(twoItem?.tone).toBe("orange");
        expect(twoItem?.passed).toBe(false);
        expect(twoItem?.label).toContain("(2/3)");

        const threeDraft = makeDraft({
            aspectRatio: "9:16",
            subtitleFontSize: 48,
            subtitleBackdrop: "shadow",
            showSubtitles: true,
            subtitles: [{ id: "s1", start: 0, end: 2, text: "Test caption" }],
        });
        const threeItem = getMasterChecklistItems(threeDraft).find((i) => i.id === "whisper-cc");
        expect(threeItem?.tone).toBe("green");
        expect(threeItem?.passed).toBe(true);
        expect(threeItem?.label).toContain("(3/3)");
    });

    it("gates Creator Rewards 60s+ minimum runtime check", () => {
        const shortDraft = makeDraft({
            enableOutro: false,
            scenes: [{ id: "scene-1", title: "H", subtitle: "S", duration: 20 }],
        });
        const rewardsShort = getMasterChecklistItems(shortDraft).find((i) => i.id === "rewards-60s");
        expect(rewardsShort?.passed).toBe(false);

        const longDraft = makeDraft({
            enableOutro: false,
            scenes: [{ id: "scene-1", title: "H", subtitle: "S", duration: 60 }],
        });
        const rewardsLong = getMasterChecklistItems(longDraft).find((i) => i.id === "rewards-60s");
        expect(rewardsLong?.passed).toBe(true);
    });
});
