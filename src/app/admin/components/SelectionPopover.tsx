import React from "react";
import { useEditorialSelection } from "../hooks/useEditorialSelection";
import { DraftResolver, VideoDraftResolver } from "../utils/dataAccessors";
import { FormatButton } from "./EditorialTools";
import { Draft, VideoDraft, PostMode } from "../../../types/news";

const BOLD_EFFECT_STYLE: React.CSSProperties = { fontWeight: 800 };
const ITALIC_EFFECT_STYLE: React.CSSProperties = { fontStyle: 'italic' };
const LABEL_BOX_EFFECT_STYLE: React.CSSProperties = { background: '#000', padding: '2px 6px', borderRadius: '3px', fontWeight: 700, border: '1px solid var(--ui-border)' };
const WHITE_BOX_EFFECT_STYLE: React.CSSProperties = { background: '#fff', padding: '2px 6px', borderRadius: '3px', fontWeight: 700 };

interface SelectionPopoverProps {
    postMode: PostMode;
    carouselDraft: Draft;
    onCarouselChange: (d: Draft) => void;
    videoDraft: VideoDraft;
    onVideoChange: (d: VideoDraft) => void;
    activeSceneTime?: number;
}

/**
 * 2027 Institutional Standard: SelectionPopover
 * Detached UI element isolated from 120fps playback ticks via React.memo + discrete activeSceneTime.
 */
export const SelectionPopover: React.FC<SelectionPopoverProps> = React.memo(({
    postMode,
    carouselDraft,
    onCarouselChange,
    videoDraft,
    onVideoChange,
    activeSceneTime = 0,
}) => {
    const { selection } = useEditorialSelection();

    if (!selection) return null;

    const isVideo = postMode === 'video' || selection.fieldId.startsWith('video-');

    const val = isVideo
        ? VideoDraftResolver.get(selection.fieldId, videoDraft, activeSceneTime)
        : (DraftResolver.get(selection.fieldId, carouselDraft) as string);
    
    const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;
    const flipBelow = !isMobile && selection.y < 64;
    const skyboxTop = isMobile ? '5px' : (flipBelow ? selection.bottom + 8 : selection.y);
    const skyboxLeft = isMobile
        ? '50%'
        : (typeof window !== 'undefined'
            ? Math.min(Math.max(selection.x, 160), window.innerWidth - 160)
            : selection.x);

    const handleUpdate = (newVal: string) => {
        if (isVideo) {
            onVideoChange(VideoDraftResolver.set(selection.fieldId, newVal, videoDraft, activeSceneTime));
        } else {
            onCarouselChange(DraftResolver.set(selection.fieldId, newVal, carouselDraft));
        }
    };

    return (
        <div 
            className="tpe-selection-popover"
            style={{ 
                position: 'fixed',
                left: skyboxLeft, 
                top: skyboxTop,
                transform: (isMobile || flipBelow) ? 'translateX(-50%)' : 'translate(-50%, -100%)',
                pointerEvents: 'auto',
                userSelect: 'none',
                marginTop: (isMobile || flipBelow) ? '0' : '-8px',
                zIndex: 9999
            }}
        >
            <FormatButton label="GOLD" syntaxOpen="==" syntaxClose="==" fieldId={selection.fieldId} value={val} onUpdate={handleUpdate} color="var(--ui-accent)" effectStyle={BOLD_EFFECT_STYLE} />
            <FormatButton label="BOLD" syntaxOpen="**" syntaxClose="**" fieldId={selection.fieldId} value={val} onUpdate={handleUpdate} color="var(--ui-text)" effectStyle={BOLD_EFFECT_STYLE} />
            <FormatButton label="ITALIC" syntaxOpen="*" syntaxClose="*" fieldId={selection.fieldId} value={val} onUpdate={handleUpdate} color="var(--ui-text-dim)" effectStyle={ITALIC_EFFECT_STYLE} />
            <FormatButton label="GREEN" syntaxOpen="~~" syntaxClose="~~" fieldId={selection.fieldId} value={val} onUpdate={handleUpdate} color="var(--ui-indicator)" effectStyle={BOLD_EFFECT_STYLE} />
            <FormatButton label="LABEL BOX" syntaxOpen="^^" syntaxClose="^^" fieldId={selection.fieldId} value={val} onUpdate={handleUpdate} color="#fff" effectStyle={LABEL_BOX_EFFECT_STYLE} />
            <FormatButton label="WHITE BOX" syntaxOpen="&&" syntaxClose="&&" fieldId={selection.fieldId} value={val} onUpdate={handleUpdate} color="#050505" effectStyle={WHITE_BOX_EFFECT_STYLE} />
        </div>
    );
});
SelectionPopover.displayName = "SelectionPopover";
