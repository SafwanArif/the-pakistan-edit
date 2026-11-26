"use client";

import React, { useState, useRef, useEffect } from "react";
import { del } from "idb-keyval";
import { PostMode, VideoDraft, calculatePsychologyPacedScenes, downloadSrtFile, getSceneRoleLabel, isSharedReHookScene } from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";
import { UploadIcon, LinkIcon, CloseIcon } from "@/components/icons/TPEIcons";
import { useClickOutside } from "../hooks/useClickOutside";
import { probeVideoMetadata, resetClipBoundFields } from "../hooks/useVideoDraftState";
import { deleteServerCachedVideo } from "../utils/serverCapabilities";
import { STORAGE_KEYS } from "../utils/storageKeys";
import { VideoCreditToolbar, SourcePrefixToolbar, EmojiToolbar } from "./EditorialTools";
import { CommandRibbonMenu } from "./CommandRibbonMenu";

interface VideoDraftFormProps {
    draft: VideoDraft;
    onChange: (d: VideoDraft) => void;
    onExportOverlay: () => void;
    onExportMP4: () => void;
    onClearVideo: () => void | Promise<void>;
    onReset?: () => void;
    onUploadVideo: (file: File, name?: string) => void | Promise<void>;
    isExporting?: boolean;
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
    activeSceneIndex?: number;
    isOutro?: boolean;
}

const textareaBaseStyle: React.CSSProperties = {
    fontFamily: 'var(--tpe-font-geist)', fontSize: '13px', height: '34px',
    resize: 'none', lineHeight: 1.35, paddingTop: '8px', overflowY: 'auto'
};
const fieldToolsStyle: React.CSSProperties = { position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: '8px', zIndex: 10 };
const pipeStyle: React.CSSProperties = { opacity: 0.35, fontSize: '14px', alignSelf: 'center' };
const exportMenuBtnStyle: React.CSSProperties = { width: '100%', justifyContent: 'center', textAlign: 'center', padding: '7px 10px', fontSize: '10px' };

/** Command ribbon interface for Video Post metadata, active scene copy, media upload, and exports. */
export const VideoDraftForm: React.FC<VideoDraftFormProps> = React.memo(({
    draft, onChange, onExportOverlay, onExportMP4, onClearVideo, onReset, onUploadVideo, isExporting = false, mode, onModeChange, activeSceneIndex = 0, isOutro = false
}) => {
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const [isAssetTrayOpen, setIsAssetTrayOpen] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [urlInput, setUrlInput] = useState("");

    const isAnchoredReHook = !isOutro && isSharedReHookScene(draft.scenes, activeSceneIndex);
    const textSceneIndex = isAnchoredReHook ? 0 : activeSceneIndex;
    const textScene = !isOutro ? draft.scenes?.[textSceneIndex] : undefined;
    const draftRef = useRef(draft);
    useEffect(() => {
        draftRef.current = draft;
    }, [draft]);
    const assetContainerRef = useClickOutside(() => {
        setIsAssetTrayOpen(false);
        setShowLinkInput(false);
    }, '[data-editorial-popover="true"]', isAssetTrayOpen);
    const exportContainerRef = useClickOutside(() => setIsExportMenuOpen(false), undefined, isExportMenuOpen);
    const headerRowRef = useClickOutside(() => setFocusedField(null), '[data-editorial-popover="true"]', focusedField !== null);

    const hasVideo = !!draft.videoUrl;
    const sceneRoleLabel = isOutro ? "🏁 OUTRO" : getSceneRoleLabel(draft.scenes, activeSceneIndex);

    const detectAspectRatioFromMedia = (url: string, videoName: string) => {
        void probeVideoMetadata(url).then((meta) => {
            const current = draftRef.current;
            if (!meta || current.videoUrl !== url) return;
            const pacedScenes = calculatePsychologyPacedScenes(meta.duration, current.scenes);
            onChange({ ...current, videoUrl: url, videoName, videoDuration: meta.duration, aspectRatio: meta.aspectRatio, scenes: pacedScenes });
        });
    };

    const handleFileUpload = (file: File) => {
        setIsAssetTrayOpen(false);
        setShowLinkInput(false);
        void onUploadVideo(file, file.name);
    };

    const handleLinkSubmit = () => {
        const clean = urlInput.trim();
        if (!clean) return;
        revokeBlobUrl(draft.videoUrl);
        deleteServerCachedVideo(draft.videoUrl);
        void del(STORAGE_KEYS.VIDEO_BLOB).catch(() => { /* best-effort cleanup */ });
        const videoName = clean.split('/').pop() || "Remote Video";
        onChange({
            ...resetClipBoundFields(draft),
            videoUrl: clean,
            videoName,
            videoDuration: undefined,
        });
        detectAspectRatioFromMedia(clean, videoName);
        setShowLinkInput(false);
        setIsAssetTrayOpen(false);
        setUrlInput("");
    };

    const handleClearVideo = () => {
        void onClearVideo();
    };

    const updateActiveSceneText = (patch: { title?: string; subtitle?: string }) => {
        const scenes = draft.scenes?.length ? [...draft.scenes] : [];
        if (scenes[textSceneIndex]) scenes[textSceneIndex] = { ...scenes[textSceneIndex]!, ...patch };
        onChange({
            ...draft,
            headline: textSceneIndex === 0 && patch.title !== undefined ? patch.title : draft.headline,
            subtitle: textSceneIndex === 0 && patch.subtitle !== undefined ? patch.subtitle : draft.subtitle,
            scenes
        });
    };

    const handleHeadlineChange = (val: string) => isOutro ? onChange({ ...draft, outroCta: val }) : updateActiveSceneText({ title: val });
    const handleSubtitleChange = (val: string) => { if (!isOutro) updateActiveSceneText({ subtitle: val }); };

    const getElasticProps = (field: string, expandedFlex: number, idleFlex: number, disabled = false) => {
        const isFocused = focusedField === field;
        const hiddenByOther = Boolean(focusedField && !isFocused);
        return {
            className: `tpe-elastic-field-wrapper ${isFocused ? 'tpe-field-expanded' : (focusedField ? 'tpe-field-shrunk' : '')}`,
            style: {
                flex: isFocused ? expandedFlex : (focusedField ? 0 : idleFlex),
                opacity: hiddenByOther ? 0 : 1,
                pointerEvents: (hiddenByOther || disabled ? 'none' : 'auto') as React.CSSProperties['pointerEvents']
            }
        };
    };

    const currentHeadlineValue = isOutro ? (draft.outroCta || "") : (textScene ? textScene.title : (draft.headline || ""));
    const currentSubtitleValue = isOutro ? "BRANDED OUTRO STINGER (5s)" : (textScene ? (textScene.subtitle ?? "") : (draft.subtitle || ""));

    return (
        <div className="tpe-flex-col tpe-draft-form-container">
            <div ref={headerRowRef} className="tpe-header-row" data-focused-field={focusedField || undefined}>
                <CommandRibbonMenu mode={mode} onModeChange={onModeChange} onReset={onReset} />

                <div className="tpe-header-main" style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                    <div className="tpe-header-tools">
                        <div {...getElasticProps('category', 1.4, 0.45)}>
                            <div className="tpe-flex-row tpe-textarea-wrapper" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                                <input id="input-video-category" aria-label="Category" dir="auto" enterKeyHint="done" autoCapitalize="characters" spellCheck={false} autoComplete="off" className="tpe-input-field tpe-uppercase" placeholder="CATEGORY" value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} onFocus={() => setFocusedField('category')} style={{ fontFamily: 'var(--tpe-font-geist)', fontSize: '13px', fontWeight: 600, letterSpacing: '0.04em', height: '34px' }} />
                            </div>
                        </div>

                        {!focusedField && <span className="tpe-separator-pipe" style={pipeStyle} aria-hidden="true">|</span>}

                        <div {...getElasticProps('headline', 2.4, 0.9)}>
                            <div className="tpe-flex-row tpe-textarea-wrapper" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                                <textarea
                                    id="input-video-headline"
                                    aria-label="Scene headline"
                                    dir="auto"
                                    enterKeyHint="enter"
                                    autoCapitalize="sentences"
                                    spellCheck={true}
                                    autoComplete="off"
                                    className="tpe-input-field tpe-textarea tpe-uppercase"
                                    placeholder={isOutro ? "OUTRO CALL TO ACTION..." : `${sceneRoleLabel} HEADLINE...`}
                                    value={currentHeadlineValue}
                                    onChange={(e) => handleHeadlineChange(e.target.value)}
                                    onFocus={() => setFocusedField('headline')}
                                    rows={1}
                                    style={{ ...textareaBaseStyle, fontWeight: 600, letterSpacing: '0.02em' }}
                                />
                                <div className="tpe-field-tools" style={fieldToolsStyle}>
                                    <EmojiToolbar fieldId="video-headline" value={currentHeadlineValue} onUpdate={handleHeadlineChange} popDirection="down" />
                                </div>
                            </div>
                        </div>

                        {!focusedField && <span className="tpe-separator-pipe" style={pipeStyle} aria-hidden="true">|</span>}

                        <div {...getElasticProps('subtitle', 2.4, 1.15, isOutro)}>
                            <div className="tpe-flex-row tpe-textarea-wrapper" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
                                <textarea
                                    id="input-video-subtitle"
                                    aria-label="Scene subtitle"
                                    dir="auto"
                                    enterKeyHint="enter"
                                    autoCapitalize="sentences"
                                    spellCheck={true}
                                    autoComplete="off"
                                    className="tpe-input-field tpe-textarea"
                                    placeholder={isOutro ? "Outro stinger screen (5s)" : (activeSceneIndex === 0 ? "Hook subheading / juicy punchline..." : `${sceneRoleLabel} subheading...`)}
                                    value={currentSubtitleValue}
                                    disabled={isOutro}
                                    onChange={(e) => handleSubtitleChange(e.target.value)}
                                    onFocus={() => setFocusedField('subtitle')}
                                    rows={1}
                                    style={{ ...textareaBaseStyle, opacity: isOutro ? 0.5 : 1, textTransform: 'none', fontWeight: 400, ...(isOutro ? { paddingInlineEnd: '8px' } : {}) }}
                                />
                                {!isOutro && (
                                    <div className="tpe-field-tools" style={fieldToolsStyle}>
                                        <EmojiToolbar fieldId="video-subtitle" value={currentSubtitleValue} onUpdate={handleSubtitleChange} popDirection="down" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Asset Toolbar */}
                <div className="tpe-flex-row tpe-ribbon-assets" style={{ gap: '8px', position: 'relative', alignItems: 'center' }} ref={assetContainerRef}>
                    <button type="button" aria-label={hasVideo ? `Video loaded: ${draft.videoName || 'Custom Video'}` : "Upload video and source"} aria-expanded={isAssetTrayOpen} onClick={() => setIsAssetTrayOpen(!isAssetTrayOpen)} className="tpe-asset-btn" data-active={hasVideo || !!draft.sourceName} title={hasVideo ? `Video loaded: ${draft.videoName || 'Custom Video'}` : "Upload video & source"}>
                        <UploadIcon stroke={hasVideo ? "var(--ui-accent)" : "currentColor"} />
                    </button>

                    <div className={`${isAssetTrayOpen ? 'tpe-asset-tray-expanded' : 'tpe-hidden'} tpe-flex-col`} style={{ gap: '10px' }}>
                        <div className="tpe-flex-row" style={{ gap: '6px' }}>
                            <label className="tpe-asset-btn tpe-upload-label" title="Upload Video File (.mp4, .mov, .webm)" aria-label="Upload Video File">
                                <input type="file" className="tpe-sr-only" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.currentTarget.value = ''; }} />
                                <UploadIcon />
                            </label>
                            <button type="button" aria-pressed={showLinkInput} aria-label="Paste Video URL" onClick={() => setShowLinkInput(!showLinkInput)} className="tpe-asset-btn" data-active={showLinkInput} title="Paste Video URL"><LinkIcon /></button>
                            {hasVideo && <button type="button" aria-label="Remove Video" onClick={handleClearVideo} className="tpe-asset-btn tpe-asset-btn-danger" title="Remove Video"><CloseIcon /></button>}
                        </div>

                        {showLinkInput && (
                            <div className="tpe-asset-input-wrapper">
                                <input type="url" aria-label="Paste video URL" enterKeyHint="done" spellCheck={false} autoCapitalize="off" autoComplete="off" className="tpe-popover-input" placeholder="PASTE VIDEO URL (.mp4)..." value={urlInput} onChange={(e) => setUrlInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleLinkSubmit()} autoFocus />
                            </div>
                        )}

                        {draft.videoName && (
                            <div style={{ fontSize: '9px', color: 'var(--ui-text-dim)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📁 {draft.videoName}</div>
                        )}

                        <div className="tpe-flex-col" style={{ gap: '8px', paddingBlockStart: '8px', borderBlockStart: '1px solid var(--ui-border)' }}>
                            <div className="tpe-source-row-wrapper">
                                <VideoCreditToolbar fieldId="video-creditName" value={draft.creditName || ""} prefix={draft.creditPrefix || "FOOTAGE:"} onPrefixChange={(p: string) => onChange({ ...draft, creditPrefix: p })} onUpdate={(v: string) => onChange({ ...draft, creditName: v })} />
                                <input id="input-video-creditName" aria-label="Footage credit" dir="auto" enterKeyHint="done" autoCapitalize="words" className="tpe-input-field" placeholder="FOOTAGE CREDIT" value={draft.creditName || ""} onChange={(e) => onChange({ ...draft, creditName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                            </div>
                            <div className="tpe-source-row-wrapper">
                                <SourcePrefixToolbar fieldId="video-sourceName" value={draft.sourceName || ""} prefix={draft.sourcePrefix || "SOURCE:"} onPrefixChange={(p: string) => onChange({ ...draft, sourcePrefix: p })} onUpdate={(v: string) => onChange({ ...draft, sourceName: v })} />
                                <input id="input-video-sourceName" aria-label="Source name" dir="auto" enterKeyHint="done" autoCapitalize="words" className="tpe-input-field" placeholder="SOURCE" value={draft.sourceName || ""} onChange={(e) => onChange({ ...draft, sourceName: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Export Cluster */}
                <div className="tpe-nav-cluster" style={{ position: 'relative' }} ref={exportContainerRef}>
                    <button
                        type="button"
                        aria-expanded={isExportMenuOpen}
                        aria-haspopup="menu"
                        onClick={() => setIsExportMenuOpen((prev) => !prev)}
                        disabled={isExporting}
                        className="tpe-nav-btn tpe-btn-primary"
                        style={{ whiteSpace: 'nowrap', padding: '6px 6px' }}
                        title="Export Final MP4 or Transparent PNG Overlays"
                        aria-label={isExporting ? "Export in progress" : "Export options"}
                    >
                        {isExporting ? "EXPORTING..." : "EXPORT"}
                    </button>

                    {isExportMenuOpen && !isExporting && (
                        <div role="menu" aria-label="Export options" className="tpe-asset-tray-expanded tpe-flex-col" style={{ right: 0, left: 'auto', minWidth: '230px', gap: '6px', padding: '8px' }}>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setIsExportMenuOpen(false); onExportMP4(); }}
                                className="tpe-nav-btn tpe-btn-primary"
                                style={exportMenuBtnStyle}
                                title="Composite video, logo, category, headline, and source directly in-app"
                            >
                                🎬 FINAL VIDEO (.MP4)
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setIsExportMenuOpen(false); onExportOverlay(); }}
                                className="tpe-nav-btn tpe-btn-gold"
                                style={exportMenuBtnStyle}
                                title="Export transparent TikTok 9:16, 4:5, and 16:9 PNG overlay ZIP"
                            >
                                🖼️ PNG OVERLAYS (.ZIP)
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                disabled={!draft.subtitles?.length}
                                onClick={() => { setIsExportMenuOpen(false); downloadSrtFile(draft); }}
                                className="tpe-nav-btn tpe-btn-gold"
                                style={{ ...exportMenuBtnStyle, opacity: draft.subtitles?.length ? 1 : 0.45 }}
                                title={draft.subtitles?.length ? "Export .SRT subtitle file for YouTube Shorts, Facebook, or TikTok reference" : "Generate subtitles first in the Storyboard"}
                            >
                                📝 SUBTITLES (.SRT)
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

VideoDraftForm.displayName = "VideoDraftForm";
