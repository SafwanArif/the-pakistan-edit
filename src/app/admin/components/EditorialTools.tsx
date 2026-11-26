"use client";

import React, { useCallback, useId, useRef, useState, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import { SOCIAL_ICONS } from "@/config/editorial";
import { insertTextAtCursor, wrapSelectionWithSyntax } from "../utils/domUtils";
import { EditorialPopover } from "./EditorialPopover";
import { useMediaQuery } from "../hooks/useMediaQuery";
import type { CloseReason } from "../hooks/useClickOutside";

const isPrimaryPointer = (e: React.PointerEvent): boolean => e.pointerType !== "mouse" || e.button === 0;
const isActivationKey = (key: string): boolean => key === "Enter" || key === " ";

const LazyEmojiPicker = dynamic(() => import("emoji-picker-react"), { ssr: false });
type EmojiPickerProps = ComponentProps<typeof LazyEmojiPicker>;

const SOURCE_PREFIX_OPTIONS = ["SOURCE:", "VIA:", "REPORT:", "DATA:"] as const;
const IMAGE_CREDIT_OPTIONS = ["PHOTO:", "STILL:", "VIA:", "SOURCE:"] as const;
const VIDEO_CREDIT_OPTIONS = ["FOOTAGE:", "CLIP:", "VIA:", "COURTESY:"] as const;

const relativeWrapStyle: React.CSSProperties = { position: 'relative' };
const customInputStyle: React.CSSProperties = { marginTop: '4px' };
const emojiBtnBaseStyle: React.CSSProperties = { background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px' };
const emojiBtnOpenStyle: React.CSSProperties = { ...emojiBtnBaseStyle, filter: 'none' };
const emojiBtnClosedStyle: React.CSSProperties = { ...emojiBtnBaseStyle, filter: 'grayscale(100%) opacity(0.6)' };

/** Normalizes user-entered custom prefix text, rejecting empty/colon-only strings and avoiding trailing `::`. */
export function normalizeEditorialPrefix(raw: string): string | null {
    const cleaned = raw.toUpperCase().trim().replace(/:+$/, "").trim();
    return cleaned ? `${cleaned}:` : null;
}

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

/**
 * Wraps the active selection in `fieldId` with editorial formatting syntax.
 */
export const FormatButton: React.FC<FormatButtonProps> = React.memo(({
    label, syntaxOpen, syntaxClose, fieldId, value, onUpdate, color, effectStyle
}) => {
    const applyWrap = () => {
        wrapSelectionWithSyntax(fieldId, value ?? "", syntaxOpen, syntaxClose, onUpdate);
    };

    return (
        <button
            type="button"
            aria-label={`Format ${label}`}
            onPointerDown={(e) => {
                if (!isPrimaryPointer(e)) return;
                e.preventDefault();
                applyWrap();
            }}
            onKeyDown={(e) => {
                if (!isActivationKey(e.key)) return;
                e.preventDefault();
                applyWrap();
            }}
            className="tpe-format-btn"
            style={{ color, ...effectStyle }}
        >
            {label}
        </button>
    );
});
FormatButton.displayName = "FormatButton";

/**
 * Lazy-loaded emoji picker popover that inserts into `fieldId` at the caret position.
 */
export const EmojiToolbar = React.memo<{
    fieldId: string;
    value: string;
    onUpdate: (val: string) => void;
    popDirection?: 'up' | 'down';
}>(({ fieldId, value, onUpdate, popDirection = 'up' }) => {
    const [open, setOpen] = useState(false);
    const isMobile = useMediaQuery("(max-width: 768px)");
    const triggerRef = useRef<HTMLButtonElement>(null);
    const triggerId = useId().replace(/:/g, "");
    const ignoreSelector = `[data-popover-trigger="${triggerId}"]`;
    const pickerWidth = isMobile ? 280 : 320;

    const handleClose = useCallback((reason?: CloseReason) => {
        setOpen(false);
        if (reason === "escape") {
            triggerRef.current?.focus();
        }
    }, []);

    return (
        <div style={relativeWrapStyle}>
            <button
                ref={triggerRef}
                type="button"
                data-popover-trigger={triggerId}
                aria-label="Insert emoji"
                aria-expanded={open}
                aria-haspopup="dialog"
                onPointerDown={(e) => {
                    if (!isPrimaryPointer(e)) return;
                    e.preventDefault();
                    setOpen((prev) => !prev);
                }}
                onKeyDown={(e) => {
                    if (!isActivationKey(e.key)) return;
                    e.preventDefault();
                    setOpen((prev) => !prev);
                }}
                style={open ? emojiBtnOpenStyle : emojiBtnClosedStyle}
            >
                🙂
            </button>
            {open && (
                <EditorialPopover
                    open={open}
                    onClose={handleClose}
                    direction={popDirection}
                    width="auto"
                    ariaLabel="Emoji picker"
                    ignoreSelector={ignoreSelector}
                >
                    <LazyEmojiPicker
                        onEmojiClick={(emojiData) => {
                            insertTextAtCursor(fieldId, value, emojiData.emoji, onUpdate);
                            setOpen(false);
                        }}
                        theme={"dark" as EmojiPickerProps["theme"]}
                        emojiStyle={"apple" as EmojiPickerProps["emojiStyle"]}
                        searchPlaceHolder="Search emojis..."
                        lazyLoadEmojis={true}
                        skinTonesDisabled={true}
                        width={pickerWidth}
                        height={isMobile ? 350 : 400}
                    />
                </EditorialPopover>
            )}
        </div>
    );
});
EmojiToolbar.displayName = "EmojiToolbar";

interface PrefixToolbarPublicProps {
    prefix: string;
    onPrefixChange: (p: string) => void;
    value?: string;
    onUpdate?: (val: string) => void;
    fieldId?: string;
}

interface PrefixToolbarProps extends PrefixToolbarPublicProps {
    options: readonly string[];
    showSocial?: boolean;
}

const PrefixToolbar = React.memo<PrefixToolbarProps>(({
    value, prefix, onPrefixChange, onUpdate, fieldId, options, showSocial
}) => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const triggerId = useId().replace(/:/g, "");
    const ignoreSelector = `[data-popover-trigger="${triggerId}"]`;

    const handleClose = useCallback((reason?: CloseReason) => {
        setOpen(false);
        if (reason === "escape") {
            triggerRef.current?.focus();
        }
    }, []);

    return (
        <div style={relativeWrapStyle}>
            <button
                ref={triggerRef}
                type="button"
                data-popover-trigger={triggerId}
                aria-label={`Change prefix (${prefix})`}
                aria-expanded={open}
                aria-haspopup="menu"
                onPointerDown={(e) => {
                    if (!isPrimaryPointer(e)) return;
                    e.preventDefault();
                    setOpen((prev) => !prev);
                }}
                onKeyDown={(e) => {
                    if (!isActivationKey(e.key)) return;
                    e.preventDefault();
                    setOpen((prev) => !prev);
                }}
                className="tpe-prefix-toggle"
            >
                {prefix}
            </button>
            {open && (
                <EditorialPopover
                    open={open}
                    onClose={handleClose}
                    direction="down"
                    width="200px"
                    right="auto"
                    role="menu"
                    ariaLabel="Prefix options"
                    ignoreSelector={ignoreSelector}
                >
                    {options.map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            role="menuitem"
                            onClick={(e) => {
                                e.preventDefault();
                                if (opt !== prefix) onPrefixChange(opt);
                                setOpen(false);
                            }}
                            className="tpe-prefix-btn"
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
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const custom = normalizeEditorialPrefix(e.currentTarget.value);
                                if (custom && custom !== prefix) onPrefixChange(custom);
                                setOpen(false);
                            }
                        }}
                        className="tpe-popover-input"
                        style={customInputStyle}
                    />
                    {showSocial && fieldId && onUpdate && (
                        <div className="tpe-social-grid">
                            {SOCIAL_ICONS.map((soc) => (
                                <button
                                    key={soc.label}
                                    type="button"
                                    aria-label={`Insert ${soc.label} icon`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        insertTextAtCursor(fieldId, value ?? "", soc.icon, onUpdate);
                                        setOpen(false);
                                    }}
                                    className="tpe-social-btn"
                                    onMouseEnter={(e) => { e.currentTarget.style.background = soc.color; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}
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

export const SourcePrefixToolbar: React.FC<PrefixToolbarPublicProps> = React.memo(
    (props) => <PrefixToolbar {...props} options={SOURCE_PREFIX_OPTIONS} showSocial={true} />
);
SourcePrefixToolbar.displayName = "SourcePrefixToolbar";

export const ImageCreditToolbar: React.FC<PrefixToolbarPublicProps> = React.memo(
    (props) => <PrefixToolbar {...props} options={IMAGE_CREDIT_OPTIONS} showSocial={false} />
);
ImageCreditToolbar.displayName = "ImageCreditToolbar";

export const VideoCreditToolbar: React.FC<PrefixToolbarPublicProps> = React.memo(
    (props) => <PrefixToolbar {...props} options={VIDEO_CREDIT_OPTIONS} showSocial={true} />
);
VideoCreditToolbar.displayName = "VideoCreditToolbar";
