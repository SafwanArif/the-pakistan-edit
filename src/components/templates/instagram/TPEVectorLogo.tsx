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
        <div style={{ transform: `scale(${scale})`, transformOrigin: 'center', display: 'inline-flex' }}>
            <div className="tpe-flex-col" style={{ gap: '2px', alignItems: 'center' }}>
                {/* Authentic Institutional Monogram - Optically centered on the green stem */}
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="9" y="22" width="12" height="6" fill={colors.paperWhite} />
                    <path fillRule="evenodd" clipRule="evenodd" d="M 21 6 H 27 A 11 11 0 0 1 27 28 V 42 H 21 V 6 Z M 27 12 V 22 A 5 5 0 0 0 27 12 Z" fill={colors.pakistanGreen} />
                    <circle cx="35" cy="39" r="3" fill={colors.crescentGold} />
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
