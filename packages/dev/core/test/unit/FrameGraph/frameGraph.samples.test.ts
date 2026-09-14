import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Constants } from "core/Engines/constants";
import { NullEngine } from "core/Engines/nullEngine";
import { FrameGraph } from "core/FrameGraph/frameGraph";
import { FrameGraphTask } from "core/FrameGraph/frameGraphTask";
import { FrameGraphTextureManager } from "core/FrameGraph/frameGraphTextureManager";
import { type FrameGraphTextureCreationOptions, type FrameGraphTextureHandle } from "core/FrameGraph/frameGraphTypes";
import { InternalTexture, InternalTextureSource } from "core/Materials/Textures/internalTexture";
import { Scene } from "core/scene";

describe("FrameGraph single-sample fallback", () => {
    let engine: NullEngine;
    let scene: Scene;
    let manager: FrameGraphTextureManager;

    const options = (): FrameGraphTextureCreationOptions => ({
        size: { width: 16, height: 16 },
        sizeIsPercentage: false,
        options: { samples: 4, types: [Constants.TEXTURETYPE_UNSIGNED_BYTE], formats: [Constants.TEXTUREFORMAT_RGBA] },
    });

    function importedTexture(samples: number): InternalTexture {
        const texture = new InternalTexture(engine, InternalTextureSource.DepthStencil);
        texture.width = texture.height = 16;
        texture.samples = samples;
        texture.format = Constants.TEXTUREFORMAT_DEPTH24_STENCIL8;
        return texture;
    }

    beforeEach(() => {
        engine = new NullEngine();
        engine._features.forceSingleSampleFrameGraphTextures = true;
        scene = new Scene(engine);
        manager = new FrameGraphTextureManager(engine, false, scene);
    });

    afterEach(() => {
        manager._dispose();
        scene.dispose();
        engine.dispose();
        vi.restoreAllMocks();
    });

    it("retains the fallback for graph-owned textures without changing caller options", () => {
        const creationOptions = options();
        const handle = manager.createRenderTargetTexture("color", creationOptions);
        manager._forceAllTexturesSingleSample();
        expect(manager.getTextureDescription(handle).options.samples).toBe(1);
        expect(creationOptions.options.samples).toBe(4);
    });

    it("never rewrites an imported MSAA texture's physical sample count", () => {
        const texture = importedTexture(4);
        const imported = manager.importTexture("depth", texture);
        const alias = manager.createDanglingHandle();
        manager.resolveDanglingHandle(alias, imported);
        const color = manager.createRenderTargetTexture("color", options());
        manager._forceAllTexturesSingleSample();
        expect(manager.getTextureDescription(imported).options.samples).toBe(4);
        expect(manager.getTextureDescription(alias).options.samples).toBe(4);
        expect(manager.getTextureDescription(color).options.samples).toBe(4);
        expect(texture.samples).toBe(4);
        texture.dispose();
    });

    it("restores requested samples when an MSAA texture is imported after owned textures", () => {
        const creationOptions = options();
        creationOptions.options.types!.push(Constants.TEXTURETYPE_UNSIGNED_BYTE);
        creationOptions.options.formats!.push(Constants.TEXTUREFORMAT_RGBA);
        const color = manager.createRenderTargetTexture("colors", creationOptions);
        expect(manager._textures.get(color + 1)!.textureDescriptionHash).toBe(manager._textures.get(color)!.textureDescriptionHash);
        const historyOptions = options();
        historyOptions.isHistoryTexture = true;
        const history = manager.createRenderTargetTexture("history", historyOptions);
        const texture = importedTexture(4);
        manager.importTexture("depth", texture);
        manager._forceAllTexturesSingleSample();
        expect(manager.getTextureDescription(color).options.samples).toBe(4);
        expect(manager.getTextureDescription(color + 1).options.samples).toBe(4);
        expect(manager._textures.get(color + 1)!.textureDescriptionHash).toBe(manager._textures.get(color)!.textureDescriptionHash);
        for (const handle of manager._historyTextures.get(history)!.handles) {
            expect(manager.getTextureDescription(handle).options.samples).toBe(4);
        }
        texture.dispose();
    });

    it("reapplies the fallback when an MSAA import is replaced by a single-sample texture", () => {
        const color = manager.createRenderTargetTexture("color", options());
        const msaa = importedTexture(4);
        const single = importedTexture(1);
        const handle = manager.importTexture("depth", msaa);
        manager._forceAllTexturesSingleSample();
        expect(manager.getTextureDescription(color).options.samples).toBe(4);
        manager.importTexture("depth", single, handle);
        manager._forceAllTexturesSingleSample();
        expect(manager.getTextureDescription(color).options.samples).toBe(1);
        expect(manager.getTextureDescription(handle).options.samples).toBe(1);
        expect(msaa.samples).toBe(4);
        msaa.dispose();
        single.dispose();
    });

    it("leaves other engines' requested samples unchanged", () => {
        engine._features.forceSingleSampleFrameGraphTextures = false;
        const color = manager.createRenderTargetTexture("color", options());
        manager._forceAllTexturesSingleSample();
        expect(manager.getTextureDescription(color).options.samples).toBe(4);
    });

    class SampledTask extends FrameGraphTask {
        public samples = 4;
        public recordedSamples: number[] = [];
        public fail = false;
        public failWhenSingleSample = false;
        public depthTexture?: FrameGraphTextureHandle;
        public readDepth = false;
        public attachDepth = false;
        public disabledReadDepth = false;

        public record(): void {
            this.recordedSamples.push(this.samples);
            if (this.fail || (this.failWhenSingleSample && this.samples === 1)) {
                throw new Error("record failed");
            }
            const pass = this._frameGraph.addRenderPass("render");
            pass.setRenderTarget(0);
            pass.setExecuteFunc(() => {});
            if (this.attachDepth) {
                pass.setRenderTargetDepth(this.depthTexture);
            }
            if (this.readDepth) {
                pass.addDependencies(this.depthTexture);
            }
            if (this.disabledReadDepth) {
                const disabledPass = this._frameGraph.addRenderPass("disabled", true);
                disabledPass.setRenderTarget(0);
                disabledPass.addDependencies(this.depthTexture);
                disabledPass.setExecuteFunc(() => {});
            }
        }
    }

    function graphWithDepth() {
        const graph = new FrameGraph(scene);
        vi.spyOn(graph.textureManager, "_allocateTextures").mockImplementation(() => {});
        const task = new SampledTask("sampled", graph);
        vi.spyOn(task, "_initializePasses").mockImplementation(() => {});
        const depthOptions = options();
        depthOptions.options.formats = [Constants.TEXTUREFORMAT_DEPTH32_FLOAT];
        depthOptions.options.types = [Constants.TEXTURETYPE_FLOAT];
        const depth = graph.textureManager.createRenderTargetTexture("owned depth", depthOptions);
        task.depthTexture = depth;
        graph.addTask(task);
        return { graph, task, depth };
    }

    it.each([
        { name: "unused depth texture", read: false, attach: false, disabled: false, samples: 4 },
        { name: "depth attachment only", read: false, attach: true, disabled: false, samples: 4 },
        { name: "sampled depth texture", read: true, attach: false, disabled: false, samples: 1 },
        { name: "sampled depth attachment", read: true, attach: true, disabled: false, samples: 1 },
        { name: "disabled pass sampling depth", read: false, attach: false, disabled: true, samples: 1 },
    ])("negotiates samples for $name", async ({ read, attach, disabled, samples }) => {
        const { graph, task, depth } = graphWithDepth();
        task.readDepth = read;
        task.attachDepth = attach;
        task.disabledReadDepth = disabled;
        try {
            expect(graph.textureManager.getTextureDescription(depth).options.samples).toBe(4);
            await graph.buildAsync(false);
            expect(graph.textureManager.getTextureDescription(depth).options.samples).toBe(samples);
            expect(task.recordedSamples).toEqual(samples === 1 ? [4, 1] : [4]);
            expect(task.samples).toBe(4);
            expect(engine._features.forceSingleSampleFrameGraphTextures).toBe(true);
        } finally {
            graph.dispose();
        }
    });

    it("recognizes aliased depth dependencies declared on a task", async () => {
        const { graph, task, depth } = graphWithDepth();
        const alias = graph.textureManager.createDanglingHandle();
        graph.textureManager.resolveDanglingHandle(alias, depth);
        task.dependencies = new Set([alias]);
        try {
            await graph.buildAsync(false);
            expect(task.recordedSamples).toEqual([4, 1]);
            expect(graph.textureManager.getTextureDescription(alias).options.samples).toBe(1);
        } finally {
            graph.dispose();
        }
    });

    it("restores multisampling when a later build no longer samples depth", async () => {
        const { graph, task, depth } = graphWithDepth();
        task.readDepth = true;
        try {
            await graph.buildAsync(false);
            task.readDepth = false;
            await graph.buildAsync(false);
            expect(task.recordedSamples).toEqual([4, 1, 4]);
            expect(graph.textureManager.getTextureDescription(depth).options.samples).toBe(4);
        } finally {
            graph.dispose();
        }
    });

    it("does not apply depth fallback on engines that support resolving depth", async () => {
        engine._features.forceSingleSampleFrameGraphTextures = false;
        const { graph, task, depth } = graphWithDepth();
        task.readDepth = true;
        try {
            await graph.buildAsync(false);
            expect(task.recordedSamples).toEqual([4]);
            expect(graph.textureManager.getTextureDescription(depth).options.samples).toBe(4);
        } finally {
            graph.dispose();
        }
    });

    it("keeps sample negotiation local to each graph and reports one build", async () => {
        const sampled = graphWithDepth();
        const attachment = graphWithDepth();
        sampled.task.readDepth = true;
        attachment.task.attachDepth = true;
        const onBuilt = vi.fn();
        sampled.graph.onBuildObservable.add(onBuilt);
        try {
            await sampled.graph.buildAsync(false);
            await attachment.graph.buildAsync(false);
            expect(onBuilt).toHaveBeenCalledOnce();
            expect(sampled.graph.textureManager.getTextureDescription(sampled.depth).options.samples).toBe(1);
            expect(attachment.graph.textureManager.getTextureDescription(attachment.depth).options.samples).toBe(4);
            expect(engine._features.forceSingleSampleFrameGraphTextures).toBe(true);
        } finally {
            sampled.graph.dispose();
            attachment.graph.dispose();
        }
    });

    it("preserves task settings across builds with and without imported MSAA", async () => {
        const { graph, task } = graphWithDepth();
        task.readDepth = true;
        const msaa = importedTexture(4);
        const single = importedTexture(1);
        try {
            await graph.buildAsync(false);
            expect(task.samples).toBe(4);
            const handle = graph.textureManager.importTexture("depth", msaa);
            await graph.buildAsync(false);
            expect(task.samples).toBe(4);
            graph.textureManager.importTexture("depth", single, handle);
            await graph.buildAsync(false);
            expect(task.samples).toBe(4);
            expect(task.recordedSamples).toEqual([4, 1, 4, 4, 1]);
        } finally {
            graph.dispose();
            msaa.dispose();
            single.dispose();
        }
    });

    it("restores task settings when recording fails", async () => {
        const graph = new FrameGraph(scene);
        const task = new SampledTask("sampled", graph);
        task.fail = true;
        graph.addTask(task);
        try {
            await expect(graph.buildAsync(false)).rejects.toThrow("record failed");
            expect(task.samples).toBe(4);
        } finally {
            graph.dispose();
        }
    });

    it("restores task settings when single-sample rerecording fails", async () => {
        const { graph, task } = graphWithDepth();
        task.readDepth = true;
        task.failWhenSingleSample = true;
        try {
            await expect(graph.buildAsync(false)).rejects.toThrow("record failed");
            expect(task.recordedSamples).toEqual([4, 1]);
            expect(task.samples).toBe(4);
        } finally {
            graph.dispose();
        }
    });
});
