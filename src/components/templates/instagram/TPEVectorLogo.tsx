import React from "react";

/**
 * 2027 Professional Quality Vector Logo
 * Features a geometrically authentic representation of the Pakistan Crescent and Star
 * Designed for pure crisp vector rendering (No AI artifacts)
 */
export const TPEVectorLogo: React.FC<{ 
    scale?: number, 
    showWordmark?: boolean 
}> = ({ 
    scale = 1,
    showWordmark = true
}) => {
    const colors = {
        pakistanGreen: "var(--ui-indicator)",
        paperWhite: "var(--ui-text)",
        crescentGold: "var(--ui-accent)",
    };

    return (
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'center center', display: 'inline-flex' }}>
            <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'center' }}>
                {/* Authentic Institutional Monogram */}
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="6" y="22" width="12" height="6" fill={colors.paperWhite} />
                    <path fillRule="evenodd" clipRule="evenodd" d="M 18 6 H 24 A 11 11 0 0 1 24 28 V 42 H 18 V 6 Z M 24 12 V 22 A 5 5 0 0 0 24 12 Z" fill={colors.pakistanGreen} />
                    <circle cx="32" cy="39" r="3" fill={colors.crescentGold} />
                </svg>

                {/* Premium Stacked Logotype */}
                {showWordmark && (
                    <div className="tpe-flex-col" style={{ lineHeight: 1.1, marginTop: '-8px', alignItems: 'center' }}>
                        <span style={{
                            fontFamily: 'var(--tpe-font-playfair)',
                            fontSize: '13px',
                            fontWeight: 800,
                            letterSpacing: '0.02em',
                            color: colors.crescentGold,
                            textTransform: 'uppercase'
                        }}>
                            PAKISTAN
                        </span>
                        <span style={{
                            fontFamily: 'var(--tpe-font-inter)',
                            fontSize: '8px',
                            fontWeight: 800,
                            letterSpacing: '0.35em',
                            color: colors.paperWhite,
                            marginTop: '2px',
                            textTransform: 'uppercase'
                        }}>
                            EDIT
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
};
