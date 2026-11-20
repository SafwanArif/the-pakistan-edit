import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, type VideoDraft } from "../../../../types/news";
import { getMasterChecklistItems } from "../MasterChecklistPopover";
import { getSceneCheckItems } from "../SceneChecklistPopover";
import { normalizeEditorialPrefix } from "../EditorialTools";

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

describe("getSceneCheckItems & normalizeEditorialPrefix (Portion E Stage 2)", () => {
    it("counts all supported closed emphasis syntaxes and face detection in Hook mode (Bug #27)", () => {
        const draft = makeDraft({
            videoUrl: "clip.mp4",
            subtitles: [{ id: "s1", start: 0.2, end: 2.0, text: "Breaking" }],
        });
        const hookScene = {
            ...draft.scenes[0]!,
            duration: 4,
            title: "WHY ==GOLD== AND ~~GREEN~~ **BOLD** MATTERS?",
            subtitle: "Verified breakdown of the policy shift for viewers.",
        };
        const items = getSceneCheckItems("hook", hookScene, draft, { faceDetected: true });
        expect(items.find((i) => i.label.includes("Selective focal emphasis"))?.ok).toBe(true);
        expect(items.find((i) => i.label.includes("eye-contact trigger detected"))?.ok).toBe(true);
        expect(items.find((i) => i.label.includes("speech starts < 0.6s"))?.ok).toBe(true);
    });

    it("resolves Re-Hook speech check at default continuation offset after Hook 01 (Bug #27)", () => {
        const draft = makeDraft({
            scenes: [
                { id: "h", title: "HOOK?", subtitle: "Context", duration: 4, clipStartOffset: 2 },
                { id: "r", title: "WAIT", subtitle: "", duration: 4, shareHookText: true },
                { id: "s", title: "STORY", subtitle: "Full story details here today.", duration: 20 },
            ],
            subtitles: [{ id: "re", start: 6.1, end: 8.5, text: "The real shift happens now" }],
        });
        const items = getSceneCheckItems("rehook", draft.scenes[1]!, draft);
        expect(items.find((i) => i.label.includes("speech starts < 0.6s"))?.ok).toBe(true);

        const deadAirDraft = makeDraft({
            ...draft,
            subtitles: [{ id: "early", start: 0.1, end: 1.5, text: "Only at t=0" }],
        });
        const deadItems = getSceneCheckItems("rehook", deadAirDraft.scenes[1]!, deadAirDraft);
        expect(deadItems.find((i) => i.label.includes("Dead air at Re-Hook start"))?.ok).toBe(false);
    });

    it("evaluates setup scene checks cleanly", () => {
        const draft = makeDraft({
            keyframes: [{ id: "k1", time: 12, zoom: 110, posX: 50, easing: "smooth" }],
        });
        const story = {
            id: "s",
            title: "WHAT THE NEW BUDGET ACTUALLY CHANGES",
            subtitle: "Breaking down every tax bracket and household cost across regions.",
            duration: 24,
            clipStartOffset: 5,
            fadeIn: true,
        };
        const items = getSceneCheckItems("setup", story, draft, { sceneBounds: { start: 8, end: 32 } });
        expect(items.every((i) => i.ok)).toBe(true);
    });

    it("normalizes custom editorial prefixes without duplicating colons or saving blanks (Bug #23)", () => {
        expect(normalizeEditorialPrefix("credit")).toBe("CREDIT:");
        expect(normalizeEditorialPrefix(" CREDIT: ")).toBe("CREDIT:");
        expect(normalizeEditorialPrefix("credit:::")).toBe("CREDIT:");
        expect(normalizeEditorialPrefix("")).toBeNull();
        expect(normalizeEditorialPrefix("   ")).toBeNull();
        expect(normalizeEditorialPrefix(":::")).toBeNull();
    });
});
