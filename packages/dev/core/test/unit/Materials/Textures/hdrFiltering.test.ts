import { afterEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "core/Engines/nullEngine";
import { RenderTargetWrapper } from "core/Engines/renderTargetWrapper";
import { Constants } from "core/Engines/constants";
import { Scene } from "core/scene";
import { Effect } from "core/Materials/effect";
import { BaseTexture } from "core/Materials/Textures/baseTexture";
import { InternalTexture, InternalTextureSource } from "core/Materials/Textures/internalTexture";
import { HDRFiltering } from "core/Materials/Textures/Filtering/hdrFiltering";
import { HDRIrradianceFiltering } from "core/Materials/Textures/Filtering/hdrIrradianceFiltering";

describe("HDR cube filtering", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    const cases = [HDRFiltering, HDRIrradianceFiltering].flatMap((Filter) =>
        [Constants.TEXTURETYPE_UNSIGNED_BYTE, Constants.TEXTURETYPE_FLOAT, Constants.TEXTURETYPE_HALF_FLOAT].map((textureType) => ({ Filter, textureType }))
    );
    for (const { Filter, textureType } of cases) {
        for (const invert of [undefined, false, true]) {
            it(`${Filter.name} preserves source mips and face orientation (type=${textureType}, invert=${invert})`, async () => {
                const engine = new NullEngine();
                const scene = new Scene(engine);
                engine._features.allowTexturePrefiltering = true;
                engine._features.needToInvertCubeMapRendering = invert;

                const createCube = (size: number) => {
                    const target = new RenderTargetWrapper(false, true, size, engine);
                    const internal = new InternalTexture(engine, InternalTextureSource.RenderTarget, true);
                    internal.width = internal.height = size;
                    internal.type = textureType;
                    internal.isCube = internal.isReady = true;
                    target.setTextures(internal);
                    return target;
                };
                vi.spyOn(engine, "createRenderTargetCubeTexture").mockImplementation(createCube);
                vi.spyOn(engine, "updateTextureWrappingMode").mockImplementation(() => {});
                const bind = vi.spyOn(engine, "bindFramebuffer");
                const vectors = vi.spyOn(Effect.prototype, "setVector3");
                const floatPairs = vi.spyOn(Effect.prototype, "setFloat2");
                const source = new BaseTexture(scene, createCube(4).texture);
                source.gammaSpace = false;

                try {
                    const filter = new Filter(engine, { quality: 1 });
                    await filter.prefilter(source);

                    expect(floatPairs).toHaveBeenCalledWith("vFilteringInfo", 4, Filter === HDRFiltering ? 3 : 2);
                    const uploaded = (name: string) => vectors.mock.calls.filter(([uniform]) => uniform === name).map(([, value]) => value.asArray());
                    expect(uploaded("front")).toEqual([
                        [1, 0, 0],
                        [-1, 0, 0],
                        [0, 1, 0],
                        [0, -1, 0],
                        [0, 0, 1],
                        [0, 0, -1],
                    ]);
                    expect(uploaded("up")).toEqual([
                        [0, 0, -1],
                        [0, 0, 1],
                        [1, 0, 0],
                        [1, 0, 0],
                        [1, 0, 0],
                        [-1, 0, 0],
                    ]);
                    const sign = invert ? -1 : 1;
                    const expectedV = [
                        [0, -1, 0],
                        [0, -1, 0],
                        [0, 0, 1],
                        [0, 0, -1],
                        [0, -1, 0],
                        [0, -1, 0],
                    ];
                    expect(uploaded("right").map((v) => v.map((n) => n || 0))).toEqual(expectedV.map((v) => v.map((n) => n * sign || 0)));
                    const lods = Filter === HDRFiltering ? 3 : 1;
                    expect(bind.mock.calls.map(([, face, , , , lod]) => [face, lod || 0])).toEqual(
                        Array.from({ length: 6 }, (_, face) => Array.from({ length: lods }, (_, lod) => [face, lod])).flat()
                    );
                } finally {
                    scene.dispose();
                    engine.dispose();
                }
            });
        }
    }
});
