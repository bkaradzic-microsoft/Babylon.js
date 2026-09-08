import { describe, expect, it } from "vitest";
import { NullEngine } from "core/Engines/nullEngine";
import { Scene } from "core/scene";
import { FreeCamera } from "core/Cameras/freeCamera";
import { Vector3 } from "core/Maths/math.vector";
import { ReflectionProbe } from "core/Probes/reflectionProbe";

describe("ReflectionProbe cube origin", () => {
    for (const invert of [undefined, false, true]) {
        for (const rightHanded of [false, true]) {
            it(`preserves cull-face overrides and restores winding (invert=${invert}, RH=${rightHanded})`, () => {
                const engine = new NullEngine();
                engine._features.needToInvertCubeMapRendering = invert;
                engine.cullBackFaces = false;
                const scene = new Scene(engine);
                scene.useRightHandedSystem = rightHanded;
                new FreeCamera("camera", Vector3.Zero(), scene);
                const probe = new ReflectionProbe("probe", 4, scene);

                try {
                    for (const previousWinding of [false, true]) {
                        engine._reverseCulling = previousWinding;
                        probe.cubeTexture.onBeforeBindObservable.notifyObservers(probe.cubeTexture);
                        expect(engine._reverseCulling).toBe(invert ? !previousWinding : previousWinding);
                        expect(engine.cullBackFaces).toBe(false);
                        for (let face = 0; face < 6; face++) {
                            probe.cubeTexture.onBeforeRenderObservable.notifyObservers(face);
                            expect(Math.sign(scene.getProjectionMatrix().m[5])).toBe(invert ? -1 : 1);
                        }
                        probe.cubeTexture.onAfterUnbindObservable.notifyObservers(probe.cubeTexture);
                        expect(engine._reverseCulling).toBe(previousWinding);
                        expect(engine.cullBackFaces).toBe(false);
                        expect(scene.getProjectionMatrix().m[5]).toBeGreaterThan(0);
                    }
                } finally {
                    scene.dispose();
                    engine.dispose();
                }
            });
        }
    }
});
