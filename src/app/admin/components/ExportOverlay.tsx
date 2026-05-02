import React from 'react';
import { TPEVectorLogo } from '../../../components/templates/instagram/TPEVectorLogo';

interface ExportOverlayProps {
    status: string;
}

export const ExportOverlay: React.FC<ExportOverlayProps> = ({ status }) => (
    <div style={{ 
        position: 'fixed', 
        inset: 0, 
        background: 'oklch(from black l c h / 0.85)', 
        backdropFilter: 'blur(40px)', 
        zIndex: 'var(--z-system)', 
        display: 'grid', 
        placeItems: 'center' 
    }}>
        <div style={{ display: 'grid', placeItems: 'center', gap: '20px' }}>
            <TPEVectorLogo scale={1.8} showWordmark={false} />
            <div 
                className="tpe-glow-text" 
                style={{ 
                    fontSize: '11px', 
                    fontWeight: 800, 
                    letterSpacing: '0.3em', 
                    color: 'var(--ui-primary)',
                    textTransform: 'uppercase'
                }}
            >
                {status}
            </div>
        </div>
    </div>
);
