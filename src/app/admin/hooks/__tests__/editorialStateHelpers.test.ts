import { describe, expect, it } from "vitest";
import { fingerprintImage, sanitizeHydratedDraft } from "../useEditorialState";

describe("useEditorialState pure helpers", () => {
    it("distinguishes distinct UUID blob URLs on production domains while bounding huge Base64 strings (P99)", () => {
        const blobA = "blob:https://studio.thepakistanedit.com/11111111-1111-1111-1111-111111111111";
        const blobB = "blob:https://studio.thepakistanedit.com/22222222-2222-2222-2222-222222222222";
        expect(fingerprintImage(blobA)).not.toBe(fingerprintImage(blobB));

        const hugeA = `data:image/png;base64,${"A".repeat(2000)}END1`;
        const hugeB = `data:image/png;base64,${"A".repeat(2000)}END2`;
        expect(fingerprintImage(hugeA).length).toBeLessThan(100);
        expect(fingerprintImage(hugeA)).not.toBe(fingerprintImage(hugeB));
    });

    it("sanitizes expired blob URLs, null slideAssets entries, and corrupt extraSlides on hydration (P96/P119)", () => {
        const sanitized = sanitizeHydratedDraft({
            headline: "KARACHI PORT EXPANSION",
            image: "blob:http://localhost:3000/expired-id",
            imageWidth: 1080,
            imageHeight: 1350,
            extraSlides: "corrupt" as unknown as [],
            slideAssets: {
                2: null as unknown as { image: string },
                3: { image: "blob:http://localhost:3000/expired-slide3", imageWidth: 800, imageHeight: 600 },
                4: { image: "/api/proxy/asset?url=https://example.com/ok.jpg", imageWidth: 1200, imageHeight: 800 },
            },
        });

        expect(sanitized.headline).toBe("KARACHI PORT EXPANSION");
        expect(sanitized.image).toBe("");
        expect(sanitized.imageWidth).toBe(0);
        expect(sanitized.extraSlides).toEqual([]);
        expect(sanitized.slideAssets?.[2]).toBeUndefined();
        expect(sanitized.slideAssets?.[3]?.image).toBe("");
        expect(sanitized.slideAssets?.[4]?.image).toBe("/api/proxy/asset?url=https://example.com/ok.jpg");
    });
});
