"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface EditorialPopoverProps {
    open: boolean;
    onClose: (reason?: CloseReason) => void;
    children: React.ReactNode;
    direction?: 'up' | 'down';
    width?: string;
    right?: number | string;
    role?: 'dialog' | 'menu';
    ariaLabel?: string;
    ignoreSelector?: string;
}

const sharedPopoverStyle: React.CSSProperties = {
    background: 'var(--ui-bg-popover)',
    backdropFilter: 'blur(var(--blur-md))',
    border: '1px solid var(--ui-border)',
    padding: '10px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    boxShadow: 'var(--shadow-lg)',
};

const desktopPopoverBaseStyle: React.CSSProperties = {
    ...sharedPopoverStyle,
    position: 'absolute',
    zIndex: 'var(--z-popover)',
};

const mobilePopoverBaseStyle: React.CSSProperties = {
    ...sharedPopoverStyle,
    position: 'fixed',
    left: '50%',
    top: '58px',
    transform: 'translateX(-50%)',
    zIndex: 10000,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100dvh - 88px)',
    overflow: 'auto',
};

const directionUpStyle: React.CSSProperties = { bottom: '100%', marginBottom: '12px' };
const directionDownStyle: React.CSSProperties = { top: '100%', marginTop: '12px' };

/**
 * Lightweight inline/portal popover container for editorial toolbar controls.
 */
export const EditorialPopover: React.FC<EditorialPopoverProps> = React.memo(({
    open,
    onClose,
    children,
    direction = 'up',
    width = '200px',
    right = 0,
    role = 'dialog',
    ariaLabel,
    ignoreSelector,
}) => {
    const ref = useClickOutside(onClose, ignoreSelector, open);
    const isMobile = useMediaQuery("(max-width: 768px)");

    if (!open) return null;

    if (isMobile && typeof document !== 'undefined') {
        return createPortal(
            <div
                ref={ref}
                data-editorial-popover="true"
                role={role}
                aria-label={ariaLabel}
                style={{ ...mobilePopoverBaseStyle, width }}
            >
                {children}
            </div>,
            document.body
        );
    }

    return (
        <div
            ref={ref}
            data-editorial-popover="true"
            role={role}
            aria-label={ariaLabel}
            style={{
                ...desktopPopoverBaseStyle,
                ...(direction === 'up' ? directionUpStyle : directionDownStyle),
                insetInlineEnd: right,
                width,
            }}
        >
            {children}
        </div>
    );
});
EditorialPopover.displayName = "EditorialPopover";
