import { describe, expect, it, vi } from "vitest";
import { ThinNativeEngine } from "core/Engines/thinNativeEngine.pure";

describe("Native font layout metrics", () => {
    it.each([
        {
            name: "uses the font line box rather than the measured glyph ink",
            metrics: { fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 5, actualBoundingBoxAscent: 13, actualBoundingBoxDescent: 4 },
            expected: { ascent: 16, height: 21, descent: 5 },
        },
        {
            name: "supports runtimes exposing only font bounds",
            metrics: { fontBoundingBoxAscent: 16, fontBoundingBoxDescent: 5 },
            expected: { ascent: 16, height: 21, descent: 5 },
        },
        {
            name: "falls back to ink bounds on older runtimes without font bounds",
            metrics: { actualBoundingBoxAscent: 13, actualBoundingBoxDescent: 4 },
            expected: { ascent: 13, height: 17, descent: 4 },
        },
        {
            name: "preserves a zero font ascent instead of replacing it with ink bounds",
            metrics: { fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 5, actualBoundingBoxAscent: 3, actualBoundingBoxDescent: 1 },
            expected: { ascent: 0, height: 5, descent: 5 },
        },
    ])("$name", ({ metrics, expected }) => {
        const context = { font: "", measureText: vi.fn(() => metrics) };
        const createCanvas = vi.fn(() => ({ getContext: () => context }));
        const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
        Object.assign(engine, { createCanvas });

        expect(engine.getFontOffset("18px Arimo")).toEqual(expected);
        expect(createCanvas).toHaveBeenCalledExactlyOnceWith(64, 64);
        expect(context.font).toBe("18px Arimo");
        expect(context.measureText).toHaveBeenCalledExactlyOnceWith("Hg");
    });
});
