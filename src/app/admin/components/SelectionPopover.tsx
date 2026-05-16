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

    return (
        <div 
            className="tpe-selection-popover"
            style={{ 
                position: 'fixed',
                left: selection.x, 
                top: selection.y,
                pointerEvents: 'auto'
            }}
        >
            <FormatButton label="Gold" syntax="^" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-accent)" effectStyle={{ fontWeight: 800 }} />
            <FormatButton label="Bold" syntax="*" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-text)" effectStyle={{ fontWeight: 800 }} />
            <FormatButton label="Italic" syntax="/" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-text-dim)" effectStyle={{ fontStyle: 'italic' }} />
            <FormatButton label="Green" syntax="_" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-indicator)" effectStyle={{ fontWeight: 800 }} />
            <FormatButton label="Block" syntax="%" fieldId={selection.fieldId} value={val} onUpdate={onChange as any} color="var(--ui-bg)" effectStyle={{ background: 'var(--ui-text)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700 }} />
        </div>
    );
};
