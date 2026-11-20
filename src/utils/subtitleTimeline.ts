import type { VideoDraft, SubtitleSegment } from "../types/news";
import { getSceneBoundaries, getTimelineStructure } from "./videoTimeline";

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
 * with a `2ms` tolerance to absorb IEEE-754 float drift across preview and FFmpeg export.
 */
export const findSubtitleAtMediaTime = (
    subtitles: readonly SubtitleSegment[] | undefined,
    mediaTime: number
): SubtitleSegment | undefined => {
    if (!subtitles?.length) return undefined;
    const t = mediaTime + 0.002;
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

/**
 * Returns sorted timeline timestamps (in seconds) for all subtitle cues visible on-screen,
 * respecting Hook/Re-Hook/Story offsets and per-card `showSubtitles` overrides.
 */
export const getActiveSubtitleTimelineTimes = (draft: VideoDraft): number[] => {
    const subs = draft.subtitles || [];
    if (!subs.length) return [];
    const scenes = draft.scenes || [];
    const globalCcOn = draft.showSubtitles !== false;
    if (!scenes.length) {
        return globalCcOn ? subs.map((s) => s.start).sort((a, b) => a - b) : [];
    }

    const boundaries = getSceneBoundaries(scenes);
    const { hasReHook, storyIdx, hookDur, rehookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;
    const isSceneCcOn = (idx: number) => scenes[idx]?.showSubtitles ?? globalCcOn;
    const times: number[] = [];

    if (!hasCustomJump) {
        for (const seg of subs) {
            const b = boundaries.find((bound) => seg.start >= bound.start && seg.start < bound.end);
            if (b && isSceneCcOn(b.idx)) {
                times.push(seg.start);
            } else if (seg.start < preStoryDur && seg.end > preStoryDur && isSceneCcOn(storyIdx)) {
                times.push(preStoryDur);
            }
        }
        return Array.from(new Set(times)).sort((a, b) => a - b);
    }

    if (isSceneCcOn(0)) {
        for (const seg of subs) {
            if (seg.start < hookOffset && seg.end > hookOffset) {
                times.push(0);
            } else if (seg.start >= hookOffset && seg.start < hookOffset + hookDur) {
                times.push(Math.round((seg.start - hookOffset) * 1000) / 1000);
            }
        }
    }

    if (hasReHook && isSceneCcOn(1)) {
        for (const seg of subs) {
            if (seg.start < rehookOffset && seg.end > rehookOffset) {
                times.push(hookDur);
            } else if (seg.start >= rehookOffset && seg.start < rehookOffset + rehookDur) {
                times.push(Math.round((hookDur + (seg.start - rehookOffset)) * 1000) / 1000);
            }
        }
    }

    for (const seg of subs) {
        if (seg.start < storyOffset && seg.end > storyOffset) {
            if (isSceneCcOn(storyIdx)) times.push(preStoryDur);
            continue;
        }
        if (seg.start < storyOffset) continue;
        const t = Math.round((preStoryDur + (seg.start - storyOffset)) * 1000) / 1000;
        const b = boundaries.find((bound) => bound.idx >= storyIdx && t >= bound.start && t < bound.end);
        if (b && isSceneCcOn(b.idx)) times.push(t);
    }

    return Array.from(new Set(times)).sort((a, b) => a - b);
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

export const downloadSrtFile = (draft: VideoDraft): void => {
    if (!draft.subtitles?.length) return;
    const blob = new Blob([buildSrtContent(draft.subtitles)], { type: 'text/plain;charset=utf-8' });
    downloadBlob(blob, `${(draft.videoName || 'the-pakistan-edit').replace(/\.[^.]+$/, '')}.srt`);
};
