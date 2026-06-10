import type { Nullable } from "../../types";
import type { TextureSize } from "../../Materials/Textures/textureCreationOptions";
import { RenderTargetWrapper } from "../renderTargetWrapper";
import type { NativeFramebuffer } from "./nativeInterfaces";
import type { ThinNativeEngine } from "../thinNativeEngine";

export class NativeRenderTargetWrapper extends RenderTargetWrapper {
    public override readonly _engine: ThinNativeEngine;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __framebuffer: Nullable<NativeFramebuffer> = null;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __framebufferDepthStencil: Nullable<NativeFramebuffer> = null;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __framebuffers: Nullable<NativeFramebuffer[]> = null;

    public get _framebuffer(): Nullable<NativeFramebuffer> {
        return this.__framebuffer;
    }

    public set _framebuffer(framebuffer: Nullable<NativeFramebuffer>) {
        if (this.__framebuffer) {
            this._engine._releaseFramebufferObjects(this.__framebuffer);
        }
        this.__framebuffer = framebuffer;
    }

    /**
     * For layered (2D array) render targets, holds one framebuffer per layer.
     * @internal
     */
    public get _framebuffers(): Nullable<NativeFramebuffer[]> {
        return this.__framebuffers;
    }

    public set _framebuffers(framebuffers: Nullable<NativeFramebuffer[]>) {
        if (this.__framebuffers) {
            for (const framebuffer of this.__framebuffers) {
                this._engine._releaseFramebufferObjects(framebuffer);
            }
        }
        this.__framebuffers = framebuffers;
    }

    public get _framebufferDepthStencil(): Nullable<NativeFramebuffer> {
        return this.__framebufferDepthStencil;
    }

    public set _framebufferDepthStencil(framebufferDepthStencil: Nullable<NativeFramebuffer>) {
        if (this.__framebufferDepthStencil) {
            this._engine._releaseFramebufferObjects(this.__framebufferDepthStencil);
        }
        this.__framebufferDepthStencil = framebufferDepthStencil;
    }

    constructor(isMulti: boolean, isCube: boolean, size: TextureSize, engine: ThinNativeEngine) {
        super(isMulti, isCube, size, engine);
        this._engine = engine;
    }

    public override dispose(disposeOnlyFramebuffers = false): void {
        this._framebuffer = null;
        this._framebufferDepthStencil = null;
        this._framebuffers = null;

        super.dispose(disposeOnlyFramebuffers);
    }
}
