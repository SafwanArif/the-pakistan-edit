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

const menuShellStyle: React.CSSProperties = { position: "relative", flexShrink: 0 };
const triggerBtnStyle: React.CSSProperties = { background: "transparent", border: "none", padding: 0 };
const menuTrayStyle: React.CSSProperties = { insetInlineStart: 0, insetInlineEnd: "auto", minWidth: "160px", gap: "6px", padding: "8px" };
const menuOptionStyle: React.CSSProperties = { width: "100%", justifyContent: "flex-start", padding: "7px 10px" };
const resetOptionStyle: React.CSSProperties = { ...menuOptionStyle, color: "var(--ui-text-dim)" };
const confirmResetOptionStyle: React.CSSProperties = { ...menuOptionStyle, color: "var(--ui-danger)", borderColor: "var(--ui-danger)" };
const separatorStyle: React.CSSProperties = { width: "100%", height: "1px", background: "var(--ui-border)", marginBlock: "2px" };
const glossaryHeaderStyle: React.CSSProperties = { fontSize: "9px", fontWeight: 900, letterSpacing: "0.08em", color: "var(--ui-accent)", paddingInline: "10px", paddingBlockStart: "4px" };
const glossaryRowStyle: React.CSSProperties = { justifyContent: "space-between", alignItems: "center", fontSize: "10px", paddingInline: "10px", gap: "8px" };
const glossaryCodeStyle: React.CSSProperties = { fontFamily: "monospace", color: "var(--ui-text-dim)", fontSize: "9px", flexShrink: 0 };
const gv = (s: React.CSSProperties): React.CSSProperties => ({ fontSize: "9px", textAlign: "end", ...s });

const STUDIO_MODES: readonly { id: PostMode; label: string; title: string }[] = [
    { id: "carousel", label: "CAROUSEL MODE", title: "Switch to Carousel Mode" },
    { id: "video", label: "VIDEO MODE", title: "Switch to Video Mode" },
];

const FX_GLOSSARY_ITEMS: readonly [token: string, label: string, style: React.CSSProperties][] = [
    ['==text==', 'Gold Text', gv({ color: 'var(--ui-accent)', fontWeight: 800 })],
    ['**text**', 'Bold', gv({ fontWeight: 800 })],
    ['*text*', 'Italic', gv({ fontStyle: 'italic', color: 'var(--ui-text-dim)' })],
    ['~~text~~', 'Green Text', gv({ color: 'var(--ui-indicator)', fontWeight: 800 })],
    ['^^text^^', 'Black Label Box', gv({ background: '#000', color: '#fff', padding: '1px 5px', borderRadius: '2px', fontWeight: 800, border: '1px solid var(--ui-border)' })],
    ['&&text&&', 'White Label Box', gv({ background: '#fff', color: '#050505', padding: '1px 5px', borderRadius: '2px', fontWeight: 800 })],
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
        void Promise.resolve(onReset()).catch((err) => console.error("RESET_DRAFT_ERROR:", err));
    };

    const triggerLabel = isOpen ? "Close mode and draft menu" : "Open mode and draft menu";
    const modeLabel = mode === "carousel" ? "CAROUSEL" : "VIDEO";

    return (
        <div ref={menuRef} style={menuShellStyle}>
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                aria-label={triggerLabel}
                aria-expanded={isOpen}
                aria-haspopup="menu"
                title={triggerLabel}
                className="tpe-logo-wrapper"
                style={triggerBtnStyle}
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
                <div role="menu" aria-label="Mode and draft options" className="tpe-asset-tray-expanded tpe-flex-col" style={menuTrayStyle}>
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
                                className="tpe-mode-btn"
                                style={menuOptionStyle}
                                title={opt.title}
                                onClick={() => { setConfirmReset(false); setIsOpen(false); if (opt.id !== mode) onModeChange(opt.id); }}
                            >
                                {opt.id === "carousel" ? <CarouselIcon width={12} height={12} stroke={stroke} /> : <VideoIcon width={12} height={12} stroke={stroke} />}
                                <span>{opt.label}</span>
                            </button>
                        );
                    })}

                    <div role="separator" style={separatorStyle} />
                    <div style={glossaryHeaderStyle}>TEXT FORMATTING</div>
                    {FX_GLOSSARY_ITEMS.map(([token, label, style]) => (
                        <div key={token} className="tpe-flex-row" style={glossaryRowStyle}>
                            <code style={glossaryCodeStyle}>{token}</code>
                            <span style={style}>{label}</span>
                        </div>
                    ))}

                    {onReset && (
                        <>
                            <div role="separator" style={separatorStyle} />
                            <button
                                type="button"
                                role="menuitem"
                                className="tpe-mode-btn"
                                onClick={handleReset}
                                style={confirmReset ? confirmResetOptionStyle : resetOptionStyle}
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
