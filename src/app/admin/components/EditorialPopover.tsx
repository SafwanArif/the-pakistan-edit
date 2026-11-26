"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useClickOutside, type CloseReason } from "../hooks/useClickOutside";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface EditorialPopoverProps {
    open: boolean;
    onClose: (reason?: CloseReason) => void;
    children: React.ReactNode;
    direction?: "up" | "down";
    width?: string;
    right?: number | string;
    role?: "dialog" | "menu";
    ariaLabel?: string;
    ignoreSelector?: string;
}

/** Lightweight inline/portal popover container for editorial toolbar controls. */
export const EditorialPopover: React.FC<EditorialPopoverProps> = React.memo(({
    open, onClose, children, direction = "up", width = "200px", right = 0, role = "dialog", ariaLabel, ignoreSelector,
}) => {
    const ref = useClickOutside(onClose, ignoreSelector, open);
    const isMobile = useMediaQuery("(max-width: 768px)");
    if (!open) return null;

    const surface = (
        <div
            ref={ref}
            className="tpe-editorial-popover"
            data-editorial-popover="true"
            data-direction={isMobile ? undefined : direction}
            role={role}
            aria-label={ariaLabel}
            style={isMobile ? { inlineSize: width } : { insetInlineEnd: right, inlineSize: width }}
        >
            {children}
        </div>
    );

    return isMobile && typeof document !== "undefined" ? createPortal(surface, document.body) : surface;
});
EditorialPopover.displayName = "EditorialPopover";
