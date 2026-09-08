import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinNativeEngine } from "core/Engines/thinNativeEngine.pure";

describe("Native cube winding", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("combines pass winding with material winding without overriding the material cull face", () => {
        vi.stubGlobal("_native", { Engine: { COMMAND_SETSTATE: new Uint32Array(1) } });
        const uints = vi.fn();
        const encoder = {
            startEncodingCommand: vi.fn(),
            encodeCommandArgAsUInt32: uints,
            encodeCommandArgAsFloat32: vi.fn(),
            finishEncodingCommand: vi.fn(),
        };
        const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
        Object.assign(engine, { _commandBufferEncoder: encoder, cullBackFaces: null });

        for (const passWinding of [false, true]) {
            for (const materialWinding of [false, true]) {
                for (const cullBack of [false, true]) {
                    uints.mockClear();
                    engine._reverseCulling = passWinding;
                    engine.setState(true, 0, false, materialWinding, cullBack);
                    expect(uints.mock.calls.map(([value]) => value)).toEqual([1, Number(cullBack), Number(passWinding !== materialWinding)]);

                    uints.mockClear();
                    engine.setStateCullFaceType(cullBack);
                    expect(uints).not.toHaveBeenCalled();

                    engine._reverseCulling = !passWinding;
                    engine.setStateCullFaceType(cullBack);
                    expect(uints.mock.calls.map(([value]) => value)).toEqual([1, Number(cullBack), Number(passWinding === materialWinding)]);
                }
            }
        }
    });
});
