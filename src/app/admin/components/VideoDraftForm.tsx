"use client";

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { del } from "idb-keyval";
import { PostMode, VideoDraft, calculatePsychologyPacedScenes, downloadSrtFile, getSceneRoleLabel, isSharedReHookScene } from "@/types/news";
import { revokeBlobUrl } from "@/utils/idUtils";
import { UploadIcon, LinkIcon, CloseIcon } from "@/components/icons/TPEIcons";
import { isSafeMediaUrl } from "../utils/domUtils";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";
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

/** Command ribbon interface for Video Post metadata, active scene copy, media upload, and exports. */
export const VideoDraftForm: React.FC<VideoDraftFormProps> = React.memo(({
    draft, onChange, onExportOverlay, onExportMP4, onClearVideo, onReset, onUploadVideo, isExporting = false, mode, onModeChange, activeSceneIndex = 0, isOutro = false,
}) => {
    const [focusedField, setFocusedField] = useState<string | null>(null);
    const [isAssetTrayOpen, setIsAssetTrayOpen] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [showLinkInput, setShowLinkInput] = useState(false);
    const [urlInput, setUrlInput] = useState("");
    const [prevIsOutro, setPrevIsOutro] = useState(isOutro);
    if (isOutro !== prevIsOutro) {
        setPrevIsOutro(isOutro);
        if (isOutro && focusedField === 'subtitle') setFocusedField(null);
    }

    const assetTriggerRef = useRef<HTMLButtonElement>(null);
    const linkBtnRef = useRef<HTMLButtonElement>(null);
    const exportTriggerRef = useRef<HTMLButtonElement>(null);
    const isMountedRef = useRef(true);
    useEffect(() => () => { isMountedRef.current = false; }, []);

    const isAnchoredReHook = !isOutro && isSharedReHookScene(draft.scenes, activeSceneIndex);
    const textSceneIndex = isAnchoredReHook ? 0 : activeSceneIndex;
    const textScene = !isOutro ? draft.scenes?.[textSceneIndex] : undefined;
    const draftRef = useRef(draft);
    useLayoutEffect(() => {
        draftRef.current = draft;
    });

    const closeAssetTray = useCallback((reason?: CloseReason) => {
        setIsAssetTrayOpen(false);
        setShowLinkInput(false);
        if (reason === "escape") assetTriggerRef.current?.focus();
    }, []);
    const closeExportMenu = useCallback((reason?: CloseReason) => {
        setIsExportMenuOpen(false);
        if (reason === "escape") exportTriggerRef.current?.focus();
    }, []);

    const assetContainerRef = useClickOutside(closeAssetTray, '[data-editorial-popover="true"]', isAssetTrayOpen);
    const exportContainerRef = useClickOutside(closeExportMenu, undefined, isExportMenuOpen);
    const clearFocusedField = useCallback((reason?: CloseReason) => {
        setFocusedField(null);
        if (reason === "escape" && document.activeElement instanceof HTMLElement && document.activeElement.closest(".tpe-header-tools")) {
            document.activeElement.blur();
        }
    }, []);
    const headerRowRef = useClickOutside(clearFocusedField, '[data-editorial-popover="true"]', focusedField !== null);

    const hasVideo = !!draft.videoUrl;
    const outroDur = draft.outroDuration || 5;
    const sceneRoleLabel = isOutro ? "🏁 OUTRO" : getSceneRoleLabel(draft.scenes, activeSceneIndex);

    const detectAspectRatioFromMedia = (url: string, videoName: string) => {
        void probeVideoMetadata(url)
            .then((meta) => {
                if (!isMountedRef.current) return;
                const current = draftRef.current;
                if (!meta || current.videoUrl !== url) return;
                const pacedScenes = calculatePsychologyPacedScenes(meta.duration, current.scenes);
                onChange({ ...current, videoUrl: url, videoName, videoDuration: meta.duration, aspectRatio: meta.aspectRatio, scenes: pacedScenes });
            })
            .catch(() => { /* best-effort metadata probe */ });
    };

    const handleFileUpload = (file: File) => {
        setIsAssetTrayOpen(false);
        setShowLinkInput(false);
        void Promise.resolve(onUploadVideo(file, file.name)).catch((err) => console.error("VIDEO_UPLOAD_ERROR:", err));
    };

    const handleLinkSubmit = () => {
        const clean = urlInput.trim();
        if (!isSafeMediaUrl(clean, false)) return;
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
        void Promise.resolve(onClearVideo()).catch((err) => console.error("CLEAR_VIDEO_ERROR:", err));
    };

    const updateActiveSceneText = (patch: { title?: string; subtitle?: string }) => {
        const scenes = draft.scenes?.length ? [...draft.scenes] : [];
        if (scenes[textSceneIndex]) scenes[textSceneIndex] = { ...scenes[textSceneIndex]!, ...patch };
        onChange({
            ...draft,
            headline: textSceneIndex === 0 && patch.title !== undefined ? patch.title : draft.headline,
            subtitle: textSceneIndex === 0 && patch.subtitle !== undefined ? patch.subtitle : draft.subtitle,
            scenes,
        });
    };

    const handleHeadlineChange = (val: string) => (isOutro ? onChange({ ...draft, outroCta: val }) : updateActiveSceneText({ title: val }));
    const handleSubtitleChange = (val: string) => { if (!isOutro) updateActiveSceneText({ subtitle: val }); };

    const handleToolsBlurCapture = (e: React.FocusEvent<HTMLDivElement>) => {
        const next = e.relatedTarget as Element | null;
        if (next && (e.currentTarget.contains(next) || next.closest('[data-editorial-popover="true"]'))) return;
        setFocusedField(null);
    };

    const getElasticProps = (field: string, expandedFlex: number, idleFlex: number, disabled = false) => {
        const isFocused = focusedField === field;
        const hiddenByOther = Boolean(focusedField && !isFocused);
        return {
            className: `tpe-elastic-field-wrapper ${isFocused ? 'tpe-field-expanded' : (focusedField ? 'tpe-field-shrunk' : '')}`,
            style: {
                flex: isFocused ? expandedFlex : (focusedField ? 0 : idleFlex),
                ...(disabled ? { pointerEvents: 'none' as const } : {}),
                ...(hiddenByOther ? { opacity: 0, pointerEvents: 'none' as const } : {}),
            },
        };
    };

    const currentHeadlineValue = isOutro ? (draft.outroCta || "") : (textScene ? textScene.title : (draft.headline || ""));
    const currentSubtitleValue = isOutro ? `BRANDED OUTRO STINGER (${outroDur}s)` : (textScene ? (textScene.subtitle ?? "") : (draft.subtitle || ""));

    return (
        <div className="tpe-flex-col tpe-draft-form-container">
            <div ref={headerRowRef} className="tpe-header-row" data-focused-field={focusedField || undefined}>
                <CommandRibbonMenu mode={mode} onModeChange={onModeChange} onReset={onReset} disabled={isExporting} />

                <div className="tpe-header-main tpe-video-ribbon-main">
                    <div className="tpe-header-tools" onBlurCapture={handleToolsBlurCapture}>
                        <div {...getElasticProps('category', 1.4, 0.45)}>
                            <div className="tpe-flex-row tpe-field-wrap">
                                <input id="input-video-category" aria-label="Category" dir="auto" enterKeyHint="done" autoCapitalize="characters" spellCheck={false} autoComplete="off" className="tpe-input-field tpe-uppercase tpe-video-ribbon-cat" placeholder="CATEGORY" value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} onFocus={() => setFocusedField('category')} />
                            </div>
                        </div>

                        {!focusedField && <span className="tpe-separator-pipe tpe-video-ribbon-pipe" aria-hidden="true">|</span>}

                        <div {...getElasticProps('headline', 2.4, 0.9)}>
                            <div className="tpe-flex-row tpe-field-wrap">
                                <textarea
                                    id="input-video-headline"
                                    aria-label="Scene headline"
                                    dir="auto"
                                    enterKeyHint="enter"
                                    autoCapitalize="sentences"
                                    spellCheck={true}
                                    autoComplete="off"
                                    className="tpe-input-field tpe-textarea tpe-uppercase tpe-video-ribbon-ta tpe-video-ribbon-hl"
                                    placeholder={isOutro ? "OUTRO CALL TO ACTION..." : `${sceneRoleLabel} HEADLINE...`}
                                    value={currentHeadlineValue}
                                    onChange={(e) => handleHeadlineChange(e.target.value)}
                                    onFocus={() => setFocusedField('headline')}
                                    rows={1}
                                />
                                <div className="tpe-field-tools tpe-video-ribbon-tools">
                                    <EmojiToolbar fieldId="video-headline" value={currentHeadlineValue} onUpdate={handleHeadlineChange} popDirection="down" />
                                </div>
                            </div>
                        </div>

                        {!focusedField && <span className="tpe-separator-pipe tpe-video-ribbon-pipe" aria-hidden="true">|</span>}

                        <div {...getElasticProps('subtitle', 2.4, 1.15, isOutro)}>
                            <div className="tpe-flex-row tpe-field-wrap">
                                <textarea
                                    id="input-video-subtitle"
                                    aria-label="Scene subtitle"
                                    dir="auto"
                                    enterKeyHint="enter"
                                    autoCapitalize="sentences"
                                    spellCheck={true}
                                    autoComplete="off"
                                    className="tpe-input-field tpe-textarea tpe-video-ribbon-ta tpe-video-ribbon-sub"
                                    placeholder={isOutro ? `Outro stinger screen (${outroDur}s)` : (activeSceneIndex === 0 ? "Hook subheading / juicy punchline..." : `${sceneRoleLabel} subheading...`)}
                                    value={currentSubtitleValue}
                                    disabled={isOutro}
                                    onChange={(e) => handleSubtitleChange(e.target.value)}
                                    onFocus={() => setFocusedField('subtitle')}
                                    rows={1}
                                />
                                {!isOutro && (
                                    <div className="tpe-field-tools tpe-video-ribbon-tools">
                                        <EmojiToolbar fieldId="video-subtitle" value={currentSubtitleValue} onUpdate={handleSubtitleChange} popDirection="down" />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* Asset Toolbar */}
                <div className="tpe-flex-row tpe-ribbon-assets tpe-asset-toolbar" ref={assetContainerRef}>
                    <button
                        ref={assetTriggerRef}
                        type="button"
                        aria-label={hasVideo ? `Video loaded: ${draft.videoName || 'Custom Video'}` : "Upload video and source"}
                        aria-expanded={isAssetTrayOpen}
                        aria-haspopup="dialog"
                        onClick={() => setIsAssetTrayOpen((open) => !open)}
                        className="tpe-asset-btn"
                        data-active={hasVideo || !!draft.sourceName}
                        title={hasVideo ? `Video loaded: ${draft.videoName || 'Custom Video'}` : "Upload video & source"}
                    >
                        <UploadIcon stroke={hasVideo ? "var(--ui-accent)" : "currentColor"} />
                    </button>

                    {isAssetTrayOpen && (
                        <div role="dialog" aria-label="Video upload and source credits" className="tpe-asset-tray-expanded tpe-flex-col tpe-asset-tray-stack">
                            <div className="tpe-flex-row tpe-asset-tray-actions">
                                <label className="tpe-asset-btn tpe-upload-label" title="Upload Video File (.mp4, .mov, .webm)" aria-label="Upload Video File">
                                    <input type="file" className="tpe-sr-only" accept="video/mp4,video/quicktime,video/webm" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileUpload(f); e.currentTarget.value = ''; }} />
                                    <UploadIcon />
                                </label>
                                <button ref={linkBtnRef} type="button" aria-pressed={showLinkInput} aria-label="Paste Video URL" onClick={() => setShowLinkInput((v) => !v)} className="tpe-asset-btn" data-active={showLinkInput} title="Paste Video URL"><LinkIcon /></button>
                                {hasVideo && <button type="button" aria-label="Remove Video" onClick={handleClearVideo} className="tpe-asset-btn tpe-asset-btn-danger" title="Remove Video"><CloseIcon /></button>}
                            </div>

                            {showLinkInput && (
                                <input
                                    type="url"
                                    inputMode="url"
                                    aria-label="Paste video URL"
                                    enterKeyHint="done"
                                    spellCheck={false}
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    autoComplete="off"
                                    autoFocus
                                    className="tpe-popover-input"
                                    placeholder="PASTE VIDEO URL (.mp4)..."
                                    value={urlInput}
                                    onChange={(e) => setUrlInput(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleLinkSubmit();
                                        else if (e.key === 'Escape') {
                                            e.nativeEvent.stopImmediatePropagation();
                                            setUrlInput("");
                                            setShowLinkInput(false);
                                            linkBtnRef.current?.focus();
                                        }
                                    }}
                                />
                            )}

                            {draft.videoName && (
                                <div className="tpe-video-filename" title={draft.videoName}>📁 {draft.videoName}</div>
                            )}

                            <div className="tpe-flex-col tpe-asset-tray-meta">
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
                    )}
                </div>

                {/* Export Cluster */}
                <div className="tpe-nav-cluster tpe-export-cluster" ref={exportContainerRef}>
                    <button
                        ref={exportTriggerRef}
                        type="button"
                        aria-expanded={isExportMenuOpen}
                        aria-haspopup="menu"
                        onClick={() => setIsExportMenuOpen((prev) => !prev)}
                        disabled={isExporting}
                        className="tpe-nav-btn tpe-btn-primary tpe-export-trigger"
                        title="Export Final MP4 or Transparent PNG Overlays"
                        aria-label={isExporting ? "Export in progress" : "Export options"}
                    >
                        {isExporting ? "EXPORTING..." : "EXPORT"}
                    </button>

                    {isExportMenuOpen && !isExporting && (
                        <div role="menu" aria-label="Export options" className="tpe-asset-tray-expanded tpe-flex-col tpe-export-menu">
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setIsExportMenuOpen(false); onExportMP4(); }}
                                className="tpe-nav-btn tpe-btn-primary tpe-export-menu-btn"
                                title="Composite video, logo, category, headline, and source directly in-app"
                            >
                                🎬 FINAL VIDEO (.MP4)
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                onClick={() => { setIsExportMenuOpen(false); onExportOverlay(); }}
                                className="tpe-nav-btn tpe-btn-gold tpe-export-menu-btn"
                                title="Export transparent TikTok 9:16, 4:5, and 16:9 PNG overlay ZIP"
                            >
                                🖼️ PNG OVERLAYS (.ZIP)
                            </button>
                            <button
                                type="button"
                                role="menuitem"
                                disabled={!draft.subtitles?.length}
                                onClick={() => { setIsExportMenuOpen(false); downloadSrtFile(draft); }}
                                className="tpe-nav-btn tpe-btn-gold tpe-export-menu-btn"
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
