import React, { useCallback, useEffect, useRef } from "react";
import { useEditorialSelection } from "../hooks/useEditorialSelection";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { DraftResolver, VideoDraftResolver } from "../utils/dataAccessors";
import { FormatButton } from "./EditorialTools";
import { Draft, VideoDraft, PostMode } from "@/types/news";

const BOLD_EFFECT_STYLE: React.CSSProperties = { fontWeight: 800 };
const ITALIC_EFFECT_STYLE: React.CSSProperties = { fontStyle: 'italic' };
const LABEL_BOX_EFFECT_STYLE: React.CSSProperties = { background: '#000', padding: '2px 6px', borderRadius: '3px', fontWeight: 700, border: '1px solid var(--ui-border)' };
const WHITE_BOX_EFFECT_STYLE: React.CSSProperties = { background: '#fff', padding: '2px 6px', borderRadius: '3px', fontWeight: 700 };

interface SelectionPopoverProps {
    postMode: PostMode;
    carouselDraft?: Draft;
    onCarouselChange?: (d: Draft) => void;
    videoDraft?: VideoDraft;
    onVideoChange?: (d: VideoDraft) => void;
    activeSceneTime?: number;
}

/**
 * 2027 Institutional Standard: SelectionPopover
 * Detached UI element isolated from 120Hz playback ticks via React.memo + discrete activeSceneTime.
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
    const isMobile = useMediaQuery("(max-width: 900px)");
    const stateRef = useRef({
        postMode,
        carouselDraft,
        onCarouselChange,
        videoDraft,
        onVideoChange,
        activeSceneTime,
        fieldId: selection?.fieldId ?? "",
    });
    useEffect(() => {
        stateRef.current = {
            postMode,
            carouselDraft,
            onCarouselChange,
            videoDraft,
            onVideoChange,
            activeSceneTime,
            fieldId: selection?.fieldId ?? "",
        };
    });

    const handleUpdate = useCallback((newVal: string) => {
        const s = stateRef.current;
        if (!s.fieldId) return;
        const videoMode = s.postMode === 'video' || s.fieldId.startsWith('video-');
        if (videoMode) {
            if (s.videoDraft && s.onVideoChange) {
                s.onVideoChange(VideoDraftResolver.set(s.fieldId, newVal, s.videoDraft, s.activeSceneTime));
            }
        } else if (s.carouselDraft && s.onCarouselChange) {
            s.onCarouselChange(DraftResolver.set(s.fieldId, newVal, s.carouselDraft));
        }
    }, []);

    if (!selection) return null;

    const isVideo = postMode === 'video' || selection.fieldId.startsWith('video-');

    const val = isVideo
        ? (videoDraft ? VideoDraftResolver.get(selection.fieldId, videoDraft, activeSceneTime) : "")
        : (carouselDraft ? (DraftResolver.get(selection.fieldId, carouselDraft) as string) : "");
    
    const inCommandRibbon = selection.ribbonBottom !== null;
    const flipBelow = inCommandRibbon || selection.y < 64;
    const skyboxTop = inCommandRibbon
        ? selection.ribbonBottom! + 6
        : (flipBelow ? selection.bottom + 8 : selection.y);
    const skyboxLeft = isMobile
        ? '50%'
        : (typeof window !== 'undefined'
            ? Math.min(Math.max(selection.x, 180), window.innerWidth - 180)
            : selection.x);

    return (
        <div 
            data-editorial-popover="true"
            className="tpe-selection-popover"
            style={{ 
                position: 'fixed',
                left: skyboxLeft, 
                top: skyboxTop,
                transform: flipBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)',
                pointerEvents: 'auto',
                userSelect: 'none',
                marginTop: flipBelow ? '0' : '-8px',
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
