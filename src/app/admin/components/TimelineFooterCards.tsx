"use client";

import React from "react";
import { PowerIcon } from "../../../components/icons/TPEIcons";

const OUTRO_COLOR = "var(--ui-outro)";
const outroHeaderRowStyle: React.CSSProperties = { justifyContent: 'space-between', alignItems: 'center' };
const outroTitleGroupStyle: React.CSSProperties = { alignItems: 'center', gap: '6px' };
const outroTitleTextStyle: React.CSSProperties = { fontSize: '10px', fontWeight: 900, color: OUTRO_COLOR, letterSpacing: '0.06em' };
const outroPlayingBadgeStyle: React.CSSProperties = { fontSize: '8px', padding: '1px 5px', borderRadius: '3px', background: OUTRO_COLOR, color: '#000', fontWeight: 900 };
const outroDurationStyle: React.CSSProperties = { fontSize: '11px', fontFamily: 'monospace', fontWeight: 700, color: OUTRO_COLOR };
const outroCtaTextStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 800, color: 'var(--ui-text)', textTransform: 'uppercase', lineHeight: 1.3 };
const outroEditHintStyle: React.CSSProperties = { fontSize: '8px', fontWeight: 800, color: OUTRO_COLOR, letterSpacing: '0.06em', textTransform: 'uppercase', marginTop: '4px' };

interface TimelineFooterCardsProps {
    sceneCount: number;
    enableOutro: boolean;
    outroDuration?: number;
    outroCta?: string;
    outroStart: number;
    isOutroActive: boolean;
    onAddAngle: () => void;
    onSeekOutro: (t: number) => void;
    onToggleOutro: () => void;
}

/** Storyboard footer controls (+ Add Angle and branded Outro preview card). */
export const TimelineFooterCards: React.FC<TimelineFooterCardsProps> = React.memo(({
    sceneCount,
    enableOutro,
    outroDuration = 5,
    outroCta,
    outroStart,
    isOutroActive,
    onAddAngle,
    onSeekOutro,
    onToggleOutro,
}) => (
    <>
        <button
            type="button"
            onClick={onAddAngle}
            className="tpe-add-angle-btn"
        >
            <span style={{ fontSize: '18px', fontWeight: 300 }}>+</span>
            <span style={{ fontSize: '9px', fontWeight: 800, letterSpacing: '0.05em' }}>ADD ANGLE</span>
        </button>

        {enableOutro ? (
                <div
                    onClick={() => onSeekOutro(outroStart)}
                    style={{
                        width: '100%',
                        cursor: isOutroActive ? 'default' : 'pointer',
                        background: isOutroActive ? `color-mix(in oklch, ${OUTRO_COLOR} 9%, transparent)` : 'oklch(from var(--ui-text) l c h / 0.02)',
                        borderTopWidth: '1px',
                        borderRightWidth: '1px',
                        borderBottomWidth: '1px',
                        borderLeftWidth: '3px',
                        borderTopStyle: 'solid',
                        borderRightStyle: 'solid',
                        borderBottomStyle: 'solid',
                        borderLeftStyle: 'solid',
                        borderTopColor: isOutroActive ? OUTRO_COLOR : 'var(--ui-border)',
                        borderRightColor: isOutroActive ? OUTRO_COLOR : 'var(--ui-border)',
                        borderBottomColor: isOutroActive ? OUTRO_COLOR : 'var(--ui-border)',
                        borderLeftColor: OUTRO_COLOR,
                        borderRadius: '10px',
                        padding: '12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        boxShadow: isOutroActive ? `0 0 16px color-mix(in oklch, ${OUTRO_COLOR} 18%, transparent)` : 'none',
                        transition: 'background-color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease',
                    }}
                >
                    <div className="tpe-flex-row" style={outroHeaderRowStyle}>
                        <div className="tpe-flex-row" style={outroTitleGroupStyle}>
                            <span style={outroTitleTextStyle}>
                                {String(sceneCount + 1).padStart(2, '0')}. OUTRO
                            </span>
                            {isOutroActive && <span style={outroPlayingBadgeStyle}>PLAYING</span>}
                        </div>
                        <div className="tpe-flex-row" style={{ alignItems: 'center', gap: '6px' }}>
                            <span className="tpe-tabular-nums" style={outroDurationStyle}>{outroDuration}s</span>
                            <button
                                type="button"
                                aria-pressed={enableOutro}
                                aria-label="Disable Outro"
                                className="tpe-asset-btn"
                                data-active={enableOutro}
                                onClick={(event) => { event.stopPropagation(); onToggleOutro(); }}
                                style={{ width: '18px', height: '18px', padding: 0, lineHeight: 1 }}
                                title="Disable Outro"
                            >
                                <PowerIcon />
                            </button>
                        </div>
                    </div>
                    <div
                        style={{
                            width: '100%',
                            textAlign: 'left',
                            padding: '8px 10px',
                            background: isOutroActive ? `color-mix(in oklch, ${OUTRO_COLOR} 12%, transparent)` : 'rgba(0, 0, 0, 0.28)',
                            borderRadius: '6px',
                            border: isOutroActive ? `1px dashed ${OUTRO_COLOR}` : '1px solid transparent',
                            transition: 'background-color 0.15s ease, border-color 0.15s ease',
                        }}
                        title="Click to jump to Outro"
                    >
                        <div style={outroCtaTextStyle}>
                            {outroCta || "FOLLOW @THEPAKISTANEDIT FOR VERIFIED INTELLIGENCE"}
                        </div>
                        {isOutroActive && <div style={outroEditHintStyle}>✎ EDITING IN TOP BAR</div>}
                    </div>
                </div>
        ) : (
                <div
                    style={{
                        width: '100%',
                        borderTopWidth: '1px',
                        borderRightWidth: '1px',
                        borderBottomWidth: '1px',
                        borderLeftWidth: '1px',
                        borderTopStyle: 'dashed',
                        borderRightStyle: 'dashed',
                        borderBottomStyle: 'dashed',
                        borderLeftStyle: 'dashed',
                        borderTopColor: 'var(--ui-border)',
                        borderRightColor: 'var(--ui-border)',
                        borderBottomColor: 'var(--ui-border)',
                        borderLeftColor: 'var(--ui-border)',
                        borderRadius: '10px',
                        padding: '8px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                    }}
                >
                    <span style={{ ...outroTitleTextStyle, color: 'var(--ui-text-dim)' }}>
                        {String(sceneCount + 1).padStart(2, '0')}. OUTRO
                    </span>
                    <button
                        type="button"
                        aria-pressed={enableOutro}
                        aria-label="Enable Outro"
                        className="tpe-asset-btn"
                        data-active={enableOutro}
                        onClick={onToggleOutro}
                        style={{ width: '18px', height: '18px', padding: 0, lineHeight: 1 }}
                        title="Enable Outro"
                    >
                        <PowerIcon />
                    </button>
                </div>
        )}
    </>
));

TimelineFooterCards.displayName = "TimelineFooterCards";
