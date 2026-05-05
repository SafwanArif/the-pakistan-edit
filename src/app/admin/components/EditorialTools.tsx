import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Draft } from "../../../types/news";
import { EMOJIS, SOCIAL_ICONS } from "../../../config/editorial";
import { getDraftValue, updateDraftValue } from "../utils/dataAccessors";
import { EditorialPopover } from "./EditorialPopover";

const FormatButton: React.FC<{ icon: string, label: string, syntax: string, fieldId: string, value: string, onUpdate: (v: string) => void, setHasSelection: (b: boolean) => void, color: string }> = ({ icon, label, syntax, fieldId, value, onUpdate, setHasSelection, color }) => (
    <button 
        onMouseDown={(e) => { 
            e.preventDefault(); 
            const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement; 
            if (el) { 
                const start = el.selectionStart!; 
                const end = el.selectionEnd!; 
                const newVal = value.substring(0, start) + syntax + value.substring(start, end) + syntax + value.substring(end); 
                onUpdate(newVal); 
                setHasSelection(false); 
                setTimeout(() => { el.focus(); el.setSelectionRange(start + syntax.length, end + syntax.length); }, 0); 
            } 
        }} 
        style={{ 
            background: 'oklch(from var(--ui-text) l c h / 0.05)', 
            color: color, 
            border: 'none', 
            padding: '0 12px',
            height: '28px',
            fontSize: '10px',
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderRadius: '4px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'var(--transition-fast)'
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'oklch(from var(--ui-text) l c h / 0.1)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'oklch(from var(--ui-text) l c h / 0.05)'}
    >
        <span style={{ fontSize: '12px' }}>{icon}</span> {label}
    </button>
);

export const EmojiToolbar: React.FC<{ fieldId: string, value: string, onUpdate: (val: string) => void, popDirection?: 'up' | 'down', right?: string | number }> = ({ fieldId, value, onUpdate, popDirection = 'up', right = '12px' }) => {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [hasSelection, setHasSelection] = useState(false);
    const [goldPos, setGoldPos] = useState({ x: 0, y: 0 });
    
    useEffect(() => {
        const el = document.getElementById(`input-${fieldId}`);
        if (!el) return;
        const onActivity = () => {
            const inputEl = el as HTMLInputElement | HTMLTextAreaElement;
            if (inputEl.selectionStart !== inputEl.selectionEnd && inputEl.selectionStart !== null) {
                const rect = inputEl.getBoundingClientRect();
                setGoldPos({ x: rect.left + (rect.width / 2), y: rect.bottom });
                setHasSelection(true);
            } else {
                setHasSelection(false);
            }
        };
        el.addEventListener("mouseup", onActivity);
        el.addEventListener("touchend", onActivity);
        el.addEventListener("keyup", onActivity);
        return () => {
            el.removeEventListener("mouseup", onActivity);
            el.removeEventListener("touchend", onActivity);
            el.removeEventListener("keyup", onActivity);
        };
    }, [fieldId]);

    const filtered = useMemo(() => EMOJIS.filter(e => e.label.toLowerCase().includes(search.toLowerCase())), [search]);

    const handleEmojiClick = (emojiIcon: string) => {
        const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement;
        if (el && el.selectionStart !== null) {
            const start = el.selectionStart;
            const end = el.selectionEnd || start;
            const newVal = value.substring(0, start) + emojiIcon + value.substring(end);
            onUpdate(newVal);
            setTimeout(() => { el.focus(); el.setSelectionRange(start + emojiIcon.length, start + emojiIcon.length); }, 0);
        }
        setOpen(false);
        setSearch("");
    };

    return (
        <>
            {hasSelection && (
                <div 
                    style={{ 
                        position: 'fixed', 
                        left: goldPos.x, 
                        top: goldPos.y, 
                        transform: 'translate(-50%, 15px)', 
                        zIndex: 'var(--z-overlay)', 
                        display: 'flex', 
                        gap: '6px',
                        background: 'var(--ui-bg-popover)',
                        backdropFilter: 'blur(var(--blur-md))',
                        padding: '6px',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid oklch(from var(--ui-border) l c h / 0.5)',
                        boxShadow: 'var(--shadow-lg)'
                    }}
                >
                    <FormatButton icon="✨" label="Gold" syntax="^" fieldId={fieldId} value={value} onUpdate={onUpdate} setHasSelection={setHasSelection} color="var(--ui-accent)" />
                    <FormatButton icon="B" label="Bold" syntax="*" fieldId={fieldId} value={value} onUpdate={onUpdate} setHasSelection={setHasSelection} color="var(--ui-text)" />
                    <FormatButton icon="🟩" label="Green" syntax="_" fieldId={fieldId} value={value} onUpdate={onUpdate} setHasSelection={setHasSelection} color="var(--ui-indicator)" />
                    <FormatButton icon="⬛" label="Block" syntax="%" fieldId={fieldId} value={value} onUpdate={onUpdate} setHasSelection={setHasSelection} color="var(--ui-text)" />
                </div>
            )}
            <div style={{ position: 'absolute', right: right, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: '6px', zIndex: 'var(--z-toolbar)', alignItems: 'center' }}>
                <div style={{ position: 'relative' }}>
                    <button onClick={(e) => { e.preventDefault(); setOpen(!open); }} style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '18px', padding: '0', filter: open ? 'none' : 'grayscale(100%) opacity(0.6)' }}>🙂</button>
                    <EditorialPopover open={open} onClose={() => setOpen(false)} direction={popDirection} width="240px">
                        <input autoFocus placeholder="Search emojis..." value={search} onChange={(e) => setSearch(e.target.value)} className="tpe-popover-input" />
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
                            {filtered.map(emoji => (
                                <button key={emoji.label} onClick={(e) => { e.preventDefault(); handleEmojiClick(emoji.icon); }} className="tpe-emoji-btn">{emoji.icon}</button>
                            ))}
                        </div>
                    </EditorialPopover>
                </div>
            </div>
        </>
    );
};

export const PrefixToolbar: React.FC<{ 
    value: string, 
    prefix: string, 
    onPrefixChange: (p: string) => void, 
    onUpdate: (val: string) => void, 
    fieldId?: string,
    options: string[],
    showSocial?: boolean
}> = ({ value, prefix, onPrefixChange, onUpdate, fieldId, options, showSocial }) => {
    const [open, setOpen] = useState(false);
    const text = useMemo(() => value.startsWith(prefix) ? value.slice(prefix.length).trim() : value, [value, prefix]);
    
    const handleIconClick = (icon: string) => {
        if (!fieldId) return;
        const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement;
        let newVal = value;
        if (el && el.selectionStart !== null) {
            const start = el.selectionStart;
            const end = el.selectionEnd || start;
            newVal = value.substring(0, start) + icon + value.substring(end);
            onUpdate(newVal);
            setTimeout(() => { el.focus(); el.setSelectionRange(start + icon.length, start + icon.length); }, 0);
        } else {
            newVal = value ? value + " " + icon : icon;
            onUpdate(newVal);
        }
        setOpen(false);
    };

    return (
        <div style={{ position: 'relative' }}>
            <button onClick={(e) => { e.preventDefault(); setOpen(!open); }} className="tpe-prefix-toggle">{prefix}</button>
            <EditorialPopover open={open} onClose={() => setOpen(false)} direction="down" width="200px" right="auto">
                {options.map(opt => (
                    <button key={opt} onClick={(e) => { e.preventDefault(); onPrefixChange(opt); onUpdate(`${opt} ${text}`.trim()); setOpen(false); }} className="tpe-prefix-btn">{opt}</button>
                ))}
                <input placeholder="Custom Prefix..." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const custom = (e.target as HTMLInputElement).value.toUpperCase().trim() + ( (e.target as HTMLInputElement).value.endsWith(':') ? '' : ':' ); onPrefixChange(custom); onUpdate(`${custom} ${text}`.trim()); setOpen(false); } }} className="tpe-popover-input" style={{ marginTop: '4px' }} />
                {showSocial && fieldId && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid var(--ui-border)' }}>
                        {SOCIAL_ICONS.map(soc => (
                            <button key={soc.label} onClick={(e) => { e.preventDefault(); handleIconClick(soc.icon); }} className="tpe-social-btn" onMouseEnter={(e) => { e.currentTarget.style.background = soc.color; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>{soc.logo}</button>
                        ))}
                    </div>
                )}
            </EditorialPopover>
        </div>
    );
};

export const SourcePrefixToolbar: React.FC<any> = (props) => (
    <PrefixToolbar {...props} options={["SOURCE:", "VIA:", "REPORT:", "DATA:"]} showSocial={true} />
);

export const ImageCreditToolbar: React.FC<any> = (props) => (
    <PrefixToolbar {...props} options={["PHOTO:", "STILL:", "VIA:", "SOURCE:"]} showSocial={false} />
);
