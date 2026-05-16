import React, { useState, useMemo } from "react";
import { EMOJIS, SOCIAL_ICONS } from "../../../config/editorial";
import { insertTextAtCursor, wrapSelectionWithSyntax } from "../utils/domUtils";
import { EditorialPopover } from "./EditorialPopover";

/**
 * 2027 Institutional Primitive: FormatButton
 */
export const FormatButton: React.FC<{ label: string, syntax: string, fieldId: string, value: string, onUpdate: (v: string) => void, color: string, effectStyle?: React.CSSProperties }> = ({ label, syntax, fieldId, value, onUpdate, color, effectStyle }) => (
    <button 
        onMouseDown={(e) => { 
            e.preventDefault(); 
            wrapSelectionWithSyntax(fieldId, value, syntax, onUpdate);
        }} 
        className="tpe-format-btn"
        style={{ color: color, ...effectStyle }}
    >
        {label}
    </button>
);

/**
 * 2027 Institutional Primitive: EmojiToolbar
 */
export const EmojiToolbar = React.memo<{ fieldId: string, value: string, onUpdate: (val: string) => void, popDirection?: 'up' | 'down' }>(({ fieldId, value, onUpdate, popDirection = 'up' }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const filtered = useMemo(() => EMOJIS.filter(e => e.label.toLowerCase().includes(search.toLowerCase())), [search]);

    return (
        <div style={{ position: 'relative' }}>
            <button onClick={(e) => { e.preventDefault(); setOpen(!open); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', filter: open ? 'none' : 'grayscale(100%) opacity(0.6)' }}>🙂</button>
            <EditorialPopover open={open} onClose={() => setOpen(false)} direction={popDirection} width="240px">
                <input autoFocus placeholder="Search emojis..." value={search} onChange={(e) => setSearch(e.target.value)} className="tpe-popover-input" />
                <div className="tpe-emoji-picker-grid">
                    {filtered.map(emoji => (
                        <button key={emoji.label} onClick={(e) => { e.preventDefault(); insertTextAtCursor(fieldId, value, emoji.icon, onUpdate); setOpen(false); }} className="tpe-emoji-btn">{emoji.icon}</button>
                    ))}
                </div>
            </EditorialPopover>
        </div>
    );
});

/**
 * 2027 Institutional Primitive: PrefixToolbar
 */
export const PrefixToolbar = React.memo<{ 
    value: string, 
    prefix: string, 
    onPrefixChange: (p: string) => void, 
    onUpdate: (val: string) => void, 
    fieldId?: string,
    options: string[],
    showSocial?: boolean
}>(({ value, prefix, onPrefixChange, onUpdate, fieldId, options, showSocial }) => {
    const [open, setOpen] = useState(false);
    const text = useMemo(() => value.startsWith(prefix) ? value.slice(prefix.length).trim() : value, [value, prefix]);
    
    return (
        <div style={{ position: 'relative' }}>
            <button onClick={(e) => { e.preventDefault(); setOpen(!open); }} className="tpe-prefix-toggle">{prefix}</button>
            <EditorialPopover open={open} onClose={() => setOpen(false)} direction="down" width="200px" right="auto">
                {options.map(opt => (
                    <button key={opt} onClick={(e) => { e.preventDefault(); onPrefixChange(opt); onUpdate(`${opt} ${text}`.trim()); setOpen(false); }} className="tpe-prefix-btn">{opt}</button>
                ))}
                <input placeholder="Custom..." onKeyDown={(e) => { if (e.key === 'Enter') { const custom = (e.target as HTMLInputElement).value.toUpperCase().trim() + ":"; onPrefixChange(custom); onUpdate(`${custom} ${text}`.trim()); setOpen(false); } }} className="tpe-popover-input" style={{ marginTop: '4px' }} />
                {showSocial && fieldId && (
                    <div className="tpe-social-grid">
                        {SOCIAL_ICONS.map(soc => (
                            <button key={soc.label} onClick={(e) => { e.preventDefault(); insertTextAtCursor(fieldId, value, soc.icon, onUpdate); setOpen(false); }} className="tpe-social-btn" onMouseEnter={(e) => { e.currentTarget.style.background = soc.color; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{soc.logo}</button>
                        ))}
                    </div>
                )}
            </EditorialPopover>
        </div>
    );
});

export const SourcePrefixToolbar: React.FC<any> = (props) => <PrefixToolbar {...props} options={["SOURCE:", "VIA:", "REPORT:", "DATA:"]} showSocial={true} />;
export const ImageCreditToolbar: React.FC<any> = (props) => <PrefixToolbar {...props} options={["PHOTO:", "STILL:", "VIA:", "SOURCE:"]} showSocial={false} />;
