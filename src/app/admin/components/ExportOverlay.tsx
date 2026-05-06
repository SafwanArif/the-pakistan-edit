import React from 'react';
import { TPEVectorLogo } from '../../../components/templates/instagram/TPEVectorLogo';

interface ExportOverlayProps {
    status: string;
    onClose?: () => void;
}

export const ExportOverlay: React.FC<ExportOverlayProps> = ({ status, onClose }) => {
    const isError = status.includes("ERROR:");
    const isComplete = status.includes("Complete!");

    return (
        <div style={{ 
            position: 'fixed', 
            inset: 0, 
            background: isError ? 'oklch(from var(--ui-danger) l c h / 0.15)' : 'oklch(from black l c h / 0.85)', 
            backdropFilter: 'blur(40px)', 
            zIndex: 'var(--z-system)', 
            display: 'grid', 
            placeItems: 'center',
            transition: 'var(--transition-lux)'
        }}>
            <div style={{ display: 'grid', placeItems: 'center', gap: '20px', textAlign: 'center', maxWidth: '400px' }}>
                <TPEVectorLogo scale={1.8} showWordmark={false} />
                <div 
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
                        onClick={onClose}
                        className="tpe-nav-btn tpe-btn-danger"
                        style={{ marginTop: '20px', inlineSize: '120px' }}
                    >
                        CLOSE ENGINE
                    </button>
                )}
            </div>
        </div>
    );
};
