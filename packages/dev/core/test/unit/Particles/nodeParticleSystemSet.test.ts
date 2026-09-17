import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NullEngine } from "core/Engines/nullEngine";
import { Scene } from "core/scene";
import { NodeParticleSystemSet } from "core/Particles/Node/nodeParticleSystemSet";
import { SystemBlock } from "core/Particles/Node/Blocks/systemBlock";
import { CreateParticleBlock } from "core/Particles/Node/Blocks/Emitters/createParticleBlock";
import { UpdateFlowMapBlock } from "core/Particles/Node/Blocks/Update/updateFlowMapBlock";
import { UpdateNoiseBlock } from "core/Particles/Node/Blocks/Update/updateNoiseBlock";
import { type BaseTexture } from "core/Materials/Textures/baseTexture";
import { type INodeParticleTextureData, ParticleTextureSourceBlock } from "core/Particles/Node/Blocks/particleSourceTextureBlock";
import { Observable } from "core/Misc/observable";
import { FreeCamera } from "core/Cameras/freeCamera";
import { Vector3 } from "core/Maths/math.vector";
import { ParticleSystem } from "core/Particles/particleSystem";

import "core/Shaders/particles.vertex";
import "core/Shaders/particles.fragment";

describe("NodeParticleSystemSet", () => {
    let engine: NullEngine;
    let scene: Scene;

    beforeEach(() => {
        engine = new NullEngine({
            renderHeight: 256,
            renderWidth: 256,
            textureSize: 256,
            deterministicLockstep: false,
            lockstepMaxSteps: 1,
        });
        scene = new Scene(engine);
    });

    afterEach(() => {
        scene.dispose();
        engine.dispose();
    });

    async function buildSystem(systemBlock: SystemBlock): Promise<ParticleSystem> {
        new FreeCamera("camera", new Vector3(0, 0, -10), scene);
        const nodeParticleSet = new NodeParticleSystemSet("timing");
        const createParticleBlock = new CreateParticleBlock("Create");
        const particleTextureBlock = new ParticleTextureSourceBlock("Texture");
        createParticleBlock.particle.connectTo(systemBlock.particle);
        particleTextureBlock.textureOutput.connectTo(systemBlock.texture);
        nodeParticleSet.systemBlocks.push(systemBlock);
        const set = await nodeParticleSet.buildAsync(scene);
        const system = set.systems[0];
        if (!(system instanceof ParticleSystem)) {
            throw new Error("Expected a CPU particle system");
        }
        return system;
    }

    it("advances prewarm time for a newly created system block", async () => {
        const block = new SystemBlock("System");
        expect(block.updateSpeed).toBe(0.0167);
        expect(block.preWarmStepOffset).toBe(1);
        const system = await buildSystem(block);
        system.preWarmCycles = 50;
        system.start();
        expect(system.getActiveCount()).toBeGreaterThan(0);
        expect(system.particles.some((particle) => particle.age > 0)).toBe(true);
    });

    it("preserves legacy simulation timing when serialized fields are absent", async () => {
        const block = new SystemBlock("System");
        const serialized = block.serialize();
        delete serialized.updateSpeed;
        delete serialized.preWarmStepOffset;
        block._deserialize(serialized);

        expect(block.updateSpeed).toBe(0.01);
        expect(block.preWarmStepOffset).toBe(1);
        const system = await buildSystem(block);
        system.preWarmCycles = 500;
        system.start();
        expect(system.updateSpeed).toBe(0.01);
        expect(system.preWarmStepOffset).toBe(1);
        expect(system.getActiveCount()).toBe(10);
        expect(system.particles.some((particle) => particle.age > 0)).toBe(true);
    });

    it.each([
        [0, 0],
        [0.025, 2],
        [0.0167, 1],
    ])("round-trips explicit update speed %s and prewarm multiplier %s", async (updateSpeed, preWarmStepOffset) => {
        const source = new SystemBlock("Source");
        source.updateSpeed = updateSpeed;
        source.preWarmStepOffset = preWarmStepOffset;
        const block = new SystemBlock("Restored");
        block._deserialize(source.serialize());
        const system = await buildSystem(block);
        expect(system.updateSpeed).toBe(updateSpeed);
        expect(system.preWarmStepOffset).toBe(preWarmStepOffset);
        system.preWarmCycles = 50;
        system.start();
        expect(system.getActiveCount() > 0).toBe(updateSpeed * preWarmStepOffset > 0);
    });

    it("waits for flow-map texture extraction before resolving buildAsync", async () => {
        const nodeParticleSet = new NodeParticleSystemSet("test");
        const systemBlock = new SystemBlock("System");
        const createParticleBlock = new CreateParticleBlock("Create");
        const flowMapBlock = new UpdateFlowMapBlock("Flow Map Update");
        const flowMapTextureBlock = new ParticleTextureSourceBlock("Flow Map Texture");
        const particleTextureBlock = new ParticleTextureSourceBlock("Particle Texture");

        createParticleBlock.particle.connectTo(flowMapBlock.particle);
        flowMapTextureBlock.textureOutput.connectTo(flowMapBlock.flowMap);
        flowMapBlock.output.connectTo(systemBlock.particle);
        particleTextureBlock.textureOutput.connectTo(systemBlock.texture);
        nodeParticleSet.systemBlocks.push(systemBlock);

        let resolveTextureContent: (value: INodeParticleTextureData) => void;
        const textureContentPromise = new Promise<INodeParticleTextureData>((resolve) => {
            resolveTextureContent = resolve;
        });
        const extractTextureContentAsync = vi.spyOn(flowMapTextureBlock, "extractTextureContentAsync").mockReturnValue(textureContentPromise);

        let buildResolved = false;
        const buildPromise = (async () => {
            const set = await nodeParticleSet.buildAsync(scene);
            buildResolved = true;
            return set;
        })();

        await Promise.resolve();

        expect(extractTextureContentAsync).toHaveBeenCalledTimes(1);
        expect(buildResolved).toBe(false);

        resolveTextureContent!({
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([128, 128, 0, 255]),
        });

        const builtSet = await buildPromise;

        expect(buildResolved).toBe(true);
        expect(builtSet.systems.length).toBe(1);
    });

    it("resolves texture extraction with null when texture loading errors", async () => {
        const textureBlock = new ParticleTextureSourceBlock("Flow Map Texture");
        const loadObservable = new Observable<BaseTexture>();
        const errorObservable = new Observable<Partial<{ message: string; exception: any }>>();
        const texture = {
            url: "bad-texture.png",
            loadingError: false,
            isReady: () => false,
            onLoadObservable: loadObservable,
            getInternalTexture: () => ({ onErrorObservable: errorObservable }),
        } as unknown as BaseTexture;

        textureBlock.sourceTexture = texture;

        const textureContentPromise = textureBlock.extractTextureContentAsync();
        errorObservable.notifyObservers({ message: "load failed" });

        await expect(textureContentPromise).resolves.toBeNull();
    });

    it("resolves buildAsync when flow-map extraction rejects", async () => {
        const nodeParticleSet = new NodeParticleSystemSet("test");
        const systemBlock = new SystemBlock("System");
        const createParticleBlock = new CreateParticleBlock("Create");
        const flowMapBlock = new UpdateFlowMapBlock("Flow Map Update");
        const flowMapTextureBlock = new ParticleTextureSourceBlock("Flow Map Texture");
        const particleTextureBlock = new ParticleTextureSourceBlock("Particle Texture");

        createParticleBlock.particle.connectTo(flowMapBlock.particle);
        flowMapTextureBlock.textureOutput.connectTo(flowMapBlock.flowMap);
        flowMapBlock.output.connectTo(systemBlock.particle);
        particleTextureBlock.textureOutput.connectTo(systemBlock.texture);
        nodeParticleSet.systemBlocks.push(systemBlock);

        vi.spyOn(flowMapTextureBlock, "extractTextureContentAsync").mockRejectedValue(new Error("load failed"));

        const builtSet = await nodeParticleSet.buildAsync(scene);

        expect(builtSet.systems.length).toBe(1);
    });

    it("waits for noise texture extraction before resolving buildAsync", async () => {
        const nodeParticleSet = new NodeParticleSystemSet("test");
        const systemBlock = new SystemBlock("System");
        const createParticleBlock = new CreateParticleBlock("Create");
        const noiseBlock = new UpdateNoiseBlock("Noise Update");
        const noiseTextureBlock = new ParticleTextureSourceBlock("Noise Texture");
        const particleTextureBlock = new ParticleTextureSourceBlock("Particle Texture");

        createParticleBlock.particle.connectTo(noiseBlock.particle);
        noiseTextureBlock.textureOutput.connectTo(noiseBlock.noiseTexture);
        noiseBlock.output.connectTo(systemBlock.particle);
        particleTextureBlock.textureOutput.connectTo(systemBlock.texture);
        nodeParticleSet.systemBlocks.push(systemBlock);

        let resolveTextureContent: (value: INodeParticleTextureData) => void;
        const textureContentPromise = new Promise<INodeParticleTextureData>((resolve) => {
            resolveTextureContent = resolve;
        });
        const extractTextureContentAsync = vi.spyOn(noiseTextureBlock, "extractTextureContentAsync").mockReturnValue(textureContentPromise);

        let buildResolved = false;
        const buildPromise = (async () => {
            const set = await nodeParticleSet.buildAsync(scene);
            buildResolved = true;
            return set;
        })();

        await Promise.resolve();

        expect(extractTextureContentAsync).toHaveBeenCalledTimes(1);
        expect(buildResolved).toBe(false);

        resolveTextureContent!({
            width: 1,
            height: 1,
            data: new Uint8ClampedArray([128, 128, 0, 255]),
        });

        const builtSet = await buildPromise;

        expect(buildResolved).toBe(true);
        expect(builtSet.systems.length).toBe(1);
    });

    it("resolves buildAsync when noise extraction rejects", async () => {
        const nodeParticleSet = new NodeParticleSystemSet("test");
        const systemBlock = new SystemBlock("System");
        const createParticleBlock = new CreateParticleBlock("Create");
        const noiseBlock = new UpdateNoiseBlock("Noise Update");
        const noiseTextureBlock = new ParticleTextureSourceBlock("Noise Texture");
        const particleTextureBlock = new ParticleTextureSourceBlock("Particle Texture");

        createParticleBlock.particle.connectTo(noiseBlock.particle);
        noiseTextureBlock.textureOutput.connectTo(noiseBlock.noiseTexture);
        noiseBlock.output.connectTo(systemBlock.particle);
        particleTextureBlock.textureOutput.connectTo(systemBlock.texture);
        nodeParticleSet.systemBlocks.push(systemBlock);

        vi.spyOn(noiseTextureBlock, "extractTextureContentAsync").mockRejectedValue(new Error("load failed"));

        const builtSet = await nodeParticleSet.buildAsync(scene);

        expect(builtSet.systems.length).toBe(1);
    });
});
