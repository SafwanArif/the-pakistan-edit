import { describe, expect, it } from "vitest";
import { createDefaultDraft, createDefaultVideoDraft } from "@/types/news";
import { DraftResolver, getEffectiveSlideAsset, VideoDraftResolver } from "../dataAccessors";
import { isSafeMediaUrl } from "../domUtils";
import { getKeyframeTelemetryTint, resolveKeyframeJumpStop } from "../keyframeTelemetry";
import { getAnchorKeyword, sanitize } from "../textUtils";
import { parseMoovBuffer } from "../clientMediaInspector";

describe("admin/utils Batch 5 hardened helpers", () => {
    it("DraftResolver guards out-of-bounds extraSlides holes (P126), slide-1 allow-list (P146), and Slide 1 shadowing (P127)", () => {
        const base = createDefaultDraft();
        const unchanged = DraftResolver.set("extra-heading-5", "SPARSE", base);
        expect(unchanged).toBe(base);

        const blocked = DraftResolver.set("slide-1-__proto__", "evil", base);
        expect(blocked).toBe(base);
        expect(DraftResolver.get("slide-1-constructor", base)).toBe("");

        const shadowed = {
            ...base,
            image: "/live-slide1.jpg",
            slideAssets: { 1: { image: "/stale-slide1.jpg" } },
        };
        expect(getEffectiveSlideAsset(1, shadowed).image).toBe("/live-slide1.jpg");
    });

    it("VideoDraftResolver survives non-finite currentTime (P155)", () => {
        const draft = { ...createDefaultVideoDraft(), category: "MARKETS" };
        expect(VideoDraftResolver.get("video-category", draft, Number.NaN)).toBe("MARKETS");
    });

    it("isSafeMediaUrl enforces real HTTP hostnames and strict blob:https?:// URLs (P129/P156)", () => {
        expect(isSafeMediaUrl("https://cdn.example.com/a.mp4")).toBe(true);
        expect(isSafeMediaUrl("/api/video/ingest?id=1")).toBe(true);
        expect(isSafeMediaUrl("http://")).toBe(false);
        expect(isSafeMediaUrl("javascript:alert(1)")).toBe(false);
        expect(isSafeMediaUrl("//evil.com/x.png")).toBe(false);
        expect(isSafeMediaUrl("blob:https://studio.example.com/uuid-1", true)).toBe(true);
        expect(isSafeMediaUrl("blob:javascript:alert(1)", true)).toBe(false);
        expect(isSafeMediaUrl("blob:", true)).toBe(false);
    });

    it("keyframeTelemetry guards NaN times and wraps cleanly with findLast", () => {
        const kfs = [
            { id: "k1", time: 2, zoom: 110, posX: 50, easing: "smooth" as const },
            { id: "k2", time: 6, zoom: 130, posX: 40, easing: "snap" as const, pre: { time: 5, zoom: 110, posX: 50 } },
        ];
        expect(getKeyframeTelemetryTint(kfs, Number.NaN, "post", false).color).toBe("var(--ui-text-dim)");
        expect(resolveKeyframeJumpStop(kfs, 5.5, "prev")).toEqual({ time: 5, side: "pre" });
        expect(resolveKeyframeJumpStop(kfs, 5.5, "next")).toEqual({ time: 6, side: "post" });
        expect(resolveKeyframeJumpStop(kfs, Number.NaN, "next")).toEqual({ time: 2, side: "post" });
    });

    it("textUtils extracts multiline gold highlights and falls back cleanly on pure Urdu (P136)", () => {
        expect(getAnchorKeyword("PAKISTAN ==STATE BANK\nRATE CUT== ANNOUNCED")).toBe("state-bank-rate-cut");
        expect(getAnchorKeyword("پاکستان معیشت کی تازہ صورتحال")).toBe("news");
        expect(sanitize("  Hello — World!  ")).toBe("hello-world");
    });

    it("parseMoovBuffer swaps tkhd dimensions for ±90° portrait iPhone/Android rotation matrices (P143)", () => {
        const makeBox = (type: string, payload: Uint8Array) => {
            const out = new Uint8Array(8 + payload.length);
            new DataView(out.buffer).setUint32(0, out.length, false);
            for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
            out.set(payload, 8);
            return out;
        };
        const concat = (...arrs: Uint8Array[]) => {
            const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
            let off = 0;
            for (const a of arrs) { out.set(a, off); off += a.length; }
            return out;
        };
        // Version 0 tkhd (84 bytes): matrix at offset 40 (90° rotation: a=0, b=65536, c=-65536, d=0), width=1920 at 76, height=1080 at 80
        const tkhdPayload = new Uint8Array(84);
        const tv = new DataView(tkhdPayload.buffer);
        tv.setInt32(40, 0, false);
        tv.setInt32(44, 65536, false);
        tv.setInt32(52, -65536, false);
        tv.setInt32(56, 0, false);
        tv.setUint32(76, 1920 * 65536, false);
        tv.setUint32(80, 1080 * 65536, false);

        const hdlrPayload = new Uint8Array(16);
        "vide".split("").forEach((ch, i) => { hdlrPayload[8 + i] = ch.charCodeAt(0); });
        const mdia = makeBox("mdia", makeBox("hdlr", hdlrPayload));
        const trak = makeBox("trak", concat(makeBox("tkhd", tkhdPayload), mdia));
        const moov = makeBox("moov", trak);

        const parsed = parseMoovBuffer(moov.buffer);
        expect(parsed?.mediaInfo.width).toBe(1080);
        expect(parsed?.mediaInfo.height).toBe(1920);
    });
});
