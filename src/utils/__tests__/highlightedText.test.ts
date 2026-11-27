import { describe, expect, it } from "vitest";
import { tokenize } from "@/components/templates/NewsCard/HighlightedText";

describe("HighlightedText tokenize — editorial syntax, multiline, flags & social badges", () => {
    it("tokenizes bold, italic, gold, green, black-box, white-box, and legacy <gold> spans", () => {
        expect(tokenize("**Bold** ==Gold== <gold>Legacy</gold> ~~Green~~ ^^Black^^ &&White&& *Italic*")).toEqual([
            { type: "bold", value: "Bold" },
            { type: "text", value: " " },
            { type: "gold", value: "Gold" },
            { type: "text", value: " " },
            { type: "gold", value: "Legacy" },
            { type: "text", value: " " },
            { type: "green", value: "Green" },
            { type: "text", value: " " },
            { type: "highlight", value: "Black" },
            { type: "text", value: " " },
            { type: "whiteHighlight", value: "White" },
            { type: "text", value: " " },
            { type: "italic", value: "Italic" },
        ]);
    });

    it("supports multiline highlights, flag emojis, and social badges cleanly", () => {
        expect(tokenize("==LINE 1\nLINE 2== 🇵🇰 [tt] [x]")).toEqual([
            { type: "gold", value: "LINE 1\nLINE 2" },
            { type: "text", value: " " },
            { type: "flag", value: "🇵🇰" },
            { type: "text", value: " " },
            { type: "social", value: "[tt]" },
            { type: "text", value: " " },
            { type: "social", value: "[x]" },
        ]);
    });

    it("preserves empty delimiters, repeated runs, and unclosed tags as coalesced plain text (P234, P251)", () => {
        expect(tokenize("==== **** <gold>unclosed")).toEqual([
            { type: "text", value: "==== **** <gold>unclosed" },
        ]);
        expect(tokenize("foo ****** bar ====== ===gold=== ~~~~~~ <gold></gold>")).toEqual([
            { type: "text", value: "foo ****** bar ====== ===gold=== ~~~~~~ <gold></gold>" },
        ]);
    });

    it("is re-entrant for nested syntax including ***bold italic*** and **a *b* c** (P234, P251)", () => {
        const outer = tokenize("==**INNER**==");
        expect(outer).toEqual([{ type: "gold", value: "**INNER**" }]);
        expect(tokenize(outer[0]!.value)).toEqual([{ type: "bold", value: "INNER" }]);

        const boldItalic = tokenize("***bold italic***");
        expect(boldItalic).toEqual([{ type: "bold", value: "*bold italic*" }]);
        expect(tokenize(boldItalic[0]!.value)).toEqual([{ type: "italic", value: "bold italic" }]);

        const nestedItalic = tokenize("**a *b* c**");
        expect(nestedItalic).toEqual([{ type: "bold", value: "a *b* c" }]);
        expect(tokenize(nestedItalic[0]!.value)).toEqual([
            { type: "text", value: "a " },
            { type: "italic", value: "b" },
            { type: "text", value: " c" },
        ]);
    });
});
