"use client";

import React, { useCallback, useLayoutEffect, useRef } from "react";
import { Draft } from "@/types/news";
import { DraftResolver } from "../utils/dataAccessors";
import { EmojiToolbar } from "./EditorialTools";

interface EditorialFieldProps {
    fieldId: string;
    draft: Draft;
    onChange: (d: Draft) => void;
    placeholder?: string;
    isMain?: boolean;
    isCategory?: boolean;
    onFocusField?: (fieldId: string) => void;
}

/** Atomic editorial input/textarea primitive with inline emoji insertion and stable `DraftResolver` updates. */
export const EditorialField: React.FC<EditorialFieldProps> = React.memo(({
    fieldId, draft, onChange, placeholder, isMain, isCategory, onFocusField,
}) => {
    const rawVal = DraftResolver.get(fieldId, draft);
    const val = typeof rawVal === "string" ? rawVal : "";
    const latestRef = useRef({ fieldId, draft, onChange });
    useLayoutEffect(() => { latestRef.current = { fieldId, draft, onChange }; }, [fieldId, draft, onChange]);

    const handleChange = useCallback((newVal: string) => {
        const { fieldId: id, draft: curr, onChange: update } = latestRef.current;
        update(DraftResolver.set(id, newVal, curr));
    }, []);

    const handleFocus = useCallback(() => { onFocusField?.(fieldId); }, [fieldId, onFocusField]);

    const sharedProps = {
        id: `input-${fieldId}`,
        "aria-label": placeholder || fieldId,
        dir: "auto" as const,
        autoComplete: "off",
        placeholder,
        value: val,
        onFocus: handleFocus,
        className: `tpe-input-field${isCategory ? "" : " tpe-textarea"}${isMain ? " tpe-input-main" : ""}${isCategory || fieldId === "headline" ? " tpe-uppercase" : ""}`,
    };

    return (
        <div className="tpe-flex-row tpe-field-wrap">
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
                    <div className="tpe-field-tools">
                        <EmojiToolbar fieldId={fieldId} value={val} onUpdate={handleChange} popDirection="down" />
                    </div>
                </>
            )}
        </div>
    );
});
EditorialField.displayName = "EditorialField";
