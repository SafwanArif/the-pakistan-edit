import { describe, expect, it } from "vitest";
import { resolvePhysicalShortcutKey, resolveStudioShortcutSeek } from "../useStudioShortcuts";

describe("useStudioShortcuts pure resolvers", () => {
    const baseCtx = {
        sceneStarts: [0, 4, 18],
        outroStart: 30,
        enableOutro: true,
        activeDisplayTime: 10,
        duration: 35,
    };

    it("maps physical Digit/Numpad codes for Urdu layouts when Shift is not held and respects NumLock OFF", () => {
        expect(resolvePhysicalShortcutKey("۱", "Digit1", false)).toBe("1");
        expect(resolvePhysicalShortcutKey("۰", "Digit0", false)).toBe("0");
        expect(resolvePhysicalShortcutKey("۳", "Numpad3", false)).toBe("3");
        expect(resolvePhysicalShortcutKey("ArrowLeft", "Numpad4", false)).toBe("ArrowLeft");
        expect(resolvePhysicalShortcutKey("!", "Digit1", true)).toBe("!");
    });

    it("resolves scene jumps and outro jump cleanly without firing on Shift+Digit", () => {
        expect(resolveStudioShortcutSeek("1", false, baseCtx)).toBe(0);
        expect(resolveStudioShortcutSeek("2", false, baseCtx)).toBe(4);
        expect(resolveStudioShortcutSeek("4", false, baseCtx)).toBe(30);
        expect(resolveStudioShortcutSeek("0", false, baseCtx)).toBe(30);
        expect(resolveStudioShortcutSeek("1", true, baseCtx)).toBeNull();
        expect(resolveStudioShortcutSeek("0", true, baseCtx)).toBeNull();
    });

    it("clamps arrow seeks safely and survives non-finite inputs", () => {
        expect(resolveStudioShortcutSeek("ArrowRight", false, baseCtx)).toBe(11);
        expect(resolveStudioShortcutSeek("ArrowLeft", true, baseCtx)).toBe(5);
        expect(resolveStudioShortcutSeek("ArrowRight", false, { ...baseCtx, activeDisplayTime: Number.NaN, duration: 20 })).toBe(1);
        expect(resolveStudioShortcutSeek("ArrowLeft", false, { ...baseCtx, activeDisplayTime: 0, duration: Number.NaN })).toBe(0);
    });
});
