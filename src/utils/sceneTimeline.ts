import type { VideoDraft, TimelineScene } from "../types/news";

/** Clamps a numeric value inclusively to `[min, max]` (returns `min` on `NaN`, preserves `±Infinity` clamping). */
export const clamp = (val: number, min: number, max: number): number =>
    Number.isNaN(val) ? min : Math.min(Math.max(val, min), max);

/** Returns `v` when finite, otherwise `fb`. */
export const finiteOr = (v: number | undefined, fb: number): number =>
    v !== undefined && Number.isFinite(v) ? v : fb;

const safePosDur = (v: number | undefined, fallback: number): number =>
    v !== undefined && Number.isFinite(v) && v > 0 ? v : fallback;

const safeNonNeg = (v: number | undefined): number =>
    v !== undefined && Number.isFinite(v) && v > 0 ? v : 0;

export const createDefaultTimelineScenes = (): TimelineScene[] => [
    { id: "scene-1", title: "==THE STATE BANK== ANNOUNCES NEW DIGITAL POLICY", subtitle: "Key decisions ratified by the executive council today in Islamabad.", duration: 4, mediaType: "video", fadeOut: true },
    { id: "rehook-1", title: "WAIT — HERE IS ==THE REAL SHIFT==", subtitle: "The overlooked turning point right before the full picture emerged.", duration: 4, mediaType: "video", fadeIn: true, shareHookText: true },
    { id: "scene-2", title: "THE STORY: FULL REPORT", subtitle: "The chronological context and underlying drivers behind this development.", duration: 52, mediaType: "video", fadeIn: true },
];

/** Returns unified structural indices, durations, and source offsets for Hook, Re-Hook, and Story. */
export const getTimelineStructure = (scenes: TimelineScene[] = []) => {
    const hasReHook = Boolean(scenes[1]?.id?.startsWith("rehook-"));
    const candidateStoryIdx = hasReHook ? 2 : 1;
    const storyIdx = scenes.length > candidateStoryIdx ? candidateStoryIdx : -1;
    const hookDur = safePosDur(scenes[0]?.duration, 4);
    const rehookDur = hasReHook ? safePosDur(scenes[1]?.duration, 4) : 0;
    return {
        hasReHook, storyIdx, hookDur, rehookDur, preStoryDur: hookDur + rehookDur,
        hookOffset: safeNonNeg(scenes[0]?.clipStartOffset),
        rehookOffset: hasReHook ? safeNonNeg(scenes[1]?.clipStartOffset) : 0,
        storyOffset: storyIdx >= 0 ? safeNonNeg(scenes[storyIdx]?.clipStartOffset) : 0,
    };
};

type TimelineStruct = ReturnType<typeof getTimelineStructure>;

/** Returns true when `scene` is a Re-Hook anchored to share 01. The Hook's headline/subheading. */
export const isSharedReHookScene = (scenes: TimelineScene[] | undefined, idx: number): boolean => {
    const s = scenes?.[idx];
    return Boolean(s?.id?.startsWith("rehook-") && s.shareHookText !== false && scenes?.[0]);
};

/** Returns canonical editorial label (`01. HOOK`, `02. RE-HOOK`, `03. STORY`, `NN. ANGLE`) for a scene index. */
export const getSceneRoleLabel = (scenes: TimelineScene[] = [], idx: number): string => {
    if (idx === 0) return "01. HOOK";
    const pad = String(idx + 1).padStart(2, "0");
    const { hasReHook, storyIdx } = getTimelineStructure(scenes);
    if (hasReHook && idx === 1) return "02. RE-HOOK";
    return storyIdx >= 0 && idx === storyIdx ? `${pad}. STORY` : `${pad}. ANGLE`;
};

export const getTotalVideoDuration = (draft: VideoDraft): number =>
    (draft.scenes || []).reduce((acc, s) => acc + safeNonNeg(s.duration), 0)
    + (draft.enableOutro ? safePosDur(draft.outroDuration, 5) : 0);

/** Guarantees every scene in a timeline has a non-empty unique ID (heals legacy persisted drafts). */
export const ensureUniqueSceneIds = (scenes: TimelineScene[]): TimelineScene[] => {
    const usedIds = new Set<string>();
    return scenes.map((s, idx) => {
        const cleanId = typeof s.id === "string" ? s.id.trim() : "";
        let id = cleanId && !usedIds.has(cleanId) ? cleanId : `scene-${idx + 1}`;
        let suffix = 2;
        while (usedIds.has(id)) id = `scene-${idx + 1}-${suffix++}`;
        usedIds.add(id);
        return id === s.id ? s : { ...s, id };
    });
};

/** Preserves 01. Hook and 02. Re-Hook and adapts 03. The Story to the imported clip duration. */
export const calculatePsychologyPacedScenes = (totalClipDuration: number, existingScenes?: TimelineScene[]): TimelineScene[] => {
    const base = ensureUniqueSceneIds(existingScenes?.length ? [...existingScenes] : createDefaultTimelineScenes());
    const { storyIdx } = getTimelineStructure(base);
    const targetIdx = storyIdx >= 0 ? storyIdx : base.length - 1;
    const story = base[targetIdx];
    if (!story) return base;
    const storyDur = Math.max(4, Math.round((safeNonNeg(totalClipDuration) - safeNonNeg(story.clipStartOffset)) * 10) / 10);
    base[targetIdx] = { ...story, duration: storyDur };
    return base;
};

export const autoPadToMonetisationThreshold = (draft: VideoDraft, targetSeconds = 61.5): VideoDraft => {
    const scenes = draft.scenes?.length ? [...draft.scenes] : createDefaultTimelineScenes();
    const { storyIdx } = getTimelineStructure(scenes);
    const targetIdx = storyIdx >= 0 ? storyIdx : scenes.length - 1;
    const targetScene = scenes[targetIdx];
    if (!targetScene) return draft;
    const outroTime = draft.enableOutro ? safePosDur(draft.outroDuration, 5) : 0;
    const otherScenesTime = scenes.reduce((sum, s, i) => (i === targetIdx ? sum : sum + safeNonNeg(s.duration)), 0);
    const neededStoryDur = Math.max(4, Math.round((finiteOr(targetSeconds, 61.5) - outroTime - otherScenesTime) * 10) / 10);
    scenes[targetIdx] = { ...targetScene, duration: Math.max(safeNonNeg(targetScene.duration), neededStoryDur) };
    return { ...draft, scenes };
};

/** Canonical mutator for a scene's `clipStartOffset` clamping safely within `clipDuration` and adapting Story duration. */
export const setSceneClipStartOffset = (draft: VideoDraft, sceneIdx: number, nextOffset?: number): VideoDraft => {
    const scenes = [...(draft.scenes || [])];
    const target = scenes[sceneIdx];
    if (!target) return draft;

    const { hasReHook, storyIdx } = getTimelineStructure(scenes);
    const isStory = storyIdx >= 0 && sceneIdx === storyIdx;
    const isHookOrReHook = sceneIdx === 0 || (hasReHook && sceneIdx === 1);
    const clipDur = !target.mediaUrl ? safeNonNeg(draft.videoDuration) : 0;
    const prevOffset = safeNonNeg(target.clipStartOffset);

    const copy: TimelineScene = { ...target };
    if (nextOffset === undefined || !Number.isFinite(nextOffset) || nextOffset < 0) {
        delete copy.clipStartOffset;
    } else {
        const maxOffset = clipDur > 0
            ? (isHookOrReHook ? Math.max(0, clipDur - Math.max(0.5, safeNonNeg(target.duration))) : Math.max(0, clipDur - 2))
            : nextOffset;
        copy.clipStartOffset = Math.round(clamp(nextOffset, 0, maxOffset) * 10) / 10;
    }

    if (isStory && clipDur > 0) {
        const prevAdaptedDur = Math.max(4, Math.round((clipDur - prevOffset) * 10) / 10);
        if (Math.abs(safeNonNeg(target.duration) - prevAdaptedDur) <= 0.5) {
            copy.duration = Math.max(4, Math.round((clipDur - (copy.clipStartOffset ?? 0)) * 10) / 10);
        }
    }

    scenes[sceneIdx] = copy;
    return { ...draft, scenes };
};

export const getActiveSceneAtTime = (draft: VideoDraft, currentTime: number): { scene: TimelineScene | null; isOutro: boolean; sceneIndex: number } => {
    const scenes = draft.scenes?.length ? draft.scenes : [];
    const safeTime = finiteOr(currentTime, 0);
    let elapsed = 0;
    for (let i = 0; i < scenes.length; i++) {
        const scene = scenes[i]!;
        const nextElapsed = elapsed + safeNonNeg(scene.duration);
        if (safeTime >= elapsed && safeTime < nextElapsed) return { scene, isOutro: false, sceneIndex: i };
        elapsed = nextElapsed;
    }
    if (draft.enableOutro && safeTime >= elapsed) return { scene: null, isOutro: true, sceneIndex: scenes.length };
    if (scenes.length > 0 && safeTime >= elapsed) return { scene: scenes[scenes.length - 1]!, isOutro: false, sceneIndex: scenes.length - 1 };
    return { scene: scenes[0] ?? null, isOutro: false, sceneIndex: 0 };
};

export type AudioBoundaryFadeMode = "full" | "breath" | "declick" | "none";

export interface ResolvedSceneFade {
    inEnabled: boolean;
    outEnabled: boolean;
    inPreset: "auto" | "micro" | "editorial";
    outPreset: "auto" | "micro" | "editorial";
    inMode: "micro" | "editorial";
    outMode: "micro" | "editorial";
    rawInDur: number;
    rawOutDur: number;
    inDur: number;
    outDur: number;
}

const MAX_FADE_WINDOW_SEC = 0.2;

const resolveSceneFadeWithStruct = (scenes: TimelineScene[], idx: number, struct: TimelineStruct, anchored: boolean): ResolvedSceneFade => {
    const s = scenes[idx];
    const inPreset = s?.fadeInPreset || "auto";
    const outPreset = s?.fadeOutPreset || "auto";
    const inMode = inPreset === "auto" ? (idx === 1 && anchored ? "micro" : "editorial") : inPreset;
    const outMode = outPreset === "auto" ? (idx === 0 && anchored ? "micro" : "editorial") : outPreset;
    const rawInDur = inMode === "micro" ? 0.08 : 0.18;
    const rawOutDur = outMode === "micro" ? 0.06 : 0.12;
    const inEnabled = s?.fadeIn ?? ((struct.storyIdx >= 0 && idx === struct.storyIdx) || (struct.hasReHook && idx === 1));
    const outEnabled = s?.fadeOut ?? (idx === 0 || (struct.hasReHook && idx === 1));
    const halfDur = safeNonNeg(s?.duration) * 0.5;
    return {
        inEnabled, outEnabled, inPreset, outPreset, inMode, outMode, rawInDur, rawOutDur,
        inDur: inEnabled ? Math.min(rawInDur, halfDur) : 0,
        outDur: outEnabled ? Math.min(rawOutDur, halfDur) : 0,
    };
};

/** Canonical single source of truth for scene fade enablement, preset mode, and clamped durations. */
export const resolveSceneFade = (scenes: TimelineScene[], idx: number): ResolvedSceneFade =>
    resolveSceneFadeWithStruct(scenes, idx, getTimelineStructure(scenes), isSharedReHookScene(scenes, 1));

const resolveAudioModesWithStruct = (
    scenes: TimelineScene[], idx: number, enableOutro: boolean, struct: TimelineStruct, anchored: boolean, cur: ResolvedSceneFade
): { inAudioMode: AudioBoundaryFadeMode; outAudioMode: AudioBoundaryFadeMode } => {
    const prevHasAudio = idx > 0 && scenes[idx - 1]?.mediaType !== "image";
    const prevFadeOut = idx > 0 ? resolveSceneFadeWithStruct(scenes, idx - 1, struct, anchored).outEnabled : false;
    const nextHasAudio = idx < scenes.length - 1 && scenes[idx + 1]?.mediaType !== "image";
    const nextFadeIn = idx < scenes.length - 1 ? resolveSceneFadeWithStruct(scenes, idx + 1, struct, anchored).inEnabled : false;
    return {
        inAudioMode: idx === 0 || !prevHasAudio ? "full" : (cur.inEnabled && prevFadeOut ? "breath" : "declick"),
        outAudioMode: (idx === scenes.length - 1 && !enableOutro) || (idx < scenes.length - 1 && !nextHasAudio)
            ? "full"
            : (cur.outEnabled && (idx === scenes.length - 1 || nextFadeIn) ? "breath" : "declick"),
    };
};

/** Resolves broadcast audio boundary fade modes ('full' | 'breath' | 'declick') for a scene. */
export const resolveAudioBoundaryModes = (scenes: TimelineScene[], idx: number, enableOutro = false) => {
    const struct = getTimelineStructure(scenes);
    const anchored = isSharedReHookScene(scenes, 1);
    return resolveAudioModesWithStruct(scenes, idx, enableOutro, struct, anchored, resolveSceneFadeWithStruct(scenes, idx, struct, anchored));
};

const NO_TRANSITION: Readonly<{ fade: number; audioGain: number }> = Object.freeze({ fade: 0, audioGain: 1 });

const getBreathDipAudioGain = (fadeIntensity: number, allowFullZero = false): number => {
    const f = clamp(fadeIntensity, 0, 1);
    const oneMinusSq = 1 - f * f;
    return allowFullZero ? oneMinusSq : 0.25 + 0.75 * oneMinusSq;
};

/** Single-pass 120Hz transition evaluator returning visual dip intensity and FFmpeg-matched audio gain (zero-alloc outside edges). */
export const evaluateSceneTransition = (draft: VideoDraft, currentTime: number): Readonly<{ fade: number; audioGain: number }> => {
    const scenes = draft.scenes || [];
    if (!scenes.length || !Number.isFinite(currentTime)) return NO_TRANSITION;
    let start = 0;

    for (let i = 0; i < scenes.length; i++) {
        const end = start + safeNonNeg(scenes[i]!.duration);
        const isLast = i === scenes.length - 1;
        if (currentTime >= start && (isLast ? currentTime <= end : currentTime < end)) {
            const nearStart = currentTime - start <= MAX_FADE_WINDOW_SEC;
            const nearEnd = end - currentTime <= MAX_FADE_WINDOW_SEC;
            if (!nearStart && !nearEnd) return NO_TRANSITION;

            const struct = getTimelineStructure(scenes);
            const anchored = isSharedReHookScene(scenes, 1);
            const curFade = resolveSceneFadeWithStruct(scenes, i, struct, anchored);
            let fade = 0;
            let isInEdge = false;
            if (nearStart && curFade.inDur > 0 && currentTime <= start + curFade.inDur) {
                fade = (1 + Math.cos(((currentTime - start) / curFade.inDur) * Math.PI)) / 2;
                isInEdge = true;
            } else if (nearEnd && curFade.outDur > 0 && currentTime >= end - curFade.outDur) {
                fade = (1 - Math.cos(((currentTime - (end - curFade.outDur)) / curFade.outDur) * Math.PI)) / 2;
            }
            if (fade <= 0.0005) return NO_TRANSITION;

            const { inAudioMode, outAudioMode } = resolveAudioModesWithStruct(scenes, i, Boolean(draft.enableOutro), struct, anchored, curFade);
            const mode = isInEdge ? inAudioMode : outAudioMode;
            return { fade, audioGain: mode === "full" ? getBreathDipAudioGain(fade, true) : (mode === "breath" ? getBreathDipAudioGain(fade, false) : 1) };
        }
        start = end;
    }
    return NO_TRANSITION;
};

/** Computes broadcast dip-to-black intensity (0..1) across any scene Fade In / Fade Out boundary. */
export const getHookTransitionFade = (draft: VideoDraft, currentTime: number): number =>
    evaluateSceneTransition(draft, currentTime).fade;

interface SceneBoundary {
    id: string;
    idx: number;
    start: number;
    end: number;
    mediaType: "video" | "image";
    mediaUrl?: string;
}

export const getSceneBoundaries = (scenes: TimelineScene[] = []): SceneBoundary[] => {
    let elapsed = 0;
    return scenes.map((s, idx) => {
        const start = elapsed;
        const end = start + safeNonNeg(s.duration);
        elapsed = end;
        return { id: s.id, idx, start, end, mediaType: s.mediaType || "video", mediaUrl: s.mediaUrl };
    });
};
