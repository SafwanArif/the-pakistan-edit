import type { VideoDraft, VideoKeyframe, TimelineScene } from "../types/news";

/** Clamps a numeric value inclusively to `[min, max]`. */
export const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);

/** Parses `MM:SS.ssss`, `MM:SS.d`, or raw seconds into a non-negative number of seconds. */
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
    const { storyIdx } = getTimelineStructure(base);
    const story = base[storyIdx]!;
    const safeClipDuration = Number.isFinite(totalClipDuration) ? Math.max(0, totalClipDuration) : 0;
    const storyDur = Math.max(4, Math.round((safeClipDuration - (story.clipStartOffset || 0)) * 10) / 10);
    base[storyIdx] = { ...story, duration: storyDur };
    return base;
};

export const autoPadToMonetisationThreshold = (draft: VideoDraft, targetSeconds: number = 61.5): VideoDraft => {
    const scenes = draft.scenes?.length ? [...draft.scenes] : createDefaultTimelineScenes();
    const { storyIdx } = getTimelineStructure(scenes);
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
 * Canonical mutator for a scene's `clipStartOffset` (01 Hook, 02 Re-Hook, or 03 Story):
 * clamps safely within `clipDuration`, rounds to 0.1s, and automatically keeps Story duration
 * adapted to the remaining clip when previously matched (preventing silent tail-looping).
 */
export const setSceneClipStartOffset = (
    draft: VideoDraft,
    sceneIdx: number,
    nextOffset?: number
): VideoDraft => {
    const scenes = [...(draft.scenes || [])];
    const target = scenes[sceneIdx];
    if (!target) return draft;

    const { hasReHook, storyIdx } = getTimelineStructure(scenes);
    const isStory = sceneIdx === storyIdx;
    const isHookOrReHook = sceneIdx === 0 || (hasReHook && sceneIdx === 1);
    const clipDur = !target.mediaUrl && draft.videoDuration && draft.videoDuration > 0 ? draft.videoDuration : 0;
    const prevOffset = target.clipStartOffset ?? 0;

    const copy: TimelineScene = { ...target };
    if (nextOffset === undefined || !Number.isFinite(nextOffset) || nextOffset < 0) {
        delete copy.clipStartOffset;
    } else {
        const maxOffset = clipDur > 0
            ? (isHookOrReHook ? Math.max(0, clipDur - Math.max(0.5, target.duration || 0)) : Math.max(0, clipDur - 2))
            : nextOffset;
        copy.clipStartOffset = Math.round(clamp(nextOffset, 0, maxOffset) * 10) / 10;
    }

    if (isStory && clipDur > 0) {
        const prevAdaptedDur = Math.max(4, Math.round((clipDur - prevOffset) * 10) / 10);
        if (Math.abs((target.duration || 0) - prevAdaptedDur) <= 0.5) {
            copy.duration = Math.max(4, Math.round((clipDur - (copy.clipStartOffset ?? 0)) * 10) / 10);
        }
    }

    scenes[sceneIdx] = copy;
    return { ...draft, scenes };
};

export interface ResolvedFraming {
    zoom: number;
    posX: number;
    posY: number;
}

export type KeyframeSpan =
    | { kind: 'constant'; framing: ResolvedFraming }
    | { kind: 'glide'; gStart: number; gEnd: number; start: ResolvedFraming; end: ResolvedFraming };

/**
 * Canonical keyframe interval resolver shared by both 120Hz preview (`interpolateKeyframe`)
 * and server-side FFmpeg curve generation (`ffmpegFilters.ts`).
 * Holds the letterbox endpoint's `posY` across `FILL (>=100%) <-> CONTAIN (<100%)` glides.
 */
export const resolveKeyframeSpan = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): KeyframeSpan => {
    const fbZoom = fallback?.zoom ?? 100;
    const fbX = fallback?.posX ?? 50;
    const fbY = fallback?.posY ?? 100;

    if (!keyframes || keyframes.length === 0) {
        return { kind: 'constant', framing: { zoom: fbZoom, posX: fbX, posY: fbY } };
    }

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
        return { kind: 'constant', framing: { zoom: last.zoom, posX: last.posX, posY: last.posY ?? fbY } };
    }

    let prevTime = 0;
    let prevZoom = fbZoom;
    let prevPosX = fbX;
    let prevPosY = fbY;
    let next = sorted[0]!;
    if (currentTime < next.time) {
        if (next.easing === 'snap' && next.pre) {
            return { kind: 'constant', framing: { zoom: next.pre.zoom, posX: next.pre.posX, posY: next.pre.posY ?? fbY } };
        }
        if (next.time <= 0) {
            return { kind: 'constant', framing: { zoom: next.zoom, posX: next.posX, posY: next.posY ?? fbY } };
        }
    } else {
        for (let i = 0; i < sorted.length - 1; i++) {
            if (currentTime >= sorted[i]!.time && currentTime < sorted[i + 1]!.time) {
                const p = sorted[i]!;
                prevTime = p.time;
                prevZoom = p.zoom;
                prevPosX = p.posX;
                prevPosY = p.posY ?? fbY;
                next = sorted[i + 1]!;
                break;
            }
        }
    }

    if (next.time <= prevTime) {
        return { kind: 'constant', framing: { zoom: prevZoom, posX: prevPosX, posY: prevPosY } };
    }
    if (currentTime >= next.time) {
        return { kind: 'constant', framing: { zoom: next.zoom, posX: next.posX, posY: next.posY ?? fbY } };
    }
    if (next.easing === 'snap' && !next.pre) {
        return { kind: 'constant', framing: { zoom: prevZoom, posX: prevPosX, posY: prevPosY } };
    }

    const buildGlide = (gEnd: number, targetZoom: number, targetPosX: number, targetPosY: number): KeyframeSpan => {
        if (gEnd <= prevTime) {
            return { kind: 'constant', framing: { zoom: targetZoom, posX: targetPosX, posY: targetPosY } };
        }
        const startPosY = prevZoom >= 100 && targetZoom < 100 ? targetPosY : prevPosY;
        const endPosY = prevZoom < 100 && targetZoom >= 100 ? prevPosY : targetPosY;
        return {
            kind: 'glide',
            gStart: prevTime,
            gEnd,
            start: { zoom: prevZoom, posX: prevPosX, posY: startPosY },
            end: { zoom: targetZoom, posX: targetPosX, posY: endPosY },
        };
    };

    const preTarget = next.easing === 'snap' ? next.pre : undefined;
    if (preTarget) {
        const preTime = preTarget.time !== undefined
            ? Math.min(next.time, Math.max(prevTime, preTarget.time))
            : next.time;
        const preY = preTarget.posY ?? fbY;
        if (currentTime >= preTime) {
            return { kind: 'constant', framing: { zoom: preTarget.zoom, posX: preTarget.posX, posY: preY } };
        }
        return buildGlide(preTime, preTarget.zoom, preTarget.posX, preY);
    }

    return buildGlide(next.time, next.zoom, next.posX, next.posY ?? fbY);
};

/**
 * Smoothly interpolates Zoom, Pan X, and Pos Y across time-based keyframes.
 * Uses smooth cosine easing for organic camera gliding without abrupt cuts.
 */
export const interpolateKeyframe = (
    keyframes: VideoKeyframe[] | undefined,
    currentTime: number,
    fallback?: { zoom?: number; posX?: number; posY?: number }
): ResolvedFraming => {
    const span = resolveKeyframeSpan(keyframes, currentTime, fallback);
    if (span.kind === 'constant') return span.framing;
    const t = (currentTime - span.gStart) / (span.gEnd - span.gStart);
    const smoothT = (1 - Math.cos(t * Math.PI)) / 2;
    return {
        zoom: span.start.zoom + (span.end.zoom - span.start.zoom) * smoothT,
        posX: span.start.posX + (span.end.posX - span.start.posX) * smoothT,
        posY: span.start.posY + (span.end.posY - span.start.posY) * smoothT,
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

    if (scenes.length > 0 && currentTime >= elapsed) {
        const lastIdx = scenes.length - 1;
        return { scene: scenes[lastIdx]!, isOutro: false, sceneIndex: lastIdx };
    }

    return { scene: scenes[0] ?? null, isOutro: false, sceneIndex: 0 };
};

export type AudioBoundaryFadeMode = "full" | "breath" | "declick" | "none";

export interface ResolvedSceneFade {
    inEnabled: boolean;
    outEnabled: boolean;
    inPreset: 'auto' | 'micro' | 'editorial';
    outPreset: 'auto' | 'micro' | 'editorial';
    inMode: 'micro' | 'editorial';
    outMode: 'micro' | 'editorial';
    rawInDur: number;
    rawOutDur: number;
    inDur: number;
    outDur: number;
}

const MAX_FADE_WINDOW_SEC = 0.2;

/**
 * Canonical single source of truth for scene fade enablement, preset mode, and clamped durations.
 * Shared across TimelineStoryboard UI, retention checklists, 120Hz preview, and FFmpeg export.
 */
export const resolveSceneFade = (scenes: TimelineScene[], idx: number): ResolvedSceneFade => {
    const s = scenes[idx];
    const { hasReHook, storyIdx } = getTimelineStructure(scenes);
    const anchored = isSharedReHookScene(scenes, 1);
    const inPreset = s?.fadeInPreset || 'auto';
    const outPreset = s?.fadeOutPreset || 'auto';
    const inMode = inPreset === 'auto' ? (idx === 1 && anchored ? 'micro' : 'editorial') : inPreset;
    const outMode = outPreset === 'auto' ? (idx === 0 && anchored ? 'micro' : 'editorial') : outPreset;
    const rawInDur = inMode === 'micro' ? 0.08 : 0.18;
    const rawOutDur = outMode === 'micro' ? 0.06 : 0.12;
    const inEnabled = s?.fadeIn ?? (idx === storyIdx || (hasReHook && idx === 1));
    const outEnabled = s?.fadeOut ?? (idx === 0 || (hasReHook && idx === 1));
    const halfDur = Math.max(0, (s?.duration || 0) * 0.5);
    return {
        inEnabled,
        outEnabled,
        inPreset,
        outPreset,
        inMode,
        outMode,
        rawInDur,
        rawOutDur,
        inDur: inEnabled ? Math.min(rawInDur, halfDur) : 0,
        outDur: outEnabled ? Math.min(rawOutDur, halfDur) : 0,
    };
};

/** Resolves effective scene fade durations from preset ('auto' | 'micro' | 'editorial'). */
export const resolveSceneFadeDurations = (scenes: TimelineScene[], idx: number) => {
    const f = resolveSceneFade(scenes, idx);
    return { inPreset: f.inPreset, outPreset: f.outPreset, inMode: f.inMode, outMode: f.outMode, inDur: f.rawInDur, outDur: f.rawOutDur };
};

/**
 * Resolves broadcast audio boundary fade modes ('full' | 'breath' | 'declick') for a scene,
 * keeping 120Hz live preview audio dips in 1:1 parity with FFmpeg's audio filtergraph.
 */
export const resolveAudioBoundaryModes = (
    scenes: TimelineScene[],
    idx: number,
    enableOutro = false
): { inAudioMode: AudioBoundaryFadeMode; outAudioMode: AudioBoundaryFadeMode } => {
    const cur = resolveSceneFade(scenes, idx);
    const prevHasAudio = idx > 0 && scenes[idx - 1]?.mediaType !== "image";
    const prevFadeOut = idx > 0 ? resolveSceneFade(scenes, idx - 1).outEnabled : false;
    const nextHasAudio = idx < scenes.length - 1 && scenes[idx + 1]?.mediaType !== "image";
    const nextFadeIn = idx < scenes.length - 1 ? resolveSceneFade(scenes, idx + 1).inEnabled : false;

    const inAudioMode: AudioBoundaryFadeMode = idx === 0 || !prevHasAudio
        ? "full"
        : (cur.inEnabled && prevFadeOut ? "breath" : "declick");
    const outAudioMode: AudioBoundaryFadeMode = (idx === scenes.length - 1 && !enableOutro) || (idx < scenes.length - 1 && !nextHasAudio)
        ? "full"
        : (cur.outEnabled && (idx === scenes.length - 1 || nextFadeIn) ? "breath" : "declick");

    return { inAudioMode, outAudioMode };
};

const NO_TRANSITION: Readonly<{ fade: number; audioGain: number }> = Object.freeze({ fade: 0, audioGain: 1 });

/** Computes soft -12dB J-cut breath-bridge audio gain (0.25..1.0), or full 0.0 dip at outer/silent edges. */
export const getBreathDipAudioGain = (fadeIntensity: number, allowFullZero = false): number => {
    const f = clamp(fadeIntensity, 0, 1);
    return allowFullZero ? (1 - Math.pow(f, 2)) : (0.25 + 0.75 * (1 - Math.pow(f, 2)));
};

/**
 * Single-pass 120Hz transition evaluator returning both visual dip-to-black intensity (`0..1`)
 * and FFmpeg-matched audio gain (`0..1`) with zero allocations outside the 0.20s edge window.
 */
export const evaluateSceneTransition = (
    draft: VideoDraft,
    currentTime: number
): Readonly<{ fade: number; audioGain: number }> => {
    const scenes = draft.scenes || [];
    if (scenes.length === 0) return NO_TRANSITION;
    let start = 0;

    for (let i = 0; i < scenes.length; i++) {
        const dur = scenes[i]!.duration || 0;
        const end = start + dur;
        const isLast = i === scenes.length - 1;
        if (currentTime >= start && (isLast ? currentTime <= end : currentTime < end)) {
            const nearStart = currentTime - start <= MAX_FADE_WINDOW_SEC;
            const nearEnd = end - currentTime <= MAX_FADE_WINDOW_SEC;
            if (!nearStart && !nearEnd) return NO_TRANSITION;

            const { inDur, outDur } = resolveSceneFade(scenes, i);
            let fade = 0;
            let isInEdge = false;
            if (nearStart && inDur > 0 && currentTime <= start + inDur) {
                fade = (1 + Math.cos(((currentTime - start) / inDur) * Math.PI)) / 2;
                isInEdge = true;
            } else if (nearEnd && outDur > 0 && currentTime >= end - outDur) {
                fade = (1 - Math.cos(((currentTime - (end - outDur)) / outDur) * Math.PI)) / 2;
            }
            if (fade <= 0.0005) return NO_TRANSITION;

            const { inAudioMode, outAudioMode } = resolveAudioBoundaryModes(scenes, i, Boolean(draft.enableOutro));
            const mode = isInEdge ? inAudioMode : outAudioMode;
            const audioGain = mode === "full"
                ? getBreathDipAudioGain(fade, true)
                : (mode === "breath" ? getBreathDipAudioGain(fade, false) : 1);
            return { fade, audioGain };
        }
        start = end;
    }
    return NO_TRANSITION;
};

/** Computes broadcast dip-to-black intensity (0..1) across any scene Fade In / Fade Out boundary (zero-allocation outside edge windows). */
export const getHookTransitionFade = (draft: VideoDraft, currentTime: number): number =>
    evaluateSceneTransition(draft, currentTime).fade;

/**
 * Computes exact live preview audio gain (0..1) matching FFmpeg's per-boundary audio fade mode
 * ('full' dips to 0.0, 'breath' dips to -12dB / 0.25, 'declick' keeps steady 1.0 across one-sided fades).
 */
export const getTransitionAudioGain = (draft: VideoDraft, currentTime: number, fadeIntensity: number): number => {
    if (fadeIntensity <= 0.0005) return 1;
    const scenes = draft.scenes || [];
    if (scenes.length === 0) return 1;
    let start = 0;
    for (let i = 0; i < scenes.length; i++) {
        const dur = scenes[i]!.duration || 0;
        const end = start + dur;
        const isLast = i === scenes.length - 1;
        if (currentTime >= start && (isLast ? currentTime <= end : currentTime < end)) {
            const { inAudioMode, outAudioMode } = resolveAudioBoundaryModes(scenes, i, Boolean(draft.enableOutro));
            const mode = (currentTime - start) <= (end - currentTime) ? inAudioMode : outAudioMode;
            if (mode === "full") return getBreathDipAudioGain(fadeIntensity, true);
            if (mode === "breath") return getBreathDipAudioGain(fadeIntensity, false);
            return 1;
        }
        start = end;
    }
    return getBreathDipAudioGain(fadeIntensity, false);
};

/** Formats seconds as compact `MM:SS.d` for studio transport, scrubbers, and pills. */
export const formatTimecode = (seconds: number): string => {
    if (Number.isNaN(seconds) || seconds < 0) return "00:00.0";
    const tenths = Math.round(seconds * 10);
    const m = Math.floor(tenths / 600);
    const s = Math.floor((tenths % 600) / 10);
    const dec = tenths % 10;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${dec}`;
};

/** Formats seconds as high-precision `MM:SS.ssss` for frame-level keyframe editing. */
export const formatPreciseTimecode = (seconds: number): string => {
    if (Number.isNaN(seconds) || seconds < 0) return "00:00.0000";
    const tenThousandths = Math.round(seconds * 10000);
    const m = Math.floor(tenThousandths / 600000);
    const s = Math.floor((tenThousandths % 600000) / 10000);
    const decimals = tenThousandths % 10000;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${decimals.toString().padStart(4, '0')}`;
};

/** Snaps a timestamp to the nearest source PTS (for VFR clips) or uniform frame grid (for CFR clips). */
export const snapTimeToSourceFrame = (
    time: number,
    fps: number,
    sourceFrameIndex?: import("../types/news").SourceFrameIndex
): number => {
    const safeTime = Math.max(0, Number.isFinite(time) ? time : 0);
    if (sourceFrameIndex && !sourceFrameIndex.cfr && sourceFrameIndex.pts.length > 0) {
        let lo = 0;
        let hi = sourceFrameIndex.pts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sourceFrameIndex.pts[mid]! < safeTime) lo = mid + 1;
            else hi = mid;
        }
        const curr = sourceFrameIndex.pts[lo]!;
        const prev = lo > 0 ? sourceFrameIndex.pts[lo - 1]! : curr;
        return Math.max(0, Math.abs(prev - safeTime) <= Math.abs(curr - safeTime) ? prev : curr);
    }
    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
    return Math.max(0, Math.round(safeTime * safeFps) / safeFps);
};

/** Moves from an exact manual time to the adjacent source frame in the requested direction. */
export const nudgeTimeToFrame = (
    time: number,
    deltaFrames: number,
    fps: number,
    sourceFrameIndex?: import("../types/news").SourceFrameIndex
): number => {
    if (sourceFrameIndex && !sourceFrameIndex.cfr && sourceFrameIndex.pts.length > 1) {
        let lo = 0;
        let hi = sourceFrameIndex.pts.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (sourceFrameIndex.pts[mid]! < time) lo = mid + 1;
            else hi = mid;
        }
        const currDist = Math.abs(sourceFrameIndex.pts[lo]! - time);
        const prevDist = lo > 0 ? Math.abs(sourceFrameIndex.pts[lo - 1]! - time) : Number.POSITIVE_INFINITY;
        const nearestIndex = prevDist <= currDist ? lo - 1 : lo;
        const nextIndex = Math.min(sourceFrameIndex.pts.length - 1, Math.max(0, nearestIndex + deltaFrames));
        return Math.max(0, sourceFrameIndex.pts[nextIndex]!);
    }
    const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
    const scaled = Math.max(0, time) * safeFps;
    const epsilon = 1e-7;
    const frameIndex = deltaFrames > 0
        ? Math.floor(scaled + epsilon) + deltaFrames
        : Math.ceil(scaled - epsilon) + deltaFrames;
    return Math.max(0, frameIndex / safeFps);
};

export interface SceneBoundary {
    id: string;
    idx: number;
    start: number;
    end: number;
    mediaType: 'video' | 'image';
    mediaUrl?: string;
}

export const getSceneBoundaries = (scenes: TimelineScene[] = []): SceneBoundary[] => {
    let elapsed = 0;
    return scenes.map((s, idx) => {
        const start = elapsed;
        const end = start + (s.duration || 0);
        elapsed = end;
        return { id: s.id, idx, start, end, mediaType: s.mediaType || 'video', mediaUrl: s.mediaUrl };
    });
};

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
        if (Math.abs(currentTimelineTime - hookDur) < 0.25) {
            const nextOffset = hasReHook ? rehookOffset : storyOffset;
            if (Math.abs(mediaTime - nextOffset) < 0.25 && Math.abs(mediaTime - (hookOffset + hookDur)) > 0.4) {
                return hookDur + Math.max(0, mediaTime - nextOffset);
            }
        }
        return clamp(mediaTime - hookOffset, 0, hookDur);
    }
    if (hasReHook && currentTimelineTime >= hookDur && currentTimelineTime < preStoryDur) {
        if (Math.abs(currentTimelineTime - hookDur) < 0.25 && Math.abs(mediaTime - (hookOffset + hookDur)) < 0.25 && Math.abs(mediaTime - rehookOffset) > 0.4) {
            return hookDur;
        }
        if (Math.abs(currentTimelineTime - preStoryDur) < 0.25 && Math.abs(mediaTime - storyOffset) < 0.25 && Math.abs(mediaTime - (rehookOffset + (preStoryDur - hookDur))) > 0.4) {
            return preStoryDur + Math.max(0, mediaTime - storyOffset);
        }
        return clamp(hookDur + Math.max(0, mediaTime - rehookOffset), hookDur, preStoryDur);
    }

    if (hasCustomJump && Math.abs(currentTimelineTime - preStoryDur) < 0.25) {
        const prevEndMedia = hasReHook ? (rehookOffset + (preStoryDur - hookDur)) : (hookOffset + hookDur);
        if (Math.abs(mediaTime - prevEndMedia) < 0.35 && Math.abs(mediaTime - storyOffset) > 0.5) {
            return preStoryDur;
        }
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
