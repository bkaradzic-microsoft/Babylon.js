import { afterEach, describe, expect, it, vi } from "vitest";
import { ThinNativeEngine } from "core/Engines/thinNativeEngine.pure";
import { InternalTexture, InternalTextureSource } from "core/Materials/Textures/internalTexture";

describe("Native additive command compatibility", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("retains the protocol-9 handshake", () => {
        expect(ThinNativeEngine["PROTOCOL_VERSION"]).toBe(9);
    });

    it.each([false, true])("encodes the matching stencil payload, SETSTENCIL2=%s", (extended) => {
        const commands = {
            COMMAND_SETSTENCIL: new Uint32Array([1]),
            COMMAND_SETSTENCIL2: extended ? new Uint32Array([2]) : undefined,
        };
        vi.stubGlobal("_native", { Engine: commands });
        const encoder = {
            startEncodingCommand: vi.fn(),
            encodeCommandArgAsUInt32: vi.fn(),
            finishEncodingCommand: vi.fn(),
        };
        const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
        Object.assign(engine, { _commandBufferEncoder: encoder });
        engine["_setStencil"](1, 2, 3, 4, 5, 6, 0x103);
        expect(encoder.startEncodingCommand).toHaveBeenCalledExactlyOnceWith(extended ? commands.COMMAND_SETSTENCIL2 : commands.COMMAND_SETSTENCIL);
        expect(encoder.encodeCommandArgAsUInt32.mock.calls.flat()).toEqual(extended ? [1, 2, 3, 4, 5, 6, 3] : [1, 2, 3, 4, 5, 6]);
        expect(encoder.finishEncodingCommand).toHaveBeenCalledOnce();
    });

    for (const extended of [false, true]) {
        for (const supplied of [false, true]) {
            it(`selects readTexture${extended ? "2" : ""} and preserves the receiver and buffer view, supplied=${supplied}`, async () => {
                const returned = new ArrayBuffer(extended ? 16 : 4);
                const readTexture = vi.fn().mockResolvedValue(returned);
                const readTexture2 = vi.fn().mockResolvedValue(returned);
                const native = extended ? { readTexture, readTexture2 } : { readTexture };
                const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
                Object.assign(engine, { _engine: native });
                const texture = new InternalTexture(engine, InternalTextureSource.Raw, true);
                const storage = extended ? new Float32Array(12) : new Uint8Array(12);
                const view = supplied ? storage.subarray(4, 8) : undefined;
                const result = await engine._readTexturePixels(texture, 1, 1, -1, 0, view);
                const selected = extended ? readTexture2 : readTexture;
                expect(selected).toHaveBeenCalledExactlyOnceWith(undefined, 0, 0, 0, 1, 1, view?.buffer ?? null, view?.byteOffset ?? 0, view?.byteLength ?? 0, -1);
                expect(selected.mock.contexts).toEqual([native]);
                expect(extended ? readTexture : readTexture2).not.toHaveBeenCalled();
                if (view) {
                    expect(result).toBe(view);
                } else {
                    expect(result).toBeInstanceOf(extended ? Float32Array : Uint8Array);
                    expect(result.buffer).toBe(returned);
                }
            });
        }
    }

    it("propagates readTexture2 failures rather than falling back to a different contract", async () => {
        const error = new Error("readback failed");
        const native = { readTexture: vi.fn(), readTexture2: vi.fn().mockRejectedValue(error) };
        const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
        Object.assign(engine, { _engine: native });
        const texture = new InternalTexture(engine, InternalTextureSource.Raw, true);
        await expect(engine._readTexturePixels(texture, 1, 1)).rejects.toBe(error);
        expect(native.readTexture).not.toHaveBeenCalled();
    });
});
