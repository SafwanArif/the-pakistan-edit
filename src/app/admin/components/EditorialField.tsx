import React from "react";
import { Draft } from "../../../types/news";
import { DraftResolver } from "../utils/dataAccessors";
import { EmojiToolbar, SourcePrefixToolbar, ImageCreditToolbar } from "./EditorialTools";

interface EditorialFieldProps {
    fieldId: string;
    draft: Draft;
    onChange: (d: Draft) => void;
    placeholder?: string;
    tools?: ('emoji' | 'source' | 'credit')[];
    isMain?: boolean;
    isCategory?: boolean;
}

/**
 * 2027 Institutional Standard: EditorialField
 * Atomic component that encapsulates all field-specific behaviors, 
 * tools, and data-resolution logic.
 */
export const EditorialField: React.FC<EditorialFieldProps> = React.memo(({ 
    fieldId, draft, onChange, placeholder, tools = [], isMain, isCategory 
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
                />
            ) : (
                <textarea 
                    id={inputId}
                    className={inputClasses}
                    placeholder={placeholder}
                    value={val}
                    onChange={(e) => handleChange(e.target.value)}
                    style={{ paddingInlineEnd: tools.length > 1 ? '80px' : (tools.length > 0 ? '40px' : '10px') }}
                />
            )}

            <div className="tpe-field-tools" style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: '8px' }}>
                {tools.includes('emoji') && (
                    <EmojiToolbar 
                        fieldId={fieldId} 
                        value={val} 
                        onUpdate={handleChange} 
                    />
                )}
                {tools.includes('source') && (
                    <SourcePrefixToolbar 
                        fieldId={fieldId} 
                        value={val} 
                        onUpdate={handleChange} 
                    />
                )}
                {tools.includes('credit') && (
                    <ImageCreditToolbar 
                        fieldId={fieldId} 
                        value={val} 
                        onUpdate={handleChange} 
                    />
                )}
            </div>
        </div>
    );
});

EditorialField.displayName = "EditorialField";
