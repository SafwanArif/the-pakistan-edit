import type { VideoDraft, SubtitleSegment, TimelineScene } from "../types/news";
import { getSceneBoundaries, getTimelineStructure, timelineTimeToMediaTime, wrapMediaTime } from "./videoTimeline";

/** Triggers a browser file download for a Blob and revokes the temporary object URL after 10s. */
export const downloadBlob = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

/**
 * Finds the active subtitle cue at `mediaTime` using a half-open `[start, end)` boundary
 * with a `2ms` tolerance. Uses O(log N) binary search for sorted transcripts with safe linear fallback.
 */
export const findSubtitleAtMediaTime = (
    subtitles: readonly SubtitleSegment[] | undefined,
    mediaTime: number
): SubtitleSegment | undefined => {
    if (!subtitles?.length) return undefined;
    const t = mediaTime + 0.002;
    if (subtitles.length > 8) {
        let lo = 0;
        let hi = subtitles.length - 1;
        while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (subtitles[mid]!.start <= t) lo = mid;
            else hi = mid - 1;
        }
        const cand = subtitles[lo]!;
        if (t >= cand.start && t < cand.end) return cand;
        if (lo > 0) {
            const prev = subtitles[lo - 1]!;
            if (prev.start <= cand.start) {
                return t >= prev.start && t < prev.end ? prev : undefined;
            }
            // Out-of-order segments detected — fall through to linear scan
        } else if (subtitles[0]!.start <= subtitles[subtitles.length - 1]!.start) {
            return undefined;
        }
    }
    for (let i = 0; i < subtitles.length; i++) {
        const seg = subtitles[i]!;
        if (t >= seg.start && t < seg.end) return seg;
    }
    return undefined;
};

/** Maps a source-media subtitle start timestamp to its timeline seek position. */
export const getMediaSubtitleTimelineTime = (draft: VideoDraft, mediaStart: number): number => {
    const { hasReHook, hookDur, rehookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;
    if (!hasCustomJump) return mediaStart;
    if (mediaStart >= hookOffset && mediaStart < hookOffset + hookDur) {
        return mediaStart - hookOffset;
    }
    if (hasReHook && mediaStart >= rehookOffset && mediaStart < rehookOffset + rehookDur) {
        return hookDur + (mediaStart - rehookOffset);
    }
    return preStoryDur + Math.max(0, mediaStart - storyOffset);
};

const roundMs = (sec: number): number => Math.round(sec * 1000) / 1000;

/**
 * Single canonical timeline subtitle projector shared by FFmpeg `.ASS` burn-in, `.SRT` export,
 * and studio subtitle jump navigation. Maps source-media Whisper cues onto exact scene timeline
 * windows, honouring Hook/Re-Hook/Story `clipStartOffset`, loop wrap-around, and per-scene `showSubtitles`.
 */
export const projectSubtitlesToTimeline = (
    draft: VideoDraft,
    options?: {
        scenes?: TimelineScene[];
        bounds?: { start: number; end: number }[];
        masterDuration?: number;
        minCueDuration?: number;
    }
): SubtitleSegment[] => {
    const subs = draft.subtitles || [];
    if (!subs.length) return [];
    const scenes = options?.scenes ?? draft.scenes ?? [];
    const globalCcOn = draft.showSubtitles !== false;
    if (!scenes.length) {
        return globalCcOn
            ? subs
                .filter((s) => s.text.trim().length > 0 && s.end > s.start)
                .map((s) => ({ ...s, text: s.text.trim() }))
                .sort((a, b) => a.start - b.start)
            : [];
    }

    const bounds = options?.bounds ?? getSceneBoundaries(scenes);
    const masterDuration = options?.masterDuration ?? (draft.videoDuration || 0);
    const minCueDuration = options?.minCueDuration ?? 0;
    const { preStoryDur, storyOffset } = getTimelineStructure(scenes);
    const projected: SubtitleSegment[] = [];

    for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i]!;
        const b = bounds[i];
        if (!b || b.end <= b.start) continue;
        const captionsOn = sc.showSubtitles ?? globalCcOn;
        if (!captionsOn) continue;

        const dur = b.end - b.start;
        const hasCustomMedia = Boolean(sc.mediaUrl) || sc.mediaType === "image";
        const slices: { timelineStart: number; mediaStart: number; mediaEnd: number }[] = [];

        if (hasCustomMedia || masterDuration <= 0) {
            const mediaStart = hasCustomMedia
                ? (sc.clipStartOffset ?? 0)
                : timelineTimeToMediaTime(draft, b.start);
            slices.push({ timelineStart: b.start, mediaStart, mediaEnd: mediaStart + dur });
        } else {
            const loopStart = b.start >= preStoryDur && storyOffset > 0 && storyOffset < masterDuration - 0.5
                ? storyOffset
                : 0;
            let cursorTimeline = b.start;
            let remaining = dur;
            let curMedia = wrapMediaTime(draft, b.start, masterDuration);
            while (remaining > 0.0005) {
                const avail = Math.max(0.001, masterDuration - curMedia);
                const take = Math.min(remaining, avail);
                slices.push({ timelineStart: cursorTimeline, mediaStart: curMedia, mediaEnd: curMedia + take });
                cursorTimeline += take;
                remaining -= take;
                curMedia = loopStart;
            }
        }

        for (const slice of slices) {
            for (let sIdx = 0; sIdx < subs.length; sIdx++) {
                const seg = subs[sIdx]!;
                if (seg.end <= slice.mediaStart || seg.start >= slice.mediaEnd) continue;
                const cleanText = seg.text.trim();
                if (!cleanText) continue;
                const clipStart = Math.max(seg.start, slice.mediaStart);
                const clipEnd = Math.min(seg.end, slice.mediaEnd);
                const tStart = roundMs(slice.timelineStart + (clipStart - slice.mediaStart));
                const tEnd = roundMs(slice.timelineStart + (clipEnd - slice.mediaStart));
                if (tEnd - tStart < minCueDuration || tEnd <= tStart) continue;

                const prev = projected[projected.length - 1];
                if (prev && prev.text === cleanText && Math.abs(tStart - prev.end) <= 0.01) {
                    prev.end = tEnd;
                } else {
                    projected.push({ id: seg.id, start: tStart, end: tEnd, text: cleanText });
                }
            }
        }
    }

    return projected;
};

/**
 * Returns sorted timeline timestamps (in seconds) for all subtitle cues visible on-screen,
 * respecting Hook/Re-Hook/Story offsets and per-card `showSubtitles` overrides.
 */
export const getActiveSubtitleTimelineTimes = (draft: VideoDraft): number[] => {
    const projected = projectSubtitlesToTimeline(draft, { masterDuration: 0 });
    if (!projected.length) return [];
    return Array.from(new Set(projected.map((c) => c.start))).sort((a, b) => a - b);
};

const toSrtTime = (sec: number): string => {
    const msTotal = Math.max(0, Math.round(sec * 1000));
    const h = Math.floor(msTotal / 3600000);
    const m = Math.floor((msTotal % 3600000) / 60000);
    const s = Math.floor((msTotal % 60000) / 1000);
    const ms = msTotal % 1000;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
};

export const buildSrtContent = (segments: SubtitleSegment[]): string =>
    segments.map((seg, i) => `${i + 1}\n${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n${seg.text.trim()}\n`).join('\n');

/** Builds timeline-aligned `.SRT` subtitles matching the exact Hook/Re-Hook/Story cuts and per-scene CC toggles. */
export const buildTimelineSrtContent = (draft: VideoDraft): string => {
    const projected = projectSubtitlesToTimeline(draft, { minCueDuration: 0.05 });
    return buildSrtContent(projected.length ? projected : (draft.subtitles || []));
};

export const downloadSrtFile = (draft: VideoDraft): void => {
    if (!draft.subtitles?.length) return;
    const blob = new Blob([buildTimelineSrtContent(draft)], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${(draft.videoName || 'the-pakistan-edit').replace(/\.[^.]+$/, '')}.srt`);
};
