"use client";

import { useEffect, useEffectEvent } from "react";
import { clamp } from "@/types/news";

interface StudioShortcutContext {
    togglePlay: () => void;
    seekTo: (time: number) => void;
    onToggleToolTab: (tab: "keyframes" | "subtitles" | "motion") => void;
    sceneStarts: number[];
    outroStart: number;
    enableOutro: boolean;
    activeDisplayTime: number;
    getLiveTime?: () => number;
    duration: number;
}

const CODE_TO_TAB: Record<string, "keyframes" | "subtitles" | "motion"> = {
    KeyK: "keyframes",
    KeyC: "subtitles",
    KeyM: "motion",
};

/** Maps physical digit `e.code` (`Digit0`–`Digit9` / NumLock-ON `Numpad0`–`Numpad9`) for Urdu layouts (`۰`–`۹`), falling back to `e.key`. */
export const resolvePhysicalShortcutKey = (key: string, code: string, shiftKey: boolean): string => {
    if (!shiftKey && (/^Digit[0-9]$/.test(code) || (/^Numpad[0-9]$/.test(code) && key.length === 1))) {
        return code.slice(-1);
    }
    return key;
};

/** Pure resolver for numeric/arrow studio shortcuts (returns target timestamp in seconds, or null). */
export const resolveStudioShortcutSeek = (
    key: string,
    shiftKey: boolean,
    ctx: Pick<StudioShortcutContext, "sceneStarts" | "outroStart" | "enableOutro" | "activeDisplayTime" | "duration">
): number | null => {
    if (!shiftKey && key >= "1" && key <= "9") {
        const idx = Number(key) - 1;
        if (idx < ctx.sceneStarts.length) return ctx.sceneStarts[idx]!;
        if (idx === ctx.sceneStarts.length && ctx.enableOutro) return ctx.outroStart;
        return null;
    }
    if (!shiftKey && key === "0" && ctx.enableOutro) return ctx.outroStart;
    if (key === "ArrowLeft" || key === "ArrowRight") {
        const safeNow = Number.isFinite(ctx.activeDisplayTime) ? ctx.activeDisplayTime : 0;
        const safeDur = Number.isFinite(ctx.duration) ? Math.max(0, ctx.duration) : 0;
        const delta = (shiftKey ? 5 : 1) * (key === "ArrowRight" ? 1 : -1);
        return clamp(safeNow + delta, 0, safeDur);
    }
    return null;
};

/** Attaches global NLE studio keyboard shortcuts once (zero listener churn during 120Hz playback). */
export const useStudioShortcuts = (ctx: StudioShortcutContext) => {
    const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
        if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.querySelector("dialog[open]")) return;
        const target = e.target instanceof HTMLElement ? e.target : null;
        if (target?.isContentEditable || target?.closest('input, textarea, select, [contenteditable="true"]')) return;

        if (e.code === "Space") {
            if (target?.closest('button, [role="button"], [role="slider"], [role="tab"]')) return;
            e.preventDefault();
            if (!e.repeat) ctx.togglePlay();
            return;
        }
        const tab = CODE_TO_TAB[e.code];
        if (tab) {
            e.preventDefault();
            if (!e.repeat) ctx.onToggleToolTab(tab);
            return;
        }
        if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target?.closest('[role="slider"]')) return;

        const liveT = ctx.getLiveTime ? ctx.getLiveTime() : ctx.activeDisplayTime;
        const resolvedKey = resolvePhysicalShortcutKey(e.key, e.code, e.shiftKey);
        const nextTime = resolveStudioShortcutSeek(resolvedKey, e.shiftKey, { ...ctx, activeDisplayTime: liveT });
        if (nextTime !== null) {
            e.preventDefault();
            if (Math.abs(nextTime - liveT) > 0.0001) ctx.seekTo(nextTime);
        }
    });

    useEffect(() => {
        const ac = new AbortController();
        window.addEventListener("keydown", onKeyDown, { signal: ac.signal });
        return () => ac.abort();
    }, []);
};
