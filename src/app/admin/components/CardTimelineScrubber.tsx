"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { VideoKeyframe, formatTimecode, clamp } from "@/types/news";
import { TimelineKeyframeTrack, TimelinePlayheadNeedle } from "./TimelineMarkers";
import { safeReleasePointerCapture } from "../utils/domUtils";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";

const cardScrubberShellStyle: React.CSSProperties = {
    position: "relative",
    padding: "3px 8px 4px",
    borderRadius: "6px",
    background: "rgba(0,0,0,0.28)",
    border: "1px solid var(--ui-border)",
    display: "flex",
    flexDirection: "column",
    gap: "1px",
};

const cardTimeRowStyle: React.CSSProperties = {
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    lineHeight: 1.1,
    pointerEvents: "none",
};

const cardTrackHitAreaStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "13px",
    display: "flex",
    alignItems: "center",
    cursor: "ew-resize",
    touchAction: "none",
};

const cardTrackRailStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "5px",
    borderRadius: "99px",
    background: "rgba(255,255,255,0.09)",
    overflow: "hidden",
};

const stopClickPropagation = (e: React.MouseEvent) => e.stopPropagation();

interface CardTimelineScrubberProps {
    sceneLabel: string;
    start: number;
    end?: number;
    duration: number;
    localTime: number;
    liveClock?: LivePlaybackClock;
    isSceneActive: boolean;
    isPlaying?: boolean;
    keyframes?: VideoKeyframe[];
    fadeInDur?: number;
    fadeOutDur?: number;
    onSeek: (time: number) => void;
    onScrubStart?: () => void;
    onScrubEnd?: (finalTime: number) => void;
}

/** Full-width NLE-style per-card timeline scrubber with vertical playhead, fade cues, keyframe diamonds, and 120Hz active timecode. */
export const CardTimelineScrubber: React.FC<CardTimelineScrubberProps> = React.memo(({
    sceneLabel,
    start,
    end,
    duration,
    localTime,
    liveClock,
    isSceneActive,
    isPlaying = false,
    keyframes = [],
    fadeInDur = 0,
    fadeOutDur = 0,
    onSeek,
    onScrubStart,
    onScrubEnd,
}) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLDivElement>(null);
    const needleRailRef = useRef<HTMLDivElement>(null);
    const timeLabelRef = useRef<HTMLSpanElement>(null);
    const dragRectRef = useRef<DOMRect | null>(null);
    const lastSentSeekRef = useRef<number | null>(null);
    const latestDragTimeRef = useRef<number | null>(null);
    const activePointerIdRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);

    const safeStart = Number.isFinite(start) ? Math.max(0, start) : 0;
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const resolvedEnd = end !== undefined && Number.isFinite(end) ? end : safeStart + safeDuration;
    const maxT = Math.max(safeStart, resolvedEnd - 0.05);
    const safeLocalTime = Number.isFinite(localTime) ? clamp(localTime, 0, safeDuration) : 0;
    const currentTime = safeStart + safeLocalTime;
    const pct = safeDuration > 0 ? clamp((safeLocalTime / safeDuration) * 100, 0, 100) : 0;
    const durLabel = safeDuration.toFixed(1);

    const paintDom = useCallback((loc: number, durStr: string) => {
        const clampedLoc = clamp(loc, 0, safeDuration);
        const nextPct = safeDuration > 0 ? clamp((clampedLoc / safeDuration) * 100, 0, 100) : 0;
        if (fillRef.current) fillRef.current.style.transform = `scaleX(${nextPct / 100})`;
        if (needleRailRef.current) needleRailRef.current.style.transform = `translate3d(${nextPct}%, 0, 0)`;
        const labelEl = timeLabelRef.current;
        if (labelEl) {
            const nextLabel = `${formatTimecode(clampedLoc)} / ${durStr}s`;
            if (labelEl.firstChild) labelEl.firstChild.nodeValue = nextLabel;
            else labelEl.textContent = nextLabel;
        }
    }, [safeDuration]);

    const safeLocalTimeRef = useRef(safeLocalTime);
    useEffect(() => {
        safeLocalTimeRef.current = safeLocalTime;
    }, [safeLocalTime]);

    // Glide active scene card scrubber needle, fill bar, and timestamp at native 120Hz (0 React renders)
    useEffect(() => {
        if (!isSceneActive || !isPlaying || isDragging || !liveClock || safeDuration <= 0) return;
        let lastPct = NaN;
        let lastLabel = "";
        const applyTime = (t: number) => {
            const loc = clamp(t - safeStart, 0, safeDuration);
            const nextPct = clamp((loc / safeDuration) * 100, 0, 100);
            if (Number.isNaN(lastPct) || Math.abs(nextPct - lastPct) >= 0.02) {
                lastPct = nextPct;
                if (fillRef.current) fillRef.current.style.transform = `scaleX(${nextPct / 100})`;
                if (needleRailRef.current) needleRailRef.current.style.transform = `translate3d(${nextPct}%, 0, 0)`;
            }
            const nextLabel = `${formatTimecode(loc)} / ${durLabel}s`;
            if (nextLabel !== lastLabel) {
                lastLabel = nextLabel;
                const el = timeLabelRef.current;
                if (el) {
                    if (el.firstChild) el.firstChild.nodeValue = nextLabel;
                    else el.textContent = nextLabel;
                }
            }
        };
        applyTime(liveClock.getTime());
        const unsubscribe = liveClock.subscribe((frame) => applyTime(frame.time));
        return () => {
            unsubscribe();
            // Reconcile imperatively mutated DOM back to React's committed localTime when stopping or switching scenes
            paintDom(safeLocalTimeRef.current, durLabel);
        };
    }, [isSceneActive, isPlaying, isDragging, liveClock, safeStart, safeDuration, durLabel, paintDom]);

    const fadeInPct = safeDuration > 0 && fadeInDur > 0 ? clamp((fadeInDur / safeDuration) * 100, 3, 18) : 0;
    const fadeOutPct = safeDuration > 0 && fadeOutDur > 0 ? clamp((fadeOutDur / safeDuration) * 100, 3, 18) : 0;

    const computeTimeAtClientX = (clientX: number): number | null => {
        const rect = dragRectRef.current ?? trackRef.current?.getBoundingClientRect();
        if (!rect || safeDuration <= 0) return null;
        const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const raw = safeStart + ratio * safeDuration;
        return Math.round(clamp(raw, safeStart, maxT) * 100) / 100;
    };

    const scrubAtClientX = (clientX: number) => {
        const snapped = computeTimeAtClientX(clientX);
        if (snapped === null) return;
        latestDragTimeRef.current = snapped;
        paintDom(snapped - safeStart, durLabel);

        if (snapped !== lastSentSeekRef.current) {
            lastSentSeekRef.current = snapped;
            onSeek(snapped);
        }
    };

    const finishDrag = (finalTime: number) => {
        activePointerIdRef.current = null;
        setIsDragging(false);
        dragRectRef.current = null;
        const prevSent = lastSentSeekRef.current;
        lastSentSeekRef.current = null;
        latestDragTimeRef.current = null;
        if (onScrubEnd) {
            onScrubEnd(finalTime);
        } else if (finalTime !== prevSent) {
            onSeek(finalTime);
        }
    };

    const handleCancelDrag = (e?: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingRef.current) return;
        if (e && activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
        isDraggingRef.current = false;
        finishDrag(latestDragTimeRef.current ?? currentTime);
    };

    const handleJumpKeyframe = useCallback(
        (t: number) => onSeek(clamp(t, safeStart, maxT)),
        [onSeek, safeStart, maxT]
    );

    return (
        <div
            onClick={stopClickPropagation}
            style={cardScrubberShellStyle}
        >
            <div style={cardTimeRowStyle}>
                <span
                    ref={timeLabelRef}
                    className="tpe-tabular-nums"
                    style={{
                        fontSize: "8.5px",
                        fontFamily: "monospace",
                        fontWeight: 800,
                        letterSpacing: "0.02em",
                        color: isSceneActive || isDragging ? "var(--ui-accent)" : "var(--ui-text-dim)",
                        whiteSpace: "nowrap",
                    }}
                >
                    {`${formatTimecode(safeLocalTime)} / ${durLabel}s`}
                </span>
            </div>

            <div
                ref={trackRef}
                className="tpe-scrubber"
                role="slider"
                aria-label={`${sceneLabel} timeline scrubber`}
                aria-orientation="horizontal"
                draggable={false}
                aria-valuemin={safeStart}
                aria-valuemax={resolvedEnd}
                aria-valuenow={Math.round(currentTime * 10) / 10}
                aria-valuetext={`${formatTimecode(safeLocalTime)} of ${durLabel}s`}
                tabIndex={0}
                onKeyDown={(e) => {
                    const step = e.shiftKey ? 2 : 0.5;
                    const liveCurrent = isSceneActive && isPlaying && liveClock
                        ? clamp(liveClock.getTime(), safeStart, maxT)
                        : currentTime;
                    let next: number | null = null;
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                        next = clamp(liveCurrent + step, safeStart, maxT);
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                        next = clamp(liveCurrent - step, safeStart, maxT);
                    } else if (e.key === 'Home') {
                        next = safeStart;
                    } else if (e.key === 'End') {
                        next = maxT;
                    }
                    if (next !== null) {
                        e.preventDefault();
                        if (Math.abs(next - liveCurrent) > 0.001) onSeek(next);
                    }
                }}
                onPointerDown={(e) => {
                    if (e.pointerType === "mouse" && e.button !== 0) return;
                    if (isDraggingRef.current) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    activePointerIdRef.current = e.pointerId;
                    dragRectRef.current = trackRef.current?.getBoundingClientRect() ?? null;
                    lastSentSeekRef.current = null;
                    latestDragTimeRef.current = null;
                    isDraggingRef.current = true;
                    setIsDragging(true);
                    onScrubStart?.();
                    scrubAtClientX(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return;
                    scrubAtClientX(e.clientX);
                }}
                onPointerUp={(e) => {
                    if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return;
                    isDraggingRef.current = false;
                    safeReleasePointerCapture(e.currentTarget, e.pointerId);
                    const finalTime = computeTimeAtClientX(e.clientX) ?? latestDragTimeRef.current ?? currentTime;
                    finishDrag(finalTime);
                }}
                onPointerCancel={handleCancelDrag}
                onLostPointerCapture={() => handleCancelDrag()}
                title={`Scrub inside ${sceneLabel} (${formatTimecode(safeStart)} – ${formatTimecode(resolvedEnd)})`}
                style={cardTrackHitAreaStyle}
            >
                {/* Full-width track rail */}
                <div style={cardTrackRailStyle}>
                    {fadeInPct > 0 && (
                        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${fadeInPct}%`, background: "linear-gradient(to right, rgba(168,85,247,0.45), transparent)" }} />
                    )}
                    {fadeOutPct > 0 && (
                        <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${fadeOutPct}%`, background: "linear-gradient(to left, rgba(168,85,247,0.45), transparent)" }} />
                    )}
                    <div
                        ref={fillRef}
                        style={{
                            width: "100%",
                            height: "100%",
                            transform: `scaleX(${pct / 100})`,
                            transformOrigin: "left center",
                            willChange: (isSceneActive && isPlaying) || isDragging ? "transform" : undefined,
                            background: isSceneActive ? "var(--ui-accent)" : "oklch(from var(--ui-accent) l c h / 0.45)",
                            borderRadius: "99px",
                        }}
                    />
                </div>

                {/* Keyframe diamonds (with Focus Isolation + Paired PRE/POST reveal) */}
                <TimelineKeyframeTrack
                    keyframes={keyframes}
                    rangeStart={safeStart}
                    rangeDuration={safeDuration}
                    currentTime={currentTime}
                    isPlaying={isPlaying}
                    onJump={handleJumpKeyframe}
                />

                <TimelinePlayheadNeedle
                    railRef={needleRailRef}
                    pct={pct}
                    active={isSceneActive || isDragging}
                    height={isDragging ? 13 : 11}
                    zIndex={3}
                />
            </div>
        </div>
    );
});

CardTimelineScrubber.displayName = "CardTimelineScrubber";
