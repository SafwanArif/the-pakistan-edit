import React from "react";

export const EditorialScrim: React.FC = () => {
    return (
        <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '70%',
            background: 'linear-gradient(to bottom, transparent 0%, oklch(from var(--ui-bg) l c h / 0.1) 60%, oklch(from var(--ui-bg) l c h / 0.3) 100%)',
            backdropFilter: 'blur(12px)',
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 80%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 80%)',
            zIndex: 10,
            pointerEvents: 'none'
        }} />
    );
};
