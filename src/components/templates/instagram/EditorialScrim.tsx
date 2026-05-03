import React from "react";

export const EditorialScrim: React.FC = () => {
    return (
        <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '70%',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(9, 26, 18, 0.2) 50%, rgba(9, 26, 18, 0.5) 85%, rgba(9, 26, 18, 0.7) 100%)',
            zIndex: 10,
            pointerEvents: 'none'
        }} />
    );
};
