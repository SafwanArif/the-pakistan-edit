"use client";

import React, { useMemo, useDeferredValue } from "react";
import { Draft } from "@/types/news";
import { NewsCard } from "@/components/templates/NewsCard/index";
import { OMNI_CONFIG, Platform } from "@/config/omnichannel";
import { TikTokIcon, InstagramIcon, XIcon } from "@/components/icons/TPEIcons";
import { useContainerScale } from "../hooks/useContainerScale";

const PLATFORM_CONFIGS: { id: Platform; label: string; w: number; h: number }[] = (
    ["tiktok", "instagram", "square"] as const
).map((platform) => ({
    id: platform,
    label: platform === "tiktok" ? "TikTok" : platform === "square" ? "X / FB" : "Instagram",
    w: OMNI_CONFIG[platform].width,
    h: OMNI_CONFIG[platform].height,
}));

const DEFAULT_HEADLINE = "==THE STATE BANK== ANNOUNCES NEW DIGITAL TRADE POLICY FOR 2027";
const DEFAULT_CATEGORY = "ECONOMY";
const DEFAULT_SUMMARY = "In a sweeping move to modernize the economy, officials have fully greenlit the national blockchain infrastructure, paving the way for frictionless global exports and deep tech integration.";
const DEFAULT_IMAGE = "https://images.unsplash.com/photo-1590409279774-7221bfad3dd9?q=80&w=1200&auto=format&fit=crop";

interface PreviewItemProps {
    p: { id: Platform; label: string; w: number; h: number };
    displayDraft: Draft;
    currentStep: number;
}

const PreviewItem = React.memo<PreviewItemProps>(({ p, displayDraft, currentStep }) => {
    const { ref, scale } = useContainerScale(p.w);

    return (
        <div className="tpe-omni-card">
            <div className="tpe-flex-row tpe-omni-header">
                <div className="tpe-omni-title">
                    {p.id === "tiktok" && <TikTokIcon width={12} height={12} aria-hidden="true" />}
                    {p.id === "square" && <XIcon width={12} height={12} aria-hidden="true" />}
                    {p.id === "instagram" && <InstagramIcon width={12} height={12} aria-hidden="true" />}
                    <span>{p.label}</span>
                </div>
                <div className="tpe-omni-dims tpe-tabular-nums">{p.w} × {p.h}</div>
            </div>
            <div ref={ref} className="tpe-omni-stage" style={{ aspectRatio: `${p.w} / ${p.h}` }}>
                <div className="tpe-omni-scaler" style={{ transform: `scale(${scale})`, width: `${p.w}px`, height: `${p.h}px` }}>
                    <NewsCard draft={displayDraft} step={currentStep} platform={p.id} />
                </div>
            </div>
        </div>
    );
});
PreviewItem.displayName = "PreviewItem";

/**
 * 2027 Institutional Standard: OmniPreviewGrid
 * Optimized for high-speed narrative ingestion with sub-pixel precision scaling.
 */
export const OmniPreviewGrid: React.FC<{ draft: Draft; currentStep: number }> = React.memo(({ draft, currentStep }) => {
    const deferredDraft = useDeferredValue(draft);

    const displayDraft = useMemo(() => {
        if (deferredDraft.headline && deferredDraft.category && deferredDraft.summary && deferredDraft.image) {
            return deferredDraft;
        }
        return {
            ...deferredDraft,
            headline: deferredDraft.headline || DEFAULT_HEADLINE,
            category: deferredDraft.category || DEFAULT_CATEGORY,
            summary: deferredDraft.summary || DEFAULT_SUMMARY,
            image: deferredDraft.image || DEFAULT_IMAGE,
        };
    }, [deferredDraft]);

    return (
        <div className="tpe-flex-col tpe-omni-shell">
            <div className="previews-container">
                {PLATFORM_CONFIGS.map((p) => (
                    <PreviewItem key={p.id} p={p} displayDraft={displayDraft} currentStep={currentStep} />
                ))}
            </div>
        </div>
    );
});
OmniPreviewGrid.displayName = "OmniPreviewGrid";
