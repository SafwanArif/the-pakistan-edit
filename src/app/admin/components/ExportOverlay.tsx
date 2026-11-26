"use client";

import React, { useEffect, useRef } from 'react';
import { TPEVectorLogo } from '@/components/templates/TPEVectorLogo';

interface ExportOverlayProps {
    status: string;
    onClose?: () => void;
    onCancel?: () => void;
}

const backdropBaseStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 10050,
    display: 'grid',
    placeItems: 'center',
    transition: 'var(--transition-lux)',
    outline: 'none',
};

const defaultBackdropStyle: React.CSSProperties = {
    ...backdropBaseStyle,
    background: 'oklch(0% 0 0 / 0.88)',
};

const errorBackdropStyle: React.CSSProperties = {
    ...backdropBaseStyle,
    background: 'linear-gradient(oklch(from var(--ui-danger) l c h / 0.18), oklch(from var(--ui-danger) l c h / 0.18)), oklch(0% 0 0 / 0.88)',
};

const overlayInnerStyle: React.CSSProperties = { display: 'grid', placeItems: 'center', gap: '20px', textAlign: 'center', maxWidth: '400px' };
const closeEngineBtnStyle: React.CSSProperties = { marginTop: '20px', inlineSize: '140px' };

const statusTextBaseStyle: React.CSSProperties = {
    fontSize: '11px',
    fontWeight: 800,
    letterSpacing: '0.2em',
    textTransform: 'uppercase',
    padding: '0 40px',
};

const statusPrimaryStyle: React.CSSProperties = { ...statusTextBaseStyle, color: 'var(--ui-primary)' };
const statusCompleteStyle: React.CSSProperties = { ...statusTextBaseStyle, color: 'var(--ui-indicator)' };
const statusErrorStyle: React.CSSProperties = { ...statusTextBaseStyle, color: 'var(--ui-danger)' };

/**
 * Full-viewport modal overlay displaying live carousel/video export status,
 * cancellation controls, and dismissible error feedback.
 */
export const ExportOverlay: React.FC<ExportOverlayProps> = React.memo(({ status, onClose, onCancel }) => {
    const overlayRef = useRef<HTMLDivElement>(null);
    const isError = /\b(error|failed|fault|timeout)\b/i.test(status);
    const isComplete = !isError && /\b(complete|success|exported)\b/i.test(status);

    useEffect(() => {
        overlayRef.current?.focus();
    }, []);

    return (
        <div
            ref={overlayRef}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Export progress"
            onKeyDown={(e) => {
                if (e.key === 'Escape' && isError && onClose) {
                    e.preventDefault();
                    e.stopPropagation();
                    onClose();
                }
            }}
            style={isError ? errorBackdropStyle : defaultBackdropStyle}
        >
            <div style={overlayInnerStyle}>
                <TPEVectorLogo scale={1.8} showWordmark={false} />
                <div
                    role={isError ? "alert" : "status"}
                    aria-live={isError ? "assertive" : "polite"}
                    className={isError ? "" : "tpe-glow-text"}
                    style={isError ? statusErrorStyle : isComplete ? statusCompleteStyle : statusPrimaryStyle}
                >
                    {status}
                </div>

                {isError && onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        className="tpe-nav-btn tpe-btn-danger"
                        style={closeEngineBtnStyle}
                    >
                        CLOSE ENGINE
                    </button>
                )}

                {!isError && !isComplete && onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="tpe-nav-btn tpe-btn-danger"
                        style={closeEngineBtnStyle}
                    >
                        CANCEL EXPORT
                    </button>
                )}
            </div>
        </div>
    );
});
ExportOverlay.displayName = "ExportOverlay";
