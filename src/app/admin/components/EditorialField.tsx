import React from "react";
import { Draft } from "../../../types/news";
import { DraftResolver } from "../utils/dataAccessors";
import { EmojiToolbar, SourcePrefixToolbar, ImageCreditToolbar } from "./EditorialTools";

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
 * Refined for Elastic Ribbon: Zero internal tools for maximum horizontal space.
 */
export const EditorialField: React.FC<EditorialFieldProps> = React.memo(({ 
    fieldId, draft, onChange, placeholder, isMain, isCategory, onFocus, onBlur
}) => {
    const val = DraftResolver.get(fieldId, draft);
    const inputId = `input-${fieldId}`;

    const handleChange = (newVal: string) => {
        onChange(DraftResolver.set(fieldId, newVal, draft));
    };

    const inputClasses = [
        "tpe-input-field",
        isMain ? "tpe-input-main" : "",
        isCategory ? "tpe-category-input" : "",
        "tpe-uppercase"
    ].filter(Boolean).join(" ");

    return (
        <div className="tpe-flex-row tpe-textarea-wrapper" style={{ flex: 1, position: 'relative' }}>
            {isCategory ? (
                <input 
                    id={inputId}
                    className={inputClasses}
                    placeholder={placeholder}
                    value={val}
                    onChange={(e) => handleChange(e.target.value)}
                    onFocus={onFocus}
                    onBlur={onBlur}
                />
            ) : (
                <textarea 
                    id={inputId}
                    className={inputClasses}
                    placeholder={placeholder}
                    value={val}
                    onChange={(e) => handleChange(e.target.value)}
                    onFocus={onFocus}
                    onBlur={onBlur}
                    style={{ paddingInlineEnd: '10px' }}
                />
            )}
        </div>
    );
});

EditorialField.displayName = "EditorialField";
