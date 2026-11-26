"use client";

import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
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
import { useClickOutside } from "../hooks/useClickOutside";

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

const TONE_PALETTES: Record<NonNullable<MasterCheckItem["tone"]>, { text: string; bg: string; border: string }> = {
    green: { text: "#4ade80", bg: "rgba(34, 197, 94, 0.08)", border: "rgba(34, 197, 94, 0.25)" },
    red: { text: "#f87171", bg: "rgba(239, 68, 68, 0.10)", border: "rgba(239, 68, 68, 0.30)" },
    yellow: { text: "#facc15", bg: "rgba(250, 204, 21, 0.09)", border: "rgba(250, 204, 21, 0.30)" },
    orange: { text: "#fb923c", bg: "rgba(249, 115, 22, 0.10)", border: "rgba(249, 115, 22, 0.30)" },
};

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
    onChange: (draft: VideoDraft) => void;
    onClose: () => void;
}

export const MasterChecklistPopover: React.FC<MasterChecklistPopoverProps> = React.memo(({
    draft,
    items: providedItems,
    onChange,
    onClose,
}) => {
    const [activeTab, setActiveTab] = useState<MasterChecklistTab>("seo");
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
    const popoverRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const el = popoverRef.current;
        const parent = el?.parentElement;
        if (!el || !parent) return;
        const rect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const width = elRect.width || Math.min(360, window.innerWidth - 24);
        const height = elRect.height || 360;
        const maxLeft = Math.max(12, window.innerWidth - width - 12);
        const maxTop = Math.max(12, window.innerHeight - height - 12);
        el.style.left = `${clamp(rect.left, 12, maxLeft)}px`;
        el.style.top = `${clamp(rect.bottom + 6, 12, maxTop)}px`;
    }, [activeTab, tabItems.length]);

    return (
        <div
            ref={popoverRef}
            role="dialog"
            aria-label="Video Standards Checklist"
            style={{
                position: "fixed",
                top: "96px",
                left: "12px",
                width: "min(360px, calc(100vw - 24px))",
                maxHeight: "calc(100dvh - 24px)",
                overflowY: "auto",
                background: "var(--ui-bg-popover)",
                border: "1px solid var(--ui-accent)",
                boxShadow: "0 14px 36px rgba(0,0,0,0.85)",
                zIndex: 90,
                borderRadius: "8px",
                padding: "10px",
            }}
        >
            <div className="tpe-flex-row" style={{ justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "9px", fontWeight: 800, color: "var(--ui-accent)", letterSpacing: "0.08em" }}>
                    VIDEO STANDARDS ({grouped.totalPassed}/{items.length})
                </span>
                <button
                    type="button"
                    aria-label="Close Standards Checklist"
                    onClick={onClose}
                    style={{ background: "none", border: "none", color: "var(--ui-text-secondary)", cursor: "pointer", fontSize: "10px", padding: "0 4px" }}
                    title="Close Standards Checklist"
                >
                    ✕
                </button>
            </div>

            <div className="tpe-mode-cluster" role="tablist" aria-label="Master Video Standards categories" style={{ width: "100%", marginBottom: "8px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
                {TAB_META.map((tab) => {
                    const bucket = grouped.byTab[tab.id];
                    return (
                        <button
                            key={tab.id}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className="tpe-mode-btn"
                            data-active={activeTab === tab.id}
                            style={{ justifyContent: "center", padding: "5px 4px", fontSize: "8px", whiteSpace: "nowrap" }}
                        >
                            {tab.label} ({bucket.passed}/{bucket.items.length})
                        </button>
                    );
                })}
            </div>

            <div className="tpe-flex-col" style={{ gap: "5px", maxHeight: "300px", overflowY: "auto" }}>
                {tabItems.map((item) => {
                    const tone = item.tone ?? (item.passed ? "green" : "orange");
                    const palette = TONE_PALETTES[tone];
                    return (
                    <div
                        key={item.id}
                        className="tpe-flex-row"
                        style={{
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: "8px",
                            padding: "5px 7px",
                            borderRadius: "6px",
                            background: palette.bg,
                            border: `1px solid ${palette.border}`,
                        }}
                    >
                        <div className="tpe-flex-col" style={{ gap: "1px", minWidth: 0 }}>
                            <span style={{ fontSize: "9px", fontWeight: 700, color: palette.text }}>
                                {item.passed ? "✓" : "•"} {item.label}
                            </span>
                            <span style={{ fontSize: "8px", color: "var(--ui-text-secondary)", lineHeight: 1.3 }}>
                                {item.detail}
                            </span>
                        </div>
                        {!item.passed && item.onFix && item.fixLabel && (
                            <button
                                type="button"
                                onClick={() => onChange(item.onFix!(draft))}
                                className="tpe-mode-btn"
                                style={{ padding: "2px 6px", fontSize: "8px", flexShrink: 0 }}
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
    const [isOpen, setIsOpen] = useState(false);
    const handleClose = useCallback(() => setIsOpen(false), []);
    const checklistRef = useClickOutside(handleClose, undefined, isOpen);
    const items = useMemo(() => getMasterChecklistItems(draft), [draft]);
    const passed = items.filter((item) => item.passed).length;
    const isMobile = variant === "mobile";

    return (
        <div ref={checklistRef} className={isMobile ? "tpe-mobile-checklist-control" : "tpe-desktop-checklist-control"} style={{ position: "relative" }}>
            <button
                type="button"
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-label={`Video standards checklist: ${passed} of ${items.length} checks passed`}
                onClick={() => setIsOpen((open) => !open)}
                className="tpe-mode-btn"
                data-active={isOpen || passed === items.length}
                style={isMobile
                    ? { height: "20px", padding: "0 4px", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "3px" }
                    : { padding: "4px 8px", fontSize: "9px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                title={`Video standards checklist (${passed}/${items.length})`}
            >
                <span aria-hidden="true" style={{ fontSize: "11px", lineHeight: "11px", display: "inline-flex" }}>📋</span>
                <span style={isMobile ? { fontSize: "8px" } : undefined}>{passed}/{items.length}</span>
            </button>
            {isOpen && (
                <MasterChecklistPopover
                    draft={draft}
                    items={items}
                    onChange={onChange}
                    onClose={handleClose}
                />
            )}
        </div>
    );
});

MasterChecklistControl.displayName = "MasterChecklistControl";
