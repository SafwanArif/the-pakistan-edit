import React from "react";
import { TPEVectorLogo } from "./TPEVectorLogo";
import { OMNI_CONFIG, Platform } from "../../../config/omnichannel";

export const TPEMasthead: React.FC<{ 
    category: string, 
    platform?: Platform,
    showWordmark?: boolean
}> = ({ 
    category, 
    platform = "instagram",
    showWordmark = true 
}) => {
    const config = OMNI_CONFIG[platform as Platform || "instagram"];
    const { top, right, left } = config.padding;
    const { logoScale, catFontSize, handleFontSize } = config;

    return (
        <div className="tpe-masthead-container" style={{ paddingBlockStart: `${top}px`, paddingInline: `${left}px ${right}px` }}>
            {/* Left: The Logo */}
            <TPEVectorLogo scale={logoScale} showWordmark={showWordmark} />

            {/* Right: The Data Category & Social Handle */}
            <div className="tpe-masthead-meta">
                <div className="tpe-masthead-category" style={{ fontSize: catFontSize }}>
                    <span style={{ opacity: 0.5 }}>{"//"}</span>
                    <span>{category}</span>
                </div>
                <div className="tpe-masthead-handle" style={{ fontSize: handleFontSize }}>
                    @thePakistanEdit
                </div>
            </div>
        </div>
    );
};
