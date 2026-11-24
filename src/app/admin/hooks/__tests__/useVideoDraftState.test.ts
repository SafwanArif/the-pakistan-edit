import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHydratedVideoDraft, probeVideoMetadata, resetClipBoundFields } from "../useVideoDraftState";
import { createDefaultVideoDraft, getDefaultVideoFraming, getVideoHeadingPreset } from "../../../../types/news";
import { GET as healthGet } from "../../../api/health/route";
import { POST as ingestPost } from "../../../api/video/ingest/route";

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

    it("strips dead ephemeral blob: URLs from scene media overrides during hydration", () => {
        const draft = normalizeHydratedVideoDraft({
            scenes: [
                { id: "scene-1", title: "Hook", subtitle: "", duration: 4 },
                { id: "scene-2", title: "Story", subtitle: "", duration: 20, mediaUrl: "blob:http://localhost:3000/dead", mediaType: "image", mediaName: "dead.png" },
                { id: "scene-3", title: "Keep", subtitle: "", duration: 10, mediaUrl: "/api/video/ingest?id=media-1.mp4", mediaType: "video" },
            ],
        });
        expect(draft.scenes[1]?.mediaUrl).toBeUndefined();
        expect(draft.scenes[1]?.mediaType).toBe("video");
        expect(draft.scenes[2]?.mediaUrl).toBe("/api/video/ingest?id=media-1.mp4");
    });

    it("resetClipBoundFields wipes stale subtitles, keyframes, star cues, and master offsets while keeping copy and framing defaults", () => {
        const dirty = {
            ...createDefaultVideoDraft(),
            category: "ECONOMY",
            headline: "KEEP THIS HEADLINE",
            defaultFramingByRatio: { "9:16": { zoom: 120, posX: 40, posY: 100 } },
            subtitles: [{ id: "s1", start: 0, end: 2, text: "Old speech" }],
            keyframes: [{ id: "k1", time: 5, zoom: 140, posX: 60, easing: "smooth" as const }],
            starCues: [{ id: "st1", time: 12 }],
            sourceFps: 25,
            sourceFrameLogUrl: "/api/video/ingest?frameIndex=old",
            scenes: [
                { id: "scene-1", title: "Hook", subtitle: "Sub", duration: 4, clipStartOffset: 18.5 },
                { id: "scene-2", title: "Story", subtitle: "Body", duration: 40, clipStartOffset: 24.0 },
                { id: "scene-3", title: "Custom", subtitle: "B-roll", duration: 10, mediaUrl: "https://cdn.example/broll.mp4", clipStartOffset: 3.0 },
            ],
        };
        const cleaned = resetClipBoundFields(dirty);
        expect(cleaned.category).toBe("ECONOMY");
        expect(cleaned.headline).toBe("KEEP THIS HEADLINE");
        expect(cleaned.defaultFramingByRatio).toEqual({ "9:16": { zoom: 120, posX: 40, posY: 100 } });
        expect(cleaned.subtitles).toEqual([]);
        expect(cleaned.keyframes).toEqual([]);
        expect(cleaned.starCues).toBeUndefined();
        expect(cleaned.sourceFps).toBeUndefined();
        expect(cleaned.scenes[0]?.clipStartOffset).toBeUndefined();
        expect(cleaned.scenes[1]?.clipStartOffset).toBeUndefined();
        expect(cleaned.scenes[2]?.clipStartOffset).toBe(3.0);
    });

    it("exposes serverless capability flags and short-circuits /api/video/ingest POST with 501 on Vercel", async () => {
        const prevVercel = process.env.VERCEL;
        try {
            process.env.VERCEL = "1";
            const healthRes = await healthGet();
            const healthBody = await healthRes.json() as { capabilities?: { localIngest?: boolean } };
            expect(healthBody.capabilities?.localIngest).toBe(false);

            const ingestRes = await ingestPost(new Request("http://localhost/api/video/ingest", { method: "POST" }));
            expect(ingestRes.status).toBe(501);

            delete process.env.VERCEL;
            const localHealth = await (await healthGet()).json() as { capabilities?: { localIngest?: boolean } };
            expect(localHealth.capabilities?.localIngest).toBe(true);
        } finally {
            if (prevVercel === undefined) delete process.env.VERCEL;
            else process.env.VERCEL = prevVercel;
        }
    });
});
