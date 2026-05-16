import React from "react";
import { useEditorialSelection } from "../hooks/useEditorialSelection";
import { DraftResolver } from "../utils/dataAccessors";
import { FormatButton } from "./EditorialTools";
import { Draft } from "../../../types/news";

interface SelectionPopoverProps {
    draft: Draft;
    onChange: (d: Draft) => void;
}

/**
 * 2027 Institutional Standard: SelectionPopover
 * Detached UI element that tracks the global selection state and provides
 * contextual formatting tools without re-rendering the parent form.
 */
export const SelectionPopover: React.FC<SelectionPopoverProps> = ({ draft, onChange }) => {
    const { selection } = useEditorialSelection();

    if (!selection) return null;

    const val = DraftResolver.get(selection.fieldId, draft);
    
    // 2027 Skybox Logic: On mobile, position above the header to prevent text obstruction.
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const skyboxTop = isMobile ? '5px' : selection.y;
    const skyboxLeft = isMobile ? '50%' : selection.x;

    return (
        <div 
            className="tpe-selection-popover"
            style={{ 
                position: 'fixed',
                left: skyboxLeft, 
                top: skyboxTop,
                transform: isMobile ? 'translateX(-50%)' : 'translate(-50%, -100%)',
                pointerEvents: 'auto',
                userSelect: 'none',
                marginTop: isMobile ? '0' : '-10px'
            }}
        >
            <FormatButton label="GOLD" syntax="^" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-accent)" effectStyle={{ fontWeight: 800 }} />
            <FormatButton label="BOLD" syntax="*" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-text)" effectStyle={{ fontWeight: 800 }} />
            <FormatButton label="ITALIC" syntax="/" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-text-dim)" effectStyle={{ fontStyle: 'italic' }} />
            <FormatButton label="GREEN" syntax="_" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-indicator)" effectStyle={{ fontWeight: 800 }} />
            <FormatButton label="BLOCK" syntax="%" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-bg)" effectStyle={{ background: 'var(--ui-text)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }} />
        </div>
    );
};
