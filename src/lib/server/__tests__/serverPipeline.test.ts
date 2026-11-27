import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft, getSceneBoundaries } from "@/types/news";
import {
    classifyFrameTimestamps,
    computeExportVbvCeiling,
    createByteLimitTransform,
    parseFfmpegProgressPercent,
    parseVideoFrameRate,
    parseWhisperProgressLine,
    withExportSlot,
} from "../videoMedia";
import {
    build45BoxHExpr,
    build45ScaleExpr,
    buildAssSubtitles,
    buildAudioFadeFilters,
    buildPosXNormExpr,
    escapeFfmpegFilterPath,
} from "../ffmpegFilters";
import { buildSceneFilterStages } from "../ffmpegSceneGraph";
import { GET as proxyAssetGet } from "@/app/api/proxy/asset/route";
import { GET as healthGet } from "@/app/api/health/route";
import { POST as exportPost } from "@/app/api/video/export/route";
import { POST as ingestPost } from "@/app/api/video/ingest/route";
import { POST as transcribePost } from "@/app/api/video/transcribe/route";

describe("Batch 8 — videoMedia pure helpers & concurrency primitives", () => {
    it("parses broadcast frame rates and rejects malformed ratios or >125 timebase", () => {
        expect(parseVideoFrameRate("30000/1001", "30/1")).toEqual({ exactFps: 29.97, nominalFps: 30 });
        expect(parseVideoFrameRate("24000/1001")).toEqual({ exactFps: 23.976, nominalFps: 24 });
        expect(parseVideoFrameRate("60000/1001")).toEqual({ exactFps: 59.94, nominalFps: 60 });
        expect(parseVideoFrameRate("90000/1", "30/1")).toEqual({ exactFps: 30, nominalFps: 30 });
        expect(parseVideoFrameRate("30/1/2", "bad")).toEqual({ exactFps: 30, nominalFps: 30 });
    });

    it("classifies CFR vs VFR timestamps cleanly and ignores non-finite values", () => {
        const cfr = Array.from({ length: 30 }, (_, i) => i / 30);
        expect(classifyFrameTimestamps(cfr).cfr).toBe(true);
        const vfr = [0, 0.033, 0.066, 0.15, 0.18, 0.30, 0.33];
        expect(classifyFrameTimestamps(vfr).cfr).toBe(false);
        expect(classifyFrameTimestamps([0, Number.NaN, 0.033]).cfr).toBe(true);
    });

    it("computes Level 4.2 VBV ceilings and parses FFmpeg/Whisper progress lines", () => {
        expect(computeExportVbvCeiling(undefined)).toBeNull();
        expect(computeExportVbvCeiling(4_000_000)).toEqual({ maxrateKbps: 16_000, bufsizeKbps: 32_000 });
        expect(computeExportVbvCeiling(40_000_000)).toEqual({ maxrateKbps: 50_000, bufsizeKbps: 100_000 });
        expect(parseFfmpegProgressPercent("out_time_us=5000000", 10, 99)).toBe(50);
        expect(parseFfmpegProgressPercent("out_time_us=15000000", 10, 99)).toBe(99);
        expect(parseFfmpegProgressPercent("speed=2.5x", 10, 99)).toBeNull();
        expect(parseWhisperProgressLine("whisper_print_progress_callback: progress =  42%", 10)).toBe(42);
        expect(parseWhisperProgressLine("[00:00:05.000 --> 00:00:10.000] Salam", 20)).toBe(50);
    });

    it("enforces AbortSignal on queued withExportSlot waiters and hard ceiling on createByteLimitTransform", async () => {
        let releaseFirst!: () => void;
        const firstGate = new Promise<void>((r) => { releaseFirst = r; });
        const first = withExportSlot(async () => { await firstGate; return "first"; });

        const ac = new AbortController();
        const second = withExportSlot(async () => "second", ac.signal);
        ac.abort();
        await expect(second).rejects.toThrow(/aborted/i);

        releaseFirst();
        await expect(first).resolves.toBe("first");

        const limit = createByteLimitTransform(4);
        const writer = limit.writable.getWriter();
        const reader = limit.readable.getReader();
        void writer.write(new Uint8Array([1, 2, 3])).catch(() => {});
        expect((await reader.read()).value?.byteLength).toBe(3);
        const overWrite = writer.write(new Uint8Array([4, 5])).catch(() => {});
        await expect(reader.read()).rejects.toThrow(/limit/i);
        await overWrite;
    });
});

describe("Batch 8 — ffmpegFilters & ffmpegSceneGraph parity and NaN hardening", () => {
    it("prevents /0.0000 glide div-by-zero (P276) and coalesces adjacent identical constant segments (P282)", () => {
        const draft = createDefaultVideoDraft();
        draft.keyframes = [
            { id: "k1", time: 1.0, zoom: 100, posX: 50, posY: 50, easing: "smooth" },
            { id: "k2", time: 1.00001, zoom: 120, posX: 50, posY: 50, easing: "smooth" },
            { id: "k3", time: 3.0, zoom: 120, posX: 50, posY: 50, easing: "smooth" },
            { id: "k4", time: 5.0, zoom: 120, posX: 80, posY: 50, easing: "smooth" },
        ];
        const scaleRes = build45ScaleExpr(draft, 0, 6, 1.5);
        expect(scaleRes.expr).not.toContain("/0.0000");
        const posXExpr = buildPosXNormExpr(draft, 0, 6);
        expect(posXExpr.startsWith("if(lt(t,3.000),0.5000,")).toBe(true);
        expect(build45BoxHExpr(draft, 0, 6, 1350, 608).minH).toBe(1350);
    });

    it("generates escaped ASS subtitles with exact marginV table across aspect ratios (P264, P290)", () => {
        const draft = createDefaultVideoDraft();
        draft.subtitleFontSize = Number.NaN;
        draft.subtitleBackdrop = "glass";
        draft.subtitlePosition = "high";
        draft.subtitles = [{ id: "s1", start: 0, end: 2, text: "Line1\n{Tag}\\Path" }];
        const bounds = getSceneBoundaries(draft.scenes);
        const ass916 = buildAssSubtitles(draft, draft.scenes, bounds, 1080, 1920, false, true, 20);
        expect(ass916).toContain("&H78080808,&H78080808,-1,0,0,0,100,100,0.4,0,3,14,0,2,60,140,435,1");
        expect(ass916).toContain("Line1\\N\\{Tag\\}\\\\Path");
        expect(ass916).not.toContain("NaN");

        const ass45 = buildAssSubtitles({ ...draft, subtitlePosition: "middle" }, draft.scenes, bounds, 1080, 1350, true, false, 20);
        expect(ass45).toContain(",60,140,185,1");
        const ass169 = buildAssSubtitles({ ...draft, subtitlePosition: "bottom" }, draft.scenes, bounds, 1920, 1080, false, false, 20);
        expect(ass169).toContain(",60,140,150,1");

        expect(escapeFfmpegFilterPath("C:\\tools\\fonts\\a'b.ass")).toBe("C\\:/tools/fonts/a\\'b.ass");
        expect(buildAudioFadeFilters(Number.NaN, 4, 0.5, 0.5, "full", "declick")).toEqual([
            "afade=t=in:st=0:d=0.500:curve=hsin",
            "afade=t=out:st=3.985:d=0.015:curve=hsin",
        ]);
    });

    it("centers portrait 9:16 video vertically in 4:5 mode at zoom<=100% (P277), guards NaN volume, and applies HDR tonemap", () => {
        const draft = createDefaultVideoDraft();
        draft.aspectRatio = "4:5";
        draft.volume = Number.NaN;
        const stage = buildSceneFilterStages({
            index: 0, scenes: draft.scenes, draft, start: 0, duration: 4, width: 1080, height: 1350, targetFps: 30,
            is45: true, isImage: false, srcWidth: 1080, srcHeight: 1920, srcHasAudio: true, srcIsHdr: true,
            mediaIdx: 0, overlayIdx: 1, customLoopVideoSource: null, customLoopAudioSource: null, loopTrim: "", aLoopTrim: "",
        });
        expect(stage.filters.some((f) => f.includes("crop=1080:1350:x='(iw-1080)*0.5000':y='(ih-1350)/2'"))).toBe(true);
        expect(stage.filters.some((f) => f.includes("tonemap=hable:desat=0"))).toBe(true);
        expect(stage.filters.join("\n")).not.toContain("NaN");
    });
});

describe("Batch 8 — Route SSRF, abort (499), and DoS (413) defenses (P257, P272, P283, P284, P293, P295, P297, P298)", () => {
    it("marks /api/health with Cache-Control: no-store", async () => {
        const res = await healthGet();
        expect(res.status).toBe(200);
        expect(res.headers.get("cache-control")).toBe("no-store");
    });

    it.each([
        "http://localhost/a.png",
        "http://127.0.0.1/a.png",
        "http://169.254.169.254/latest/meta-data",
        "http://224.0.0.1/a.png",
        "http://198.18.0.1/a.png",
        "http://[0:0:0:0:0:0:0:1]/a.png",
        "http://[0:0:0:0:0:ffff:7f00:1]/a.png",
        "http://[::7f00:1]/a.png",
        "http://[2002:7f00:1::]/a.png",
        "http://[2001:0::1]/a.png",
        "http://[ff02::1]/a.png",
        "http://[64:ff9b::1]/a.png",
        "https://user:pass@example.com/a.png",
        "https://example.com:6379/a.png",
        "file:///etc/passwd",
        `https://example.com/${"a".repeat(4100)}.png`,
    ])("blocks SSRF or oversized URL %s with HTTP 400", async (target) => {
        const res = await proxyAssetGet(new Request(`http://localhost/api/proxy/asset?url=${encodeURIComponent(target)}`));
        expect(res.status).toBe(400);
    });

    it("fails fast with 413 on oversized /api/video/ingest Content-Length (P295) and 499 on aborted requests (P284, P297)", async () => {
        const hugeRes = await ingestPost(new Request("http://localhost/api/video/ingest", {
            method: "POST",
            headers: { "content-length": "600000000" },
        }));
        expect(hugeRes.status).toBe(413);

        const aborted = AbortSignal.abort();
        expect((await exportPost(new Request("http://localhost/api/video/export", { method: "POST", signal: aborted }))).status).toBe(499);
        expect((await ingestPost(new Request("http://localhost/api/video/ingest", { method: "POST", signal: aborted }))).status).toBe(499);
        expect((await transcribePost(new Request("http://localhost/api/video/transcribe", { method: "POST", signal: aborted }))).status).toBe(499);
    });
});
