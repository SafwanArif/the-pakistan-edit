import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHydratedVideoDraft, probeVideoMetadata } from "../useVideoDraftState";
import { getDefaultVideoFraming, getVideoHeadingPreset } from "../../../../types/news";

describe("video aspect ratio presets", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("migrates saved square video drafts to the 16:9 preset", () => {
        const draft = normalizeHydratedVideoDraft({ aspectRatio: "1:1" });

        expect(draft.aspectRatio).toBe("16:9");
    });

    it("detects landscape source video as 16:9", async () => {
        const video = {
            preload: "",
            videoWidth: 1920,
            videoHeight: 1080,
            duration: 12,
            onloadedmetadata: null as (() => void) | null,
            onerror: null as (() => void) | null,
            removeAttribute: vi.fn(),
            load: vi.fn(),
            src: "",
        };
        vi.stubGlobal("document", { createElement: () => video });

        const result = probeVideoMetadata("landscape.mp4");
        video.onloadedmetadata?.();

        await expect(result).resolves.toMatchObject({ aspectRatio: "16:9", duration: 12 });
    });

    it("resolves heading placement per ratio and falls back to the legacy preset", () => {
        const draft = {
            headlinePreset: "bottom" as const,
            headingPresets: {
                "9:16": "top" as const,
                "4:5": "center" as const,
            },
        };

        expect(getVideoHeadingPreset(draft, "9:16")).toBe("top");
        expect(getVideoHeadingPreset(draft, "4:5")).toBe("center");
        expect(getVideoHeadingPreset(draft, "16:9")).toBe("bottom");
    });

    it("keeps default framing independent per ratio and migrates legacy framing to the active ratio", () => {
        const draft = normalizeHydratedVideoDraft({
            aspectRatio: "9:16",
            zoom: 135,
            posX: 40,
            posY: 100,
            defaultFramingByRatio: {
                "9:16": { zoom: 135, posX: 40, posY: 100 },
                "4:5": { zoom: 25, posX: 60, posY: 35 },
            },
        });

        expect(getDefaultVideoFraming(draft, "9:16")).toEqual({ zoom: 135, posX: 40, posY: 100 });
        expect(getDefaultVideoFraming(draft, "4:5")).toEqual({ zoom: 25, posX: 60, posY: 35 });
        expect(getDefaultVideoFraming(draft, "16:9")).toEqual({ zoom: 100, posX: 50, posY: 100 });

        const legacyDraft = normalizeHydratedVideoDraft({
            aspectRatio: "4:5",
            zoom: 25,
            posX: 60,
            posY: 35,
        });
        expect(getDefaultVideoFraming(legacyDraft, "4:5")).toEqual({ zoom: 25, posX: 60, posY: 35 });
        expect(getDefaultVideoFraming(legacyDraft, "9:16")).toEqual({ zoom: 100, posX: 50, posY: 100 });
    });
});
