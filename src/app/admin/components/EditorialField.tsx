"use client";

import React, { useCallback, useLayoutEffect, useRef } from "react";
import { Draft } from "@/types/news";
import { DraftResolver } from "../utils/dataAccessors";
import { EmojiToolbar } from "./EditorialTools";

const wrapperStyle: React.CSSProperties = { flex: 1, minWidth: 0, position: "relative" };
const fieldToolsStyle: React.CSSProperties = { position: "absolute", insetInlineEnd: "10px", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "8px", zIndex: 10 };

interface EditorialFieldProps {
    fieldId: string;
    draft: Draft;
    onChange: (d: Draft) => void;
    placeholder?: string;
    isMain?: boolean;
    isCategory?: boolean;
    onFocus?: () => void;
    onFocusField?: (fieldId: string) => void;
    onBlur?: () => void;
}

/** Atomic editorial input/textarea primitive with inline emoji insertion and stable `DraftResolver` updates. */
export const EditorialField: React.FC<EditorialFieldProps> = React.memo(({
    fieldId, draft, onChange, placeholder, isMain, isCategory, onFocus, onFocusField, onBlur,
}) => {
    const rawVal = DraftResolver.get(fieldId, draft);
    const val = typeof rawVal === "string" ? rawVal : "";
    const latestRef = useRef({ fieldId, draft, onChange });
    useLayoutEffect(() => { latestRef.current = { fieldId, draft, onChange }; }, [fieldId, draft, onChange]);

    const handleChange = useCallback((newVal: string) => {
        const { fieldId: id, draft: curr, onChange: update } = latestRef.current;
        update(DraftResolver.set(id, newVal, curr));
    }, []);

    const handleFocus = useCallback(() => {
        onFocusField?.(fieldId);
        onFocus?.();
    }, [fieldId, onFocusField, onFocus]);

    const sharedProps = {
        id: `input-${fieldId}`,
        "aria-label": placeholder || fieldId,
        dir: "auto" as const,
        autoComplete: "off",
        placeholder,
        value: val,
        onFocus: handleFocus,
        onBlur,
        className: `tpe-input-field${isCategory ? "" : " tpe-textarea"}${isMain ? " tpe-input-main" : ""}${isCategory || fieldId === "headline" ? " tpe-uppercase" : ""}`,
    };

    return (
        <div className="tpe-flex-row" style={wrapperStyle}>
            {isCategory ? (
                <input
                    {...sharedProps}
                    enterKeyHint="done"
                    autoCapitalize="characters"
                    spellCheck={false}
                    onChange={(e) => handleChange(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                />
            ) : (
                <>
                    <textarea
                        {...sharedProps}
                        enterKeyHint="enter"
                        autoCapitalize="sentences"
                        spellCheck={true}
                        onChange={(e) => handleChange(e.target.value)}
                    />
                    <div className="tpe-field-tools" style={fieldToolsStyle}>
                        <EmojiToolbar fieldId={fieldId} value={val} onUpdate={handleChange} popDirection="down" />
                    </div>
                </>
            )}
        </div>
    );
});
EditorialField.displayName = "EditorialField";
