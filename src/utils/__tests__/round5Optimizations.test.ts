import { describe, expect, it, vi, afterEach } from "vitest";
import { createDefaultVideoDraft } from "../../types/news";
import { VideoDraftResolver } from "../../app/admin/utils/dataAccessors";
import { buildSceneFilterStages, isAnimatedSceneOverlay } from "../../lib/server/ffmpegSceneGraph";
import { insertTextAtCursor, wrapSelectionWithSyntax } from "../../app/admin/utils/domUtils";
import { POST as exportPost } from "../../app/api/video/export/route";
import { POST as transcribePost } from "../../app/api/video/transcribe/route";

describe("Round 5 regression tests", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    it("VideoDraftResolver updates global draft.sourceName and draft.creditName on Scene 02+ when no per-scene override exists", () => {
        const draft = createDefaultVideoDraft();
        draft.sourceName = "Dawn News";
        draft.creditName = "Reuters";
        // Park at t=10s (Scene 03 / Story)
        const updatedSource = VideoDraftResolver.set("video-sourceName", "==Dawn== News", draft, 10);
        expect(updatedSource.sourceName).toBe("==Dawn== News");
        expect(updatedSource.scenes[2]?.sourceName).toBeUndefined();
        expect(VideoDraftResolver.get("video-sourceName", updatedSource, 10)).toBe("==Dawn== News");

        const updatedCredit = VideoDraftResolver.set("video-creditName", "**Reuters**", updatedSource, 10);
        expect(updatedCredit.creditName).toBe("**Reuters**");
        expect(updatedCredit.scenes[2]?.creditName).toBeUndefined();
        expect(VideoDraftResolver.get("video-creditName", updatedCredit, 10)).toBe("**Reuters**");
    });

    it("VideoDraftResolver still updates an explicit per-scene sourceName override when set", () => {
        const draft = createDefaultVideoDraft();
        draft.sourceName = "Global Source";
        draft.scenes[2] = { ...draft.scenes[2]!, sourceName: "Scene 3 Source" };

        const updated = VideoDraftResolver.set("video-sourceName", "==Scene 3== Source", draft, 10);
        expect(updated.scenes[2]?.sourceName).toBe("==Scene 3== Source");
        expect(updated.sourceName).toBe("Global Source");
    });

    it("ffmpegSceneGraph uses eof_action=repeat for static overlays and keeps 0.22s fade-in on animated Scene 01", () => {
        const draft = createDefaultVideoDraft();
        draft.enableMotion = true;

        expect(isAnimatedSceneOverlay(draft, draft.scenes, 0)).toBe(true);
        expect(isAnimatedSceneOverlay(draft, draft.scenes, 1)).toBe(false);
        expect(isAnimatedSceneOverlay({ ...draft, enableMotion: false }, draft.scenes, 0)).toBe(false);

        const baseCtx = {
            scenes: draft.scenes,
            draft,
            start: 0,
            duration: 4,
            width: 1080,
            height: 1920,
            targetFps: 30,
            is45: false,
            isImage: false,
            srcWidth: 1080,
            srcHeight: 1920,
            srcHasAudio: true,
            mediaIdx: 0,
            overlayIdx: 1,
            customLoopVideoSource: null,
            customLoopAudioSource: null,
            loopTrim: "",
            aLoopTrim: "",
        };

        const scene0 = buildSceneFilterStages({ ...baseCtx, index: 0 });
        expect(scene0.filters.some((f) => f.includes("fade=t=in:st=0:d=0.22:alpha=1"))).toBe(true);
        expect(scene0.filters.some((f) => f.includes("overlay=0:0:format=auto:alpha=straight,scale=out_color_matrix=bt709:out_range=tv"))).toBe(true);

        const scene1 = buildSceneFilterStages({ ...baseCtx, index: 1, start: 4 });
        expect(scene1.filters.some((f) => f.includes("fade=t=in:st=0:d=0.22:alpha=1"))).toBe(false);
        expect(scene1.filters.some((f) => f.includes("overlay=0:0:format=auto:alpha=straight:eof_action=repeat:repeatlast=1,scale=out_color_matrix=bt709:out_range=tv"))).toBe(true);
    });

    it("POST /api/video/export and /api/video/transcribe short-circuit with 501 on VERCEL=1", async () => {
        vi.stubEnv("VERCEL", "1");

        const exportRes = await exportPost(new Request("http://localhost/api/video/export", { method: "POST" }));
        expect(exportRes.status).toBe(501);

        const transcribeRes = await transcribePost(new Request("http://localhost/api/video/transcribe", { method: "POST" }));
        expect(transcribeRes.status).toBe(501);
    });

    it("domUtils slices live el.value so Android IME composition indices never drift against stale React props", () => {
        const fakeEl = {
            value: "Breaking Lahore News",
            selectionStart: 9,
            selectionEnd: 15,
            focus: vi.fn(),
            setSelectionRange: vi.fn(),
        };
        vi.stubGlobal("document", {
            getElementById: (id: string) => (id === "input-video-headline" ? fakeEl : null),
            contains: () => true,
        });
        vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
            cb(0);
            return 1;
        });

        let result = "";
        // Stale React value prop intentionally shorter than live DOM el.value
        wrapSelectionWithSyntax("video-headline", "Breaking", "==", "==", (next) => { result = next; });
        expect(result).toBe("Breaking ==Lahore== News");

        let inserted = "";
        fakeEl.selectionStart = 8;
        fakeEl.selectionEnd = 8;
        insertTextAtCursor("video-headline", "Stale", " 🇵🇰", (next) => { inserted = next; });
        expect(inserted).toBe("Breaking 🇵🇰 Lahore News");
    });
});
