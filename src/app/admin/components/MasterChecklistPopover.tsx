"use client";

import React, { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    VideoDraft,
    SUBTITLE_FONT_OPTIONS,
    SUBTITLE_BACKDROP_OPTIONS,
    getDefaultSubtitleFontSize,
    getTotalVideoDuration,
    autoPadToMonetisationThreshold,
    resolveSceneFade,
    getTimelineStructure,
    switchVideoAspectRatio,
    clamp,
} from "@/types/news";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";

type MasterChecklistTab = "seo" | "rewards" | "psychology";

interface MasterCheckItem {
    id: string;
    category: MasterChecklistTab;
    label: string;
    detail: string;
    passed: boolean;
    tone?: "red" | "yellow" | "orange" | "green";
    fixLabel?: string;
    onFix?: (draft: VideoDraft) => VideoDraft;
}

const TAB_META: { id: MasterChecklistTab; label: string }[] = [
    { id: "seo", label: "SMO / SEO" },
    { id: "rewards", label: "CREATOR REWARDS" },
    { id: "psychology", label: "PSYCHOLOGY" },
];

export function getMasterChecklistItems(draft: VideoDraft): MasterCheckItem[] {
    const scenes = draft.scenes || [];
    const totalSec = getTotalVideoDuration(draft);
    const { hasReHook } = getTimelineStructure(scenes);
    const hook = scenes[0];
    const rehook = hasReHook ? scenes[1] : undefined;
    const hookFades = scenes.length > 0 ? resolveSceneFade(scenes, 0) : { inDur: 0, outDur: 0 };
    const rehookFades = hasReHook ? resolveSceneFade(scenes, 1) : { inDur: 0, outDur: 0 };

    const targetCcSize = getDefaultSubtitleFontSize(draft.aspectRatio);
    const activeCcSize = draft.subtitleFontSize ?? targetCcSize;
    const hasSubs = Boolean(draft.subtitles?.length && draft.showSubtitles !== false);
    const activeFont = SUBTITLE_FONT_OPTIONS[draft.subtitleFont || "plus-jakarta"]?.label || "Plus Jakarta Sans";
    const activeBackdrop = draft.subtitleBackdrop || "pill";
    const hasCustomMedia = scenes.some((s) => Boolean(s.mediaUrl));
    const hasKeyframes = (draft.keyframes?.length ?? 0) > 1;
    const isTransformed = scenes.length >= 3 || hasCustomMedia || hasKeyframes;

    const subSizeOk = activeCcSize === targetCcSize;
    const subBackdropOk = activeBackdrop !== "none";
    const subScore = (hasSubs ? 1 : 0) + (subSizeOk ? 1 : 0) + (subBackdropOk ? 1 : 0);
    const subTone: MasterCheckItem["tone"] = subScore === 0 ? "red" : subScore === 1 ? "yellow" : subScore === 2 ? "orange" : "green";

    return [
        // 1. SMO / Social Search Optimisation
        {
            id: "whisper-cc",
            category: "seo",
            label: `Whisper Subtitles, Size & Contrast (${subScore}/3)`,
            detail: `${hasSubs ? `${draft.subtitles?.length} CC` : "No CC"} • ${activeCcSize}px (${targetCcSize}px std) • ${activeFont} / ${SUBTITLE_BACKDROP_OPTIONS[activeBackdrop]?.label || activeBackdrop}`,
            passed: subScore === 3,
            tone: subTone,
            fixLabel: draft.subtitles?.length && draft.showSubtitles === false
                ? "Show CC"
                : (!subSizeOk || !subBackdropOk)
                    ? "Optimise CC"
                    : undefined,
            onFix: draft.subtitles?.length && draft.showSubtitles === false
                ? (d) => ({ ...d, showSubtitles: true })
                : (!subSizeOk || !subBackdropOk)
                    ? (d) => ({ ...d, subtitleFontSize: undefined, subtitleBackdrop: activeBackdrop === "none" ? "shadow" : activeBackdrop })
                    : undefined,
        },
        {
            id: "ocr-keywords",
            category: "seo",
            label: "OCR Headline & Subheading Copy",
            detail: hook?.title?.trim() && hook?.subtitle?.trim() ? "Both headline & subheading indexed on frame" : "Add headline + subheading for visual search OCR",
            passed: Boolean(hook?.title?.trim() && hook?.subtitle?.trim()),
        },
        {
            id: "seo-watchtime",
            category: "seo",
            label: "60s+ Search & Watch-Time Depth",
            detail: `${totalSec.toFixed(1)}s total • Longer spoken context boosts search ranking`,
            passed: totalSec >= 60,
            fixLabel: "Pad 60s",
            onFix: (d) => autoPadToMonetisationThreshold(d),
        },

        // 2. TikTok Creator Rewards Eligibility
        {
            id: "rewards-60s",
            category: "rewards",
            label: "60s+ Minimum Payout Runtime",
            detail: `${totalSec.toFixed(1)}s total (Creator Rewards requires >= 60s)`,
            passed: totalSec >= 60,
            fixLabel: "Pad 60s",
            onFix: (d) => autoPadToMonetisationThreshold(d),
        },
        {
            id: "rewards-916",
            category: "rewards",
            label: "9:16 Vertical Native Format",
            detail: `Current aspect: ${draft.aspectRatio} (Creator Rewards requires vertical 9:16)`,
            passed: draft.aspectRatio === "9:16",
            fixLabel: "Set 9:16",
            onFix: (d) => switchVideoAspectRatio(d, "9:16"),
        },
        {
            id: "rewards-transform",
            category: "rewards",
            label: "Original / Transformative Structure",
            detail: isTransformed
                ? `${scenes.length} acts${hasCustomMedia ? " + custom B-roll" : ""}${hasKeyframes ? " + camera motion" : ""} (add VO for max RPM safety)`
                : "Add Re-Hook, custom B-roll, or voiceover to avoid unoriginality flags",
            passed: isTransformed,
        },
        {
            id: "lufs-audio",
            category: "rewards",
            label: "Clean Audio & -14 LUFS Mix",
            detail: draft.isMuted ? "Muted — unmute original VO/audio for Creator Rewards" : draft.normalizeAudio !== false ? "FFmpeg loudnorm (-14 LUFS) active" : "Normalization OFF",
            passed: !draft.isMuted && draft.normalizeAudio !== false,
            fixLabel: "Enable",
            onFix: (d) => ({ ...d, isMuted: false, normalizeAudio: true }),
        },
        {
            id: "rewards-credit",
            category: "rewards",
            label: "Source & Footage Attribution",
            detail: draft.sourceName?.trim() || draft.creditName?.trim() ? "Source/footage credit set" : "Add SOURCE or FOOTAGE credit for editorial protection",
            passed: Boolean(draft.sourceName?.trim() || draft.creditName?.trim()),
        },

        // 3. Digital Marketing & Social Video Psychology
        {
            id: "hook-window",
            category: "psychology",
            label: "3–5s Scroll-Stop Hook (01.)",
            detail: hook ? `${hook.duration}s • ${hook.title?.trim() ? "Headline set" : "Missing headline"}` : "No Hook scene",
            passed: Boolean(hook && hook.duration >= 3 && hook.duration <= 5 && hook.title?.trim()),
            fixLabel: hook && (hook.duration < 3 || hook.duration > 5) ? "Set 4s" : undefined,
            onFix: hook ? (d) => ({ ...d, scenes: d.scenes.map((s, idx) => (idx === 0 ? { ...s, duration: 4 } : s)) }) : undefined,
        },
        {
            id: "rehook-anchor",
            category: "psychology",
            label: "02. Re-Hook & Anchor Continuity",
            detail: rehook ? (rehook.shareHookText !== false ? `Anchored (${rehook.duration}s pattern interrupt)` : "Anchor Hook disabled on 02") : "No 02. Re-Hook scene",
            passed: Boolean(rehook && rehook.shareHookText !== false),
            fixLabel: "Anchor",
            onFix: rehook ? (d) => ({ ...d, scenes: d.scenes.map((s, idx) => (idx === 1 ? { ...s, shareHookText: true } : s)) }) : undefined,
        },
        {
            id: "fade-pacing",
            category: "psychology",
            label: "Micro / Editorial Fade Pacing",
            detail: rehook
                ? `01 out ${hookFades.outDur.toFixed(2)}s • 02 in ${rehookFades.inDur.toFixed(2)}s`
                : `01 out ${hookFades.outDur.toFixed(2)}s`,
            passed: Boolean(hook && hookFades.outDur > 0 && (!rehook || rehookFades.inDur > 0)),
            fixLabel: "Auto Fade",
            onFix: (d) => ({
                ...d,
                scenes: d.scenes.map((s, idx) =>
                    idx === 0
                        ? { ...s, fadeOut: true, fadeOutPreset: "auto" }
                        : (hasReHook && idx === 1 ? { ...s, fadeIn: true, fadeInPreset: "auto" } : s)
                ),
            }),
        },
        {
            id: "kinetic-motion",
            category: "psychology",
            label: "2026/2027 Kinetic Editorial Motion",
            detail: draft.enableMotion !== false && (draft.motionWordmark !== false || draft.motionText !== false)
                ? "Wordmark, headline & slash motion active"
                : "Static motion disabled",
            passed: draft.enableMotion !== false && (draft.motionWordmark !== false || draft.motionText !== false),
            fixLabel: "Enable",
            onFix: (d) => ({ ...d, enableMotion: true, motionWordmark: true, motionText: true }),
        },
        {
            id: "branded-outro",
            category: "psychology",
            label: "04. Branded Outro & Sponsor/CTA",
            detail: draft.enableOutro ? `${draft.outroDuration || 5}s CTA end card enabled` : "Outro disabled",
            passed: Boolean(draft.enableOutro),
            fixLabel: "Enable",
            onFix: (d) => ({ ...d, enableOutro: true }),
        },
    ];
}

interface MasterChecklistPopoverProps {
    draft: VideoDraft;
    items?: MasterCheckItem[];
    anchorRef?: React.RefObject<HTMLElement | null>;
    ignoreSelector?: string;
    onChange: (draft: VideoDraft) => void;
    onClose: (reason?: CloseReason) => void;
}

export const MasterChecklistPopover: React.FC<MasterChecklistPopoverProps> = React.memo(({
    draft,
    items: providedItems,
    anchorRef,
    ignoreSelector,
    onChange,
    onClose,
}) => {
    const uid = useId();
    const [activeTab, setActiveTab] = useState<MasterChecklistTab>("seo");
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
    const popoverRef = useClickOutside(onClose, ignoreSelector, true);

    const items = useMemo(() => providedItems ?? getMasterChecklistItems(draft), [providedItems, draft]);
    const grouped = useMemo(() => {
        const byTab: Record<MasterChecklistTab, { items: MasterCheckItem[]; passed: number }> = {
            seo: { items: [], passed: 0 },
            rewards: { items: [], passed: 0 },
            psychology: { items: [], passed: 0 },
        };
        let totalPassed = 0;
        for (const item of items) {
            const bucket = byTab[item.category];
            bucket.items.push(item);
            if (item.passed) {
                bucket.passed++;
                totalPassed++;
            }
        }
        return { byTab, totalPassed };
    }, [items]);
    const tabItems = grouped.byTab[activeTab].items;

    useLayoutEffect(() => {
        const updatePosition = () => {
            const el = popoverRef.current;
            const anchor = anchorRef?.current ?? el?.parentElement;
            if (!el || !anchor) return;
            const rect = anchor.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const width = elRect.width || Math.min(360, window.innerWidth - 24);
            const height = elRect.height || 360;
            const maxLeft = Math.max(12, window.innerWidth - width - 12);
            const maxTop = Math.max(12, window.innerHeight - height - 12);
            el.style.left = `${clamp(rect.left, 12, maxLeft)}px`;
            el.style.top = `${clamp(rect.bottom + 6, 12, maxTop)}px`;
        };
        const ac = new AbortController();
        updatePosition();
        window.addEventListener("resize", updatePosition, { signal: ac.signal });
        window.addEventListener("scroll", updatePosition, { capture: true, passive: true, signal: ac.signal });
        return () => ac.abort();
    }, [activeTab, tabItems.length, anchorRef, popoverRef]);

    const handleTabKeyDown = (e: React.KeyboardEvent, idx: number) => {
        let nextIdx = idx;
        if (e.key === "ArrowRight") nextIdx = (idx + 1) % TAB_META.length;
        else if (e.key === "ArrowLeft") nextIdx = (idx - 1 + TAB_META.length) % TAB_META.length;
        else if (e.key === "Home") nextIdx = 0;
        else if (e.key === "End") nextIdx = TAB_META.length - 1;
        else return;
        e.preventDefault();
        setActiveTab(TAB_META[nextIdx]!.id);
        tabRefs.current[nextIdx]?.focus();
    };

    const dialog = (
        <div
            ref={popoverRef}
            role="dialog"
            aria-label="Video Standards Checklist"
            className="tpe-checklist-popover"
        >
            <div className="tpe-flex-row tpe-checklist-header">
                <span className="tpe-checklist-title tpe-tabular-nums">
                    VIDEO STANDARDS ({grouped.totalPassed}/{items.length})
                </span>
                <button
                    type="button"
                    aria-label="Close Standards Checklist"
                    onClick={() => onClose("escape")}
                    className="tpe-checklist-close"
                    title="Close Standards Checklist"
                >
                    ✕
                </button>
            </div>

            <div className="tpe-mode-cluster tpe-checklist-tabs" role="tablist" aria-label="Master Video Standards categories">
                {TAB_META.map((tab, idx) => {
                    const bucket = grouped.byTab[tab.id];
                    const selected = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            ref={(el) => { tabRefs.current[idx] = el; }}
                            id={`${uid}-tab-${tab.id}`}
                            type="button"
                            role="tab"
                            aria-selected={selected}
                            aria-controls={`${uid}-panel-${tab.id}`}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => setActiveTab(tab.id)}
                            onKeyDown={(e) => handleTabKeyDown(e, idx)}
                            className="tpe-mode-btn tpe-checklist-tab tpe-tabular-nums"
                            data-active={selected}
                        >
                            {tab.label} ({bucket.passed}/{bucket.items.length})
                        </button>
                    );
                })}
            </div>

            <div
                id={`${uid}-panel-${activeTab}`}
                role="tabpanel"
                aria-labelledby={`${uid}-tab-${activeTab}`}
                className="tpe-flex-col tpe-checklist-list"
            >
                {tabItems.map((item) => {
                    const tone = item.tone ?? (item.passed ? "green" : "orange");
                    return (
                        <div key={item.id} className="tpe-flex-row tpe-checklist-row" data-tone={tone}>
                            <div className="tpe-flex-col tpe-checklist-copy">
                                <span className="tpe-checklist-label">
                                    {item.passed ? "✓" : "•"} {item.label}
                                </span>
                                <span className="tpe-checklist-detail">
                                    {item.detail}
                                </span>
                            </div>
                            {!item.passed && item.onFix && item.fixLabel && (
                                <button
                                    type="button"
                                    onClick={() => onChange(item.onFix!(draft))}
                                    className="tpe-mode-btn tpe-checklist-fix"
                                >
                                    {item.fixLabel}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );

    return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
});
MasterChecklistPopover.displayName = "MasterChecklistPopover";

interface MasterChecklistControlProps {
    draft: VideoDraft;
    onChange: (draft: VideoDraft) => void;
    variant: "mobile" | "desktop";
}

export const MasterChecklistControl: React.FC<MasterChecklistControlProps> = React.memo(({
    draft,
    onChange,
    variant,
}) => {
    const uid = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [isOpen, setIsOpen] = useState(false);
    const handleClose = useCallback((reason?: CloseReason) => {
        setIsOpen(false);
        if (reason === "escape") triggerRef.current?.focus();
    }, []);
    const items = useMemo(() => getMasterChecklistItems(draft), [draft]);
    const passed = items.filter((item) => item.passed).length;
    const isMobile = variant === "mobile";

    return (
        <div className={isMobile ? "tpe-checklist-anchor" : "tpe-desktop-checklist-control tpe-checklist-anchor"}>
            <button
                ref={triggerRef}
                type="button"
                data-checklist-trigger={uid}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-label={`Video standards checklist: ${passed} of ${items.length} checks passed`}
                onClick={() => setIsOpen((open) => !open)}
                className="tpe-mode-btn tpe-checklist-trigger"
                data-variant={variant}
                data-active={isOpen || passed === items.length}
                title={`Video standards checklist (${passed}/${items.length})`}
            >
                <span aria-hidden="true" className="tpe-checklist-trigger-icon">📋</span>
                <span className="tpe-tabular-nums">{passed}/{items.length}</span>
            </button>
            {isOpen && (
                <MasterChecklistPopover
                    draft={draft}
                    items={items}
                    anchorRef={triggerRef}
                    ignoreSelector={`[data-checklist-trigger="${uid}"]`}
                    onChange={onChange}
                    onClose={handleClose}
                />
            )}
        </div>
    );
});
MasterChecklistControl.displayName = "MasterChecklistControl";
