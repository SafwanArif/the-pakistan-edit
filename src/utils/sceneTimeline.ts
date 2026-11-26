import type { VideoDraft, TimelineScene } from "../types/news";

/** Clamps a numeric value inclusively to `[min, max]`. */
export const clamp = (val: number, min: number, max: number): number => Math.min(Math.max(val, min), max);

export const createDefaultTimelineScenes = (): TimelineScene[] => [
    { id: "scene-1", title: "==THE STATE BANK== ANNOUNCES NEW DIGITAL POLICY", subtitle: "Key decisions ratified by the executive council today in Islamabad.", duration: 4, mediaType: 'video', fadeOut: true },
    { id: "rehook-1", title: "WAIT — HERE IS ==THE REAL SHIFT==", subtitle: "The overlooked turning point right before the full picture emerged.", duration: 4, mediaType: 'video', fadeIn: true, shareHookText: true },
    { id: "scene-2", title: "THE STORY: FULL REPORT", subtitle: "The chronological context and underlying drivers behind this development.", duration: 52, mediaType: 'video', fadeIn: true }
];

/** Returns unified structural indices, durations, and source offsets for Hook, Re-Hook, and Story. */
export const getTimelineStructure = (scenes: TimelineScene[] = []) => {
    const hasReHook = Boolean(scenes[1]?.id.startsWith('rehook-'));
    const candidateStoryIdx = hasReHook ? 2 : 1;
    const storyIdx = scenes.length > candidateStoryIdx ? candidateStoryIdx : -1;
    const hookDur = scenes[0]?.duration || 4;
    const rehookDur = hasReHook ? (scenes[1]?.duration || 4) : 0;
    const preStoryDur = hookDur + rehookDur;
    const hookOffset = scenes[0]?.clipStartOffset ?? 0;
    const rehookOffset = hasReHook ? (scenes[1]?.clipStartOffset ?? 0) : 0;
    const storyOffset = storyIdx >= 0 ? (scenes[storyIdx]?.clipStartOffset ?? 0) : 0;
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
    if (storyIdx >= 0 && idx === storyIdx) return `${pad}. STORY`;
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
    const targetIdx = storyIdx >= 0 ? storyIdx : base.length - 1;
    const story = base[targetIdx];
    if (!story) return base;
    const safeClipDuration = Number.isFinite(totalClipDuration) ? Math.max(0, totalClipDuration) : 0;
    const storyDur = Math.max(4, Math.round((safeClipDuration - (story.clipStartOffset || 0)) * 10) / 10);
    base[targetIdx] = { ...story, duration: storyDur };
    return base;
};

export const autoPadToMonetisationThreshold = (draft: VideoDraft, targetSeconds: number = 61.5): VideoDraft => {
    const scenes = draft.scenes?.length ? [...draft.scenes] : createDefaultTimelineScenes();
    const { storyIdx } = getTimelineStructure(scenes);
    const targetIdx = storyIdx >= 0 ? storyIdx : scenes.length - 1;
    const targetScene = scenes[targetIdx];
    if (!targetScene) return draft;
    const outroTime = draft.enableOutro ? (draft.outroDuration || 5) : 0;
    const otherScenesTime = scenes.reduce((sum, s, i) => (i === targetIdx ? sum : sum + (s.duration || 0)), 0);
    const neededStoryDur = Math.max(4, Math.round((targetSeconds - outroTime - otherScenesTime) * 10) / 10);
    scenes[targetIdx] = {
        ...targetScene,
        duration: Math.max(targetScene.duration || 0, neededStoryDur),
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
    const isStory = storyIdx >= 0 && sceneIdx === storyIdx;
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
    const inEnabled = s?.fadeIn ?? ((storyIdx >= 0 && idx === storyIdx) || (hasReHook && idx === 1));
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
const getBreathDipAudioGain = (fadeIntensity: number, allowFullZero = false): number => {
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

interface SceneBoundary {
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
