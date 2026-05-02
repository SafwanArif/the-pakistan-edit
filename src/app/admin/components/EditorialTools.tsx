import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Draft } from "../../../types/news";
import { EMOJIS, SOCIAL_ICONS } from "../../../config/editorial";
import { getDraftValue, updateDraftValue } from "../utils/dataAccessors";
import { EditorialPopover } from "./EditorialPopover";

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
                <button onMouseDown={(e) => { e.preventDefault(); const el = document.getElementById(`input-${fieldId}`) as HTMLInputElement | HTMLTextAreaElement; if (el) { const start = el.selectionStart!; const end = el.selectionEnd!; const newVal = value.substring(0, start) + '*' + value.substring(start, end) + '*' + value.substring(end); onUpdate(newVal); setHasSelection(false); setTimeout(() => { el.focus(); el.setSelectionRange(start + 1, end + 1); }, 0); } }} className="tpe-toolbar-btn" style={{ background: '#111', color: 'var(--ui-accent)', border: '1px solid oklch(from var(--ui-accent) l c h / 0.2)', position: 'fixed', left: goldPos.x, top: goldPos.y, transform: 'translate(-50%, 15px)', zIndex: 'var(--z-overlay)', boxShadow: 'var(--shadow-lg)' }}>✨ Make Selected Gold</button>
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

export const SourcePrefixToolbar: React.FC<{ value: string, prefix: string, onPrefixChange: (p: string) => void, onUpdate: (val: string) => void, fieldId?: string }> = ({ value, prefix, onPrefixChange, onUpdate, fieldId }) => {
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
                {["SOURCE:", "VIA:", "REPORT:", "DATA:"].map(opt => (
                    <button key={opt} onClick={(e) => { e.preventDefault(); onPrefixChange(opt); onUpdate(`${opt} ${text}`.trim()); setOpen(false); }} className="tpe-prefix-btn">{opt}</button>
                ))}
                <input placeholder="Custom Prefix..." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const custom = (e.target as HTMLInputElement).value.toUpperCase().trim() + ( (e.target as HTMLInputElement).value.endsWith(':') ? '' : ':' ); onPrefixChange(custom); onUpdate(`${custom} ${text}`.trim()); setOpen(false); } }} className="tpe-popover-input" style={{ marginTop: '4px' }} />
                {fieldId && (
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

export const ImageCreditToolbar: React.FC<{ value: string, prefix: string, onPrefixChange: (p: string) => void, onUpdate: (val: string) => void, fieldId?: string }> = ({ value, prefix, onPrefixChange, onUpdate, fieldId }) => {
    const [open, setOpen] = useState(false);
    const text = useMemo(() => { const full = value || ""; return full.startsWith(prefix) ? full.slice(prefix.length).trim() : full; }, [value, prefix]);
    
    return (
        <div style={{ position: 'relative' }}>
            <button onClick={(e) => { e.preventDefault(); setOpen(!open); }} className="tpe-prefix-toggle">{prefix}</button>
            <EditorialPopover open={open} onClose={() => setOpen(false)} direction="down" width="200px" right="auto">
                {["PHOTO:", "STILL:", "VIA:", "SOURCE:"].map(opt => (
                    <button key={opt} onClick={(e) => { e.preventDefault(); onPrefixChange(opt); onUpdate(`${opt} ${text}`.trim()); setOpen(false); }} className="tpe-prefix-btn">{opt}</button>
                ))}
                <input placeholder="Custom Prefix..." onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); const custom = (e.target as HTMLInputElement).value.toUpperCase().trim() + ( (e.target as HTMLInputElement).value.endsWith(':') ? '' : ':' ); onPrefixChange(custom); onUpdate(`${custom} ${text}`.trim()); setOpen(false); } }} className="tpe-popover-input" style={{ marginTop: '4px' }} />
            </EditorialPopover>
        </div>
    );
};
