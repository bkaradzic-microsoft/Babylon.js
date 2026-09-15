import { afterEach, describe, expect, it, vi } from "vitest";
import { Constants } from "core/Engines/constants";
import { ThinNativeEngine } from "core/Engines/thinNativeEngine.pure";
import { Logger } from "core/Misc/logger";

describe("Native primitive mode expansion", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function createEngine(supportsExpansion?: unknown) {
        const commands = {
            COMMAND_DRAW: new Uint32Array([1]),
            COMMAND_DRAWINSTANCED: new Uint32Array([2]),
            COMMAND_DRAWINDEXED: new Uint32Array([3]),
            COMMAND_DRAWINDEXEDINSTANCED: new Uint32Array([4]),
        };
        vi.stubGlobal("_native", { Engine: commands });
        const encoder = {
            startEncodingCommand: vi.fn(),
            encodeCommandArgAsUInt32: vi.fn(),
            finishEncodingCommand: vi.fn(),
        };
        const engine: ThinNativeEngine = Object.create(ThinNativeEngine.prototype);
        const drawCalls = vi.fn();
        const flushDepth = vi.fn();
        Object.assign(engine, {
            _engine: supportsExpansion === undefined ? {} : { supportsPrimitiveModeExpansion: supportsExpansion },
            _commandBufferEncoder: encoder,
            _flushDepthTestState: flushDepth,
            _drawCalls: { addCount: drawCalls },
            _fillModeWarningDisplayed: false,
        });
        return { engine, encoder, commands, drawCalls, flushDepth };
    }

    for (const method of ["drawArraysType", "drawElementsType"] as const) {
        for (const instances of [undefined, 3]) {
            it.each([Constants.MATERIAL_LineLoopDrawMode, Constants.MATERIAL_TriangleFanDrawMode])(
                `${method} forwards mode %i with instances=${instances} to capable runtimes`,
                (mode) => {
                    const { engine, encoder, commands, drawCalls, flushDepth } = createEngine(true);
                    const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => {});
                    engine[method](mode, 7, 11, instances);
                    const command =
                        method === "drawElementsType"
                            ? instances === undefined
                                ? commands.COMMAND_DRAWINDEXED
                                : commands.COMMAND_DRAWINDEXEDINSTANCED
                            : instances === undefined
                              ? commands.COMMAND_DRAW
                              : commands.COMMAND_DRAWINSTANCED;
                    expect(encoder.startEncodingCommand).toHaveBeenCalledExactlyOnceWith(command);
                    expect(encoder.encodeCommandArgAsUInt32.mock.calls.flat()).toEqual(instances === undefined ? [mode, 7, 11] : [mode, 7, 11, instances]);
                    expect(encoder.finishEncodingCommand).toHaveBeenCalledOnce();
                    expect(drawCalls).toHaveBeenCalledExactlyOnceWith(1, false);
                    expect(flushDepth).toHaveBeenCalledOnce();
                    expect(warn).not.toHaveBeenCalled();
                }
            );
        }

        it.each([undefined, false, 1])(`${method} keeps the legacy warning/skip for capability=%s`, (capability) => {
            const { engine, encoder, drawCalls, flushDepth } = createEngine(capability);
            const warn = vi.spyOn(Logger, "Warn").mockImplementation(() => {});
            engine[method](Constants.MATERIAL_LineLoopDrawMode, 0, 4);
            engine[method](Constants.MATERIAL_TriangleFanDrawMode, 0, 4, 2);
            expect(warn).toHaveBeenCalledOnce();
            expect(encoder.startEncodingCommand).not.toHaveBeenCalled();
            expect(drawCalls).not.toHaveBeenCalled();
            expect(flushDepth).not.toHaveBeenCalled();
        });

        it(`${method} continues forwarding natively supported topologies to older runtimes`, () => {
            const { engine, encoder } = createEngine();
            engine[method](Constants.MATERIAL_TriangleFillMode, 2, 6);
            expect(encoder.encodeCommandArgAsUInt32.mock.calls.flat()).toEqual([Constants.MATERIAL_TriangleFillMode, 2, 6]);
        });
    }
});
