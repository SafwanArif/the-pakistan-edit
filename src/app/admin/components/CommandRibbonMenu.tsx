"use client";

import React, { useMemo, useState } from "react";
import { PostMode } from "@/types/news";
import { CarouselIcon, VideoIcon } from "@/components/icons/TPEIcons";
import { TPEVectorLogo, type LogoMotionConfig } from "@/components/templates/TPEVectorLogo";
import { useClickOutside } from "../hooks/useClickOutside";

interface CommandRibbonMenuProps {
    mode: PostMode;
    onModeChange: (mode: PostMode) => void;
    onReset?: () => void | Promise<void>;
}

const menuOptionStyle: React.CSSProperties = {
    width: "100%",
    justifyContent: "flex-start",
    padding: "7px 10px",
};

const FX_GLOSSARY_ITEMS: { token: string; label: string; style: React.CSSProperties }[] = [
    { token: '==text==', label: 'Gold Text', style: { color: 'var(--ui-accent)', fontWeight: 800 } },
    { token: '**text**', label: 'Bold', style: { fontWeight: 800 } },
    { token: '*text*', label: 'Italic', style: { fontStyle: 'italic', color: 'var(--ui-text-dim)' } },
    { token: '~~text~~', label: 'Green Text', style: { color: 'var(--ui-indicator)', fontWeight: 800 } },
    { token: '^^text^^', label: 'Black Label Box', style: { background: '#000', color: '#fff', padding: '1px 5px', borderRadius: '2px', fontWeight: 800, border: '1px solid var(--ui-border)' } },
    { token: '&&text&&', label: 'White Label Box', style: { background: '#fff', color: '#050505', padding: '1px 5px', borderRadius: '2px', fontWeight: 800 } },
];

export const CommandRibbonMenu: React.FC<CommandRibbonMenuProps> = React.memo(({ mode, onModeChange, onReset }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [animationNonce, setAnimationNonce] = useState(0);
    const menuRef = useClickOutside(() => {
        setIsOpen(false);
        setConfirmReset(false);
    }, undefined, isOpen);

    const logoMotionConfig = useMemo<LogoMotionConfig>(() => ({
        previewNonce: animationNonce,
        morphDuration: 0.45,
        holdDuration: 0.5,
        starScale: 100,
        spinMode: 'ccw',
        sequence: 'star-crescent',
        holdFeel: 'drift',
    }), [animationNonce]);

    const handleReset = () => {
        if (!onReset) return;
        if (!confirmReset) {
            setConfirmReset(true);
            return;
        }
        setConfirmReset(false);
        setIsOpen(false);
        void onReset();
    };

    const selectMode = (nextMode: PostMode) => {
        setConfirmReset(false);
        onModeChange(nextMode);
        setIsOpen(false);
    };
    
    const handleLogoClick = () => {
        setAnimationNonce(prev => prev + 1);
        setConfirmReset(false);
        setIsOpen(open => !open);
    };

    return (
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
                type="button"
                aria-label="Open mode and draft menu"
                aria-expanded={isOpen}
                aria-haspopup="menu"
                onClick={handleLogoClick}
                className="tpe-logo-wrapper"
                style={{ background: "transparent", border: "none", padding: 0 }}
                title="Open mode and draft menu"
            >
                <TPEVectorLogo
                    scale={0.9}
                    showWordmark={false}
                    motionConfig={logoMotionConfig}
                />
            </button>

            {isOpen && (
                <div
                    role="menu"
                    aria-label="Mode and draft options"
                    className="tpe-asset-tray-expanded tpe-flex-col"
                    style={{ left: 0, right: "auto", minWidth: "160px", gap: "6px", padding: "8px" }}
                >
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={mode === "carousel"}
                        data-active={mode === "carousel"}
                        className="tpe-mode-btn"
                        onClick={() => selectMode("carousel")}
                        style={menuOptionStyle}
                        title="Switch to Carousel Mode"
                    >
                        <CarouselIcon width={12} height={12} stroke={mode === "carousel" ? "#000" : "currentColor"} />
                        <span>CAROUSEL MODE</span>
                    </button>
                    <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={mode === "video"}
                        data-active={mode === "video"}
                        className="tpe-mode-btn"
                        onClick={() => selectMode("video")}
                        style={menuOptionStyle}
                        title="Switch to Video Mode"
                    >
                        <VideoIcon width={12} height={12} stroke={mode === "video" ? "#000" : "currentColor"} />
                        <span>VIDEO MODE</span>
                    </button>
                    
                    <div role="separator" style={{ width: "100%", height: "1px", background: "var(--ui-border)", marginBlock: "2px" }} />
                    
                    <div style={{ fontSize: '9px', fontWeight: 900, letterSpacing: '0.08em', color: 'var(--ui-accent)', paddingInline: '10px', paddingBlockStart: '4px' }}>
                        TEXT FORMATTING
                    </div>
                    {FX_GLOSSARY_ITEMS.map((item) => (
                        <div key={item.token} className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', fontSize: '10px', paddingInline: '10px', gap: '8px' }}>
                            <code style={{ fontFamily: 'monospace', color: 'var(--ui-text-dim)', fontSize: '9px', flexShrink: 0 }}>{item.token}</code>
                            <span style={{ ...item.style, fontSize: '9px', textAlign: 'right' }}>{item.label}</span>
                        </div>
                    ))}
                    
                    {onReset && (
                        <>
                            <div role="separator" style={{ width: "100%", height: "1px", background: "var(--ui-border)", marginBlock: "2px" }} />
                            <button
                                type="button"
                                role="menuitem"
                                className="tpe-mode-btn"
                                onClick={handleReset}
                                style={{
                                    ...menuOptionStyle,
                                    color: confirmReset ? "var(--ui-danger)" : "var(--ui-text-dim)",
                                    borderColor: confirmReset ? "var(--ui-danger)" : undefined,
                                }}
                                title={confirmReset ? `Click again to confirm resetting ${mode} draft` : `Reset ${mode} draft`}
                            >
                                {confirmReset
                                    ? `CONFIRM RESET ${mode === "carousel" ? "CAROUSEL" : "VIDEO"}?`
                                    : `RESET ${mode === "carousel" ? "CAROUSEL" : "VIDEO"} DRAFT`}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
});

CommandRibbonMenu.displayName = "CommandRibbonMenu";
