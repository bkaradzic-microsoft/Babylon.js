import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NullEngine } from "core/Engines/nullEngine";
import { type Engine } from "core/Engines/engine";
import { FreeCamera } from "core/Cameras/freeCamera";
import { Constants } from "core/Engines/constants";
import { PointLight } from "core/Lights/pointLight";
import { ShadowGenerator } from "core/Lights/Shadows/shadowGenerator";
import { StandardMaterial } from "core/Materials/standardMaterial";
import { Vector3 } from "core/Maths/math.vector";
import { MeshBuilder } from "core/Meshes/meshBuilder";
import { type SubMesh } from "core/Meshes/subMesh";
import { Scene } from "core/scene";

import "core/Lights/Shadows/shadowGeneratorSceneComponent";

// Pre-load shader modules that ShadowGenerator dynamically imports during construction.
// Without these, the fire-and-forget import() in _initShaderSourceAsync may still be
// resolving when the test environment tears down, causing EnvironmentTeardownError.
import "core/Shaders/shadowMap.fragment";
import "core/Shaders/shadowMap.vertex";
import "core/Shaders/depthBoxBlur.fragment";
import "core/Shaders/ShadersInclude/shadowMapFragmentSoftTransparentShadow";

class TestShadowGenerator extends ShadowGenerator {
    public selectFace(faceIndex: number): void {
        this._currentFaceIndex = faceIndex;
    }

    public renderSubMesh(subMesh: SubMesh): void {
        this._renderSubMeshForShadowMap(subMesh);
    }
}

describe("ShadowGenerator", () => {
    describe("instantiate", () => {
        let subject: Engine;

        beforeEach(function () {
            subject = new NullEngine({
                renderHeight: 256,
                renderWidth: 256,
                textureSize: 256,
                deterministicLockstep: false,
                lockstepMaxSteps: 1,
            });
        });

        afterEach(function () {
            subject.dispose();
        });

        it("should be able to be instantiated with a null engine", () => {
            const scene = new Scene(subject);
            const light = new PointLight("Point", new Vector3(1, 1, 1), scene);
            const generator = new ShadowGenerator(1024, light);

            expect(generator).not.toBeUndefined();
        });
    });

    describe("cube map framebuffer origin", () => {
        let engine: NullEngine;
        let scene: Scene;
        let light: PointLight;

        beforeEach(() => {
            engine = new NullEngine();
            scene = new Scene(engine);
            new FreeCamera("camera", new Vector3(0, 0, -10), scene);
            light = new PointLight("point", new Vector3(1, 2, 3), scene);
        });

        afterEach(() => {
            engine.dispose();
            vi.restoreAllMocks();
        });

        it.each([0, 1, 2, 3, 4, 5])("reflects only clip-space Y for cube face %i, including cached transforms", (face) => {
            engine._features.needToInvertCubeMapRendering = false;
            const original = new TestShadowGenerator(32, light);
            original.selectFace(face);
            const position = light.position.add(light.getShadowDirection(face).scale(3)).add(new Vector3(0.17, 0.31, 0.43));
            const expected = Vector3.TransformCoordinates(position, original.getTransformMatrix());
            original.dispose();

            engine._features.needToInvertCubeMapRendering = true;
            const corrected = new TestShadowGenerator(32, light);
            corrected.selectFace(face);
            const transform = corrected.getTransformMatrix().clone();
            const actual = Vector3.TransformCoordinates(position, transform);
            expect(actual.x).toBeCloseTo(expected.x);
            expect(actual.y).toBeCloseTo(-expected.y);
            expect(actual.z).toBeCloseTo(expected.z);
            expect(corrected.getTransformMatrix().equals(transform)).toBe(true);
            scene.incrementRenderId();
            expect(corrected.getTransformMatrix().equals(transform)).toBe(true);
        });

        it("leaves a directed point light's 2D projection unchanged", () => {
            light.direction = new Vector3(0, -1, 1);
            engine._features.needToInvertCubeMapRendering = false;
            const original = new TestShadowGenerator(32, light);
            const expected = original.getTransformMatrix().clone();
            original.dispose();

            engine._features.needToInvertCubeMapRendering = true;
            const corrected = new TestShadowGenerator(32, light);
            expect(light.needCube()).toBe(false);
            expect(corrected.getTransformMatrix().equals(expected)).toBe(true);
        });

        it.each([
            [false, false],
            [false, true],
            [true, false],
            [true, true],
        ])("preserves material winding and cull-face choices (RHS=%s, mirrored mesh=%s)", (useRHS, mirroredMesh) => {
            scene.useRightHandedSystem = useRHS;
            const mesh = MeshBuilder.CreateBox("caster", {}, scene);
            const material = new StandardMaterial("caster", scene);
            mesh.material = material;
            mesh.scaling.x = mirroredMesh ? -1 : 1;
            mesh.computeWorldMatrix(true);
            scene.incrementRenderId();
            const generator = new TestShadowGenerator(32, light);
            generator.customAllowRendering = () => false;
            const directedLight = new PointLight("directed", light.position, scene);
            directedLight.direction = new Vector3(0, -1, 1);
            const directedGenerator = new TestShadowGenerator(32, directedLight);
            directedGenerator.customAllowRendering = () => false;
            const setState = vi.spyOn(engine, "setState");

            for (const sideOrientation of [Constants.MATERIAL_ClockWiseSideOrientation, Constants.MATERIAL_CounterClockWiseSideOrientation]) {
                material.sideOrientation = sideOrientation;
                for (const cullBackFaces of [false, true]) {
                    material.cullBackFaces = cullBackFaces;
                    engine._features.needToInvertCubeMapRendering = false;
                    generator.renderSubMesh(mesh.subMeshes[0]);
                    const baseline = setState.mock.lastCall!;

                    engine._features.needToInvertCubeMapRendering = undefined;
                    generator.renderSubMesh(mesh.subMeshes[0]);
                    expect(setState).toHaveBeenLastCalledWith(...baseline);

                    engine._features.needToInvertCubeMapRendering = true;
                    generator.renderSubMesh(mesh.subMeshes[0]);
                    expect(setState).toHaveBeenLastCalledWith(baseline[0], baseline[1], baseline[2], !baseline[3], cullBackFaces);
                    expect(engine._reverseCulling).toBe(false);

                    directedGenerator.renderSubMesh(mesh.subMeshes[0]);
                    expect(setState).toHaveBeenLastCalledWith(...baseline);
                }
            }
        });
    });
});
