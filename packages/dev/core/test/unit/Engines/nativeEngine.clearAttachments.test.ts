import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinNativeEngine } from "core/Engines/thinNativeEngine.pure";

describe("Native attachment clears", () => {
    afterEach(() => vi.unstubAllGlobals());

    function createEngine() {
        vi.stubGlobal("_native", { Engine: { COMMAND_CLEAR: new Uint32Array(1) } });
        const uints = vi.fn();
        const floats = vi.fn();
        const encoder = {
            startEncodingCommand: vi.fn(),
            encodeCommandArgAsUInt32: uints,
            encodeCommandArgAsFloat32: floats,
            finishEncodingCommand: vi.fn(),
        };
        const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
        Object.assign(engine, { _commandBufferEncoder: encoder });
        return { engine, uints, floats };
    }

    it.each([
        { attachments: [], mask: 0 },
        { attachments: [-1], mask: 0 },
        { attachments: [-1, -1], mask: 0 },
        { attachments: [0], mask: 1 },
        { attachments: [-1, 1], mask: 2 },
        { attachments: [2, -1, 0], mask: 5 },
        { attachments: [0, 1, 2, 3, 4, 5, 6, 7], mask: 255 },
    ])("encodes $attachments as mask $mask without losing depth/stencil clears", ({ attachments, mask }) => {
        const { engine, uints, floats } = createEngine();
        engine.bindAttachments(attachments);
        engine.clear({ r: 0.2, g: 0.3, b: 0.4, a: 1 }, true, true, true, 7);
        expect(uints.mock.calls.map(([value]) => value)).toEqual([mask ? 1 : 0, 1, 1, 7, mask]);
        expect(floats.mock.calls.map(([value]) => value)).toEqual([0.2, 0.3, 0.4, 1, 1]);
    });

    it("preserves the all-disabled layout produced by buildTextureLayout", () => {
        const { engine, uints } = createEngine();
        engine.bindAttachments(engine.buildTextureLayout([false, false]));
        engine.clear({ r: 0, g: 0, b: 0, a: 0 }, true, false, false);
        expect(uints.mock.calls.map(([value]) => value)).toEqual([0, 0, 0, 0, 0]);
    });

    for (const restore of ["restoreSingleAttachment", "restoreSingleAttachmentForRenderTarget"] as const) {
        it(`${restore} restores color clearing after an empty mask`, () => {
            const { engine, uints } = createEngine();
            engine.bindAttachments([-1, -1]);
            engine[restore]();
            engine.clear({ r: 0, g: 0, b: 0, a: 1 }, true, false, false);
            expect(uints.mock.calls.map(([value]) => value)).toEqual([1, 0, 0, 0, 255]);
        });
    }
});
