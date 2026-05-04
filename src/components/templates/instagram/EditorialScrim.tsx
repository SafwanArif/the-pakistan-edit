import React from "react";

export const EditorialScrim: React.FC = () => {
    return (
        <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '70%',
            background: 'linear-gradient(to bottom, transparent 0%, oklch(from var(--ui-bg) l c h / 0.05) 60%, oklch(from var(--ui-bg) l c h / 0.2) 100%)',
            zIndex: 7,
            pointerEvents: 'none'
        }} />
    );
};
