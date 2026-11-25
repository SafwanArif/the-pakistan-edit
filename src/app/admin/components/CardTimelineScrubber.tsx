"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { VideoKeyframe, formatTimecode, clamp } from "../../../types/news";
import { TimelineKeyframeTrack, TimelinePlayheadNeedle } from "./TimelineMarkers";
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

const cardTrackRailStyle: React.CSSProperties = {
    position: "relative",
    width: "100%",
    height: "5px",
    borderRadius: "99px",
    background: "rgba(255,255,255,0.09)",
    overflow: "hidden",
};

interface CardTimelineScrubberProps {
    sceneLabel: string;
    start: number;
    end: number;
    duration: number;
    localTime: number;
    liveClock?: LivePlaybackClock;
    isSceneActive: boolean;
    isPlaying?: boolean;
    keyframes?: VideoKeyframe[];
    fadeInDur?: number;
    fadeOutDur?: number;
    onSeek: (time: number) => void;
}

/** Full-width NLE-style per-card timeline scrubber with vertical playhead, fade cues, and hover/active timecode. */
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
}) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const fillRef = useRef<HTMLDivElement>(null);
    const needleRailRef = useRef<HTMLDivElement>(null);
    const timeLabelRef = useRef<HTMLSpanElement>(null);
    const dragRectRef = useRef<DOMRect | null>(null);
    const lastSentSeekRef = useRef<number | null>(null);
    const isDraggingRef = useRef(false);
    const [isDragging, setIsDragging] = useState(false);

    const currentTime = start + localTime;
    const pct = duration > 0 ? clamp((localTime / duration) * 100, 0, 100) : 0;

    // Glide active scene card scrubber needle, fill bar, and timestamp at native 120Hz (0 React renders)
    useEffect(() => {
        if (!isSceneActive || !isPlaying || isDragging || !liveClock || duration <= 0) return;
        let lastPct = NaN;
        let lastLabel = "";
        const durLabel = duration.toFixed(1);
        const applyTime = (t: number) => {
            const loc = clamp(t - start, 0, duration);
            const nextPct = clamp((loc / duration) * 100, 0, 100);
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
        return liveClock.subscribe((frame) => applyTime(frame.time));
    }, [isSceneActive, isPlaying, isDragging, liveClock, start, duration]);

    const fadeInPct = duration > 0 && fadeInDur > 0 ? clamp((fadeInDur / duration) * 100, 3, 18) : 0;
    const fadeOutPct = duration > 0 && fadeOutDur > 0 ? clamp((fadeOutDur / duration) * 100, 3, 18) : 0;

    const scrubAtClientX = (clientX: number) => {
        const rect = dragRectRef.current ?? trackRef.current?.getBoundingClientRect();
        if (!rect || duration <= 0) return;
        const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const maxT = Math.max(start, end - 0.05);
        const raw = start + ratio * duration;
        const snapped = Math.round(clamp(raw, start, maxT) * 100) / 100;
        if (snapped !== lastSentSeekRef.current) {
            lastSentSeekRef.current = snapped;
            onSeek(snapped);
        }
    };

    const handleJumpKeyframe = useCallback(
        (t: number) => onSeek(Math.min(Math.max(start, t), Math.max(start, end - 0.05))),
        [onSeek, start, end]
    );

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            style={cardScrubberShellStyle}
        >
            <div
                style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    alignItems: "center",
                    lineHeight: 1.1,
                    pointerEvents: "none",
                }}
            >
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
                    {`${formatTimecode(localTime)} / ${duration.toFixed(1)}s`}
                </span>
            </div>

            <div
                ref={trackRef}
                className="tpe-scrubber"
                role="slider"
                aria-label={`${sceneLabel} timeline scrubber`}
                aria-orientation="horizontal"
                draggable={false}
                aria-valuemin={start}
                aria-valuemax={end}
                aria-valuenow={Math.round(currentTime * 10) / 10}
                aria-valuetext={`${formatTimecode(localTime)} of ${duration.toFixed(1)}s`}
                tabIndex={0}
                onKeyDown={(e) => {
                    const step = e.shiftKey ? 2 : 0.5;
                    const maxT = Math.max(start, end - 0.05);
                    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        onSeek(Math.min(maxT, currentTime + step));
                    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
                        e.preventDefault();
                        onSeek(Math.max(start, currentTime - step));
                    } else if (e.key === 'Home') {
                        e.preventDefault();
                        onSeek(start);
                    } else if (e.key === 'End') {
                        e.preventDefault();
                        onSeek(maxT);
                    }
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dragRectRef.current = trackRef.current?.getBoundingClientRect() ?? null;
                    lastSentSeekRef.current = null;
                    isDraggingRef.current = true;
                    setIsDragging(true);
                    scrubAtClientX(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (!isDraggingRef.current) return;
                    scrubAtClientX(e.clientX);
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
                    dragRectRef.current = null;
                    lastSentSeekRef.current = null;
                }}
                onPointerCancel={() => {
                    if (!isDraggingRef.current) return;
                    isDraggingRef.current = false;
                    setIsDragging(false);
                    dragRectRef.current = null;
                    lastSentSeekRef.current = null;
                }}
                onLostPointerCapture={() => {
                    if (!isDraggingRef.current) return;
                    isDraggingRef.current = false;
                    setIsDragging(false);
                    dragRectRef.current = null;
                    lastSentSeekRef.current = null;
                }}
                title={`Scrub inside ${sceneLabel} (${formatTimecode(start)} – ${formatTimecode(end)})`}
                style={{
                    position: "relative",
                    width: "100%",
                    height: "13px",
                    display: "flex",
                    alignItems: "center",
                    cursor: "ew-resize",
                    touchAction: "none",
                }}
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
                    rangeStart={start}
                    rangeDuration={duration}
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
