"use client";

import React from "react";

interface TimelineFooterCardsProps {
    sceneCount: number;
    enableOutro: boolean;
    outroDuration?: number;
    outroCta?: string;
    outroStart: number;
    isOutroActive: boolean;
    onAddAngle: () => void;
    onSeekOutro: (t: number) => void;
}

/** Storyboard footer controls (+ Add Angle and branded Outro preview card). */
export const TimelineFooterCards: React.FC<TimelineFooterCardsProps> = ({
    sceneCount,
    enableOutro,
    outroDuration = 5,
    outroCta,
    outroStart,
    isOutroActive,
    onAddAngle,
    onSeekOutro,
}) => (
    <>
        <button
            type="button"
            onClick={onAddAngle}
            style={{ width: '100%', height: '42px', background: 'oklch(from var(--ui-text) l c h / 0.02)', border: '1px dashed var(--ui-border)', borderRadius: '10px', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '6px', cursor: 'pointer', color: 'var(--ui-text-dim)', transition: 'border-color 0.2s ease, color 0.2s ease', padding: '8px' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ui-accent)'; e.currentTarget.style.color = 'var(--ui-accent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--ui-border)'; e.currentTarget.style.color = 'var(--ui-text-dim)'; }}
        >
            <span style={{ fontSize: '18px', fontWeight: 300 }}>+</span>
            <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em' }}>ADD ANGLE</span>
        </button>

        {enableOutro && (() => {
            const outroColor = "var(--ui-outro)";
            return (
                <div
                    onClick={() => onSeekOutro(outroStart)}
                    style={{
                        width: '100%',
                        cursor: isOutroActive ? 'default' : 'pointer',
                        background: isOutroActive ? `color-mix(in oklch, ${outroColor} 9%, transparent)` : 'oklch(from var(--ui-text) l c h / 0.02)',
                        borderWidth: '1px',
                        borderStyle: 'solid',
                        borderTopColor: isOutroActive ? outroColor : 'var(--ui-border)',
                        borderRightColor: isOutroActive ? outroColor : 'var(--ui-border)',
                        borderBottomColor: isOutroActive ? outroColor : 'var(--ui-border)',
                        borderLeftWidth: '3px',
                        borderLeftColor: outroColor,
                        borderRadius: '10px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: isOutroActive ? `0 0 16px color-mix(in oklch, ${outroColor} 18%, transparent)` : 'none',
                        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                >
                    <div className="tpe-flex-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontSize: '10px', fontWeight: 900, color: outroColor, letterSpacing: '0.06em' }}>
                                🏁 {String(sceneCount + 1).padStart(2, '0')}. OUTRO
                            </span>
                            {isOutroActive && <span style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '3px', background: outroColor, color: '#000', fontWeight: 900 }}>PLAYING</span>}
                        </div>
                        <span className="tpe-tabular-nums" style={{ fontSize: '11px', fontFamily: 'monospace', fontWeight: 700, color: outroColor }}>{outroDuration}s</span>
                    </div>
                    <div
                        style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 10px',
                            background: isOutroActive ? `color-mix(in oklch, ${outroColor} 12%, transparent)` : 'rgba(0, 0, 0, 0.28)',
                            borderRadius: '6px',
                            border: isOutroActive ? `1px dashed ${outroColor}` : '1px solid transparent',
                            transition: 'background-color 0.15s ease, border-color 0.15s ease',
                        }}
                        title="Click to jump to Outro"
                    >
                        <div style={{ fontSize: '11px', fontWeight: 800, color: 'var(--ui-text)', textTransform: 'uppercase', lineHeight: 1.3 }}>
                            {outroCta || "FOLLOW @THEPAKISTANEDIT FOR VERIFIED INTELLIGENCE"}
                        </div>
                        {isOutroActive && <div style={{ fontSize: '8px', fontWeight: 800, color: outroColor, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '4px' }}>✎ EDITING IN TOP BAR</div>}
                    </div>
                </div>
            );
        })()}
    </>
);
