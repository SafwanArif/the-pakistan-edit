"use client";

import React, { useMemo, useDeferredValue } from "react";
import { Draft } from "../../../types/news";
import { NewsCard } from "../../../components/templates/instagram/NewsCard/index";
import { OMNI_CONFIG, Platform } from "../../../config/omnichannel";
import { TikTokIcon, InstagramIcon, XIcon } from "../../../components/icons/TPEIcons";
import { useContainerScale } from "../hooks/useContainerScale";

interface PreviewItemProps {
    p: { id: Platform; label: string; w: number; h: number };
    displayDraft: Draft;
    currentStep: number;
}

const PreviewItem = React.memo<PreviewItemProps>(({ p, displayDraft, currentStep }) => {
    const { ref, scale } = useContainerScale(p.w);

    return (
        <div style={{ background: 'var(--ui-bg)', borderRadius: '16px', border: '1px solid var(--ui-border)', overflow: 'hidden', boxShadow: 'var(--shadow-lg)', display: 'flex', flexDirection: 'column', alignSelf: 'center' }}>
            <div className="tpe-flex-row" style={{ padding: '12px 16px', borderBlockEnd: '1px solid var(--ui-border)', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--ui-text-dim)', letterSpacing: '0.05em', justifyContent: 'space-between', background: 'oklch(from var(--ui-bg) l c h / 0.5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    {p.id === "tiktok" && <TikTokIcon width={12} height={12} />}
                    {p.id === "square" && <XIcon width={12} height={12} />}
                    {p.id === "instagram" && <InstagramIcon width={12} height={12} />}
                    <span>{p.label}</span>
                </div>
                <div style={{ fontSize: '9px', fontWeight: 600, color: 'oklch(from var(--ui-text) l c h / 0.1)', letterSpacing: '0.1em' }}>{p.w} × {p.h}</div>
            </div>
            <div ref={ref} style={{ width: '100%', position: "relative", overflow: "hidden", background: '#111', display: 'flex', justifyContent: 'center', aspectRatio: `${p.w} / ${p.h}` }}>
                <div style={{ position: "absolute", insetBlockStart: 0, transformOrigin: "top center", transform: `scale(${scale})`, width: `${p.w}px`, height: `${p.h}px` }}>
                    <NewsCard 
                        draft={displayDraft} 
                        step={currentStep} 
                        platform={p.id} 
                    />
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
export const OmniPreviewGrid: React.FC<{ draft: Draft; currentStep: number }> = ({ draft, currentStep }) => {
    const deferredDraft = useDeferredValue(draft);

    const displayDraft = useMemo(() => ({
        ...deferredDraft,
        headline: deferredDraft.headline || "^THE STATE BANK^ ANNOUNCES NEW DIGITAL TRADE POLICY FOR 2027",
        category: deferredDraft.category || "ECONOMY",
        summary: deferredDraft.summary || "In a sweeping move to modernize the economy, officials have fully greenlit the national blockchain infrastructure, paving the way for frictionless global exports and deep tech integration.",
        image: deferredDraft.image || "https://images.unsplash.com/photo-1590409279774-7221bfad3dd9?q=80&w=1200&auto=format&fit=crop",
    }), [deferredDraft]);

    const platformConfigs = useMemo(() => {
        const platforms: Platform[] = ["tiktok", "instagram", "square"];
        return platforms.map(platform => ({
            id: platform,
            label: platform === "tiktok" ? "TikTok" : platform === "square" ? "X / FB" : "Instagram",
            w: OMNI_CONFIG[platform].width,
            h: OMNI_CONFIG[platform].height
        }));
    }, []);
    
    return (
        <div className="tpe-flex-col" style={{ inlineSize: '100%', blockSize: '100%' }}>
            <div className="previews-container">
                {platformConfigs.map(p => (
                    <PreviewItem key={p.id} p={p} displayDraft={displayDraft} currentStep={currentStep} />
                ))}
            </div>
        </div>
    );
};
