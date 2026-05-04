import React from "react";

/**
 * 2027 Professional Quality Vector Logo (Unified SVG Standard)
 * Features a geometrically authentic representation of the Pakistan Crescent and Star
 * and a locked-in wordmark for absolute centering and vector stability.
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

    // Unified SVG Dimensions - Tightly bounded to prevent layout shifts
    // Wordmark version is ~72px wide to match 'PAKISTAN' wordmark bounds
    const width = showWordmark ? 72 : 48;
    const height = showWordmark ? 85 : 48;
    const centerX = width / 2;

    return (
        <svg 
            width={width * scale} 
            height={height * scale} 
            viewBox={`0 0 ${width} ${height}`} 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            style={{ 
                display: 'inline-block', 
                verticalAlign: 'middle',
                overflow: 'visible'
            }}
        >
            {/* Monogram Group - Optically aligned with 'I' in PAKISTAN */}
            <g transform={`translate(${centerX - 24}, 0)`}>
                {/* Rect (White Dash) */}
                <rect x="6" y="22" width="12" height="6" fill={colors.paperWhite} />
                {/* Green P Path - Stem is at x=18-24 (Center 21) */}
                <path fillRule="evenodd" clipRule="evenodd" d="M 18 6 H 24 A 11 11 0 0 1 24 28 V 42 H 18 V 6 Z M 24 12 V 22 A 5 5 0 0 0 24 12 Z" fill={colors.pakistanGreen} />
                {/* Gold Circle */}
                <circle cx="32" cy="39" r="3" fill={colors.crescentGold} />
            </g>

            {/* Wordmark Group */}
            {showWordmark && (
                <g transform={`translate(${centerX}, 55)`}>
                    <text
                        x="0"
                        y="0"
                        textAnchor="middle"
                        fill={colors.crescentGold}
                        style={{
                            fontFamily: 'var(--tpe-font-playfair)',
                            fontSize: '13px',
                            fontWeight: 800,
                            letterSpacing: '0.02em',
                            textTransform: 'uppercase'
                        }}
                    >
                        PAKISTAN
                    </text>
                    <text
                        x="0"
                        y="10"
                        textAnchor="middle"
                        fill={colors.paperWhite}
                        style={{
                            fontFamily: 'var(--tpe-font-inter)',
                            fontSize: '8px',
                            fontWeight: 800,
                            letterSpacing: '0.35em',
                            textTransform: 'uppercase'
                        }}
                    >
                        EDIT
                    </text>
                </g>
            )}
        </svg>
    );
};
