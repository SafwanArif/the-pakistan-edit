"use client";

import React, { useCallback, useRef, useState } from "react";
import { VideoKeyframe, formatTimecode, clamp } from "../../../types/news";
import { TimelineKeyframeTrack, TimelinePlayheadNeedle } from "./TimelineMarkers";

const cardScrubberShellStyle: React.CSSProperties = {
    position: "relative",
    padding: "4px 8px",
    borderRadius: "6px",
    background: "rgba(0,0,0,0.28)",
    border: "1px solid var(--ui-border)",
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
    isSceneActive,
    isPlaying = false,
    keyframes = [],
    fadeInDur = 0,
    fadeOutDur = 0,
    onSeek,
}) => {
    const trackRef = useRef<HTMLDivElement>(null);
    const dragRectRef = useRef<DOMRect | null>(null);
    const [isHovering, setIsHovering] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const currentTime = start + localTime;
    const pct = duration > 0 ? clamp((localTime / duration) * 100, 0, 100) : 0;
    const showTimecode = isSceneActive || isHovering || isDragging;

    const fadeInPct = duration > 0 && fadeInDur > 0 ? clamp((fadeInDur / duration) * 100, 3, 18) : 0;
    const fadeOutPct = duration > 0 && fadeOutDur > 0 ? clamp((fadeOutDur / duration) * 100, 3, 18) : 0;

    const scrubAtClientX = (clientX: number) => {
        const rect = dragRectRef.current ?? trackRef.current?.getBoundingClientRect();
        if (!rect || duration <= 0) return;
        const ratio = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
        const maxT = Math.max(start, end - 0.05);
        const raw = start + ratio * duration;
        const snapped = Math.round(clamp(raw, start, maxT) * 100) / 100;
        onSeek(snapped);
    };

    const handleJumpKeyframe = useCallback(
        (t: number) => onSeek(Math.min(Math.max(start, t), Math.max(start, end - 0.05))),
        [onSeek, start, end]
    );

    return (
        <div
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            style={cardScrubberShellStyle}
        >
            {showTimecode && (
                <div
                    style={{
                        position: "absolute",
                        top: "-15px",
                        right: "6px",
                        padding: "1px 6px",
                        borderRadius: "4px",
                        background: "var(--ui-bg-popover)",
                        border: "1px solid var(--ui-border)",
                        fontSize: "8px",
                        fontFamily: "monospace",
                        fontWeight: 800,
                        color: isSceneActive ? "var(--ui-accent)" : "var(--ui-text-dim)",
                        pointerEvents: "none",
                        zIndex: 5,
                        whiteSpace: "nowrap",
                    }}
                >
                    {formatTimecode(localTime)} / {duration.toFixed(1)}s
                </div>
            )}

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
                    setIsDragging(true);
                    scrubAtClientX(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (!isDragging) return;
                    scrubAtClientX(e.clientX);
                }}
                onPointerUp={(e) => {
                    if (!isDragging) return;
                    e.currentTarget.releasePointerCapture(e.pointerId);
                    setIsDragging(false);
                    dragRectRef.current = null;
                }}
                onPointerCancel={() => {
                    setIsDragging(false);
                    dragRectRef.current = null;
                }}
                onLostPointerCapture={() => {
                    setIsDragging(false);
                    dragRectRef.current = null;
                }}
                title={`Scrub inside ${sceneLabel} (${formatTimecode(start)} – ${formatTimecode(end)})`}
                style={{
                    position: "relative",
                    width: "100%",
                    height: "16px",
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
                        style={{
                            width: "100%",
                            height: "100%",
                            transform: `scaleX(${pct / 100})`,
                            transformOrigin: "left center",
                            willChange: "transform",
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
                    pct={pct}
                    active={isSceneActive || isDragging}
                    height={isDragging || isHovering ? 14 : 11}
                    zIndex={3}
                />
            </div>
        </div>
    );
});

CardTimelineScrubber.displayName = "CardTimelineScrubber";
