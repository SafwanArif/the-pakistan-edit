import React from "react";
import { Draft } from "../../../types/news";
import { DraftResolver } from "../utils/dataAccessors";
import { EmojiToolbar } from "./EditorialTools";

interface EditorialFieldProps {
    fieldId: string;
    draft: Draft;
    onChange: (d: Draft) => void;
    placeholder?: string;
    isMain?: boolean;
    isCategory?: boolean;
    onFocus?: () => void;
    onBlur?: () => void;
}

/**
 * 2027 Institutional Standard: EditorialField
 * Atomic component that encapsulates all field-specific behaviors.
 * Refined for Elastic Ribbon: Restored Emoji Toolbar.
 */
export const EditorialField: React.FC<EditorialFieldProps> = React.memo(({ 
    fieldId, draft, onChange, placeholder, isMain, isCategory, onFocus, onBlur
}) => {
    const val = (DraftResolver.get(fieldId, draft) as string) || "";
    const inputId = `input-${fieldId}`;

    const handleChange = (newVal: string) => {
        onChange(DraftResolver.set(fieldId, newVal, draft));
    };

    const inputClasses = [
        "tpe-input-field",
        !isCategory ? "tpe-textarea" : "",
        isMain ? "tpe-input-main" : "",
        isCategory ? "tpe-category-input" : "",
        "tpe-uppercase"
    ].filter(Boolean).join(" ");

    return (
        <div className="tpe-flex-row tpe-textarea-wrapper" style={{ flex: 1, position: 'relative' }}>
            {isCategory ? (
                <input 
                    id={inputId}
                    aria-label={placeholder || fieldId}
                    spellCheck={false}
                    autoComplete="off"
                    className={inputClasses}
                    placeholder={placeholder}
                    value={val}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleChange(e.target.value)}
                    onFocus={onFocus}
                    onBlur={onBlur}
                />
            ) : (
                <>
                    <textarea 
                        id={inputId}
                        aria-label={placeholder || fieldId}
                        className={inputClasses}
                        placeholder={placeholder}
                        value={val}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => handleChange(e.target.value)}
                        onFocus={onFocus}
                        onBlur={onBlur}
                        style={{ paddingInlineEnd: '40px' }}
                    />
                    <div className="tpe-field-tools" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: '8px', zIndex: 10 }}>
                        <EmojiToolbar fieldId={fieldId} value={val} onUpdate={handleChange} popDirection="down" />
                    </div>
                </>
            )}
        </div>
    );
});

EditorialField.displayName = "EditorialField";
