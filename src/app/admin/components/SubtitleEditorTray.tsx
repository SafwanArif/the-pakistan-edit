"use client";

import React, { useState } from "react";
import { SubtitleSegment, SubtitleFontId, SubtitleBackdropId, SUBTITLE_FONT_OPTIONS, SUBTITLE_BACKDROP_OPTIONS, VideoDraft, formatTimecode, downloadSrtFile, timelineTimeToMediaTime, wrapMediaTime, getDefaultSubtitleFontSize, getMediaSubtitleTimelineTime, getTimelineStructure } from "../../../types/news";
import { ScrubPillSlider } from "./ScrubPillSlider";

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
    draft: VideoDraft;
    onChange: (d: VideoDraft) => void;
    onSeekMedia: (mediaStart: number) => void;
}

export const SubtitleRowList: React.FC<SubtitleRowListProps> = React.memo(({
    segments, draft, onChange, onSeekMedia
}) => {
    const allSubs = draft.subtitles || [];
    const updateText = (id: string, text: string) =>
        onChange({ ...draft, subtitles: allSubs.map((s) => (s.id === id ? { ...s, text } : s)) });
    const removeSeg = (id: string) =>
        onChange({ ...draft, subtitles: allSubs.filter((s) => s.id !== id) });

    return (
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
                        aria-label={`Subtitle text at ${formatTimecode(seg.start)}`}
                        value={seg.text}
                        onChange={(e) => updateText(seg.id, e.target.value)}
                        style={{ flex: 1, minWidth: 0, fontSize: '10px', color: 'var(--ui-text)', background: 'transparent', border: 'none' }}
                    />
                    <button
                        type="button"
                        aria-label="Delete subtitle line"
                        onClick={() => removeSeg(seg.id)}
                        className="tpe-asset-btn tpe-asset-btn-danger"
                        style={{ width: '16px', height: '16px', fontSize: '9px', padding: 0 }}
                        title="Delete subtitle line"
                    >
                        ×
                    </button>
                </div>
            ))}
        </div>
    );
});
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
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const subtitles = draft.subtitles || [];
    const showSubtitles = draft.showSubtitles !== false;

    const transcribeAbortRef = React.useRef<AbortController | null>(null);

    React.useEffect(() => {
        return () => transcribeAbortRef.current?.abort();
    }, []);

    const handleTranscribe = async () => {
        if (!draft.videoUrl || isTranscribing) return;
        transcribeAbortRef.current?.abort();
        const controller = new AbortController();
        transcribeAbortRef.current = controller;
        setIsTranscribing(true);
        setErrorMsg(null);
        try {
            const res = await fetch("/api/video/transcribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ videoUrl: draft.videoUrl }),
                signal: controller.signal,
            });
            const data = await res.json() as { segments?: SubtitleSegment[]; error?: string };
            if (!res.ok) throw new Error(data.error || "Transcription failed");
            onChange({ ...draft, subtitles: data.segments || [], showSubtitles: true });
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') return;
            setErrorMsg(err instanceof Error ? err.message : "Transcription failed");
        } finally {
            if (transcribeAbortRef.current === controller) {
                setIsTranscribing(false);
            }
        }
    };

    const seekToMediaTime = (mediaStart: number) => seekTo(getMediaSubtitleTimelineTime(draft, mediaStart));

    const ccSize = draft.subtitleFontSize ?? getDefaultSubtitleFontSize(draft.aspectRatio);

    return (
        <div
            className="tpe-flex-col tpe-deck-surface"
            style={{ gap: '6px' }}
        >
            {/* Compact Studio Capsule Strip matching Keyframes toolbar */}
            <div className="tpe-flex-row" style={{ justifyContent: 'center', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                    type="button"
                    disabled={!draft.videoUrl || isTranscribing}
                    onClick={() => void handleTranscribe()}
                    className="tpe-mode-btn"
                    style={{
                        padding: '2px 7px', fontSize: '8.5px', fontWeight: 800,
                        background: isTranscribing ? 'oklch(from var(--ui-accent) l c h / 0.14)' : 'rgba(255,255,255,0.05)',
                        color: isTranscribing ? 'var(--ui-accent)' : 'var(--ui-text)',
                        border: '1px solid var(--ui-border)', borderRadius: '5px',
                    }}
                    title="Detect speech with local Whisper and generate editable subtitles"
                >
                    {isTranscribing ? "⏳ TRANSCRIBING..." : (subtitles.length > 0 ? "↻ RE-TRANSCRIBE" : "🎙️ AUTO-GENERATE SUBTITLES")}
                </button>

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
                            <button type="button" onClick={() => void navigator.clipboard.writeText(subtitles.map(s => s.text).join(' '))} className="tpe-mode-btn" style={{ padding: '2px 6px', fontSize: '8px', boxShadow: 'none' }} title="Copy full transcript text">
                                COPY
                            </button>
                            <button type="button" onClick={() => downloadSrtFile(draft)} className="tpe-mode-btn" style={{ padding: '2px 6px', fontSize: '8px', boxShadow: 'none' }} title="Download .SRT file">
                                .SRT
                            </button>
                        </div>
                    </>
                )}
            </div>

            {errorMsg && (
                <div style={{ fontSize: '9px', color: 'var(--ui-danger)', lineHeight: 1.35, padding: '5px 8px', borderRadius: '6px', background: 'rgba(255,60,60,0.08)', border: '1px solid rgba(255,60,60,0.25)' }}>
                    {errorMsg}
                </div>
            )}

            {subtitles.length > 0 && (
                <SubtitleRowList
                    segments={subtitles}
                    draft={draft}
                    onChange={onChange}
                    onSeekMedia={seekToMediaTime}
                />
            )}
        </div>
    );
});

SubtitleEditorTray.displayName = "SubtitleEditorTray";
