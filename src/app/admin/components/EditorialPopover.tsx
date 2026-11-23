import React, { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
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
    const portalRoot = useRef<HTMLDivElement | null>(null);
    
    useEffect(() => {
        if (typeof document !== 'undefined' && !portalRoot.current) {
            portalRoot.current = document.createElement('div');
            document.body.appendChild(portalRoot.current);
        }
        return () => {
            if (portalRoot.current) {
                document.body.removeChild(portalRoot.current);
                portalRoot.current = null;
            }
        };
    }, []);

    if (!open) return null;

    // Calculate if we need to use fixed positioning on mobile
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    
    if (isMobile && portalRoot.current) {
        const mobilePopover = (
            <div 
                ref={ref}
                role="dialog"
                style={{ 
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
                    width: width === 'auto' ? 'auto' : width,
                    overflow: 'auto',
                }}
            >
                {children}
            </div>
        );
        return createPortal(mobilePopover, portalRoot.current);
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
