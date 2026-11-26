"use client";

import React, { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import { VideoKeyframe, formatTimecode, clamp } from "@/types/news";
import { TimelineKeyframeTrack, TimelinePlayheadNeedle } from "./TimelineMarkers";
import { isPrimaryPointer, safeReleasePointerCapture, safeSetPointerCapture, stopEventPropagation } from "../utils/domUtils";
import type { LivePlaybackClock } from "../utils/livePlaybackClock";

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
    onScrubMove?: (time: number) => void;
    onScrubEnd?: (finalTime: number) => void;
}

/** Full-width per-card timeline scrubber with playhead, fade cues, keyframe diamonds, and 120Hz active timecode. */
export const CardTimelineScrubber: React.FC<CardTimelineScrubberProps> = React.memo(({
    sceneLabel, start, end, duration, localTime, liveClock, isSceneActive,
    isPlaying = false, keyframes = [], fadeInDur = 0, fadeOutDur = 0, onSeek, onScrubStart, onScrubMove, onScrubEnd,
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

    const paintDom = useCallback((loc: number, lastState?: { pct: number; label: string }) => {
        const clampedLoc = clamp(loc, 0, safeDuration);
        const nextPct = safeDuration > 0 ? clamp((clampedLoc / safeDuration) * 100, 0, 100) : 0;
        if (!lastState || Number.isNaN(lastState.pct) || Math.abs(nextPct - lastState.pct) >= 0.02) {
            if (lastState) lastState.pct = nextPct;
            if (fillRef.current) fillRef.current.style.transform = `scaleX(${nextPct / 100})`;
            if (needleRailRef.current) needleRailRef.current.style.transform = `translate3d(${nextPct}%, 0, 0)`;
        }
        const nextLabel = `${formatTimecode(clampedLoc)} / ${durLabel}s`;
        if (!lastState || nextLabel !== lastState.label) {
            if (lastState) lastState.label = nextLabel;
            const el = timeLabelRef.current;
            if (el) {
                if (el.firstChild) el.firstChild.nodeValue = nextLabel;
                else el.textContent = nextLabel;
            }
        }
    }, [safeDuration, durLabel]);

    const onUnmountScrubEnd = useEffectEvent(() => {
        onScrubEnd?.(latestDragTimeRef.current ?? currentTime);
    });
    const onPlaybackStop = useEffectEvent(() => {
        if (!isDraggingRef.current) paintDom(safeLocalTime);
    });

    useEffect(() => () => {
        if (isDraggingRef.current) {
            isDraggingRef.current = false;
            activePointerIdRef.current = null;
            onUnmountScrubEnd();
        }
    }, []);

    // Glide active scene card scrubber needle, fill bar, and timestamp at native 120Hz (0 React renders)
    useEffect(() => {
        if (!isSceneActive || !isPlaying || isDragging || !liveClock || safeDuration <= 0) return;
        const lastState = { pct: NaN, label: "" };
        paintDom(liveClock.getTime() - safeStart, lastState);
        const unsubscribe = liveClock.subscribe((frame) => paintDom(frame.time - safeStart, lastState));
        return () => {
            unsubscribe();
            onPlaybackStop();
        };
    }, [isSceneActive, isPlaying, isDragging, liveClock, safeStart, safeDuration, paintDom]);

    const fadeInPct = safeDuration > 0 && fadeInDur > 0 ? clamp((fadeInDur / safeDuration) * 100, 3, 18) : 0;
    const fadeOutPct = safeDuration > 0 && fadeOutDur > 0 ? clamp((fadeOutDur / safeDuration) * 100, 3, 18) : 0;

    const computeTimeAtClientX = (clientX: number): number | null => {
        const rect = dragRectRef.current ?? trackRef.current?.getBoundingClientRect();
        if (!rect || safeDuration <= 0) return null;
        const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        return Math.round(clamp(safeStart + ratio * safeDuration, safeStart, maxT) * 100) / 100;
    };

    const scrubAtClientX = (clientX: number) => {
        const snapped = computeTimeAtClientX(clientX);
        if (snapped === null) return;
        latestDragTimeRef.current = snapped;
        paintDom(snapped - safeStart);
        if (snapped !== lastSentSeekRef.current) {
            lastSentSeekRef.current = snapped;
            if (onScrubMove) onScrubMove(snapped);
            else onSeek(snapped);
        }
    };

    const finishDrag = (finalTime: number) => {
        activePointerIdRef.current = null;
        setIsDragging(false);
        dragRectRef.current = null;
        const prevSent = lastSentSeekRef.current;
        lastSentSeekRef.current = null;
        latestDragTimeRef.current = null;
        if (onScrubEnd) onScrubEnd(finalTime);
        else if (finalTime !== prevSent) onSeek(finalTime);
    };

    const handleCancelDrag = (e?: React.PointerEvent<HTMLDivElement>) => {
        if (!isDraggingRef.current) return;
        if (e && activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current) return;
        isDraggingRef.current = false;
        finishDrag(latestDragTimeRef.current ?? currentTime);
    };

    const handleJumpKeyframe = useCallback((t: number) => onSeek(clamp(t, safeStart, maxT)), [onSeek, safeStart, maxT]);

    return (
        <div onClick={stopEventPropagation} className="tpe-card-scrubber" dir="ltr">
            <div className="tpe-card-scrubber-time-row">
                <span ref={timeLabelRef} className="tpe-tabular-nums tpe-card-scrubber-time" data-active={isSceneActive || isDragging}>
                    {`${formatTimecode(safeLocalTime)} / ${durLabel}s`}
                </span>
            </div>

            <div
                ref={trackRef}
                className="tpe-scrubber tpe-card-scrubber-hit"
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
                    const live = isSceneActive && isPlaying && liveClock ? clamp(liveClock.getTime(), safeStart, maxT) : currentTime;
                    const next = e.key === "ArrowRight" || e.key === "ArrowUp" ? clamp(live + step, safeStart, maxT)
                        : e.key === "ArrowLeft" || e.key === "ArrowDown" ? clamp(live - step, safeStart, maxT)
                        : e.key === "Home" ? safeStart
                        : e.key === "End" ? maxT : null;
                    if (next === null) return;
                    e.preventDefault();
                    if (Math.abs(next - live) > 0.001) onSeek(next);
                }}
                onPointerDown={(e) => {
                    if (!isPrimaryPointer(e) || isDraggingRef.current) return;
                    safeSetPointerCapture(e.currentTarget, e.pointerId);
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
                    if (isDraggingRef.current && e.pointerId === activePointerIdRef.current) scrubAtClientX(e.clientX);
                }}
                onPointerUp={(e) => {
                    if (!isDraggingRef.current || e.pointerId !== activePointerIdRef.current) return;
                    isDraggingRef.current = false;
                    safeReleasePointerCapture(e.currentTarget, e.pointerId);
                    finishDrag(computeTimeAtClientX(e.clientX) ?? latestDragTimeRef.current ?? currentTime);
                }}
                onPointerCancel={handleCancelDrag}
                onLostPointerCapture={() => handleCancelDrag()}
                title={`Scrub inside ${sceneLabel} (${formatTimecode(safeStart)} – ${formatTimecode(resolvedEnd)})`}
            >
                <div className="tpe-card-scrubber-rail">
                    {fadeInPct > 0 && <div className="tpe-card-scrubber-fade" data-side="left" style={{ inlineSize: `${fadeInPct}%` }} />}
                    {fadeOutPct > 0 && <div className="tpe-card-scrubber-fade" data-side="right" style={{ inlineSize: `${fadeOutPct}%` }} />}
                    <div
                        ref={fillRef}
                        className="tpe-card-scrubber-fill"
                        data-active={isSceneActive}
                        data-live={(isSceneActive && isPlaying) || isDragging}
                        style={{ transform: `scaleX(${pct / 100})` }}
                    />
                </div>
                <TimelineKeyframeTrack keyframes={keyframes} rangeStart={safeStart} rangeDuration={safeDuration} currentTime={currentTime} isPlaying={isPlaying} onJump={handleJumpKeyframe} />
                <TimelinePlayheadNeedle railRef={needleRailRef} pct={pct} active={isSceneActive || isDragging} height={isDragging ? 13 : 11} zIndex={3} />
            </div>
        </div>
    );
});

CardTimelineScrubber.displayName = "CardTimelineScrubber";
