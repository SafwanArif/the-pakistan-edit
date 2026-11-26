"use client";

import React, { useEffect, useRef } from "react";
import { TPEVectorLogo } from "@/components/templates/TPEVectorLogo";

interface ExportOverlayProps {
    status: string;
    onClose?: () => void;
    onCancel?: () => void;
}

/** Full-viewport native top-layer `<dialog>` displaying live export progress, cancel, and dismissible error feedback. */
export const ExportOverlay: React.FC<ExportOverlayProps> = React.memo(({ status, onClose, onCancel }) => {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const isError = /\b(error|failed|fault|timeout)\b/i.test(status);
    const isComplete = !isError && /\b(complete|success|exported)\b/i.test(status);
    const state = isError ? "error" : isComplete ? "complete" : "active";
    const action = isError && onClose
        ? { label: "CLOSE ENGINE", onClick: onClose }
        : !isError && !isComplete && onCancel
            ? { label: "CANCEL EXPORT", onClick: onCancel }
            : null;

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (!dialog.open) dialog.showModal();
        return () => { if (dialog.open) dialog.close(); };
    }, []);

    return (
        <dialog
            ref={dialogRef}
            aria-label="Export progress"
            className="tpe-export-overlay"
            data-state={state}
            onCancel={(e) => {
                e.preventDefault();
                if (isError && onClose) onClose();
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
        </dialog>
    );
});
ExportOverlay.displayName = "ExportOverlay";
