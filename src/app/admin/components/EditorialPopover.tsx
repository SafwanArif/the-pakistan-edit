import React from "react";
import { useClickOutside } from "../hooks/useClickOutside";

interface EditorialPopoverProps {
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
    direction?: 'up' | 'down';
    width?: string;
    right?: number | string;
}

const popoverBaseStyle: React.CSSProperties = {
    position: 'absolute',
    background: 'var(--ui-bg-popover)',
    backdropFilter: 'blur(var(--blur-md))',
    border: '1px solid var(--ui-border)',
    padding: '10px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    boxShadow: 'var(--shadow-lg)',
    zIndex: 'var(--z-popover)',
};

/**
 * 2027 Institutional Primitive: EditorialPopover
 * Consolidated interaction layer for all dashboard toolkits.
 */
export const EditorialPopover: React.FC<EditorialPopoverProps> = React.memo(({ 
    open, onClose, children, direction = 'up', width = '200px', right = 0 
}) => {
    const ref = useClickOutside(onClose, undefined, open);
    if (!open) return null;

    return (
        <div 
            ref={ref}
            role="dialog"
            style={{ 
                ...popoverBaseStyle,
                ...(direction === 'up' ? { bottom: '100%', marginBottom: '12px' } : { top: '100%', marginTop: '12px' }), 
                right: right, 
                width: width, 
            }}
        >
            {children}
        </div>
    );
});
EditorialPopover.displayName = "EditorialPopover";
