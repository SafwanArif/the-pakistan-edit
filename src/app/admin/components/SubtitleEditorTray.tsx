"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { SubtitleSegment, SubtitleFontId, SubtitleBackdropId, SUBTITLE_FONT_OPTIONS, SUBTITLE_BACKDROP_OPTIONS, VideoDraft, clamp, formatTimecode, downloadSrtFile, timelineTimeToMediaTime, wrapMediaTime, getDefaultSubtitleFontSize, getMediaSubtitleTimelineTime, getTimelineStructure } from "@/types/news";
import { stopEventPropagation } from "../utils/domUtils";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { consumeNdjsonStream } from "../utils/ndjsonStream";

const POSITION_OPTIONS = [['bottom', 'LOW'], ['middle', 'MID'], ['high', 'HIGH']] as const;
const SUBTITLE_FONT_ENTRIES = Object.entries(SUBTITLE_FONT_OPTIONS) as [SubtitleFontId, { label: string }][];
const SUBTITLE_BACKDROP_ENTRIES = Object.entries(SUBTITLE_BACKDROP_OPTIONS) as [SubtitleBackdropId, { label: string }][];

/** O(N) interval-overlap resolver returning subtitles whose media window intersects `[startSec, endSec)`. */
export const getSceneSubtitles = (draft: VideoDraft, startSec: number, endSec: number): SubtitleSegment[] => {
    const subs = draft.subtitles || [];
    if (!subs.length || endSec <= startSec) return [];
    const dur = endSec - startSec;
    const clipDur = draft.videoDuration || 0;
    const intervals: [number, number][] = [];

    if (clipDur > 0) {
        const mStart = wrapMediaTime(draft, startSec, clipDur);
        const { preStoryDur, storyOffset } = getTimelineStructure(draft.scenes || []);
        const loopStart = startSec >= preStoryDur && storyOffset > 0 && storyOffset < clipDur - 0.5 ? storyOffset : 0;
        const loopSpan = Math.max(0.5, clipDur - loopStart);
        if (dur >= loopSpan) {
            intervals.push([loopStart, clipDur]);
        } else if (mStart + dur <= clipDur) {
            intervals.push([mStart, mStart + dur]);
        } else {
            intervals.push([mStart, clipDur]);
            intervals.push([loopStart, loopStart + (mStart + dur - clipDur)]);
        }
    } else {
        const mStart = timelineTimeToMediaTime(draft, startSec);
        intervals.push([mStart, mStart + dur]);
    }

    return subs.filter((seg) => intervals.some(([a, b]) => seg.end > a && seg.start < b));
};

interface SubtitleRowListProps {
    segments: SubtitleSegment[];
    onUpdateText: (id: string, text: string) => void;
    onRemoveSeg: (id: string) => void;
    onSeekMedia: (mediaStart: number) => void;
}

export const SubtitleRowList: React.FC<SubtitleRowListProps> = React.memo(({
    segments, onUpdateText, onRemoveSeg, onSeekMedia,
}) => (
    <div onClick={stopEventPropagation} className="tpe-sub-list">
        {segments.map((seg) => (
            <div key={seg.id} className="tpe-flex-row tpe-subtitle-row tpe-sub-row">
                <button
                    type="button"
                    onClick={() => onSeekMedia(seg.start)}
                    className="tpe-tabular-nums tpe-sub-time-btn"
                    title={`Jump to ${formatTimecode(seg.start)}`}
                >
                    {formatTimecode(seg.start)}
                </button>
                <input
                    type="text"
                    dir="auto"
                    enterKeyHint="done"
                    autoCapitalize="sentences"
                    spellCheck={true}
                    aria-label={`Subtitle text at ${formatTimecode(seg.start)}`}
                    value={seg.text}
                    onChange={(e) => onUpdateText(seg.id, e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                    className="tpe-sub-text-input"
                />
                <button
                    type="button"
                    aria-label="Delete subtitle line"
                    onClick={() => onRemoveSeg(seg.id)}
                    className="tpe-asset-btn tpe-asset-btn-danger tpe-sub-del-btn"
                    title="Delete subtitle line"
                >
                    ×
                </button>
            </div>
        ))}
    </div>
));
SubtitleRowList.displayName = "SubtitleRowList";

interface SubtitleEditorTrayProps {
    draft: VideoDraft;
    onChange: (d: VideoDraft) => void;
    seekTo: (time: number) => void;
}

/** Inline speech-to-text subtitle generator and live per-line editor. */
export const SubtitleEditorTray: React.FC<SubtitleEditorTrayProps> = React.memo(({
    draft, onChange, seekTo,
}) => {
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [transcribeProgress, setTranscribeProgress] = useState<{ stage: string; percent: number } | null>(null);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const subtitles = draft.subtitles || [];
    const showSubtitles = draft.showSubtitles !== false;

    const transcribeAbortRef = useRef<AbortController | null>(null);
    const latestRef = useRef({ draft, onChange, seekTo });
    useLayoutEffect(() => {
        latestRef.current = { draft, onChange, seekTo };
    });

    useEffect(() => () => {
        transcribeAbortRef.current?.abort();
    }, []);

    useEffect(() => {
        if (!transcribeAbortRef.current) return;
        transcribeAbortRef.current.abort();
        transcribeAbortRef.current = null;
    }, [draft.videoUrl]);

    useEffect(() => {
        if (!isTranscribing) return;
        const startedAt = Date.now();
        const timer = setInterval(() => {
            setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
        }, 500);
        return () => clearInterval(timer);
    }, [isTranscribing]);

    const handleCancelTranscribe = () => {
        transcribeAbortRef.current?.abort();
        transcribeAbortRef.current = null;
        setIsTranscribing(false);
        setTranscribeProgress(null);
        setElapsedSec(0);
    };

    const handleTranscribe = async () => {
        const requestedVideoUrl = draft.videoUrl;
        if (!requestedVideoUrl || isTranscribing) return;
        transcribeAbortRef.current?.abort();
        const controller = new AbortController();
        transcribeAbortRef.current = controller;
        setElapsedSec(0);
        setIsTranscribing(true);
        setTranscribeProgress({ stage: "STARTING WHISPER ENGINE...", percent: 2 });
        setErrorMsg(null);
        try {
            const res = await fetch("/api/video/transcribe", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/x-ndjson",
                },
                body: JSON.stringify({ videoUrl: requestedVideoUrl }),
                signal: controller.signal,
            });
            const contentType = res.headers.get("content-type") || "";
            if (!res.ok) {
                const errData = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(errData.error || `Transcription failed (${res.status})`);
            }

            let resolvedSegments: SubtitleSegment[] = [];
            if (contentType.includes("application/x-ndjson") && res.body) {
                let finalSegments: SubtitleSegment[] | null = null;
                await consumeNdjsonStream<{ stage?: string; percent?: number; segments?: SubtitleSegment[]; error?: string }>(
                    res,
                    (evt) => {
                        if (controller.signal.aborted) return;
                        if (evt.error) throw new Error(evt.error);
                        if (evt.stage) {
                            setTranscribeProgress((prev) => ({
                                stage: evt.stage!,
                                percent: typeof evt.percent === "number" ? evt.percent : (prev?.percent ?? 0),
                            }));
                        }
                        if (evt.segments) finalSegments = evt.segments;
                    }
                );
                if (controller.signal.aborted) return;
                if (finalSegments === null) throw new Error("Transcription ended without subtitle output.");
                resolvedSegments = finalSegments;
            } else {
                const data = await res.json() as { segments?: SubtitleSegment[]; error?: string };
                if (controller.signal.aborted) return;
                if (data.error) throw new Error(data.error);
                resolvedSegments = data.segments || [];
            }

            const { draft: latestDraft, onChange: commit } = latestRef.current;
            if (controller.signal.aborted || latestDraft.videoUrl !== requestedVideoUrl) return;
            commit({ ...latestDraft, subtitles: resolvedSegments, showSubtitles: true });
            if (resolvedSegments.length === 0) {
                setErrorMsg("No speech detected in audio track.");
            }
        } catch (err) {
            if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
            setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
        } finally {
            if (transcribeAbortRef.current === controller) {
                transcribeAbortRef.current = null;
                if (!controller.signal.aborted) {
                    setIsTranscribing(false);
                    setTranscribeProgress(null);
                    setElapsedSec(0);
                }
            }
        }
    };

    const seekToMediaTime = useCallback((mediaStart: number) => {
        const { draft: latestDraft, seekTo: seek } = latestRef.current;
        seek(getMediaSubtitleTimelineTime(latestDraft, mediaStart));
    }, []);

    const handleUpdateSubtitleText = useCallback((id: string, text: string) => {
        const { draft: latestDraft, onChange: commit } = latestRef.current;
        const allSubs = latestDraft.subtitles || [];
        commit({ ...latestDraft, subtitles: allSubs.map((s) => (s.id === id ? { ...s, text } : s)) });
    }, []);

    const handleRemoveSubtitle = useCallback((id: string) => {
        const { draft: latestDraft, onChange: commit } = latestRef.current;
        const allSubs = latestDraft.subtitles || [];
        commit({ ...latestDraft, subtitles: allSubs.filter((s) => s.id !== id) });
    }, []);

    const handleFontSizeChange = useCallback((v: number) => {
        const { draft: latestDraft, onChange: commit } = latestRef.current;
        const currentSize = latestDraft.subtitleFontSize ?? getDefaultSubtitleFontSize(latestDraft.aspectRatio);
        if (v !== currentSize) commit({ ...latestDraft, subtitleFontSize: v });
    }, []);

    const ccSize = draft.subtitleFontSize ?? getDefaultSubtitleFontSize(draft.aspectRatio);

    return (
        <div className="tpe-flex-col tpe-sub-tray">
            {/* Compact Studio Capsule Strip matching Keyframes toolbar */}
            <div className="tpe-flex-row tpe-sub-strip">
                <div className="tpe-nested-action-row tpe-nested-capsule">
                    <button
                        type="button"
                        disabled={!draft.videoUrl || isTranscribing}
                        onClick={() => void handleTranscribe()}
                        className="tpe-mode-btn tpe-nested-action tpe-tabular-nums tpe-sub-gen-btn"
                        data-busy={isTranscribing}
                        title="Detect speech with local Whisper and generate editable subtitles"
                    >
                        {isTranscribing
                            ? `TRANSCRIBING ${transcribeProgress ? `${transcribeProgress.percent}%` : ""}...`
                            : (subtitles.length > 0 ? "RE-TRANSCRIBE" : "AUTO-GENERATE SUBTITLES")}
                    </button>
                </div>

                {subtitles.length > 0 && (
                    <>
                        <div role="group" aria-label="Subtitle vertical position" className="tpe-mode-cluster tpe-sub-cluster" title="Lower-third vertical placement">
                            {POSITION_OPTIONS.map(([pos, lbl]) => {
                                const active = (draft.subtitlePosition || 'bottom') === pos;
                                return (
                                    <button
                                        key={pos}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => { if (!active) onChange({ ...draft, subtitlePosition: pos }); }}
                                        className="tpe-mode-btn tpe-sub-pos-btn"
                                        data-active={active}
                                    >
                                        {lbl}
                                    </button>
                                );
                            })}
                        </div>

                        <select
                            aria-label="Caption font family"
                            title="Caption font family"
                            value={draft.subtitleFont || 'plus-jakarta'}
                            onChange={(e) => onChange({ ...draft, subtitleFont: e.target.value as SubtitleFontId })}
                            className="tpe-select"
                        >
                            {SUBTITLE_FONT_ENTRIES.map(([id, opt]) => (
                                <option key={id} value={id} className="tpe-sub-select-opt">{opt.label}</option>
                            ))}
                        </select>

                        <select
                            aria-label="Caption backdrop style"
                            title="Caption backdrop style"
                            value={draft.subtitleBackdrop || 'pill'}
                            onChange={(e) => onChange({ ...draft, subtitleBackdrop: e.target.value as SubtitleBackdropId })}
                            className="tpe-select"
                        >
                            {SUBTITLE_BACKDROP_ENTRIES.map(([id, opt]) => (
                                <option key={id} value={id} className="tpe-sub-select-opt">{opt.label}</option>
                            ))}
                        </select>

                        <ScrubPillSlider
                            label="SIZE"
                            value={ccSize}
                            min={18}
                            max={56}
                            unit="px"
                            accentColor="var(--ui-accent)"
                            width="88px"
                            height="20px"
                            title="Drag or click to set caption font size (18–56px)"
                            onChange={handleFontSizeChange}
                        />

                        <div className="tpe-mode-cluster tpe-sub-action-cluster">
                            <button
                                type="button"
                                aria-pressed={showSubtitles}
                                onClick={() => onChange({ ...draft, showSubtitles: !showSubtitles })}
                                className="tpe-mode-btn tpe-sub-cc-btn"
                                data-active={showSubtitles}
                                title="Toggle captions on/off globally"
                            >
                                CC: {showSubtitles ? "ON" : "OFF"}
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    try {
                                        void navigator.clipboard?.writeText(subtitles.map((s) => s.text).join(' '))?.catch(() => {});
                                    } catch { /* clipboard unavailable on insecure LAN origins */ }
                                }}
                                className="tpe-mode-btn tpe-sub-util-btn"
                                title="Copy full transcript text"
                            >
                                COPY
                            </button>
                            <button type="button" onClick={() => downloadSrtFile(draft)} className="tpe-mode-btn tpe-sub-util-btn" title="Download .SRT file">
                                .SRT
                            </button>
                        </div>
                    </>
                )}
            </div>

            {isTranscribing && transcribeProgress && (
                <div role="status" aria-live="polite" className="tpe-deck-surface tpe-flex-col tpe-sub-progress-card">
                    <div className="tpe-flex-row tpe-sub-progress-head">
                        <span className="tpe-sub-progress-stage">{transcribeProgress.stage}</span>
                        <div className="tpe-flex-row tpe-tabular-nums tpe-sub-progress-meta">
                            <span className="tpe-sub-progress-pct">{transcribeProgress.percent}%</span>
                            <span className="tpe-sub-progress-elapsed">
                                {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
                            </span>
                            <button
                                type="button"
                                onClick={handleCancelTranscribe}
                                className="tpe-mode-btn tpe-sub-cancel-btn"
                                title="Cancel transcription"
                            >
                                CANCEL
                            </button>
                        </div>
                    </div>
                    <div
                        role="progressbar"
                        aria-label="Transcription progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={transcribeProgress.percent}
                        aria-valuetext={`${transcribeProgress.percent}% — ${transcribeProgress.stage}`}
                        className="tpe-sub-progress-track"
                    >
                        <div
                            className="tpe-sub-progress-fill"
                            style={{ transform: `scaleX(${clamp(transcribeProgress.percent / 100, 0.02, 1)})` }}
                        />
                    </div>
                </div>
            )}

            {errorMsg && (
                <div role="alert" className="tpe-sub-error">
                    {errorMsg}
                </div>
            )}

            {subtitles.length > 0 && (
                <SubtitleRowList
                    segments={subtitles}
                    onUpdateText={handleUpdateSubtitleText}
                    onRemoveSeg={handleRemoveSubtitle}
                    onSeekMedia={seekToMediaTime}
                />
            )}
        </div>
    );
});

SubtitleEditorTray.displayName = "SubtitleEditorTray";
