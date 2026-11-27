import { describe, expect, it } from "vitest";
import { createDefaultVideoDraft } from "@/types/news";
import {
    compute45FrameLayout,
    computeAmbientCropInto,
    computeEffectiveVolume,
    computeFullBleedLayout,
    computeKenBurnsMul,
    getInitialMediaAspect,
    resolveCaptionBottom,
    resolvePresetLayout,
    sanitizeAspect,
} from "@/components/templates/VideoCard/videoCardGeometry";

describe("videoCardGeometry — single-source framing & ambient crop parity", () => {
    const dims45 = { width: 1080, height: 1350 };
    const dims916 = { width: 1080, height: 1920 };

    it("sanitizes non-finite and non-positive aspect ratios to 16:9", () => {
        expect(sanitizeAspect(16 / 9)).toBeCloseTo(16 / 9, 6);
        expect(sanitizeAspect(0)).toBeCloseTo(16 / 9, 6);
        expect(sanitizeAspect(-1)).toBeCloseTo(16 / 9, 6);
        expect(sanitizeAspect(Number.NaN)).toBeCloseTo(16 / 9, 6);
        expect(sanitizeAspect(Number.POSITIVE_INFINITY)).toBeCloseTo(16 / 9, 6);
    });

    it("computes 4:5 Contain (0%), Fill (100%), and Punch (150%) identically in allocation & zero-alloc modes", () => {
        const contain = compute45FrameLayout(dims45, 16 / 9, { zoom: 0, posX: 50, posY: 100 });
        expect(contain.H_cont).toBeCloseTo(607.5, 4);
        expect(contain.containerH).toBeCloseTo(607.5, 4);
        expect(contain.effScale).toBeCloseTo(1.0, 5);
        expect(contain.topY).toBe(0);

        const fill = compute45FrameLayout(dims45, 16 / 9, { zoom: 100, posX: 50, posY: 50 });
        expect(fill.containerH).toBeCloseTo(1350, 4);
        expect(fill.effScale).toBeCloseTo(1350 / 607.5, 5);

        const out = { H_cont: 0, effScale: 0, containerH: 0, panX: 0, topY: 0, mediaY: 0, botInset: 0 };
        const punch = compute45FrameLayout(dims45, 16 / 9, { zoom: 150, posX: 25, posY: 50 }, 1.02, out);
        expect(punch).toBe(out);
        expect(punch.effScale).toBeCloseTo((1350 / 607.5) * 1.5 * 1.02, 5);
        expect(punch.panX).toBeGreaterThan(0);
    });

    it("applies identical Ken Burns scale for 4:5 photo scenes (eliminates P196 pause snap)", () => {
        const kb = computeKenBurnsMul(true, 5, 0, 10);
        expect(kb).toBeCloseTo(1.02, 6);
        expect(computeKenBurnsMul(false, 5, 0, 10)).toBe(1);
        expect(computeKenBurnsMul(true, Number.NaN, 0, 10)).toBe(1);

        const base = compute45FrameLayout(dims45, 16 / 9, { zoom: 0, posX: 50, posY: 100 }, 1);
        const zoomed = compute45FrameLayout(dims45, 16 / 9, { zoom: 0, posX: 50, posY: 100 }, kb);
        expect(zoomed.effScale).toBeCloseTo(base.effScale * 1.02, 6);
    });

    it("clamps ambient crop fractions strictly inside [0, 1]", () => {
        const crop = { xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 };
        computeAmbientCropInto(dims45, 607.5, 607.5, 1, 0, crop);
        expect(crop).toEqual({ xFrac: 0, wFrac: 1, yFrac: 0, hFrac: 1 });

        computeAmbientCropInto(dims45, 607.5, 900, 2.0, 500, crop);
        expect(crop.wFrac).toBeCloseTo(0.5, 5);
        expect(crop.xFrac).toBeGreaterThanOrEqual(0);
        expect(crop.xFrac + crop.wFrac).toBeLessThanOrEqual(1.000001);
        expect(crop.hFrac).toBeGreaterThan(0);
        expect(crop.hFrac).toBeLessThanOrEqual(1);
    });

    it("computes 9:16 full-bleed cover pan and preset/caption offsets cleanly", () => {
        const fb = computeFullBleedLayout(dims916, 16 / 9, { zoom: 100, posX: 0 }, 1);
        expect(fb.coverH).toBe(1920);
        expect(fb.coverW).toBeCloseTo(1920 * (16 / 9), 4);
        expect(fb.panX).toBeGreaterThan(0);

        expect(resolvePresetLayout(true, false, "bottom")).toEqual({ justify: "flex-end", top: "160px", bottom: "200px" });
        expect(resolvePresetLayout(false, true, "top")).toEqual({ justify: "flex-start", top: "390px", bottom: "140px" });
        expect(resolveCaptionBottom(true, false, "high")).toBe("255px");
        expect(resolveCaptionBottom(false, true, "bottom")).toBe("245px");
        expect(resolveCaptionBottom(false, false, "middle")).toBe("215px");
    });

    it("resolves initial post-rotation aspect from sourceMediaInfo and clamps effective volume (P208, P216)", () => {
        const draft = createDefaultVideoDraft();
        expect(getInitialMediaAspect(draft)).toBeCloseTo(16 / 9, 6);
        draft.sourceMediaInfo = { width: 1080, height: 1920, exactFps: 30, nominalFps: 30, isHdr: false };
        expect(getInitialMediaAspect(draft)).toBeCloseTo(9 / 16, 6);
        // Portrait 9:16 clip in 4:5 has topY === 0 so export & preview share identical top scrim visibility
        expect(compute45FrameLayout(dims45, getInitialMediaAspect(draft), { zoom: 0, posY: 50 }).topY).toBe(0);

        draft.volume = 0.6;
        expect(computeEffectiveVolume(draft, 5)).toBeCloseTo(0.6, 5);
        draft.volume = 2.5;
        expect(computeEffectiveVolume(draft, 5)).toBe(1);
    });
});
