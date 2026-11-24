import React from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../hooks/useClickOutside";
import { useMediaQuery } from "../hooks/useMediaQuery";

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

const mobilePopoverBaseStyle: React.CSSProperties = {
    position: 'fixed',
    left: '50%',
    top: '58px',
    transform: 'translateX(-50%)',
    background: 'var(--ui-bg-popover)',
    backdropFilter: 'blur(var(--blur-md))',
    border: '1px solid var(--ui-border)',
    padding: '10px',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    boxShadow: 'var(--shadow-lg)',
    zIndex: 10000,
    maxWidth: 'calc(100vw - 32px)',
    maxHeight: 'calc(100vh - 88px)',
    overflow: 'auto',
};

/**
 * 2027 Institutional Primitive: EditorialPopover
 * Consolidated interaction layer for all dashboard toolkits.
 */
export const EditorialPopover: React.FC<EditorialPopoverProps> = React.memo(({ 
    open, onClose, children, direction = 'up', width = '200px', right = 0 
}) => {
    const ref = useClickOutside(onClose, undefined, open);
    const isMobile = useMediaQuery("(max-width: 768px)");

    if (!open) return null;

    if (isMobile && typeof document !== 'undefined') {
        return createPortal(
            <div
                ref={ref}
                data-editorial-popover="true"
                role="dialog"
                style={{
                    ...mobilePopoverBaseStyle,
                    width: width === 'auto' ? 'auto' : width,
                }}
            >
                {children}
            </div>,
            document.body
        );
    }

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
