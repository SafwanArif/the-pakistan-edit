import { useEffect, useRef } from "react";
import { clamp } from "../../../types/news";

export interface StudioShortcutContext {
    togglePlay: () => void;
    seekTo: (time: number) => void;
    onToggleToolTab: (tab: "keyframes" | "subtitles" | "motion") => void;
    sceneStarts: number[];
    outroStart: number;
    enableOutro: boolean;
    activeDisplayTime: number;
    duration: number;
}

/** Pure resolver for numeric/arrow studio shortcuts (returns target timestamp in seconds, or null). */
export const resolveStudioShortcutSeek = (
    key: string,
    shiftKey: boolean,
    ctx: Pick<StudioShortcutContext, "sceneStarts" | "outroStart" | "enableOutro" | "activeDisplayTime" | "duration">
): number | null => {
    if (key >= "1" && key <= "9") {
        const idx = Number(key) - 1;
        if (idx < ctx.sceneStarts.length) return ctx.sceneStarts[idx]!;
        if (idx === ctx.sceneStarts.length && ctx.enableOutro) return ctx.outroStart;
        return null;
    }
    if (key === "0" && ctx.enableOutro) return ctx.outroStart;
    if (key === "ArrowLeft" || key === "ArrowRight") {
        const delta = (shiftKey ? 5 : 1) * (key === "ArrowRight" ? 1 : -1);
        return clamp(ctx.activeDisplayTime + delta, 0, ctx.duration);
    }
    return null;
};

/** Attaches global NLE studio keyboard shortcuts once (zero listener churn during 120fps playback). */
export const useStudioShortcuts = (ctx: StudioShortcutContext) => {
    const ctxRef = useRef(ctx);
    useEffect(() => {
        ctxRef.current = ctx;
    });

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
            const s = ctxRef.current;

            if (e.code === "Space") {
                if (target?.closest("button")) return;
                e.preventDefault();
                s.togglePlay();
                return;
            }
            if (e.code === "KeyK") {
                e.preventDefault();
                s.onToggleToolTab("keyframes");
                return;
            }
            if (e.code === "KeyC") {
                e.preventDefault();
                s.onToggleToolTab("subtitles");
                return;
            }
            if (e.code === "KeyM") {
                e.preventDefault();
                s.onToggleToolTab("motion");
                return;
            }
            if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && target?.closest('[role="slider"]')) {
                return;
            }
            const nextTime = resolveStudioShortcutSeek(e.key, e.shiftKey, s);
            if (nextTime !== null) {
                e.preventDefault();
                s.seekTo(nextTime);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);
};
