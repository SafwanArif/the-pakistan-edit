import type { VideoDraft, SubtitleSegment, TimelineScene } from "../types/news";
import { finiteOr, getSceneBoundaries, getTimelineStructure } from "./sceneTimeline";
import { timelineTimeToMediaTime, wrapMediaTime } from "./videoTimeline";

/** Triggers a browser file download for a Blob and revokes the temporary object URL after 10s. */
export const downloadBlob = (blob: Blob, filename: string): void => {
    if (typeof document === "undefined" || typeof URL === "undefined") return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
};

const sortedSubtitleCache = new WeakMap<readonly SubtitleSegment[], boolean>();

const isSubtitleArraySorted = (subtitles: readonly SubtitleSegment[]): boolean => {
    const cached = sortedSubtitleCache.get(subtitles);
    if (cached !== undefined) return cached;
    let sorted = true;
    for (let i = 0; i < subtitles.length; i++) {
        const cur = subtitles[i]!.start;
        if (!Number.isFinite(cur) || (i > 0 && cur < subtitles[i - 1]!.start)) { sorted = false; break; }
    }
    sortedSubtitleCache.set(subtitles, sorted);
    return sorted;
};

const cleanCueText = (text: unknown): string => (typeof text === "string" ? text.trim() : "");

/** Finds the active subtitle cue at `mediaTime` using `[start, end)` with 2ms tolerance (O(log N) when sorted). */
export const findSubtitleAtMediaTime = (subtitles: readonly SubtitleSegment[] | undefined, mediaTime: number): SubtitleSegment | undefined => {
    if (!subtitles?.length || !Number.isFinite(mediaTime)) return undefined;
    const t = mediaTime + 0.002;
    if (subtitles.length > 8 && isSubtitleArraySorted(subtitles)) {
        let lo = 0, hi = subtitles.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (subtitles[mid]!.start <= t) lo = mid; else hi = mid - 1; }
        const cand = subtitles[lo]!;
        if (t >= cand.start && t < cand.end) return cand;
        const prev = lo > 0 ? subtitles[lo - 1]! : undefined;
        return prev && t >= prev.start && t < prev.end ? prev : undefined;
    }
    for (let i = 0; i < subtitles.length; i++) {
        const seg = subtitles[i]!;
        if (t >= seg.start && t < seg.end) return seg;
    }
    return undefined;
};

/** Maps a source-media subtitle start timestamp to its timeline seek position. */
export const getMediaSubtitleTimelineTime = (draft: VideoDraft, mediaStart: number): number => {
    const safeStart = Math.max(0, finiteOr(mediaStart, 0));
    const { hasReHook, hookDur, rehookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (!(hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook)) return safeStart;
    if (safeStart >= hookOffset && safeStart < hookOffset + hookDur) return safeStart - hookOffset;
    if (hasReHook && safeStart >= rehookOffset && safeStart < rehookOffset + rehookDur) return hookDur + (safeStart - rehookOffset);
    return preStoryDur + Math.max(0, safeStart - storyOffset);
};

const roundMs = (sec: number): number => Math.round(sec * 1000) / 1000;
const MAX_WRAP_SLICES = 256;

/** Single canonical timeline subtitle projector shared by FFmpeg `.ASS` burn-in, `.SRT` export, and studio jumps. */
export const projectSubtitlesToTimeline = (
    draft: VideoDraft,
    options?: { scenes?: TimelineScene[]; bounds?: { start: number; end: number }[]; masterDuration?: number; minCueDuration?: number }
): SubtitleSegment[] => {
    const rawSubs = draft.subtitles || [];
    if (!rawSubs.length) return [];
    const subs = isSubtitleArraySorted(rawSubs)
        ? rawSubs
        : [...rawSubs].filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end)).sort((a, b) => a.start - b.start);

    const scenes = options?.scenes ?? draft.scenes ?? [];
    const globalCcOn = draft.showSubtitles !== false;
    if (!scenes.length) {
        return globalCcOn
            ? subs
                .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start && cleanCueText(s.text).length > 0)
                .map((s) => ({ ...s, text: cleanCueText(s.text) }))
            : [];
    }

    const effectiveDraft = options?.scenes ? { ...draft, scenes } : draft;
    const bounds = options?.bounds ?? getSceneBoundaries(scenes);
    const rawMaster = options?.masterDuration ?? (draft.videoDuration || 0);
    const masterDuration = Number.isFinite(rawMaster) && rawMaster > 0 ? rawMaster : 0;
    const minCueDuration = options?.minCueDuration ?? 0;
    const { preStoryDur, storyOffset } = getTimelineStructure(scenes);
    const projected: SubtitleSegment[] = [];

    for (let i = 0; i < scenes.length; i++) {
        const sc = scenes[i]!, b = bounds[i];
        if (!b || !Number.isFinite(b.start) || !Number.isFinite(b.end)) continue;
        const dur = b.end - b.start;
        if (!Number.isFinite(dur) || dur <= 0 || !(sc.showSubtitles ?? globalCcOn)) continue;

        const hasCustomMedia = Boolean(sc.mediaUrl) || sc.mediaType === "image";
        const slices: { timelineStart: number; mediaStart: number; mediaEnd: number }[] = [];

        if (hasCustomMedia || masterDuration <= 0) {
            const mediaStart = hasCustomMedia
                ? Math.max(0, finiteOr(sc.clipStartOffset, 0))
                : timelineTimeToMediaTime(effectiveDraft, b.start);
            slices.push({ timelineStart: b.start, mediaStart, mediaEnd: mediaStart + dur });
        } else {
            const loopStart = b.start >= preStoryDur && storyOffset > 0 && storyOffset < masterDuration - 0.5 ? storyOffset : 0;
            let cursorTimeline = b.start, remaining = dur, curMedia = wrapMediaTime(effectiveDraft, b.start, masterDuration), guard = 0;
            while (remaining > 0.0005 && ++guard <= MAX_WRAP_SLICES) {
                const take = Math.min(remaining, Math.max(0.001, masterDuration - curMedia));
                slices.push({ timelineStart: cursorTimeline, mediaStart: curMedia, mediaEnd: curMedia + take });
                cursorTimeline += take;
                remaining -= take;
                curMedia = loopStart;
            }
        }

        for (const slice of slices) {
            for (let sIdx = 0; sIdx < subs.length; sIdx++) {
                const seg = subs[sIdx]!;
                if (!Number.isFinite(seg.start) || !Number.isFinite(seg.end) || seg.end <= slice.mediaStart || seg.start >= slice.mediaEnd) continue;
                const cleanText = cleanCueText(seg.text);
                if (!cleanText) continue;
                const tStart = roundMs(slice.timelineStart + (Math.max(seg.start, slice.mediaStart) - slice.mediaStart));
                const tEnd = roundMs(slice.timelineStart + (Math.min(seg.end, slice.mediaEnd) - slice.mediaStart));
                if (tEnd - tStart < minCueDuration || tEnd <= tStart) continue;

                const prev = projected[projected.length - 1];
                if (prev && prev.text === cleanText && Math.abs(tStart - prev.end) <= 0.01) prev.end = tEnd;
                else projected.push({ id: seg.id, start: tStart, end: tEnd, text: cleanText });
            }
        }
    }
    return projected;
};

/** Returns sorted timeline timestamps (in seconds) for all subtitle cues visible on-screen. */
export const getActiveSubtitleTimelineTimes = (draft: VideoDraft): number[] => {
    const projected = projectSubtitlesToTimeline(draft);
    return projected.length ? Array.from(new Set(projected.map((c) => c.start))).sort((a, b) => a - b) : [];
};

const toSrtTime = (sec: number): string => {
    const msTotal = Math.max(0, Math.round(finiteOr(sec, 0) * 1000));
    const h = Math.floor(msTotal / 3600000);
    const m = Math.floor((msTotal % 3600000) / 60000);
    const s = Math.floor((msTotal % 60000) / 1000);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(msTotal % 1000).padStart(3, "0")}`;
};

export const buildSrtContent = (segments: SubtitleSegment[]): string =>
    segments
        .filter((seg) => Number.isFinite(seg.start) && Number.isFinite(seg.end) && seg.end > seg.start && cleanCueText(seg.text).length > 0)
        .map((seg, i) => `${i + 1}\n${toSrtTime(seg.start)} --> ${toSrtTime(seg.end)}\n${cleanCueText(seg.text)}\n`)
        .join("\n");

/** Builds timeline-aligned `.SRT` subtitles matching Hook/Re-Hook/Story cuts and per-scene CC toggles. */
export const buildTimelineSrtContent = (draft: VideoDraft): string => {
    const projected = projectSubtitlesToTimeline(draft.showSubtitles === false ? { ...draft, showSubtitles: true } : draft, { minCueDuration: 0.05 });
    return buildSrtContent(projected.length ? projected : (draft.subtitles || []));
};

export const downloadSrtFile = (draft: VideoDraft): void => {
    if (!draft.subtitles?.length) return;
    const baseName = (draft.videoName || "the-pakistan-edit").replace(/\.[^.]+$/, "").trim() || "the-pakistan-edit";
    downloadBlob(new Blob([buildTimelineSrtContent(draft)], { type: "text/plain;charset=utf-8" }), `${baseName}.srt`);
};
