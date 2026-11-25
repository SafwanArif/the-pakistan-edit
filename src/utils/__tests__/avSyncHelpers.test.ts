import { describe, expect, it } from "vitest";
import {
    POST_SEEK_AUDIT_WINDOW_MS,
    createPostSeekAudit,
    evaluatePostSeekAvSkew,
    getCanPlayTimeoutMs,
    resolvePlaybackSyncAction,
    shouldUseFastSeekDuringScrub,
} from "../../components/templates/VideoCard/avSyncHelpers";

describe("avSyncHelpers — single-coordinator playback sync & post-seek A/V guard", () => {
    it("resolves scrub release + resume into a single 'start-play' action (no competing double-seek)", () => {
        const action = resolvePlaybackSyncAction({
            isOutro: false,
            isScrubbing: false,
            isPlaying: true,
            wasPlaying: false,
            wasScrubbing: true,
            isExplicitSeek: true,
        });
        expect(action).toBe("start-play");
    });

    it("returns 'noop' during active Story playback when no explicit seek happened (prevents stale discrete-gated currentTime snapback)", () => {
        const action = resolvePlaybackSyncAction({
            isOutro: false,
            isScrubbing: false,
            isPlaying: true,
            wasPlaying: true,
            wasScrubbing: false,
            isExplicitSeek: false,
        });
        expect(action).toBe("noop");
    });

    it("returns 'explicit-play-seek' only when already playing and user triggers an explicit seek", () => {
        const action = resolvePlaybackSyncAction({
            isOutro: false,
            isScrubbing: false,
            isPlaying: true,
            wasPlaying: true,
            wasScrubbing: false,
            isExplicitSeek: true,
        });
        expect(action).toBe("explicit-play-seek");
    });

    it("prioritizes outro > scrub > pause-seek cleanly", () => {
        expect(resolvePlaybackSyncAction({
            isOutro: true,
            isScrubbing: true,
            isPlaying: true,
            wasPlaying: false,
            wasScrubbing: false,
            isExplicitSeek: true,
        })).toBe("outro");

        expect(resolvePlaybackSyncAction({
            isOutro: false,
            isScrubbing: true,
            isPlaying: false,
            wasPlaying: true,
            wasScrubbing: false,
            isExplicitSeek: false,
        })).toBe("scrub");

        expect(resolvePlaybackSyncAction({
            isOutro: false,
            isScrubbing: false,
            isPlaying: false,
            wasPlaying: false,
            wasScrubbing: true,
            isExplicitSeek: true,
        })).toBe("pause-seek");
    });

    it("uses 2500ms canplay priming headroom on mobile/blob and 350ms on desktop HTTP 206", () => {
        expect(getCanPlayTimeoutMs(true)).toBe(2500);
        expect(getCanPlayTimeoutMs(false)).toBe(350);
    });

    it("enables fastSeek during active scrub whenever supported by the browser", () => {
        expect(shouldUseFastSeekDuringScrub(true)).toBe(true);
        expect(shouldUseFastSeekDuringScrub(false)).toBe(false);
    });

    it("triggers at most one post-seek A/V recovery after 3 consecutive frames with >350ms skew", () => {
        const audit = createPostSeekAudit(1000);

        // Healthy frames do not trigger recovery
        expect(evaluatePostSeekAvSkew(audit, 1040, 37.05, 37.0).shouldRecover).toBe(false);
        expect(audit.consecutiveSkewFrames).toBe(0);

        // Two skewed frames followed by a healthy frame resets streak
        expect(evaluatePostSeekAvSkew(audit, 1080, 39.2, 37.0).shouldRecover).toBe(false);
        expect(evaluatePostSeekAvSkew(audit, 1120, 39.2, 37.0).shouldRecover).toBe(false);
        expect(evaluatePostSeekAvSkew(audit, 1160, 37.08, 37.0).shouldRecover).toBe(false);
        expect(audit.consecutiveSkewFrames).toBe(0);

        // Three consecutive skewed frames (>350ms) trigger exactly one recovery
        expect(evaluatePostSeekAvSkew(audit, 1200, 39.5, 37.0).shouldRecover).toBe(false);
        expect(evaluatePostSeekAvSkew(audit, 1240, 39.5, 37.0).shouldRecover).toBe(false);
        const third = evaluatePostSeekAvSkew(audit, 1280, 39.5, 37.0);
        expect(third.shouldRecover).toBe(true);
        expect(third.active).toBe(false);
        expect(audit.recovered).toBe(true);

        // Subsequent calls never trigger a second recovery loop
        expect(evaluatePostSeekAvSkew(audit, 1320, 40.5, 37.0).shouldRecover).toBe(false);
    });

    it("deactivates post-seek audit automatically after the 2200ms settle window", () => {
        const audit = createPostSeekAudit(1000);
        const res = evaluatePostSeekAvSkew(audit, 1000 + POST_SEEK_AUDIT_WINDOW_MS + 10, 40.0, 37.0);
        expect(res.active).toBe(false);
        expect(res.shouldRecover).toBe(false);
    });
});
