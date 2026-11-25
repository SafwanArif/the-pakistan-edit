"use client";

import React, { useEffect, useRef, useState } from "react";
import { VideoKeyframe, formatTimecode, clamp } from "../../../types/news";
import { HookGlyph } from "./ClipOffsetTrimmer";
import { TimelineKeyframeTrack, TimelinePlayheadNeedle } from "./TimelineMarkers";
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
            const isActiveSeg = idx === activeSegIdx;
            const roleColor = m.color || "var(--ui-accent)";
            const displayLabel = segW >= 8 ? m.label : (segW >= 1.2 ? m.shortLabel : undefined);
            return (
                <div
                    key={`${m.id}-${idx}`}
                    style={{
                        position: "absolute",
                        left: `${startPct}%`,
                        width: `${segW}%`,
                        top: 0,
                        bottom: 0,
                        borderRight: idx < sceneMarkers.length - 1 || outroPct > 0 ? "2px solid #050505" : "none",
                        borderTop: `2.5px solid ${roleColor}`,
                        background: `color-mix(in oklch, ${roleColor} ${isActiveSeg ? "22%" : "9%"}, transparent)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: segW < 8 ? "center" : "flex-start",
                        paddingInline: segW < 8 ? "0px" : "5px",
                        overflow: "hidden",
                        pointerEvents: "none",
                    }}
                >
                    {displayLabel && (
                        <span style={{ fontSize: segW < 8 ? "7px" : "7.5px", fontWeight: 900, letterSpacing: segW < 8 ? "0" : "0.05em", color: roleColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: segW < 8 ? "clip" : "ellipsis" }}>
                            {displayLabel}
                        </span>
                    )}
                </div>
            );
        })}

        {outroPct > 0 && (() => {
            const outroColor = "var(--ui-outro)";
            const outroNum = String(sceneMarkers.length + 1).padStart(2, "0");
            const outroLabel = outroPct >= 8 ? `${outroNum}. OUTRO` : (outroPct >= 1.2 ? outroNum : undefined);
            return (
                <div
                    style={{
                        position: "absolute",
                        right: 0,
                        top: 0,
                        bottom: 0,
                        width: `${outroPct}%`,
                        borderTop: `2.5px solid ${outroColor}`,
                        background: `color-mix(in oklch, ${outroColor} ${isOutroActive ? "22%" : "9%"}, transparent)`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: outroPct < 8 ? "center" : "flex-start",
                        paddingInline: outroPct < 8 ? "0px" : "5px",
                        overflow: "hidden",
                        pointerEvents: "none",
                    }}
                >
                    {outroLabel && (
                        <span style={{ fontSize: outroPct < 8 ? "7px" : "7.5px", fontWeight: 900, letterSpacing: outroPct < 8 ? "0" : "0.05em", color: outroColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: outroPct < 8 ? "clip" : "ellipsis" }}>
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

/** 2027 NLE-style master timeline scrubber with fused draggable Hook/Re-Hook emoji handles, hover timecode, vertical playhead, and clickable keyframes. */
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
    const isDraggingRef = useRef(false);
    const handleDragCleanupRef = useRef<(() => void) | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragTarget, setDragTarget] = useState<"hook" | "rehook" | null>(null);

    useEffect(() => () => {
        handleDragCleanupRef.current?.();
    }, []);

    const safeDuration = Math.max(duration, 0.1);
    const pct = clamp((currentTime / safeDuration) * 100, 0, 100);
    const outroPct = enableOutro && duration > 0 ? Math.min(25, (outroDuration / safeDuration) * 100) : 0;
    const sceneEndPct = 100 - outroPct;

    // Drive master playhead needle + progress sweep at native 120Hz/144Hz via GPU transforms (0 React renders)
    useEffect(() => {
        if (!isPlaying || isDragging || !liveClock) return;
        let lastPct = NaN;
        const applyTime = (t: number) => {
            const nextPct = clamp((t / safeDuration) * 100, 0, 100);
            if (!Number.isNaN(lastPct) && Math.abs(nextPct - lastPct) < 0.015) return;
            lastPct = nextPct;
            if (sweepRef.current) sweepRef.current.style.transform = `scaleX(${nextPct / 100})`;
            if (needleRailRef.current) needleRailRef.current.style.transform = `translate3d(${nextPct}%, 0, 0)`;
        };
        applyTime(liveClock.getTime());
        return liveClock.subscribe((frame) => applyTime(frame.time));
    }, [isPlaying, isDragging, liveClock, safeDuration]);

    const updateHoverDom = (nextPct: number, time: number, mode: "scrub" | "hook" | "rehook" = "scrub") => {
        const wrap = hoverWrapRef.current;
        const pill = hoverPillRef.current;
        if (!wrap || !pill) return;
        wrap.style.visibility = "visible";
        wrap.style.transform = `translate3d(${Math.max(4, Math.min(96, nextPct))}%, 0, 0)`;
        const accent = mode === "rehook" ? "var(--ui-indicator)" : "var(--ui-accent)";
        pill.style.borderColor = accent;
        pill.style.color = accent;
        let prefix = "";
        if (mode === "hook") {
            prefix = "🪝 ";
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
        pill.textContent = `${prefix}${formatTimecode(time)}`;
    };

    const hideHoverDom = () => {
        if (hoverWrapRef.current) hoverWrapRef.current.style.visibility = "hidden";
    };

    const preSetupDur = hookDuration + rehookDuration;
    const getHandleTimelinePos = (sourceOffset: number) =>
        preSetupDur + Math.max(0, sourceOffset - setupOffset);
    const hookMax = Math.max(0, clipDuration - hookDuration);
    const hookTimelinePos = getHandleTimelinePos(hookOffset);
    const hookLeftPct = safeDuration > 0 ? clamp((hookTimelinePos / safeDuration) * 100, 0, sceneEndPct) : 0;
    const hookWidthPct = safeDuration > 0 ? Math.min(sceneEndPct - hookLeftPct, (hookDuration / safeDuration) * 100) : 0;

    const rehookMax = Math.max(0, clipDuration - rehookDuration);
    const rehookTimelinePos = getHandleTimelinePos(rehookOffset);
    const rehookLeftPct = safeDuration > 0 ? clamp((rehookTimelinePos / safeDuration) * 100, 0, sceneEndPct) : 0;
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
            return pct >= m.percent && pct < nextPct;
        });

    const startHandleDrag = (e: React.PointerEvent<HTMLButtonElement>, target: "hook" | "rehook") => {
        e.stopPropagation();
        e.preventDefault();
        const handleEl = e.currentTarget;
        const activePointerId = e.pointerId;
        handleEl.setPointerCapture(activePointerId);
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
                const nextTimelinePos = getHandleTimelinePos(next);
                updateHoverDom((nextTimelinePos / safeDuration) * 100, next, target);
            }
        };

        const cleanup = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onCancel);
            handleEl.removeEventListener("lostpointercapture", onLostCapture);
            handleDragCleanupRef.current = null;
        };

        const finishDrag = (didMove: boolean) => {
            if (finished) return;
            finished = true;
            cleanup();
            try {
                if (handleEl.hasPointerCapture(activePointerId)) {
                    handleEl.releasePointerCapture(activePointerId);
                }
            } catch {}
            setDragTarget(null);
            hideHoverDom();
            if (onHookDragEnd) {
                onHookDragEnd(target, didMove);
            } else if (!didMove) {
                if (target === "hook") onPreviewHook?.();
                else onPreviewRehook?.();
            }
        };

        const onCancel = (ev: PointerEvent) => {
            if (ev.pointerId !== activePointerId) return;
            finishDrag(moved);
        };
        const onUp = (ev: PointerEvent) => {
            if (ev.pointerId !== activePointerId) return;
            finishDrag(moved);
        };
        const onLostCapture = () => finishDrag(moved);

        handleDragCleanupRef.current?.();
        handleDragCleanupRef.current = cleanup;
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onCancel);
        handleEl.addEventListener("lostpointercapture", onLostCapture);
    };

    return (
        <div
            style={{
                position: "relative",
                width: "100%",
                paddingBottom: showHookHandles && clipDuration > 0 ? "14px" : "0px",
                touchAction: showHookHandles && clipDuration > 0 ? "none" : undefined,
            }}
        >
            <div
                ref={trackRef}
                className="tpe-scrubber"
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
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        onJumpToTime(Math.min(safeDuration, currentTime + step));
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        onJumpToTime(Math.max(0, currentTime - step));
                    } else if (e.key === 'Home') {
                        e.preventDefault();
                        onJumpToTime(0);
                    } else if (e.key === 'End') {
                        e.preventDefault();
                        onJumpToTime(safeDuration);
                    }
                }}
                onPointerEnter={() => {
                    dragRectRef.current = trackRef.current?.getBoundingClientRect() ?? null;
                }}
                onPointerDown={(e) => {
                    e.currentTarget.setPointerCapture(e.pointerId);
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
                    const next = timeAtClientX(e.clientX);
                    updateHoverDom(next.pct, next.time);
                    if (isDraggingRef.current && next.time !== lastScrubTimeRef.current) {
                        lastScrubTimeRef.current = next.time;
                        onScrubMove(next.time);
                    }
                }}
                onPointerUp={(e) => {
                    if (!isDraggingRef.current) return;
                    isDraggingRef.current = false;
                    try {
                        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                            e.currentTarget.releasePointerCapture(e.pointerId);
                        }
                    } catch {}
                    setIsDragging(false);
                    const next = timeAtClientX(e.clientX);
                    dragRectRef.current = null;
                    lastScrubTimeRef.current = null;
                    if (e.pointerType !== "mouse") hideHoverDom();
                    onScrubEnd(next.time);
                }}
                onPointerCancel={() => {
                    if (!isDraggingRef.current) return;
                    isDraggingRef.current = false;
                    setIsDragging(false);
                    const finalTime = lastScrubTimeRef.current ?? currentTime;
                    dragRectRef.current = null;
                    lastScrubTimeRef.current = null;
                    hideHoverDom();
                    onScrubEnd(finalTime);
                }}
                onLostPointerCapture={() => {
                    if (!isDraggingRef.current) return;
                    isDraggingRef.current = false;
                    setIsDragging(false);
                    const finalTime = lastScrubTimeRef.current ?? currentTime;
                    dragRectRef.current = null;
                    lastScrubTimeRef.current = null;
                    hideHoverDom();
                    onScrubEnd(finalTime);
                }}
                onMouseLeave={() => { if (!isDragging && !dragTarget) { dragRectRef.current = null; hideHoverDom(); } }}
                style={{
                    position: "relative",
                    width: "100%",
                    height: showKeyframesLane ? "38px" : "22px",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "flex-end",
                    gap: "2px",
                    cursor: "ew-resize",
                    touchAction: "none",
                    userSelect: "none",
                    transition: "height 0.14s ease",
                }}
            >
                {/* Zero-render hover & drag tooltip driven via GPU translate3d ref */}
                <div
                    ref={hoverWrapRef}
                    style={{
                        position: "absolute",
                        inset: 0,
                        visibility: "hidden",
                        transform: "translate3d(4%, 0, 0)",
                        willChange: "transform",
                        pointerEvents: "none",
                        zIndex: 8,
                    }}
                >
                    <div
                        ref={hoverPillRef}
                        style={{
                            position: "absolute",
                            left: 0,
                            top: "-20px",
                            transform: "translateX(-50%)",
                            padding: "1px 6px",
                            borderRadius: "4px",
                            background: "var(--ui-bg-popover)",
                            border: "1px solid var(--ui-accent)",
                            fontSize: "8.5px",
                            fontFamily: "monospace",
                            fontWeight: 800,
                            color: "var(--ui-accent)",
                            whiteSpace: "nowrap",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
                        }}
                    />
                </div>

                {/* Top Lane: Dedicated Keyframe Rail (visible when KEYFRAMES drawer is open) */}
                {showKeyframesLane && (
                    <div style={{ position: "relative", width: "100%", height: "14px", borderRadius: "4px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <TimelineKeyframeTrack keyframes={keyframes} rangeStart={0} rangeDuration={safeDuration} currentTime={currentTime} isPlaying={isPlaying} size={10} zIndex={4} onJump={onJumpToTime} />
                    </div>
                )}

                {/* Main Lane: Segmented Angle-Card Blocks */}
                <div style={{ position: "relative", width: "100%", height: "22px", borderRadius: "5px", background: "rgba(0,0,0,0.35)", overflow: "hidden", border: "1px solid rgba(255,255,255,0.08)" }}>
                    <MainTimelineSegments sceneMarkers={sceneMarkers} outroPct={outroPct} activeSegIdx={activeSegIdx} isOutroActive={isOutroActive} />

                    {/* Hook / Re-Hook Source Clip Span Highlights (GPU translate3d + scaleX) */}
                    {showHookHandles && clipDuration > 0 && (
                        <>
                            <div style={{ position: "absolute", left: 0, width: "100%", bottom: 0, height: "3px", transform: `translate3d(${hookLeftPct}%, 0, 0) scaleX(${hookWidthPct / 100})`, transformOrigin: "left center", willChange: dragTarget === "hook" ? "transform" : undefined, background: "var(--ui-accent)", opacity: 0.75, pointerEvents: "none" }} />
                            {rehookDuration > 0 && (
                                <div style={{ position: "absolute", left: 0, width: "100%", bottom: 0, height: "3px", transform: `translate3d(${rehookLeftPct}%, 0, 0) scaleX(${rehookWidthPct / 100})`, transformOrigin: "left center", willChange: dragTarget === "rehook" ? "transform" : undefined, background: "var(--ui-indicator)", opacity: 0.75, pointerEvents: "none" }} />
                            )}
                        </>
                    )}

                    {/* Played Progress Sweep (GPU scaleX) */}
                    <div ref={sweepRef} style={{ position: "absolute", inset: 0, transform: `scaleX(${pct / 100})`, transformOrigin: "left center", willChange: isPlaying || isDragging ? "transform" : undefined, background: "linear-gradient(90deg, oklch(from var(--ui-accent) l c h / 0.22), oklch(from var(--ui-accent) l c h / 0.35))", pointerEvents: "none" }} />
                </div>

                <TimelinePlayheadNeedle railRef={needleRailRef} pct={pct} active={isPlaying || isDragging} height={showKeyframesLane ? 42 : 26} width={2.5} zIndex={6} />
            </div>

            {/* Fused draggable Hook & Re-Hook emoji handles below the timeline rail (GPU translate3d) */}
            {showHookHandles && clipDuration > 0 && (
                <>
                    <div style={{ position: "absolute", left: 0, right: 0, bottom: "2px", height: "14px", transform: `translate3d(${Math.max(2, Math.min(98, hookLeftPct))}%, 0, 0)`, willChange: dragTarget === "hook" ? "transform" : undefined, pointerEvents: "none", zIndex: 6 }}>
                        <button
                            type="button"
                            draggable={false}
                            onPointerDown={(e) => startHandleDrag(e, "hook")}
                            title={`Drag to move 01. Hook in-point (${formatTimecode(hookOffset)}) or click to preview`}
                            style={{ position: "absolute", left: 0, bottom: 0, transform: "translateX(-60%)", background: "transparent", border: "none", padding: "6px 0", marginBottom: "-6px", fontSize: "12px", lineHeight: 1, cursor: dragTarget === "hook" ? "grabbing" : "grab", pointerEvents: "auto", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
                        >
                            <HookGlyph role="hook" />
                        </button>
                    </div>
                    {rehookDuration > 0 && (
                        <div style={{ position: "absolute", left: 0, right: 0, bottom: "2px", height: "14px", transform: `translate3d(${Math.max(2, Math.min(98, rehookLeftPct))}%, 0, 0)`, willChange: dragTarget === "rehook" ? "transform" : undefined, pointerEvents: "none", zIndex: 6 }}>
                            <button
                                type="button"
                                draggable={false}
                                onPointerDown={(e) => startHandleDrag(e, "rehook")}
                                title={`Drag to move 02. Re-Hook in-point (${formatTimecode(rehookOffset)}) or click to preview`}
                                style={{ position: "absolute", left: 0, bottom: 0, transform: "translateX(-40%)", background: "transparent", border: "none", padding: "6px 0", marginBottom: "-6px", fontSize: "12px", lineHeight: 1, cursor: dragTarget === "rehook" ? "grabbing" : "grab", pointerEvents: "auto", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
                            >
                                <HookGlyph role="rehook" />
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
});
MainTimelineScrubber.displayName = "MainTimelineScrubber";
