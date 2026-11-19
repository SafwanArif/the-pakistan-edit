import type { VideoDraft, VideoKeyframe, TimelineScene } from "../types/news";

/** Clamps a numeric value inclusively to `[min, max]`. */
export const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);

/** Parses `MM:SS.d` or raw seconds string into a non-negative number of seconds. */
export const parseTimeInput = (raw: string): number | null => {
    const clean = raw.trim();
    if (!clean) return null;
    if (clean.includes(':')) {
        const [mStr, sStr] = clean.split(':');
        const m = Number(mStr);
        const s = Number(sStr);
        return Number.isFinite(m) && Number.isFinite(s) ? Math.max(0, m * 60 + s) : null;
    }
    const val = Number(clean);
    return Number.isFinite(val) ? Math.max(0, val) : null;
};

export const createDefaultTimelineScenes = (): TimelineScene[] => [
    { id: "scene-1", title: "==THE STATE BANK== ANNOUNCES NEW DIGITAL POLICY", subtitle: "Key decisions ratified by the executive council today in Islamabad.", duration: 4, mediaType: 'video', fadeOut: true },
    { id: "rehook-1", title: "WAIT — HERE IS ==THE REAL SHIFT==", subtitle: "The overlooked turning point right before the full picture emerged.", duration: 4, mediaType: 'video', fadeIn: true, shareHookText: true },
    { id: "scene-2", title: "THE STORY: FULL REPORT", subtitle: "The chronological context and underlying drivers behind this development.", duration: 52, mediaType: 'video', fadeIn: true }
];

/** Returns unified structural indices, durations, and source offsets for Hook, Re-Hook, and Story. */
export const getTimelineStructure = (scenes: TimelineScene[] = []) => {
    const hasReHook = Boolean(scenes[1]?.id.startsWith('rehook-'));
    const storyIdx = hasReHook ? Math.min(2, Math.max(0, scenes.length - 1)) : Math.min(1, Math.max(0, scenes.length - 1));
    const hookDur = scenes[0]?.duration || 4;
    const rehookDur = hasReHook ? (scenes[1]?.duration || 4) : 0;
    const preStoryDur = hookDur + rehookDur;
    const hookOffset = scenes[0]?.clipStartOffset ?? 0;
    const rehookOffset = hasReHook ? (scenes[1]?.clipStartOffset ?? 0) : 0;
    const storyOffset = scenes[storyIdx]?.clipStartOffset ?? 0;
    return { hasReHook, storyIdx, hookDur, rehookDur, preStoryDur, hookOffset, rehookOffset, storyOffset };
};

/** Returns true when `scene` is a Re-Hook anchored to share 01. The Hook's headline/subheading. */
export const isSharedReHookScene = (scenes: TimelineScene[] | undefined, idx: number): boolean => {
    const s = scenes?.[idx];
    return Boolean(s?.id.startsWith('rehook-') && s.shareHookText !== false && scenes?.[0]);
};

/** Returns canonical editorial label (`01. HOOK`, `02. RE-HOOK`, `03. STORY`, `NN. ANGLE`) for a scene index. */
export const getSceneRoleLabel = (scenes: TimelineScene[] = [], idx: number): string => {
    const pad = String(idx + 1).padStart(2, '0');
    if (idx === 0) return '01. HOOK';
    const { hasReHook, storyIdx } = getTimelineStructure(scenes);
    if (hasReHook && idx === 1) return '02. RE-HOOK';
    if (idx === storyIdx) return `${pad}. STORY`;
    return `${pad}. ANGLE`;
};

export const getTotalVideoDuration = (draft: VideoDraft): number => {
    const scenesDuration = (draft.scenes || []).reduce((acc, s) => acc + (s.duration || 0), 0);
    const outro = draft.enableOutro ? (draft.outroDuration || 5) : 0;
    return scenesDuration + outro;
};

/** Guarantees every scene in a timeline has a unique ID (heals legacy persisted drafts). */
export const ensureUniqueSceneIds = (scenes: TimelineScene[]): TimelineScene[] => {
    const usedIds = new Set<string>();
    return scenes.map((s, idx) => {
        let id = s.id && !usedIds.has(s.id) ? s.id : `scene-${idx + 1}`;
        while (usedIds.has(id)) id = `scene-${idx + 1}-${usedIds.size}`;
        usedIds.add(id);
        return id === s.id ? s : { ...s, id };
    });
};

/** Preserves 01. Hook and 02. Re-Hook and adapts 03. The Story to the imported clip duration. */
export const calculatePsychologyPacedScenes = (
    totalClipDuration: number,
    existingScenes?: TimelineScene[]
): TimelineScene[] => {
    const base = ensureUniqueSceneIds(existingScenes?.length ? [...existingScenes] : createDefaultTimelineScenes());
    const hasReHook = Boolean(base[1]?.id.startsWith('rehook-'));
    const storyIdx = hasReHook ? Math.min(2, base.length - 1) : Math.min(1, base.length - 1);
    const story = base[storyIdx]!;
    const storyDur = Math.max(4, Math.round((totalClipDuration - (story.clipStartOffset || 0)) * 10) / 10);
    base[storyIdx] = { ...story, duration: storyDur };
    return base;
};

export const autoPadToMonetisationThreshold = (draft: VideoDraft, targetSeconds: number = 61.5): VideoDraft => {
    const scenes = draft.scenes?.length ? [...draft.scenes] : createDefaultTimelineScenes();
    const storyIdx = scenes[1]?.id.startsWith('rehook-') ? Math.min(2, scenes.length - 1) : Math.min(1, scenes.length - 1);
    const outroTime = draft.enableOutro ? (draft.outroDuration || 5) : 0;
    const otherScenesTime = scenes.reduce((sum, s, i) => (i === storyIdx ? sum : sum + (s.duration || 0)), 0);
    const neededStoryDur = Math.max(4, Math.round((targetSeconds - outroTime - otherScenesTime) * 10) / 10);
    scenes[storyIdx] = {
        ...scenes[storyIdx]!,
        duration: Math.max(scenes[storyIdx]!.duration || 0, neededStoryDur),
    };
    return { ...draft, scenes };
};

/**
 * Smoothly interpolates Zoom and Pan X across time-based keyframes.
 * Uses smooth cosine easing for organic camera gliding without abrupt cuts.
 */
export const interpolateKeyframe = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): { zoom: number; posX: number; posY: number } => {
    const fbY = fallback?.posY ?? 100;
    const defaultFraming = {
        zoom: fallback?.zoom ?? 100,
        posX: fallback?.posX ?? 50,
        posY: fbY,
    };

    if (!keyframes || keyframes.length === 0) return defaultFraming;

    let alreadySorted = true;
    for (let i = 1; i < keyframes.length; i++) {
        if (keyframes[i]!.time < keyframes[i - 1]!.time) {
            alreadySorted = false;
            break;
        }
    }
    const sorted = alreadySorted ? keyframes : [...keyframes].sort((a, b) => a.time - b.time);

    const last = sorted[sorted.length - 1]!;
    if (currentTime >= last.time) {
        return { zoom: last.zoom, posX: last.posX, posY: last.posY ?? fbY };
    }

    let prev: VideoKeyframe = { id: '__base__', time: 0, ...defaultFraming };
    let next = sorted[0]!;
    if (currentTime < sorted[0]!.time) {
        const first = sorted[0]!;
        if (first.easing === 'snap' && first.pre) {
            return { zoom: first.pre.zoom, posX: first.pre.posX, posY: first.pre.posY ?? fbY };
        }
        if (first.time <= 0) {
            return { zoom: first.zoom, posX: first.posX, posY: first.posY ?? fbY };
        }
    } else {
        for (let i = 0; i < sorted.length - 1; i++) {
            if (currentTime >= sorted[i]!.time && currentTime < sorted[i + 1]!.time) {
                prev = sorted[i]!;
                next = sorted[i + 1]!;
                break;
            }
        }
    }

    const prevY = prev.posY ?? fbY;
    const span = next.time - prev.time;
    if (span <= 0) return { zoom: prev.zoom, posX: prev.posX, posY: prevY };
    if (currentTime >= next.time) {
        return { zoom: next.zoom, posX: next.posX, posY: next.posY ?? fbY };
    }
    if (next.easing === 'snap' && !next.pre) {
        return { zoom: prev.zoom, posX: prev.posX, posY: prevY };
    }
    const preTarget = next.easing === 'snap' ? next.pre : undefined;
    if (preTarget) {
        const preTime = preTarget.time !== undefined
            ? Math.min(next.time, Math.max(prev.time, preTarget.time))
            : next.time;
        const preY = preTarget.posY ?? fbY;
        if (currentTime >= preTime) {
            return { zoom: preTarget.zoom, posX: preTarget.posX, posY: preY };
        }
        const preSpan = preTime - prev.time;
        if (preSpan <= 0) return { zoom: preTarget.zoom, posX: preTarget.posX, posY: preY };
        const preT = (currentTime - prev.time) / preSpan;
        const smoothPreT = (1 - Math.cos(preT * Math.PI)) / 2;
        return {
            zoom: Math.round((prev.zoom + (preTarget.zoom - prev.zoom) * smoothPreT) * 10) / 10,
            posX: Math.round((prev.posX + (preTarget.posX - prev.posX) * smoothPreT) * 10) / 10,
            posY: Math.round((prevY + (preY - prevY) * smoothPreT) * 10) / 10,
        };
    }

    const t = (currentTime - prev.time) / span;
    const targetY = next.posY ?? fbY;
    const smoothT = (1 - Math.cos(t * Math.PI)) / 2;

    return {
        zoom: Math.round((prev.zoom + (next.zoom - prev.zoom) * smoothT) * 10) / 10,
        posX: Math.round((prev.posX + (next.posX - prev.posX) * smoothT) * 10) / 10,
        posY: Math.round((prevY + (targetY - prevY) * smoothT) * 10) / 10,
    };
};

export const getActiveSceneAtTime = (draft: VideoDraft, currentTime: number): { scene: TimelineScene | null; isOutro: boolean; sceneIndex: number } => {
    const scenes = draft.scenes && draft.scenes.length > 0 ? draft.scenes : [];
    let elapsed = 0;

    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i]!;
        const nextElapsed = elapsed + scene.duration;
        if (currentTime >= elapsed && currentTime < nextElapsed) {
            return { scene, isOutro: false, sceneIndex: i };
        }
        elapsed = nextElapsed;
    }

    if (draft.enableOutro && currentTime >= elapsed) {
        return { scene: null, isOutro: true, sceneIndex: scenes.length };
    }

    return { scene: scenes[0] ?? null, isOutro: false, sceneIndex: 0 };
};

/** Resolves effective scene fade durations from preset ('auto' | 'micro' | 'editorial'). */
export const resolveSceneFadeDurations = (scenes: TimelineScene[], idx: number) => {
    const anchored = Boolean(scenes[1]?.id.startsWith('rehook-') && scenes[1]?.shareHookText !== false);
    const s = scenes[idx];
    const inPreset = s?.fadeInPreset || 'auto';
    const outPreset = s?.fadeOutPreset || 'auto';
    const inMode = inPreset === 'auto' ? (idx === 1 && anchored ? 'micro' : 'editorial') : inPreset;
    const outMode = outPreset === 'auto' ? (idx === 0 && anchored ? 'micro' : 'editorial') : outPreset;
    return { inPreset, outPreset, inMode, outMode, inDur: inMode === 'micro' ? 0.08 : 0.18, outDur: outMode === 'micro' ? 0.06 : 0.12 };
};

/** Computes broadcast dip-to-black intensity (0..1) across any scene Fade In / Fade Out boundary. */
export const getHookTransitionFade = (draft: VideoDraft, currentTime: number): number => {
    const scenes = draft.scenes || [];
    if (scenes.length === 0) return 0;
    const { hasReHook, storyIdx } = getTimelineStructure(scenes);
    let start = 0;

    for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i]!;
        const dur = s.duration || 0;
        const end = start + dur;
        const resolved = resolveSceneFadeDurations(scenes, i);
        const inOn = s.fadeIn ?? (i === storyIdx || (hasReHook && i === 1));
        const outOn = s.fadeOut ?? (i === 0 || (hasReHook && i === 1));
        const inDur = inOn ? Math.min(resolved.inDur, dur * 0.5) : 0;
        const outDur = outOn ? Math.min(resolved.outDur, dur * 0.5) : 0;

        if (inDur > 0 && currentTime >= start && currentTime <= start + inDur) {
            return (1 + Math.cos(((currentTime - start) / inDur) * Math.PI)) / 2;
        }
        const beforeEnd = i === scenes.length - 1 ? currentTime <= end : currentTime < end;
        if (outDur > 0 && currentTime >= end - outDur && beforeEnd) {
            return (1 - Math.cos(((currentTime - (end - outDur)) / outDur) * Math.PI)) / 2;
        }
        start = end;
    }
    return 0;
};

/** Computes soft -12dB J-cut breath-bridge audio gain (0.25..1.0), or full 0.0 dip at outer/silent edges. */
export const getBreathDipAudioGain = (fadeIntensity: number, allowFullZero = false): number => {
    const f = Math.max(0, Math.min(1, fadeIntensity));
    return allowFullZero ? (1 - Math.pow(f, 2)) : (0.25 + 0.75 * (1 - Math.pow(f, 2)));
};

export const formatTimecode = (seconds: number): string => {
    if (Number.isNaN(seconds) || seconds < 0) return "00:00.0";
    const tenths = Math.round(seconds * 10);
    const m = Math.floor(tenths / 600);
    const s = Math.floor((tenths % 600) / 10);
    const ds = tenths % 10;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ds}`;
};

export const getSceneBoundaries = (scenes: TimelineScene[] = []) =>
    scenes.reduce<{ id: string; idx: number; start: number; end: number; mediaType: 'video' | 'image'; mediaUrl?: string }[]>((acc, s, idx) => {
        const start = idx === 0 ? 0 : acc[idx - 1]!.end;
        return [...acc, { id: s.id, idx, start, end: start + (s.duration || 0), mediaType: s.mediaType || 'video', mediaUrl: s.mediaUrl }];
    }, []);

/**
 * Maps timeline timecode (seconds) to the underlying video clip timestamp,
 * accounting for cold-open teaser hook in-points before resetting Scene 02 to 00:00.0.
 */
export const timelineTimeToMediaTime = (draft: VideoDraft, timelineTime: number): number => {
    const scenes = draft.scenes && draft.scenes.length > 0 ? draft.scenes : [];
    if (scenes.length === 0) return timelineTime;

    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;

    if (hasCustomJump) {
        if (timelineTime < hookDur) return hookOffset + timelineTime;
        if (hasReHook && timelineTime < preStoryDur) return rehookOffset + (timelineTime - hookDur);
        return storyOffset + (timelineTime - preStoryDur);
    }

    return timelineTime;
};

/** Wraps timeline-mapped media time within [storyOffset, clipDuration] for Story+ so pre-Story footage never replays. */
export const wrapMediaTime = (draft: VideoDraft, timelineTime: number, clipDuration: number): number => {
    const raw = timelineTimeToMediaTime(draft, timelineTime);
    if (!clipDuration || clipDuration <= 0) return raw;
    const { preStoryDur, storyOffset } = getTimelineStructure(draft.scenes || []);
    if (timelineTime >= preStoryDur && storyOffset > 0 && storyOffset < clipDuration - 0.5) {
        const span = Math.max(0.5, clipDuration - storyOffset);
        return storyOffset + (Math.max(0, raw - storyOffset) % span);
    }
    return raw % clipDuration;
};

/**
 * Maps a native video media timestamp back to timeline currentTime,
 * tracking loop iterations when the source clip is shorter than the timeline.
 */
export const mediaTimeToTimelineTime = (draft: VideoDraft, mediaTime: number, currentTimelineTime: number): number => {
    const scenes = draft.scenes && draft.scenes.length > 0 ? draft.scenes : [];
    if (scenes.length === 0) return mediaTime;

    const { hasReHook, hookDur, preStoryDur, hookOffset, rehookOffset, storyOffset } = getTimelineStructure(scenes);
    const hasCustomJump = hookOffset > 0 || rehookOffset > 0 || storyOffset > 0 || hasReHook;

    if (hasCustomJump && currentTimelineTime < hookDur) {
        return Math.max(0, mediaTime - hookOffset);
    }
    if (hasReHook && currentTimelineTime >= hookDur && currentTimelineTime < preStoryDur) {
        return hookDur + Math.max(0, mediaTime - rehookOffset);
    }

    const baseOffset = hasCustomJump ? preStoryDur : 0;
    const relMedia = hasCustomJump && storyOffset > 0 ? Math.max(0, mediaTime - storyOffset) : mediaTime;
    const prevNarrativeTime = Math.max(0, currentTimelineTime - baseOffset);
    const rawClipDur = draft.videoDuration && draft.videoDuration > 1 ? draft.videoDuration : 0;
    const clipDur = rawClipDur > 0 ? Math.max(1, rawClipDur - (hasCustomJump ? storyOffset : 0)) : 0;

    if (clipDur > 0) {
        let loopIndex = Math.floor(prevNarrativeTime / clipDur);
        const posInLoop = prevNarrativeTime % clipDur;
        if (posInLoop > clipDur - 0.8 && relMedia < 0.8) {
            loopIndex += 1;
        }
        return baseOffset + loopIndex * clipDur + relMedia;
    }

    return baseOffset + relMedia;
};
