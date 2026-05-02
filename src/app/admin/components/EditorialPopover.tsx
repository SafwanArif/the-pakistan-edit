import React from "react";

interface EditorialPopoverProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    direction?: 'up' | 'down';
    width?: string;
    right?: number | string;
}

/**
 * 2027 Institutional Primitive: EditorialPopover
 * Consolidated interaction layer for all dashboard toolkits.
 */
export const EditorialPopover: React.FC<EditorialPopoverProps> = ({ 
    open, onClose, children, direction = 'up', width = '200px', right = 0 
}) => {
    if (!open) return null;

    return (
        <div style={{ 
            position: 'absolute', 
            ...(direction === 'up' ? { bottom: '100%', marginBottom: '12px' } : { top: '100%', marginTop: '12px' }), 
            right: right, 
            background: 'var(--ui-bg-popover)', 
            backdropFilter: 'blur(var(--blur-md))', 
            border: '1px solid var(--ui-border)', 
            padding: '10px', 
            borderRadius: 'var(--radius-md)', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '8px', 
            boxShadow: 'var(--shadow-lg)', 
            width: width, 
            zIndex: 'var(--z-popover)' 
        }}>
            {children}
            <div 
                style={{ position: 'fixed', inset: 0, zIndex: -1, cursor: 'default' }} 
                onClick={(e) => { e.stopPropagation(); onClose(); }} 
            />
        </div>
    );
};
