"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { VideoKeyframe, formatTimecode, clamp } from "@/types/news";
import { HookGlyph } from "./ClipOffsetTrimmer";
import { TimelineKeyframeTrack, TimelinePlayheadNeedle } from "./TimelineMarkers";
import { isActivationKey, isPrimaryPointer, safeReleasePointerCapture, safeSetPointerCapture } from "../utils/domUtils";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";

interface SceneMarker {
    id: string;
    percent: number;
    label?: string;
    shortLabel?: string;
    color?: string;
}

const MainTimelineSegments = React.memo<{
    sceneMarkers: SceneMarker[];
    outroPct: number;
    activeSegIdx: number;
    isOutroActive: boolean;
}>(({ sceneMarkers, outroPct, activeSegIdx, isOutroActive }) => (
    <>
        {sceneMarkers.map((m, idx) => {
            const sceneEndPct = 100 - outroPct;
            const startPct = Math.min(m.percent, sceneEndPct);
            const nextPct = Math.min(sceneMarkers[idx + 1]?.percent ?? sceneEndPct, sceneEndPct);
            const segW = Math.max(0, nextPct - startPct);
            const isNarrow = segW < 8;
            const displayLabel = !isNarrow ? m.label : (segW >= 1.2 ? m.shortLabel : undefined);
            return (
                <div
                    key={m.id || idx}
                    className="tpe-main-scrubber-seg"
                    data-active={idx === activeSegIdx}
                    data-divider={idx < sceneMarkers.length - 1 || outroPct > 0}
                    data-narrow={isNarrow}
                    style={{
                        left: `${startPct}%`,
                        width: `${segW}%`,
                        "--seg-color": m.color || "var(--ui-accent)",
                    } as React.CSSProperties}
                >
                    {displayLabel && (
                        <span className="tpe-main-scrubber-seg-label" data-narrow={isNarrow}>
                            {displayLabel}
                        </span>
                    )}
                </div>
            );
        })}

        {outroPct > 0 && (() => {
            const outroNum = String(sceneMarkers.length + 1).padStart(2, "0");
            const isNarrow = outroPct < 8;
            const outroLabel = !isNarrow ? `${outroNum}. OUTRO` : (outroPct >= 1.2 ? outroNum : undefined);
            return (
                <div
                    className="tpe-main-scrubber-seg"
                    data-outro="true"
                    data-active={isOutroActive}
                    data-narrow={isNarrow}
                    style={{ width: `${outroPct}%` }}
                >
                    {outroLabel && (
                        <span className="tpe-main-scrubber-seg-label" data-narrow={isNarrow}>
                            {outroLabel}
                        </span>
                    )}
                </div>
            );
        })()}
    </>
));
MainTimelineSegments.displayName = "MainTimelineSegments";

interface MainTimelineScrubberProps {
    duration: number;
    currentTime: number;
    liveClock?: LivePlaybackClock;
    isPlaying: boolean;
    sceneMarkers: SceneMarker[];
    keyframes?: VideoKeyframe[];
    outroDuration?: number;
    enableOutro?: boolean;
    showKeyframesLane?: boolean;
    clipDuration?: number;
    hookDuration?: number;
    hookOffset?: number;
    rehookDuration?: number;
    rehookOffset?: number;
    setupOffset?: number;
    showHookHandles?: boolean;
    onChangeHookOffset?: (offset: number) => void;
    onPreviewHook?: () => void;
    onChangeRehookOffset?: (offset: number) => void;
    onPreviewRehook?: () => void;
    onHookDragStart?: () => void;
    onHookDragEnd?: (target: "hook" | "rehook", moved: boolean) => void;
    onScrubStart: () => void;
    onScrubMove: (time: number) => void;
    onScrubEnd: (time: number) => void;
    onJumpToTime: (time: number, side?: 'pre' | 'post') => void;
}

/** 2027 NLE-style master timeline scrubber with fused draggable Hook/Re-Hook handles, hover timecode, vertical playhead, and clickable keyframes. */
export const MainTimelineScrubber: React.FC<MainTimelineScrubberProps> = React.memo(({
    duration,
    currentTime,
    liveClock,
    isPlaying,
    sceneMarkers,
    keyframes = [],
    outroDuration = 5,
    enableOutro = false,
    showKeyframesLane = true,
    clipDuration = 0,
    hookDuration = 0,
    hookOffset = 0,
    rehookDuration = 0,
    rehookOffset = 0,
    setupOffset = 0,
    showHookHandles = false,
    onChangeHookOffset,
    onPreviewHook,
    onChangeRehookOffset,
    onPreviewRehook,
    onHookDragStart,
    onHookDragEnd,
    onScrubStart,
    onScrubMove,
    onScrubEnd,
    onJumpToTime,
}) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const sweepRef = useRef<HTMLDivElement>(null);
    const needleRailRef = useRef<HTMLDivElement>(null);
    const hoverWrapRef = useRef<HTMLDivElement>(null);
    const hoverPillRef = useRef<HTMLDivElement>(null);
    const dragRectRef = useRef<DOMRect | null>(null);
    const lastScrubTimeRef = useRef<number | null>(null);
    const activePointerIdRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);
    const dragTargetRef = useRef<"hook" | "rehook" | null>(null);
    const handleDragCleanupRef = useRef<((notifyEnd?: boolean) => void) | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragTarget, setDragTarget] = useState<"hook" | "rehook" | null>(null);

    const safeDuration = Math.max(duration, 0.1);
    const pct = clamp((currentTime / safeDuration) * 100, 0, 100);
    const outroPct = enableOutro && duration > 0 ? Math.min(25, (outroDuration / safeDuration) * 100) : 0;
    const sceneEndPct = 100 - outroPct;

    const latestRef = useRef({ pct, currentTime, onScrubEnd });
    useLayoutEffect(() => {
        latestRef.current = { pct, currentTime, onScrubEnd };
    });

    useEffect(() => () => {
        handleDragCleanupRef.current?.(true);
        if (isDraggingRef.current) {
            isDraggingRef.current = false;
            activePointerIdRef.current = null;
            latestRef.current.onScrubEnd(lastScrubTimeRef.current ?? latestRef.current.currentTime);
        }
    }, []);

    const paintPlayhead = (nextPct: number) => {
        if (sweepRef.current) sweepRef.current.style.transform = `scaleX(${nextPct / 100})`;
        if (needleRailRef.current) needleRailRef.current.style.transform = `translate3d(${nextPct}%, 0, 0)`;
    };

    // Drive master playhead needle + progress sweep at native 120Hz/144Hz via GPU transforms (0 React renders)
    useEffect(() => {
        if (!isPlaying || isDragging || !liveClock) return;
        let lastPct = NaN;
        const applyTime = (t: number) => {
            const nextPct = clamp((t / safeDuration) * 100, 0, 100);
            if (!Number.isNaN(lastPct) && Math.abs(nextPct - lastPct) < 0.015) return;
            lastPct = nextPct;
            paintPlayhead(nextPct);
        };
        applyTime(liveClock.getTime());
        const unsub = liveClock.subscribe((frame) => applyTime(frame.time));
        return () => {
            unsub();
            paintPlayhead(latestRef.current.pct);
        };
    }, [isPlaying, isDragging, liveClock, safeDuration]);

    const updateHoverDom = (nextPct: number, time: number, mode: "scrub" | "hook" | "rehook" = "scrub") => {
        const wrap = hoverWrapRef.current;
        const pill = hoverPillRef.current;
        if (!wrap || !pill) return;
        wrap.style.visibility = "visible";
        wrap.style.transform = `translate3d(${clamp(nextPct, 4, 96)}%, 0, 0)`;
        const accent = mode === "rehook" ? "var(--ui-indicator)" : "var(--ui-accent)";
        pill.style.borderColor = accent;
        pill.style.color = accent;
        let prefix = "";
        if (mode === "hook") {
            prefix = "HOOK ";
        } else if (mode === "rehook") {
            prefix = "RE-HOOK ";
        } else if (outroPct > 0 && nextPct >= 100 - outroPct) {
            prefix = `${String(sceneMarkers.length + 1).padStart(2, '0')}. OUTRO • `;
        } else {
            for (let i = sceneMarkers.length - 1; i >= 0; i--) {
                if (nextPct >= sceneMarkers[i]!.percent) {
                    prefix = sceneMarkers[i]!.label ? `${sceneMarkers[i]!.label} • ` : "";
                    break;
                }
            }
        }
        const label = `${prefix}${formatTimecode(time)}`;
        if (pill.firstChild) pill.firstChild.nodeValue = label;
        else pill.textContent = label;
    };

    const hideHoverDom = () => {
        if (hoverWrapRef.current) hoverWrapRef.current.style.visibility = "hidden";
    };

    const preSetupDur = hookDuration + rehookDuration;
    const getHandleTimelinePos = (sourceOffset: number) =>
        preSetupDur + Math.max(0, sourceOffset - setupOffset);
    const hookMax = Math.max(0, clipDuration - hookDuration);
    const hookLeftPct = safeDuration > 0 ? clamp((getHandleTimelinePos(hookOffset) / safeDuration) * 100, 0, sceneEndPct) : 0;
    const hookWidthPct = safeDuration > 0 ? Math.min(sceneEndPct - hookLeftPct, (hookDuration / safeDuration) * 100) : 0;

    const rehookMax = Math.max(0, clipDuration - rehookDuration);
    const rehookLeftPct = safeDuration > 0 ? clamp((getHandleTimelinePos(rehookOffset) / safeDuration) * 100, 0, sceneEndPct) : 0;
    const rehookWidthPct = safeDuration > 0 ? Math.min(sceneEndPct - rehookLeftPct, (rehookDuration / safeDuration) * 100) : 0;

    const timeAtClientX = (clientX: number, maxSec = safeDuration) => {
        const rect = dragRectRef.current ?? trackRef.current?.getBoundingClientRect();
        if (!rect) return { pct: 0, time: 0 };
        const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const snapped = Math.round(ratio * maxSec * 100) / 100;
        return { pct: ratio * 100, time: clamp(snapped, 0, maxSec) };
    };

    const isOutroActive = outroPct > 0 && pct >= 100 - outroPct;
    const activeSegIdx = isOutroActive
        ? -1
        : sceneMarkers.findIndex((m, idx) => {
            const nextPct = sceneMarkers[idx + 1]?.percent ?? (outroPct > 0 ? 100 - outroPct : 100);
            return pct >= m.percent && (pct < nextPct || (outroPct === 0 && idx === sceneMarkers.length - 1 && pct === 100));
        });

    const cancelTrackDrag = (pointerId?: number) => {
        if (!isDraggingRef.current) return;
        if (pointerId !== undefined && activePointerIdRef.current !== null && pointerId !== activePointerIdRef.current) return;
        isDraggingRef.current = false;
        activePointerIdRef.current = null;
        setIsDragging(false);
        const finalTime = lastScrubTimeRef.current ?? currentTime;
        dragRectRef.current = null;
        lastScrubTimeRef.current = null;
        hideHoverDom();
        onScrubEnd(finalTime);
    };

    const startHandleDrag = (e: React.PointerEvent<HTMLButtonElement>, target: "hook" | "rehook") => {
        if (!isPrimaryPointer(e) || dragTargetRef.current || isDraggingRef.current) return;
        e.stopPropagation();
        e.preventDefault();
        const handleEl = e.currentTarget;
        const activePointerId = e.pointerId;
        safeSetPointerCapture(handleEl, activePointerId);
        dragTargetRef.current = target;
        setDragTarget(target);
        onHookDragStart?.();
        const startX = e.clientX;
        const trackWidth = Math.max(1, trackRef.current?.getBoundingClientRect().width ?? 1);
        const startOffset = target === "hook" ? hookOffset : rehookOffset;
        const maxOff = target === "hook" ? hookMax : rehookMax;
        let lastSent = startOffset;
        let moved = false;
        let finished = false;

        const onMove = (ev: PointerEvent) => {
            if (ev.pointerId !== activePointerId || clipDuration <= 0) return;
            if (Math.abs(ev.clientX - startX) > 2) moved = true;
            const deltaRatio = (ev.clientX - startX) / trackWidth;
            const next = clamp(Math.round((startOffset + deltaRatio * safeDuration) * 10) / 10, 0, maxOff);
            if (next !== lastSent) {
                lastSent = next;
                if (target === "hook") onChangeHookOffset?.(next);
                else onChangeRehookOffset?.(next);
                updateHoverDom((getHandleTimelinePos(next) / safeDuration) * 100, next, target);
            }
        };

        const cleanup = (notifyEnd = false) => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            handleEl.removeEventListener("lostpointercapture", onLostCapture);
            handleDragCleanupRef.current = null;
            dragTargetRef.current = null;
            if (notifyEnd && !finished) {
                finished = true;
                onHookDragEnd?.(target, moved);
            }
        };

        const finishDrag = (didMove: boolean) => {
            if (finished) return;
            finished = true;
            cleanup(false);
            safeReleasePointerCapture(handleEl, activePointerId);
            setDragTarget(null);
            hideHoverDom();
            if (onHookDragEnd) {
                onHookDragEnd(target, didMove);
            } else if (!didMove) {
                if (target === "hook") onPreviewHook?.();
                else onPreviewRehook?.();
            }
        };

        const onCancel = (ev: PointerEvent) => { if (ev.pointerId === activePointerId) finishDrag(moved); };
        const onUp = (ev: PointerEvent) => { if (ev.pointerId === activePointerId) finishDrag(moved); };
        const onLostCapture = () => finishDrag(moved);

        handleDragCleanupRef.current?.(false);
        handleDragCleanupRef.current = cleanup;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        handleEl.addEventListener("lostpointercapture", onLostCapture);
    };

    const handleItems = showHookHandles && clipDuration > 0
        ? [
            {
                role: "hook" as const,
                label: "01. Hook",
                offset: hookOffset,
                maxOff: hookMax,
                leftPct: hookLeftPct,
                widthPct: hookWidthPct,
                onChange: onChangeHookOffset,
                onPreview: onPreviewHook,
            },
            ...(rehookDuration > 0 ? [{
                role: "rehook" as const,
                label: "02. Re-Hook",
                offset: rehookOffset,
                maxOff: rehookMax,
                leftPct: rehookLeftPct,
                widthPct: rehookWidthPct,
                onChange: onChangeRehookOffset,
                onPreview: onPreviewRehook,
            }] : []),
        ]
        : [];

    const hasHandles = handleItems.length > 0;

    return (
        <div dir="ltr" className="tpe-main-scrubber-wrap" data-handles={hasHandles}>
            <div
                ref={trackRef}
                className="tpe-scrubber tpe-main-scrubber"
                data-kf-lane={showKeyframesLane}
                role="slider"
                aria-label="Master timeline scrubber"
                aria-orientation="horizontal"
                draggable={false}
                aria-valuemin={0}
                aria-valuemax={Math.round(safeDuration * 10) / 10}
                aria-valuenow={Math.round(currentTime * 10) / 10}
                aria-valuetext={`${formatTimecode(currentTime)} of ${formatTimecode(safeDuration)}`}
                tabIndex={0}
                onKeyDown={(e) => {
                    const step = e.shiftKey ? 5 : 1;
                    const live = isPlaying && liveClock ? clamp(liveClock.getTime(), 0, safeDuration) : currentTime;
                    let next: number | null = null;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(safeDuration, live + step);
                    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(0, live - step);
                    else if (e.key === 'Home') next = 0;
                    else if (e.key === 'End') next = safeDuration;
                    if (next === null) return;
                    e.preventDefault();
                    if (Math.abs(next - live) > 0.001) onJumpToTime(next);
                }}
                onPointerEnter={() => {
                    dragRectRef.current = trackRef.current?.getBoundingClientRect() ?? null;
                }}
                onPointerDown={(e) => {
                    if (!isPrimaryPointer(e) || isDraggingRef.current || dragTargetRef.current) return;
                    safeSetPointerCapture(e.currentTarget, e.pointerId);
                    activePointerIdRef.current = e.pointerId;
                    dragRectRef.current = trackRef.current?.getBoundingClientRect() ?? null;
                    isDraggingRef.current = true;
                    setIsDragging(true);
                    onScrubStart();
                    const next = timeAtClientX(e.clientX);
                    lastScrubTimeRef.current = next.time;
                    onScrubMove(next.time);
                    updateHoverDom(next.pct, next.time);
                }}
                onPointerMove={(e) => {
                    if (dragTarget) return;
                    if (!isDraggingRef.current && e.pointerType !== "mouse") return;
                    if (isDraggingRef.current && e.pointerId !== activePointerIdRef.current) return;
                    const next = timeAtClientX(e.clientX);
                    updateHoverDom(next.pct, next.time);
                    if (isDraggingRef.current && next.time !== lastScrubTimeRef.current) {
                        lastScrubTimeRef.current = next.time;
                        onScrubMove(next.time);
                    }
                }}
                onPointerUp={(e) => {
                    if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return;
                    isDraggingRef.current = false;
                    activePointerIdRef.current = null;
                    safeReleasePointerCapture(e.currentTarget, e.pointerId);
                    setIsDragging(false);
                    const next = timeAtClientX(e.clientX);
                    dragRectRef.current = null;
                    lastScrubTimeRef.current = null;
                    if (e.pointerType !== "mouse") hideHoverDom();
                    onScrubEnd(next.time);
                }}
                onPointerCancel={(e) => cancelTrackDrag(e.pointerId)}
                onLostPointerCapture={() => cancelTrackDrag()}
                onMouseLeave={() => { if (!isDraggingRef.current && !dragTarget) { dragRectRef.current = null; hideHoverDom(); } }}
            >
                {/* Zero-render hover & drag tooltip driven via GPU translate3d ref */}
                <div ref={hoverWrapRef} className="tpe-main-scrubber-hover-wrap">
                    <div ref={hoverPillRef} className="tpe-main-scrubber-hover-pill" />
                </div>

                {/* Top Lane: Dedicated Keyframe Rail (visible when KEYFRAMES drawer is open) */}
                {showKeyframesLane && (
                    <div className="tpe-main-scrubber-kf-lane">
                        <TimelineKeyframeTrack keyframes={keyframes} rangeStart={0} rangeDuration={safeDuration} currentTime={currentTime} isPlaying={isPlaying} size={10} zIndex={4} onJump={onJumpToTime} />
                    </div>
                )}

                {/* Main Lane: Segmented Angle-Card Blocks */}
                <div className="tpe-main-scrubber-rail">
                    <MainTimelineSegments sceneMarkers={sceneMarkers} outroPct={outroPct} activeSegIdx={activeSegIdx} isOutroActive={isOutroActive} />

                    {/* Hook / Re-Hook Source Clip Span Highlights (GPU translate3d + scaleX) */}
                    {handleItems.map((h) => (
                        <div
                            key={h.role}
                            className="tpe-main-scrubber-span"
                            data-role={h.role}
                            data-dragging={dragTarget === h.role}
                            style={{ transform: `translate3d(${h.leftPct}%, 0, 0) scaleX(${h.widthPct / 100})` }}
                        />
                    ))}

                    {/* Played Progress Sweep (GPU scaleX) */}
                    <div
                        ref={sweepRef}
                        className="tpe-main-scrubber-sweep"
                        data-active={isPlaying || isDragging}
                        style={{ transform: `scaleX(${pct / 100})` }}
                    />
                </div>

                <TimelinePlayheadNeedle railRef={needleRailRef} pct={pct} active={isPlaying || isDragging} height={showKeyframesLane ? 42 : 26} width={2.5} zIndex={6} />
            </div>

            {/* Fused draggable Hook & Re-Hook handles below the timeline rail (GPU translate3d) */}
            {handleItems.map((h) => (
                <div
                    key={h.role}
                    className="tpe-main-scrubber-handle-rail"
                    data-dragging={dragTarget === h.role}
                    style={{ transform: `translate3d(${clamp(h.leftPct, 2, 98)}%, 0, 0)` }}
                >
                    <button
                        type="button"
                        role="slider"
                        aria-valuemin={0}
                        aria-valuemax={Math.round(h.maxOff * 10) / 10}
                        aria-valuenow={Math.round(h.offset * 10) / 10}
                        aria-valuetext={formatTimecode(h.offset)}
                        draggable={false}
                        aria-label={`${h.label} in-point at ${formatTimecode(h.offset)}. Drag or press arrow keys to adjust, Enter to preview.`}
                        onPointerDown={(e) => startHandleDrag(e, h.role)}
                        onKeyDown={(e) => {
                            if (isActivationKey(e.key)) {
                                e.preventDefault();
                                e.stopPropagation();
                                h.onPreview?.();
                                return;
                            }
                            const delta = e.shiftKey ? 1 : 0.1;
                            if (e.key === "ArrowRight" || e.key === "ArrowUp") {
                                e.preventDefault();
                                e.stopPropagation();
                                const next = clamp(Math.round((h.offset + delta) * 10) / 10, 0, h.maxOff);
                                if (next !== h.offset) h.onChange?.(next);
                            } else if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
                                e.preventDefault();
                                e.stopPropagation();
                                const next = clamp(Math.round((h.offset - delta) * 10) / 10, 0, h.maxOff);
                                if (next !== h.offset) h.onChange?.(next);
                            }
                        }}
                        title={`Drag to move ${h.label} in-point (${formatTimecode(h.offset)}) or click to preview`}
                        className="tpe-main-scrubber-handle-btn"
                        data-role={h.role}
                        data-dragging={dragTarget === h.role}
                    >
                        <HookGlyph role={h.role} />
                    </button>
                </div>
            ))}
        </div>
    );
});
MainTimelineScrubber.displayName = "MainTimelineScrubber";
