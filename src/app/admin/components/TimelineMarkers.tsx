"use client";

import React from "react";
import { VideoKeyframe, formatTimecode, clamp } from "@/types/news";
import { isActivationKey, isPrimaryPointer } from "../utils/domUtils";

interface TimelineKeyframeDiamondProps {
    kf: VideoKeyframe;
    pct: number;
    displayTime: number;
    isAtPlayhead: boolean;
    variant?: 'split' | 'pre' | 'post';
    dimmed?: boolean;
    size?: number;
    zIndex?: number;
    jumpTime?: number;
    jumpSide?: 'pre' | 'post';
    onJump: (time: number, side?: 'pre' | 'post') => void;
}

/** Shared NLE keyframe diamond marker used by both card and master timeline scrubbers. */
const TimelineKeyframeDiamond: React.FC<TimelineKeyframeDiamondProps> = React.memo(({
    kf,
    pct,
    displayTime,
    isAtPlayhead,
    variant = 'split',
    dimmed = false,
    size = 7,
    zIndex = 2,
    jumpTime: explicitJumpTime,
    jumpSide,
    onJump,
}) => {
    const isCut = kf.easing === 'snap';
    const pre = isCut ? kf.pre : undefined;
    const jumpTime = explicitJumpTime ?? (variant === 'pre' && pre?.time !== undefined ? pre.time : kf.time);
    const title = variant === 'pre'
        ? `PRE Cut @ ${formatTimecode(displayTime)} • Zoom ${Math.round(pre?.zoom ?? kf.zoom)}% • Pan ${Math.round(pre?.posX ?? kf.posX)}%`
        : variant === 'post'
            ? `POST Cut @ ${formatTimecode(displayTime)} • Zoom ${Math.round(kf.zoom)}% • Pan ${Math.round(kf.posX)}%`
            : isCut
                ? `Cut Keyframe at ${formatTimecode(displayTime)}${pre ? ` • Pre${pre.time !== undefined && pre.time < kf.time ? ` @${formatTimecode(pre.time)}` : ''} ${Math.round(pre.zoom)}%/${Math.round(pre.posX)}% →` : ' • Hold →'} Post ${Math.round(kf.zoom)}%/${Math.round(kf.posX)}%`
                : `Keyframe at ${formatTimecode(displayTime)} • Zoom ${Math.round(kf.zoom)}% • Pan ${Math.round(kf.posX)}%`;

    const cssVariant = variant === 'split' && isCut ? 'split-cut' : variant;
    const safePct = Number.isFinite(pct) ? clamp(pct, 0, 100) : 0;

    return (
        <button
            type="button"
            onPointerDown={(e) => {
                if (!isPrimaryPointer(e)) return;
                e.stopPropagation();
                onJump(jumpTime, jumpSide);
            }}
            onKeyDown={(e) => {
                if (!isActivationKey(e.key)) return;
                e.preventDefault();
                e.stopPropagation();
                onJump(jumpTime, jumpSide);
            }}
            title={title}
            aria-label={title}
            className="tpe-kf-diamond"
            data-variant={cssVariant}
            data-active={isAtPlayhead}
            data-dimmed={dimmed}
            style={{ left: `${safePct}%`, width: `${size}px`, height: `${size}px`, zIndex }}
        />
    );
});
TimelineKeyframeDiamond.displayName = "TimelineKeyframeDiamond";

interface TimelineKeyframeTrackProps {
    keyframes: VideoKeyframe[];
    rangeStart: number;
    rangeDuration: number;
    currentTime: number;
    isPlaying?: boolean;
    size?: number;
    zIndex?: number;
    onJump: (time: number, side?: 'pre' | 'post') => void;
}

const getKeyframeEarliestTime = (kf: VideoKeyframe): number =>
    kf.easing === 'snap' && kf.pre?.time !== undefined ? Math.min(kf.time, kf.pre.time) : kf.time;

const isKeyframeInRange = (kf: VideoKeyframe, rangeStart: number, rangeEnd: number): boolean => {
    const earliest = getKeyframeEarliestTime(kf);
    return (earliest >= rangeStart && earliest <= rangeEnd) || (kf.time >= rangeStart && kf.time <= rangeEnd);
};

const isKeyframeFocusedAt = (kf: VideoKeyframe, currentTime: number): boolean =>
    Math.abs(kf.time - currentTime) <= 0.06
    || (kf.easing === 'snap' && kf.pre?.time !== undefined && Math.abs(kf.pre.time - currentTime) <= 0.06);

const getFocusedKeyframeKey = (
    keyframes: VideoKeyframe[],
    rangeStart: number,
    rangeDuration: number,
    currentTime: number,
    isPlaying = false
): string => {
    if (isPlaying) return "";
    const safeDur = Number.isFinite(rangeDuration) ? Math.max(0.1, rangeDuration) : 0.1;
    const rangeEnd = rangeStart + safeDur;
    const kf = keyframes.find((k) => isKeyframeInRange(k, rangeStart, rangeEnd) && isKeyframeFocusedAt(k, currentTime));
    if (!kf) return "";
    const atPost = Math.abs(currentTime - kf.time) <= 0.06 ? 1 : 0;
    const atPre = kf.easing === 'snap' && kf.pre?.time !== undefined && Math.abs(currentTime - kf.pre.time) <= 0.06 ? 1 : 0;
    return `${kf.id}:${atPre}:${atPost}`;
};

/** Renders keyframes with Focus Isolation, skipping 120Hz playback ticks when focus proximity is unchanged. */
export const TimelineKeyframeTrack: React.FC<TimelineKeyframeTrackProps> = React.memo(({
    keyframes,
    rangeStart,
    rangeDuration,
    currentTime,
    isPlaying = false,
    size = 7,
    zIndex = 2,
    onJump,
}) => {
    const safeDur = Number.isFinite(rangeDuration) ? Math.max(0.1, rangeDuration) : 0.1;
    const rangeEnd = rangeStart + safeDur;
    const toPct = (t: number) => Number.isFinite(t) ? clamp(((t - rangeStart) / safeDur) * 100, 0, 100) : 0;

    const visibleKeyframes = keyframes.filter((kf) => isKeyframeInRange(kf, rangeStart, rangeEnd));
    const focusedKf = isPlaying ? undefined : visibleKeyframes.find((kf) => isKeyframeFocusedAt(kf, currentTime));

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
                                aria-hidden="true"
                                className="tpe-kf-connector"
                                style={{ left: `${prePct}%`, width: `${Math.max(0, postPct - prePct)}%`, zIndex }}
                            />
                            <TimelineKeyframeDiamond
                                kf={kf}
                                variant="pre"
                                pct={prePct}
                                displayTime={Math.max(0, preTime - rangeStart)}
                                isAtPlayhead={Math.abs(currentTime - preTime) <= 0.06}
                                size={size}
                                zIndex={zIndex + 1}
                                jumpTime={preTime}
                                jumpSide="pre"
                                onJump={onJump}
                            />
                            <TimelineKeyframeDiamond
                                kf={kf}
                                variant="post"
                                pct={postPct}
                                displayTime={Math.max(0, kf.time - rangeStart)}
                                isAtPlayhead={Math.abs(currentTime - kf.time) <= 0.06}
                                size={size}
                                zIndex={zIndex + 1}
                                jumpTime={kf.time}
                                jumpSide="post"
                                onJump={onJump}
                            />
                        </React.Fragment>
                    );
                }

                const earliest = getKeyframeEarliestTime(kf);
                const splitPre = kf.easing === 'snap' && kf.pre?.time !== undefined;
                return (
                    <TimelineKeyframeDiamond
                        key={kf.id}
                        kf={kf}
                        variant="split"
                        dimmed={isDimmed}
                        pct={toPct(earliest)}
                        displayTime={Math.max(0, earliest - rangeStart)}
                        isAtPlayhead={isFocused}
                        size={size}
                        zIndex={isFocused ? zIndex + 1 : zIndex}
                        jumpTime={splitPre ? earliest : kf.time}
                        jumpSide={splitPre && kf.pre!.time! < kf.time ? 'pre' : undefined}
                        onJump={onJump}
                    />
                );
            })}
        </>
    );
}, (prev, next) =>
    prev.keyframes === next.keyframes
    && prev.rangeStart === next.rangeStart
    && prev.rangeDuration === next.rangeDuration
    && Boolean(prev.isPlaying) === Boolean(next.isPlaying)
    && prev.size === next.size
    && prev.zIndex === next.zIndex
    && prev.onJump === next.onJump
    && getFocusedKeyframeKey(prev.keyframes, prev.rangeStart, prev.rangeDuration, prev.currentTime, Boolean(prev.isPlaying))
        === getFocusedKeyframeKey(next.keyframes, next.rangeStart, next.rangeDuration, next.currentTime, Boolean(next.isPlaying))
);
TimelineKeyframeTrack.displayName = "TimelineKeyframeTrack";

interface TimelinePlayheadNeedleProps {
    pct: number;
    active: boolean;
    height: number;
    width?: number;
    zIndex?: number;
    railRef?: React.RefObject<HTMLDivElement | null>;
}

/** Shared slim vertical playhead needle positioned via 100%-width GPU translate3d rail (zero layout reflow). */
export const TimelinePlayheadNeedle: React.FC<TimelinePlayheadNeedleProps> = React.memo(({
    pct,
    active,
    height,
    width = 2,
    zIndex = 5,
    railRef,
}) => {
    const safePct = Number.isFinite(pct) ? clamp(pct, 0, 100) : 0;
    return (
        <div
            ref={railRef}
            aria-hidden="true"
            className="tpe-playhead-rail"
            data-active={active}
            style={{ transform: `translate3d(${safePct}%, 0, 0)`, zIndex }}
        >
            <div
                className="tpe-playhead-needle"
                data-active={active}
                style={{ width: `${width}px`, height: `${height}px` }}
            />
        </div>
    );
});
TimelinePlayheadNeedle.displayName = "TimelinePlayheadNeedle";
