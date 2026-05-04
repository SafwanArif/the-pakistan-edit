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

    // Unified SVG Dimensions
    const width = 120;
    const height = showWordmark ? 75 : 48; // Tightened from 85 to 75
    const centerX = 60;

    return (
        <svg 
            width={width * scale} 
            height={height * scale} 
            viewBox={`0 0 ${width} ${height}`} 
            fill="none" 
            xmlns="http://www.w3.org/2000/svg"
            style={{ 
                display: 'block', 
                margin: '0 auto',
                overflow: 'visible'
            }}
        >
            {/* Monogram Group - Centered on Stem */}
            <g transform={`translate(${centerX - 24}, 0)`}>
                {/* Rect (White Dash) */}
                <rect x="9" y="22" width="12" height="6" fill={colors.paperWhite} />
                {/* Green P Path - Stem is at x=21-27 (Center 24) */}
                <path fillRule="evenodd" clipRule="evenodd" d="M 21 6 H 27 A 11 11 0 0 1 27 28 V 42 H 21 V 6 Z M 27 12 V 22 A 5 5 0 0 0 27 12 Z" fill={colors.pakistanGreen} />
                {/* Gold Circle */}
                <circle cx="35" cy="39" r="3" fill={colors.crescentGold} />
            </g>

            {/* Wordmark Group - Tightened vertically */}
            {showWordmark && (
                <g transform={`translate(${centerX}, 50)`}> {/* Lifted from 55 to 50 for tightness */}
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
