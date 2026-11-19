import React, { useState } from "react";
import { SOCIAL_ICONS } from "../../../config/editorial";
import { insertTextAtCursor, wrapSelectionWithSyntax } from "../utils/domUtils";
import { EditorialPopover } from "./EditorialPopover";
import EmojiPicker, { Theme, EmojiStyle } from 'emoji-picker-react';

/**
 * 2027 Institutional Primitive: FormatButton
 */
export const FormatButton: React.FC<{ label: string, syntaxOpen: string, syntaxClose: string, fieldId: string, value: string, onUpdate: (v: string) => void, color: string, effectStyle?: React.CSSProperties }> = ({ label, syntaxOpen, syntaxClose, fieldId, value, onUpdate, color, effectStyle }) => (
    <button 
        type="button"
        aria-label={`Format ${label}`}
        onMouseDown={(e) => { 
            e.preventDefault(); 
            wrapSelectionWithSyntax(fieldId, value, syntaxOpen, syntaxClose, onUpdate);
        }} 
        className="tpe-format-btn"
        style={{ color: color, ...effectStyle }}
    >
        {label}
    </button>
);
FormatButton.displayName = "FormatButton";

/**
 * 2027 Institutional Primitive: EmojiToolbar (Powered by EmojiPickerReact)
 */
export const EmojiToolbar = React.memo<{ fieldId: string, value: string, onUpdate: (val: string) => void, popDirection?: 'up' | 'down' }>(({ fieldId, value, onUpdate, popDirection = 'up' }) => {
    const [open, setOpen] = useState(false);

    return (
        <div style={{ position: 'relative' }}>
            <button type="button" aria-label="Insert emoji" aria-expanded={open} aria-haspopup="dialog" onClick={(e) => { e.preventDefault(); setOpen(!open); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', filter: open ? 'none' : 'grayscale(100%) opacity(0.6)' }}>🙂</button>
            <EditorialPopover open={open} onClose={() => setOpen(false)} direction={popDirection} width="auto">
                <EmojiPicker 
                    onEmojiClick={(emojiData) => {
                        insertTextAtCursor(fieldId, value, emojiData.emoji, onUpdate);
                        setOpen(false);
                    }}
                    theme={Theme.DARK}
                    emojiStyle={EmojiStyle.APPLE}
                    searchPlaceHolder="Search emojis..."
                    lazyLoadEmojis={true}
                    skinTonesDisabled={true}
                    width={320}
                    height={400}
                />
            </EditorialPopover>
        </div>
    );
});
EmojiToolbar.displayName = "EmojiToolbar";

/**
 * 2027 Institutional Primitive: PrefixToolbar
 */
const PrefixToolbar = React.memo<{ 
    value: string, 
    prefix: string, 
    onPrefixChange: (p: string) => void, 
    onUpdate: (val: string) => void, 
    fieldId?: string,
    options: string[],
    showSocial?: boolean
}>(({ value, prefix, onPrefixChange, onUpdate, fieldId, options, showSocial }) => {
    const [open, setOpen] = useState(false);
    
    // We no longer slice the prefix out of the value because they are decoupled!
    // The value strictly holds only the text. The prefix strictly holds the prefix.
    
    return (
        <div style={{ position: 'relative' }}>
            <button type="button" aria-label={`Change prefix (${prefix})`} aria-expanded={open} aria-haspopup="menu" onClick={(e) => { e.preventDefault(); setOpen(!open); }} className="tpe-prefix-toggle">{prefix}</button>
            <EditorialPopover open={open} onClose={() => setOpen(false)} direction="down" width="200px" right="auto">
                {options.map(opt => (
                    <button key={opt} type="button" onClick={(e) => { 
                        e.preventDefault(); 
                        onPrefixChange(opt); 
                        // FIX: We no longer mutate the text field with the prefix!
                        setOpen(false); 
                    }} className="tpe-prefix-btn">{opt}</button>
                ))}
                <input 
                    aria-label="Custom prefix"
                    placeholder="Custom..." 
                    onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => { 
                        if (e.key === 'Enter') { 
                            const custom = (e.target as HTMLInputElement).value.toUpperCase().trim() + ":"; 
                            onPrefixChange(custom); 
                            setOpen(false); 
                        } 
                    }} 
                    className="tpe-popover-input" 
                    style={{ marginTop: '4px' }} 
                />
                {showSocial && fieldId && (
                    <div className="tpe-social-grid">
                        {SOCIAL_ICONS.map(soc => (
                            <button key={soc.label} type="button" aria-label={`Insert ${soc.label} icon`} onClick={(e) => { e.preventDefault(); insertTextAtCursor(fieldId, value, soc.icon, onUpdate); setOpen(false); }} className="tpe-social-btn" onMouseEnter={(e) => { e.currentTarget.style.background = soc.color; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{soc.logo}</button>
                        ))}
                    </div>
                )}
            </EditorialPopover>
        </div>
    );
});
PrefixToolbar.displayName = "PrefixToolbar";

export const SourcePrefixToolbar: React.FC<{
    value: string, prefix: string, onPrefixChange: (p: string) => void, onUpdate: (val: string) => void, fieldId?: string
}> = (props) => <PrefixToolbar {...props} options={["SOURCE:", "VIA:", "REPORT:", "DATA:"]} showSocial={true} />;
SourcePrefixToolbar.displayName = "SourcePrefixToolbar";

export const ImageCreditToolbar: React.FC<{
    value: string, prefix: string, onPrefixChange: (p: string) => void, onUpdate: (val: string) => void, fieldId?: string
}> = (props) => <PrefixToolbar {...props} options={["PHOTO:", "STILL:", "VIA:", "SOURCE:"]} showSocial={false} />;
ImageCreditToolbar.displayName = "ImageCreditToolbar";

export const VideoCreditToolbar: React.FC<{
    value: string, prefix: string, onPrefixChange: (p: string) => void, onUpdate: (val: string) => void, fieldId?: string
}> = (props) => <PrefixToolbar {...props} options={["FOOTAGE:", "CLIP:", "VIA:", "COURTESY:"]} showSocial={true} />;
VideoCreditToolbar.displayName = "VideoCreditToolbar";
