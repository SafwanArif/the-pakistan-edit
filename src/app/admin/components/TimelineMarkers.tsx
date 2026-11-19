"use client";

import React from "react";
import { VideoKeyframe, formatTimecode } from "../../../types/news";

interface TimelineKeyframeDiamondProps {
    kf: VideoKeyframe;
    pct: number;
    displayTime: number;
    isAtPlayhead: boolean;
    variant?: 'split' | 'pre' | 'post';
    dimmed?: boolean;
    size?: number;
    zIndex?: number;
    onJump: (time: number) => void;
}

/** Shared NLE keyframe diamond marker used by both card and master timeline scrubbers. */
const TimelineKeyframeDiamond: React.FC<TimelineKeyframeDiamondProps> = ({
    kf,
    pct,
    displayTime,
    isAtPlayhead,
    variant = 'split',
    dimmed = false,
    size = 7,
    zIndex = 2,
    onJump,
}) => {
    const isCut = kf.easing === 'snap';
    const pre = isCut ? kf.pre : undefined;
    const jumpTime = variant === 'pre' && pre?.time !== undefined ? pre.time : kf.time;
    const title = variant === 'pre'
        ? `PRE Cut @ ${formatTimecode(displayTime)} • Zoom ${Math.round(pre?.zoom ?? kf.zoom)}% • Pan ${Math.round(pre?.posX ?? kf.posX)}%`
        : variant === 'post'
            ? `POST Cut @ ${formatTimecode(displayTime)} • Zoom ${Math.round(kf.zoom)}% • Pan ${Math.round(kf.posX)}%`
            : isCut
                ? `Cut Keyframe at ${formatTimecode(displayTime)}${pre ? ` • Pre${pre.time !== undefined && pre.time < kf.time ? ` @${formatTimecode(pre.time)}` : ''} ${Math.round(pre.zoom)}%/${Math.round(pre.posX)}% →` : ' • Hold →'} Post ${Math.round(kf.zoom)}%/${Math.round(kf.posX)}%`
                : `Keyframe at ${formatTimecode(displayTime)} • Zoom ${Math.round(kf.zoom)}% • Pan ${Math.round(kf.posX)}%`;

    const background = variant === 'pre'
        ? (isAtPlayhead ? "#ffffff" : "var(--ui-pre)")
        : variant === 'post'
            ? (isAtPlayhead ? "#ffffff" : "var(--ui-accent)")
            : isCut
                ? (isAtPlayhead
                    ? "linear-gradient(135deg, var(--ui-pre) 48%, #ffffff 52%)"
                    : "linear-gradient(135deg, color-mix(in oklch, var(--ui-pre) 90%, transparent) 48%, var(--ui-accent) 52%)")
                : (isAtPlayhead ? "#fff" : "var(--ui-accent)");

    return (
        <button
            type="button"
            onPointerDown={(e) => {
                e.stopPropagation();
                onJump(jumpTime);
            }}
            title={title}
            aria-label={title}
            style={{
                position: "absolute",
                left: `${pct}%`,
                top: "50%",
                transform: `translate(-50%, -50%) rotate(45deg) scale(${isAtPlayhead ? 1.2 : 1})`,
                width: `${size}px`,
                height: `${size}px`,
                padding: 0,
                borderRadius: "1.5px",
                background,
                border: `1.5px solid ${isAtPlayhead ? (variant === 'pre' ? "var(--ui-pre)" : "var(--ui-accent)") : "#0a0d0c"}`,
                boxShadow: isAtPlayhead ? `0 0 8px ${variant === 'pre' ? "#38bdf8" : "var(--ui-accent)"}` : "0 0 4px oklch(from var(--ui-accent) l c h / 0.55)",
                opacity: dimmed ? 0.42 : 1,
                cursor: "pointer",
                transition: "transform 0.12s ease, opacity 0.15s ease, background-color 0.12s ease",
                zIndex,
            }}
        />
    );
};

interface TimelineKeyframeTrackProps {
    keyframes: VideoKeyframe[];
    rangeStart: number;
    rangeDuration: number;
    currentTime: number;
    size?: number;
    zIndex?: number;
    onJump: (time: number, side?: 'pre' | 'post') => void;
}

/** Renders keyframes with Focus Isolation: Cut Keyframes collapse to 1 diamond at their earliest time and reveal their paired PRE ─── POST bridge when focused. */
export const TimelineKeyframeTrack: React.FC<TimelineKeyframeTrackProps> = ({
    keyframes,
    rangeStart,
    rangeDuration,
    currentTime,
    size = 7,
    zIndex = 2,
    onJump,
}) => {
    const safeDur = Math.max(0.1, rangeDuration);
    const rangeEnd = rangeStart + safeDur;
    const toPct = (t: number) => Math.max(0, Math.min(100, ((t - rangeStart) / safeDur) * 100));

    const getEarliestTime = (kf: VideoKeyframe) =>
        kf.easing === 'snap' && kf.pre?.time !== undefined ? Math.min(kf.time, kf.pre.time) : kf.time;

    const focusedKf = keyframes.find((kf) =>
        Math.abs(kf.time - currentTime) <= 0.06
        || (kf.easing === 'snap' && kf.pre?.time !== undefined && Math.abs(kf.pre.time - currentTime) <= 0.06)
    );

    const visibleKeyframes = keyframes.filter((kf) => {
        const earliest = getEarliestTime(kf);
        return (earliest >= rangeStart && earliest <= rangeEnd) || (kf.time >= rangeStart && kf.time <= rangeEnd);
    });

    return (
        <>
            {visibleKeyframes.map((kf) => {
                const isFocused = focusedKf?.id === kf.id;
                const isDimmed = Boolean(focusedKf && !isFocused);
                const preTime = kf.easing === 'snap' ? kf.pre?.time : undefined;
                const hasPairGap = isFocused && preTime !== undefined && kf.time - preTime >= 0.05;

                if (hasPairGap && preTime !== undefined) {
                    const prePct = toPct(preTime);
                    const postPct = toPct(kf.time);
                    return (
                        <React.Fragment key={kf.id}>
                            <div
                                style={{
                                    position: "absolute",
                                    left: `${prePct}%`,
                                    width: `${Math.max(0, postPct - prePct)}%`,
                                    top: "50%",
                                    height: "2px",
                                    transform: "translateY(-50%)",
                                    background: "linear-gradient(90deg, #38bdf8, var(--ui-accent))",
                                    boxShadow: "0 0 6px oklch(from var(--ui-accent) l c h / 0.55)",
                                    pointerEvents: "none",
                                    zIndex,
                                }}
                            />
                            <TimelineKeyframeDiamond
                                kf={kf}
                                variant="pre"
                                pct={prePct}
                                displayTime={preTime - rangeStart}
                                isAtPlayhead={Math.abs(currentTime - preTime) <= 0.06}
                                size={size}
                                zIndex={zIndex + 1}
                                onJump={(t) => onJump(t, 'pre')}
                            />
                            <TimelineKeyframeDiamond
                                kf={kf}
                                variant="post"
                                pct={postPct}
                                displayTime={kf.time - rangeStart}
                                isAtPlayhead={Math.abs(currentTime - kf.time) <= 0.06}
                                size={size}
                                zIndex={zIndex + 1}
                                onJump={(t) => onJump(t, 'post')}
                            />
                        </React.Fragment>
                    );
                }

                const earliest = getEarliestTime(kf);
                return (
                    <TimelineKeyframeDiamond
                        key={kf.id}
                        kf={kf}
                        variant="split"
                        dimmed={isDimmed}
                        pct={toPct(earliest)}
                        displayTime={earliest - rangeStart}
                        isAtPlayhead={isFocused}
                        size={size}
                        zIndex={isFocused ? zIndex + 1 : zIndex}
                        onJump={(t) => onJump(kf.easing === 'snap' && kf.pre?.time !== undefined ? earliest : t, kf.easing === 'snap' && kf.pre?.time !== undefined && kf.pre.time < kf.time ? 'pre' : undefined)}
                    />
                );
            })}
        </>
    );
};

interface TimelinePlayheadNeedleProps {
    pct: number;
    active: boolean;
    height: number;
    width?: number;
    zIndex?: number;
}

/** Shared slim vertical playhead needle for NLE timeline scrubbers. */
export const TimelinePlayheadNeedle: React.FC<TimelinePlayheadNeedleProps> = ({
    pct,
    active,
    height,
    width = 2,
    zIndex = 5,
}) => (
    <div
        style={{
            position: "absolute",
            left: `${pct}%`,
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: `${width}px`,
            height: `${height}px`,
            borderRadius: "2px",
            background: active ? "#fff" : "var(--ui-accent)",
            boxShadow: active ? "0 0 8px var(--ui-accent)" : "none",
            pointerEvents: "none",
            transition: "height 0.12s ease",
            zIndex,
        }}
    />
);
