"use client";

import React, { useEffect, useRef } from "react";
import { TPEVectorLogo } from "@/components/templates/TPEVectorLogo";

interface ExportOverlayProps {
    status: string;
    onClose?: () => void;
    onCancel?: () => void;
}

/** Full-viewport modal overlay displaying live export progress, cancel, and dismissible error feedback. */
export const ExportOverlay: React.FC<ExportOverlayProps> = React.memo(({ status, onClose, onCancel }) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const isError = /\b(error|failed|fault|timeout)\b/i.test(status);
    const isComplete = !isError && /\b(complete|success|exported)\b/i.test(status);
    const state = isError ? "error" : isComplete ? "complete" : "active";
    const action = isError && onClose
        ? { label: "CLOSE ENGINE", onClick: onClose }
        : !isError && !isComplete && onCancel
            ? { label: "CANCEL EXPORT", onClick: onCancel }
            : null;

    useEffect(() => {
        const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        overlayRef.current?.focus();
        return () => { if (prev && document.contains(prev)) prev.focus(); };
    }, []);

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Export progress"
            className="tpe-export-overlay"
            data-state={state}
            onKeyDown={(e) => {
                if (e.key === "Escape" && isError && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
            }}
        >
            <div className="tpe-export-overlay-inner">
                <TPEVectorLogo scale={1.8} showWordmark={false} />
                <div
                    role={isError ? "alert" : "status"}
                    aria-live={isError ? "assertive" : "polite"}
                    className={isError ? "tpe-export-status" : "tpe-export-status tpe-glow-text"}
                    data-state={state}
                >
                    {status}
                </div>
                {action && (
                    <button type="button" onClick={action.onClick} className="tpe-nav-btn tpe-btn-danger tpe-export-action">
                        {action.label}
                    </button>
                )}
            </div>
        </div>
    );
});
ExportOverlay.displayName = "ExportOverlay";
