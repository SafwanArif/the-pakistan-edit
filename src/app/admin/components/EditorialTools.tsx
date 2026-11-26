"use client";

import React, { useCallback, useId, useRef, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { SOCIAL_ICONS } from "@/config/editorial";
import { insertTextAtCursor, isActivationKey, isPrimaryPointer, wrapSelectionWithSyntax } from "../utils/domUtils";
import { EditorialPopover } from "./EditorialPopover";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { CloseReason } from "../hooks/useClickOutside";

const LazyEmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });
type EmojiPickerProps = ComponentProps<typeof LazyEmojiPicker>;

const SOURCE_PREFIX_OPTIONS = ["SOURCE:", "VIA:", "REPORT:", "DATA:"] as const;
const IMAGE_CREDIT_OPTIONS = ["PHOTO:", "STILL:", "VIA:", "SOURCE:"] as const;
const VIDEO_CREDIT_OPTIONS = ["FOOTAGE:", "CLIP:", "VIA:", "COURTESY:"] as const;

/** Normalizes user-entered custom prefix text, rejecting empty/colon-only strings and avoiding trailing `::`. */
export function normalizeEditorialPrefix(raw: string): string | null {
    const cleaned = raw.toUpperCase().trim().replace(/:+$/, "").trim();
    return cleaned ? `${cleaned}:` : null;
}

/** Shared popover toggle wiring: pointer + keyboard activation, per-instance outside-click exclusion, and Escape focus restore. */
const usePopoverToggle = () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const triggerId = useId().replace(/:/g, "");
    const close = useCallback((reason?: CloseReason) => {
        setOpen(false);
        if (reason === "escape") triggerRef.current?.focus();
    }, []);
    const triggerProps = {
        ref: triggerRef,
        type: "button" as const,
        "data-popover-trigger": triggerId,
        "aria-expanded": open,
        onPointerDown: (e: React.PointerEvent) => { if (isPrimaryPointer(e)) { e.preventDefault(); setOpen((v) => !v); } },
        onKeyDown: (e: React.KeyboardEvent) => { if (isActivationKey(e.key)) { e.preventDefault(); setOpen((v) => !v); } },
    };
    return { open, setOpen, close, ignoreSelector: `[data-popover-trigger="${triggerId}"]`, triggerProps };
};

interface FormatButtonProps {
    label: string;
    syntaxOpen: string;
    syntaxClose: string;
    fieldId: string;
    value?: string;
    onUpdate: (v: string) => void;
    color: string;
    effectStyle?: React.CSSProperties;
}

/** Wraps the active selection in `fieldId` with editorial formatting syntax. */
export const FormatButton: React.FC<FormatButtonProps> = React.memo(({
    label, syntaxOpen, syntaxClose, fieldId, value, onUpdate, color, effectStyle,
}) => {
    const apply = () => wrapSelectionWithSyntax(fieldId, value ?? "", syntaxOpen, syntaxClose, onUpdate);
    return (
        <button
            type="button"
            aria-label={`Format ${label}`}
            className="tpe-format-btn"
            style={{ color, ...effectStyle }}
            onPointerDown={(e) => { if (isPrimaryPointer(e)) { e.preventDefault(); apply(); } }}
            onKeyDown={(e) => { if (isActivationKey(e.key)) { e.preventDefault(); apply(); } }}
        >
            {label}
        </button>
    );
});
FormatButton.displayName = "FormatButton";

/** Lazy-loaded emoji picker popover that inserts into `fieldId` at the caret position. */
export const EmojiToolbar = React.memo<{ fieldId: string; value: string; onUpdate: (val: string) => void; popDirection?: "up" | "down" }>(
    ({ fieldId, value, onUpdate, popDirection = "up" }) => {
        const { open, setOpen, close, ignoreSelector, triggerProps } = usePopoverToggle();
        const isMobile = useMediaQuery("(max-width: 768px)");

        return (
            <div className="tpe-tool-wrap">
                <button {...triggerProps} aria-label="Insert emoji" aria-haspopup="dialog" className="tpe-emoji-btn" data-open={open}>
                    🙂
                </button>
                {open && (
                    <EditorialPopover open={open} onClose={close} direction={popDirection} width="auto" ariaLabel="Emoji picker" ignoreSelector={ignoreSelector}>
                        <LazyEmojiPicker
                            onEmojiClick={(emojiData) => { insertTextAtCursor(fieldId, value, emojiData.emoji, onUpdate); setOpen(false); }}
                            theme={"dark" as EmojiPickerProps["theme"]}
                            emojiStyle={"apple" as EmojiPickerProps["emojiStyle"]}
                            searchPlaceHolder="Search emojis..."
                            lazyLoadEmojis={true}
                            skinTonesDisabled={true}
                            width={isMobile ? 280 : 320}
                            height={isMobile ? 350 : 400}
                        />
                    </EditorialPopover>
                )}
            </div>
        );
    }
);
EmojiToolbar.displayName = "EmojiToolbar";

interface PrefixToolbarPublicProps {
    prefix: string;
    onPrefixChange: (p: string) => void;
    value?: string;
    onUpdate?: (val: string) => void;
    fieldId?: string;
}

const PrefixToolbar = React.memo<PrefixToolbarPublicProps & { options: readonly string[]; showSocial?: boolean }>(({
    value, prefix, onPrefixChange, onUpdate, fieldId, options, showSocial,
}) => {
    const { open, close, ignoreSelector, triggerProps } = usePopoverToggle();

    return (
        <div className="tpe-tool-wrap">
            <button {...triggerProps} aria-label={`Change prefix (${prefix})`} aria-haspopup="menu" className="tpe-prefix-toggle">
                {prefix}
            </button>
            {open && (
                <EditorialPopover open={open} onClose={close} direction="down" width="200px" right="auto" role="menu" ariaLabel="Prefix options" ignoreSelector={ignoreSelector}>
                    {options.map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            role="menuitem"
                            className="tpe-prefix-btn"
                            onClick={(e) => {
                                e.preventDefault();
                                if (opt !== prefix) onPrefixChange(opt);
                                close(e.detail === 0 ? "escape" : "outside");
                            }}
                        >
                            {opt}
                        </button>
                    ))}
                    <input
                        type="text"
                        aria-label="Custom prefix"
                        enterKeyHint="done"
                        autoCapitalize="characters"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="Custom..."
                        className="tpe-popover-input tpe-popover-input-mt"
                        onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            const custom = normalizeEditorialPrefix(e.currentTarget.value);
                            if (custom && custom !== prefix) onPrefixChange(custom);
                            close("escape");
                        }}
                    />
                    {showSocial && fieldId && onUpdate && (
                        <div className="tpe-social-grid">
                            {SOCIAL_ICONS.map((soc) => (
                                <button
                                    key={soc.label}
                                    type="button"
                                    aria-label={`Insert ${soc.label} icon`}
                                    className="tpe-social-btn"
                                    style={{ "--soc-bg": soc.color } as React.CSSProperties}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        insertTextAtCursor(fieldId, value ?? "", soc.icon, onUpdate);
                                        close("outside");
                                    }}
                                >
                                    {soc.logo}
                                </button>
                            ))}
                        </div>
                    )}
                </EditorialPopover>
            )}
        </div>
    );
});
PrefixToolbar.displayName = "PrefixToolbar";

export const SourcePrefixToolbar: React.FC<PrefixToolbarPublicProps> = React.memo((props) => <PrefixToolbar {...props} options={SOURCE_PREFIX_OPTIONS} showSocial={true} />);
SourcePrefixToolbar.displayName = "SourcePrefixToolbar";

export const ImageCreditToolbar: React.FC<PrefixToolbarPublicProps> = React.memo((props) => <PrefixToolbar {...props} options={IMAGE_CREDIT_OPTIONS} showSocial={false} />);
ImageCreditToolbar.displayName = "ImageCreditToolbar";

export const VideoCreditToolbar: React.FC<PrefixToolbarPublicProps> = React.memo((props) => <PrefixToolbar {...props} options={VIDEO_CREDIT_OPTIONS} showSocial={true} />);
VideoCreditToolbar.displayName = "VideoCreditToolbar";
