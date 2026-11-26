import { describe, expect, it } from "vitest";
import {
    computeVideoToAudioClockAdjustment,
    createInitialAvSyncDiag,
    getCanPlayTimeoutMs,
    resolvePlaybackSyncAction,
    resolveScrubSeekTarget,
} from "../../components/templates/VideoCard/avSyncHelpers";

describe("avSyncHelpers — single-coordinator playback sync & audio-master follower lock", () => {
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

    it("computes muted-video PLL adjustments under 500ms and fast audio re-lock above 500ms", () => {
        expect(computeVideoToAudioClockAdjustment(37.04, 37.0)).toMatchObject({ mode: "hold", videoPlaybackRate: 1 });

        const videoBehind = computeVideoToAudioClockAdjustment(36.7, 37.0);
        expect(videoBehind.mode).toBe("pull");
        expect(videoBehind.videoPlaybackRate).toBeGreaterThan(1);

        const videoAhead = computeVideoToAudioClockAdjustment(37.3, 37.0);
        expect(videoAhead.mode).toBe("pull");
        expect(videoAhead.videoPlaybackRate).toBeLessThan(1);

        const severe = computeVideoToAudioClockAdjustment(35.0, 37.0);
        expect(severe.mode).toBe("snap-audio");
        expect(severe.targetAudioTime).toBe(35.0);
    });

    it("snaps active scrub targets onto real parsed keyframes when keyframe-snap mode is active", () => {
        const kfs = [0, 5, 10, 15, 20];
        expect(resolveScrubSeekTarget(12.2, kfs, true)).toBe(10);
        expect(resolveScrubSeekTarget(13.1, kfs, true)).toBe(15);
        expect(resolveScrubSeekTarget(12.2, kfs, false)).toBe(12.2);
    });

    it("initializes lean live diagnostics snapshot without legacy single-channel recovery fields", () => {
        expect(createInitialAvSyncDiag()).toEqual({
            profile: "standard",
            companionAudioActive: false,
            companionAudioFallback: false,
            lastAudioDriftMs: 0,
            lastSeekTargetSec: 0,
            lastSeekDurationMs: 0,
            readyStateAtPlay: 0,
            lastError: null,
        });
    });
});
