"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import type { PostMode } from "@/types/news";
import { CarouselIcon, VideoIcon } from "@/components/icons/TPEIcons";
import { TPEVectorLogo, type LogoMotionConfig } from "@/components/templates/TPEVectorLogo";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";

interface CommandRibbonMenuProps {
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
    onReset?: () => void | Promise<void>;
    disabled?: boolean;
}

const STUDIO_MODES: readonly { id: PostMode; label: string; title: string }[] = [
    { id: "carousel", label: "CAROUSEL MODE", title: "Switch to Carousel Mode" },
    { id: "video", label: "VIDEO MODE", title: "Switch to Video Mode" },
];

const FX_GLOSSARY_ITEMS: readonly [token: string, label: string, fx: string][] = [
    ['==text==', 'Gold Text', 'gold'],
    ['**text**', 'Bold', 'bold'],
    ['*text*', 'Italic', 'italic'],
    ['~~text~~', 'Green Text', 'green'],
    ['^^text^^', 'Black Label Box', 'black'],
    ['&&text&&', 'White Label Box', 'white'],
];

/** Brand logo trigger and dropdown menu for studio mode switching, formatting glossary, and draft reset. */
export const CommandRibbonMenu: React.FC<CommandRibbonMenuProps> = React.memo(({ mode, onModeChange, onReset, disabled = false }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [animationNonce, setAnimationNonce] = useState(0);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const handleCloseMenu = useCallback((reason?: CloseReason) => {
        setIsOpen(false);
        setConfirmReset(false);
        if (reason === "escape") triggerRef.current?.focus();
    }, []);

    const menuRef = useClickOutside(handleCloseMenu, undefined, isOpen && !disabled);
    const logoMotionConfig = useMemo<LogoMotionConfig>(() => ({ previewNonce: animationNonce }), [animationNonce]);

    const handleReset = () => {
        if (!onReset) return;
        if (!confirmReset) { setConfirmReset(true); return; }
        setConfirmReset(false);
        setIsOpen(false);
        triggerRef.current?.focus();
        void Promise.resolve(onReset()).catch((err) => console.error("RESET_DRAFT_ERROR:", err));
    };

    const triggerLabel = isOpen ? "Close mode and draft menu" : "Open mode and draft menu";
    const modeLabel = mode === "carousel" ? "CAROUSEL" : "VIDEO";

    return (
        <div ref={menuRef} className="tpe-ribbon-menu">
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                aria-label={triggerLabel}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                title={triggerLabel}
                className="tpe-logo-wrapper tpe-ribbon-trigger"
                onClick={() => {
                    if (disabled) return;
                    setAnimationNonce((n) => n + 1);
                    setConfirmReset(false);
                    setIsOpen((o) => !o);
                }}
            >
                <TPEVectorLogo scale={0.9} showWordmark={false} motionConfig={logoMotionConfig} />
            </button>

            {isOpen && !disabled && (
                <div role="menu" aria-label="Mode and draft options" className="tpe-asset-tray-expanded tpe-flex-col tpe-ribbon-menu-tray">
                    {STUDIO_MODES.map((opt) => {
                        const active = mode === opt.id;
                        const stroke = active ? "#000" : "currentColor";
                        return (
                            <button
                                key={opt.id}
                                type="button"
                                role="menuitemradio"
                                aria-checked={active}
                                data-active={active}
                                className="tpe-mode-btn tpe-ribbon-menu-option"
                                title={opt.title}
                                onClick={() => {
                                    setConfirmReset(false);
                                    setIsOpen(false);
                                    if (opt.id !== mode) onModeChange(opt.id);
                                    else triggerRef.current?.focus();
                                }}
                            >
                                {opt.id === "carousel" ? <CarouselIcon width={12} height={12} stroke={stroke} /> : <VideoIcon width={12} height={12} stroke={stroke} />}
                                <span>{opt.label}</span>
                            </button>
                        );
                    })}

                    <div role="separator" className="tpe-ribbon-sep" />
                    <div className="tpe-glossary-header">TEXT FORMATTING</div>
                    {FX_GLOSSARY_ITEMS.map(([token, label, fx]) => (
                        <div key={token} className="tpe-flex-row tpe-glossary-row">
                            <code className="tpe-glossary-code">{token}</code>
                            <span className="tpe-glossary-val" data-fx={fx}>{label}</span>
                        </div>
                    ))}

                    {onReset && (
                        <>
                            <div role="separator" className="tpe-ribbon-sep" />
                            <button
                                type="button"
                                role="menuitem"
                                className="tpe-mode-btn tpe-ribbon-menu-reset"
                                data-confirm={confirmReset}
                                onClick={handleReset}
                                title={confirmReset ? `Click again to confirm resetting ${mode} draft` : `Reset ${mode} draft`}
                            >
                                {confirmReset ? `CONFIRM RESET ${modeLabel}?` : `RESET ${modeLabel} DRAFT`}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});
CommandRibbonMenu.displayName = "CommandRibbonMenu";
