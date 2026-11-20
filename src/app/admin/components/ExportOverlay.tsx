import React from 'react';
import { TPEVectorLogo } from '../../../components/templates/instagram/TPEVectorLogo';

interface ExportOverlayProps {
    status: string;
    onClose?: () => void;
}

const overlayInnerStyle: React.CSSProperties = { display: 'grid', placeItems: 'center', gap: '20px', textAlign: 'center', maxWidth: '400px' };
const closeEngineBtnStyle: React.CSSProperties = { marginTop: '20px', inlineSize: '120px' };

export const ExportOverlay: React.FC<ExportOverlayProps> = React.memo(({ status, onClose }) => {
    const isError = /error/i.test(status);
    const isComplete = /complete|success/i.test(status);

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Export progress"
            style={{ 
            position: 'fixed', 
            inset: 0, 
            background: isError ? 'oklch(from var(--ui-danger) l c h / 0.15)' : 'oklch(from black l c h / 0.85)', 
            backdropFilter: 'blur(40px)', 
            zIndex: 'var(--z-system)', 
            display: 'grid', 
            placeItems: 'center',
            transition: 'var(--transition-lux)'
        }}>
            <div style={overlayInnerStyle}>
                <TPEVectorLogo scale={1.8} showWordmark={false} />
                <div 
                    role="status"
                    aria-live="polite"
                    className={isError ? "" : "tpe-glow-text"} 
                    style={{ 
                        fontSize: '11px', 
                        fontWeight: 800, 
                        letterSpacing: '0.2em', 
                        color: isError ? 'var(--ui-danger)' : isComplete ? 'var(--ui-indicator)' : 'var(--ui-primary)',
                        textTransform: 'uppercase',
                        padding: '0 40px'
                    }}
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
            </div>
        </div>
    );
});
ExportOverlay.displayName = "ExportOverlay";
