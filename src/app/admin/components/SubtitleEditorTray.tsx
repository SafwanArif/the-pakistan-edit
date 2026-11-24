"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { SubtitleSegment, SubtitleFontId, SubtitleBackdropId, SUBTITLE_FONT_OPTIONS, SUBTITLE_BACKDROP_OPTIONS, VideoDraft, formatTimecode, downloadSrtFile, timelineTimeToMediaTime, wrapMediaTime, getDefaultSubtitleFontSize, getMediaSubtitleTimelineTime, getTimelineStructure } from "../../../types/news";
import { ScrubPillSlider } from "./ScrubPillSlider";
import { consumeNdjsonStream } from "../utils/ndjsonStream";

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
    segments, onUpdateText, onRemoveSeg, onSeekMedia
}) => (
    <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '160px', overflowY: 'auto' }}>
        {segments.map((seg) => (
            <div key={seg.id} className="tpe-flex-row tpe-subtitle-row" style={{ alignItems: 'center', gap: '6px', padding: '3px 6px', borderRadius: '5px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--ui-border)' }}>
                <button
                    type="button"
                    onClick={() => onSeekMedia(seg.start)}
                    className="tpe-tabular-nums"
                    style={{ fontFamily: 'monospace', fontSize: '8.5px', fontWeight: 800, color: 'var(--ui-accent)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 0, whiteSpace: 'nowrap' }}
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
                    style={{ flex: 1, minWidth: 0, fontSize: '10px', color: 'var(--ui-text)', background: 'transparent', border: 'none' }}
                />
                <button
                    type="button"
                    aria-label="Delete subtitle line"
                    onClick={() => onRemoveSeg(seg.id)}
                    className="tpe-asset-btn tpe-asset-btn-danger"
                    style={{ width: '16px', height: '16px', fontSize: '9px', padding: 0 }}
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
    draft, onChange, seekTo
}) => {
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [transcribeProgress, setTranscribeProgress] = useState<{ stage: string; percent: number } | null>(null);
    const [elapsedSec, setElapsedSec] = useState(0);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const subtitles = draft.subtitles || [];
    const showSubtitles = draft.showSubtitles !== false;

    const transcribeAbortRef = useRef<AbortController | null>(null);
    const latestRef = useRef({ draft, onChange, seekTo });
    useEffect(() => {
        latestRef.current = { draft, onChange, seekTo };
    });

    useEffect(() => {
        return () => transcribeAbortRef.current?.abort();
    }, []);

    useEffect(() => {
        if (!isTranscribing) {
            setElapsedSec(0);
            return;
        }
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
    };

    const handleTranscribe = async () => {
        if (!draft.videoUrl || isTranscribing) return;
        transcribeAbortRef.current?.abort();
        const controller = new AbortController();
        transcribeAbortRef.current = controller;
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
                body: JSON.stringify({ videoUrl: draft.videoUrl }),
                signal: controller.signal,
            });
            const contentType = res.headers.get("content-type") || "";
            if (!res.ok) {
                const errData = await res.json().catch(() => ({})) as { error?: string };
                throw new Error(errData.error || `Transcription failed (${res.status})`);
            }

            if (contentType.includes("application/x-ndjson") && res.body) {
                let finalSegments: SubtitleSegment[] | null = null;
                await consumeNdjsonStream<{ stage?: string; percent?: number; segments?: SubtitleSegment[]; error?: string }>(
                    res,
                    (evt) => {
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
                if (finalSegments === null) throw new Error("Transcription ended without subtitle output.");
                const { draft: latestDraft, onChange: commit } = latestRef.current;
                commit({ ...latestDraft, subtitles: finalSegments, showSubtitles: true });
            } else {
                const data = await res.json() as { segments?: SubtitleSegment[]; error?: string };
                if (data.error) throw new Error(data.error);
                const { draft: latestDraft, onChange: commit } = latestRef.current;
                commit({ ...latestDraft, subtitles: data.segments || [], showSubtitles: true });
            }
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
        } finally {
            if (transcribeAbortRef.current === controller) {
                setIsTranscribing(false);
                setTranscribeProgress(null);
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

    const ccSize = draft.subtitleFontSize ?? getDefaultSubtitleFontSize(draft.aspectRatio);

    return (
        <div
            className="tpe-flex-col"
            style={{ gap: '6px', width: '100%' }}
        >
            {/* Compact Studio Capsule Strip matching Keyframes toolbar */}
            <div className="tpe-flex-row" style={{ justifyContent: 'center', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <div className="tpe-nested-action-row tpe-nested-capsule">
                    <button
                        type="button"
                        disabled={!draft.videoUrl || isTranscribing}
                        onClick={() => void handleTranscribe()}
                        className="tpe-mode-btn tpe-nested-action"
                        style={{
                            background: isTranscribing ? 'oklch(from var(--ui-accent) l c h / 0.14)' : 'transparent',
                            color: isTranscribing ? 'var(--ui-accent)' : 'var(--ui-text)',
                        }}
                        title="Detect speech with local Whisper and generate editable subtitles"
                    >
                        {isTranscribing
                            ? `TRANSCRIBING ${transcribeProgress ? `${transcribeProgress.percent}%` : ""}...`
                            : (subtitles.length > 0 ? "RE-TRANSCRIBE" : "AUTO-GENERATE SUBTITLES")}
                    </button>
                </div>

                {subtitles.length > 0 && (
                    <>
                        <div className="tpe-mode-cluster" style={{ padding: '1px', gap: '1px' }} title="Lower-third vertical placement">
                            {([['bottom', 'LOW'], ['middle', 'MID'], ['high', 'HIGH']] as const).map(([pos, lbl]) => {
                                const active = (draft.subtitlePosition || 'bottom') === pos;
                                return (
                                    <button
                                        key={pos}
                                        type="button"
                                        aria-pressed={active}
                                        onClick={() => onChange({ ...draft, subtitlePosition: pos })}
                                        className="tpe-mode-btn"
                                        style={{
                                            padding: '2px 6px', fontSize: '7.5px',
                                            background: active ? 'rgba(255,255,255,0.12)' : 'transparent',
                                            color: active ? '#fff' : 'var(--ui-text-dim)',
                                            boxShadow: 'none',
                                        }}
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
                            {(Object.entries(SUBTITLE_FONT_OPTIONS) as [SubtitleFontId, { label: string }][]).map(([id, opt]) => (
                                <option key={id} value={id} style={{ background: '#111', color: '#fff' }}>{opt.label}</option>
                            ))}
                        </select>

                        <select
                            aria-label="Caption backdrop style"
                            title="Caption backdrop style"
                            value={draft.subtitleBackdrop || 'pill'}
                            onChange={(e) => onChange({ ...draft, subtitleBackdrop: e.target.value as SubtitleBackdropId })}
                            className="tpe-select"
                        >
                            {(Object.entries(SUBTITLE_BACKDROP_OPTIONS) as [SubtitleBackdropId, { label: string }][]).map(([id, opt]) => (
                                <option key={id} value={id} style={{ background: '#111', color: '#fff' }}>{opt.label}</option>
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
                            onChange={(v) => onChange({ ...draft, subtitleFontSize: v })}
                        />

                        <div className="tpe-mode-cluster" style={{ padding: '1px', gap: '2px', alignItems: 'center' }}>
                            <button
                                type="button"
                                onClick={() => onChange({ ...draft, showSubtitles: !showSubtitles })}
                                className="tpe-mode-btn"
                                style={{
                                    padding: '2px 6px', fontSize: '8px',
                                    background: showSubtitles ? 'oklch(from var(--ui-accent) l c h / 0.16)' : 'transparent',
                                    color: showSubtitles ? 'var(--ui-accent)' : 'var(--ui-text-dim)',
                                    boxShadow: 'none',
                                }}
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
                                className="tpe-mode-btn"
                                style={{ padding: '2px 6px', fontSize: '8px', boxShadow: 'none' }}
                                title="Copy full transcript text"
                            >
                                COPY
                            </button>
                            <button type="button" onClick={() => downloadSrtFile(draft)} className="tpe-mode-btn" style={{ padding: '2px 6px', fontSize: '8px', boxShadow: 'none' }} title="Download .SRT file">
                                .SRT
                            </button>
                        </div>
                    </>
                )}
            </div>

            {isTranscribing && transcribeProgress && (
                <div
                    role="status"
                    aria-live="polite"
                    className="tpe-deck-surface tpe-flex-col"
                    style={{ gap: '5px', padding: '7px 10px' }}
                >
                    <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '8.5px', fontWeight: 900, letterSpacing: '0.07em', color: 'var(--ui-accent)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {transcribeProgress.stage}
                        </span>
                        <div className="tpe-flex-row tpe-tabular-nums" style={{ alignItems: 'center', gap: '6px', flexShrink: 0, fontSize: '8.5px', fontFamily: 'monospace', fontWeight: 800 }}>
                            <span style={{ color: 'var(--ui-text)' }}>{transcribeProgress.percent}%</span>
                            <span style={{ color: 'var(--ui-text-dim)' }}>
                                {Math.floor(elapsedSec / 60)}:{String(elapsedSec % 60).padStart(2, '0')}
                            </span>
                            <button
                                type="button"
                                onClick={handleCancelTranscribe}
                                className="tpe-mode-btn"
                                style={{ padding: '1px 5px', fontSize: '7.5px', color: 'var(--ui-danger)' }}
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
                        style={{ width: '100%', height: '4px', borderRadius: '999px', background: 'rgba(255,255,255,0.08)', overflow: 'hidden' }}
                    >
                        <div
                            style={{
                                width: '100%',
                                height: '100%',
                                background: 'var(--ui-accent)',
                                boxShadow: '0 0 10px oklch(from var(--ui-accent) l c h / 0.6)',
                                transform: `scaleX(${Math.max(0.02, Math.min(1, transcribeProgress.percent / 100))})`,
                                transformOrigin: 'left center',
                                transition: 'transform 0.25s ease-out',
                            }}
                        />
                    </div>
                </div>
            )}

            {errorMsg && (
                <div style={{ fontSize: '9px', color: 'var(--ui-danger)', lineHeight: 1.35, padding: '5px 8px', borderRadius: '6px', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.25)' }}>
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
