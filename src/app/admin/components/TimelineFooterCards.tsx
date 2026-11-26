"use client";

import React from "react";
import { DEFAULT_OUTRO_CTA } from "@/types/news";
import { CloseIcon } from "@/components/icons/TPEIcons";
import { isActivationKey, stopEventPropagation } from "../utils/domUtils";

interface TimelineFooterCardsProps {
    enableOutro: boolean;
    onAddAngle: () => void;
    onAddOutro: () => void;
}

interface TimelineOutroCardProps {
    sceneCount: number;
    outroDuration?: number;
    outroCta?: string;
    outroStart: number;
    isOutroActive: boolean;
    onSeekOutro: (t: number) => void;
    onRemoveOutro: () => void;
}

/** Compact actions for adding an angle or navigating to the optional Outro. */
export const TimelineFooterCards: React.FC<TimelineFooterCardsProps> = React.memo(({
    enableOutro,
    onAddAngle,
    onAddOutro,
}) => (
    <>
        <button type="button" onClick={onAddAngle} className="tpe-add-angle-btn">
            <span aria-hidden="true" className="tpe-footer-plus">+</span>
            <span className="tpe-footer-label">ADD ANGLE</span>
        </button>
        <button
            type="button"
            aria-label={enableOutro ? "Go to Outro" : "Add Outro"}
            onClick={onAddOutro}
            className="tpe-add-outro-btn"
            data-active={enableOutro}
            title={enableOutro ? "Go to Outro card" : "Add branded Outro card"}
        >
            <span aria-hidden="true" className="tpe-footer-check">{enableOutro ? "✓" : "+"}</span>
            <span className="tpe-footer-label">{enableOutro ? "OUTRO ADDED" : "ADD OUTRO"}</span>
        </button>
    </>
));
TimelineFooterCards.displayName = "TimelineFooterCards";

/** Branded Outro card rendered as the final slide in the storyboard rack. */
export const TimelineOutroCard: React.FC<TimelineOutroCardProps> = React.memo(({
    sceneCount,
    outroDuration = 5,
    outroCta,
    outroStart,
    isOutroActive,
    onSeekOutro,
    onRemoveOutro,
}) => (
    <div
        role="button"
        tabIndex={isOutroActive ? -1 : 0}
        aria-label={isOutroActive ? "Outro active" : "Jump to Outro"}
        onClick={() => { if (!isOutroActive) onSeekOutro(outroStart); }}
        onKeyDown={(e) => {
            if (!isOutroActive && isActivationKey(e.key)) {
                e.preventDefault();
                onSeekOutro(outroStart);
            }
        }}
        className="tpe-scene-card tpe-outro-card"
        data-active={isOutroActive}
    >
        <div className="tpe-flex-row tpe-scene-card-row">
            <div className="tpe-flex-row tpe-scene-card-head-left">
                <span className="tpe-scene-card-label">
                    {String(sceneCount + 1).padStart(2, '0')}. OUTRO
                </span>
                {isOutroActive && <span className="tpe-outro-playing-pill">PLAYING</span>}
            </div>
            <div className="tpe-flex-row tpe-scene-card-head-left" onClick={stopEventPropagation} onKeyDown={stopEventPropagation}>
                <span className="tpe-tabular-nums tpe-outro-dur">{outroDuration}s</span>
                <button
                    type="button"
                    aria-label="Remove Outro"
                    className="tpe-asset-btn tpe-asset-btn-danger tpe-storyboard-remove-btn"
                    onClick={onRemoveOutro}
                    title="Remove Outro"
                >
                    <CloseIcon width={16} height={16} />
                </button>
            </div>
        </div>
        <div className="tpe-outro-cta-box" data-active={isOutroActive} title="Click to jump to Outro">
            <div dir="auto" className="tpe-outro-cta-text">
                {outroCta || DEFAULT_OUTRO_CTA}
            </div>
            {isOutroActive && <div className="tpe-outro-edit-hint">✎ EDITING IN TOP BAR</div>}
        </div>
    </div>
));
TimelineOutroCard.displayName = "TimelineOutroCard";
