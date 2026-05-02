import React from "react";

export const EditorialScrim: React.FC = () => {
    return (
        <div style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            width: '100%',
            height: '70%',
            background: 'linear-gradient(to bottom, transparent 0%, rgba(9, 26, 18, 0.6) 40%, rgba(9, 26, 18, 0.95) 80%, rgba(9, 26, 18, 1) 100%)',
            zIndex: 10,
            pointerEvents: 'none'
        }} />
    );
};
