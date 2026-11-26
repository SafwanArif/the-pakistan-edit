"use client";

import React, { useEffect, useRef } from "react";
import { TPEVectorLogo } from "@/components/templates/TPEVectorLogo";

interface ExportOverlayProps {
    status: string;
    onClose?: () => void;
    onCancel?: () => void;
}

const backdropBase: React.CSSProperties = { position: "fixed", inset: 0, zIndex: 10050, display: "grid", placeItems: "center", transition: "var(--transition-lux)", outline: "none" };
const defaultBackdropStyle: React.CSSProperties = { ...backdropBase, background: "oklch(0% 0 0 / 0.88)" };
const errorBackdropStyle: React.CSSProperties = { ...backdropBase, background: "linear-gradient(oklch(from var(--ui-danger) l c h / 0.18), oklch(from var(--ui-danger) l c h / 0.18)), oklch(0% 0 0 / 0.88)" };
const innerStyle: React.CSSProperties = { display: "grid", placeItems: "center", gap: "20px", textAlign: "center", maxWidth: "400px" };
const actionBtnStyle: React.CSSProperties = { marginTop: "20px", inlineSize: "140px" };
const statusBase: React.CSSProperties = { fontSize: "11px", fontWeight: 800, letterSpacing: "0.2em", textTransform: "uppercase", padding: "0 40px" };
const statusStyles = {
    primary: { ...statusBase, color: "var(--ui-primary)" },
    complete: { ...statusBase, color: "var(--ui-indicator)" },
    error: { ...statusBase, color: "var(--ui-danger)" },
} satisfies Record<string, React.CSSProperties>;

/** Full-viewport modal overlay displaying live export progress, cancel, and dismissible error feedback. */
export const ExportOverlay: React.FC<ExportOverlayProps> = React.memo(({ status, onClose, onCancel }) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const isError = /\b(error|failed|fault|timeout)\b/i.test(status);
    const isComplete = !isError && /\b(complete|success|exported)\b/i.test(status);
    const action = isError && onClose
        ? { label: "CLOSE ENGINE", onClick: onClose }
        : !isError && !isComplete && onCancel
            ? { label: "CANCEL EXPORT", onClick: onCancel }
            : null;

    useEffect(() => { overlayRef.current?.focus(); }, []);

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Export progress"
            style={isError ? errorBackdropStyle : defaultBackdropStyle}
            onKeyDown={(e) => {
                if (e.key === "Escape" && isError && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); }
            }}
        >
            <div style={innerStyle}>
                <TPEVectorLogo scale={1.8} showWordmark={false} />
                <div
                    role={isError ? "alert" : "status"}
                    aria-live={isError ? "assertive" : "polite"}
                    className={isError ? "" : "tpe-glow-text"}
                    style={isError ? statusStyles.error : isComplete ? statusStyles.complete : statusStyles.primary}
                >
                    {status}
                </div>
                {action && (
                    <button type="button" onClick={action.onClick} className="tpe-nav-btn tpe-btn-danger" style={actionBtnStyle}>
                        {action.label}
                    </button>
                )}
            </div>
        </div>
    );
});
ExportOverlay.displayName = "ExportOverlay";
