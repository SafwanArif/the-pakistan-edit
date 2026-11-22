"use client";

import React, { useState } from "react";
import { PostMode } from "../../../types/news";
import { CarouselIcon, VideoIcon } from "../../../components/icons/TPEIcons";
import { TPEVectorLogo } from "../../../components/templates/TPEVectorLogo";
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

export const CommandRibbonMenu: React.FC<CommandRibbonMenuProps> = ({ mode, onModeChange, onReset }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useClickOutside(() => setIsOpen(false), undefined, isOpen);

    const handleReset = () => {
        const draftName = mode === "carousel" ? "carousel" : "video";
        if (onReset && window.confirm(`Reset ${draftName} draft?`)) {
            setIsOpen(false);
            void onReset();
        }
    };

    const selectMode = (nextMode: PostMode) => {
        onModeChange(nextMode);
        setIsOpen(false);
    };

    return (
        <div ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
                type="button"
                aria-label="Open mode and draft menu"
                aria-expanded={isOpen}
                aria-haspopup="menu"
                onClick={() => setIsOpen((open) => !open)}
                className="tpe-logo-wrapper"
                style={{ background: "transparent", border: "none", padding: 0 }}
                title="Open mode and draft menu"
            >
                <TPEVectorLogo scale={0.9} showWordmark={false} />
            </button>

            {isOpen && (
                <div
                    role="menu"
                    aria-label="Mode and draft options"
                    className="tpe-asset-tray-expanded tpe-flex-col"
                    style={{ left: 0, right: "auto", minWidth: "200px", gap: "6px", padding: "8px" }}
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
                    {onReset && (
                        <>
                            <div role="separator" style={{ width: "100%", height: "1px", background: "var(--ui-border)", marginBlock: "2px" }} />
                            <button
                                type="button"
                                role="menuitem"
                                className="tpe-mode-btn"
                                onClick={handleReset}
                                style={{ ...menuOptionStyle, color: "var(--ui-text-dim)" }}
                                title={`Reset ${mode} draft`}
                            >
                                RESET {mode === "carousel" ? "CAROUSEL" : "VIDEO"} DRAFT
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
};

CommandRibbonMenu.displayName = "CommandRibbonMenu";
