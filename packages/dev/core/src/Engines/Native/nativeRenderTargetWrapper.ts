import { type Nullable } from "../../types";
import { type InternalTexture } from "../../Materials/Textures/internalTexture";
import { type TextureSize } from "../../Materials/Textures/textureCreationOptions";
import { RenderTargetWrapper } from "../renderTargetWrapper";
import { type NativeFramebuffer } from "./nativeInterfaces";
import { type ThinNativeEngine } from "../thinNativeEngine";

export class NativeRenderTargetWrapper extends RenderTargetWrapper {
    public override readonly _engine: ThinNativeEngine;

    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __framebuffer: Nullable<NativeFramebuffer> = null;
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __framebufferDepthStencil: Nullable<NativeFramebuffer> = null;
    // Per-face framebuffers for cube render targets (index = cube face 0..5).
    // eslint-disable-next-line @typescript-eslint/naming-convention
    private __framebuffers: Nullable<NativeFramebuffer[]> = null;

    // Lazily-built per-(mip, layer) framebuffers for 3D render targets (IBL voxel grid + its
    // procedural mip chain). Keyed by `mip * depth + layer`; each slice/mip is rendered through
    // its own bgfx framebuffer selected by bindFramebuffer(lodLevel, layer).
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public _layerFramebuffers: Nullable<Map<number, NativeFramebuffer>> = null;
    // The 3D texture the multi-attachment (layered MRT) framebuffer was last built from, so it can be
    // rebuilt when setInternalTexture swaps in the shared voxel texture after creation.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public _layered3DFramebufferTexture: unknown = undefined;

    // True for a mixed-type MRT whose color attachments target specific layers of 2D-array textures and/or
    // faces of cube textures (plus plain 2D). Its multi-attachment framebuffer is built lazily on first bind
    // (via _bindLayeredMultiFramebuffer) so per-attachment layer/face and post-creation setInternalTexture
    // (a shared texture swapped into an attachment) are honored. The 3D voxelization MRT uses the is3D route.
    // eslint-disable-next-line @typescript-eslint/naming-convention
    public _isMixedTypeMRT: boolean = false;

    public get _framebuffer(): Nullable<NativeFramebuffer> {
        return this.__framebuffer;
    }

    public set _framebuffer(framebuffer: Nullable<NativeFramebuffer>) {
        if (this.__framebuffer) {
            this._engine._releaseFramebufferObjects(this.__framebuffer);
        }
        this.__framebuffer = framebuffer;
    }

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
        // Keep _framebuffer pointing at face 0 so single-target code paths still work.
        this.__framebuffer = framebuffers ? framebuffers[0] : null;
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

    /**
     * Attaches a texture to one of the color attachments of this render target.
     * @param texture The texture to attach
     * @param index The index of the color attachment
     * @param disposePrevious Whether to dispose the texture currently attached at this index
     */
    public override setTexture(texture: InternalTexture, index: number = 0, disposePrevious: boolean = true): void {
        const previous = this.textures?.[index];

        super.setTexture(texture, index, disposePrevious);

        if (previous === texture) {
            return;
        }

        // A frame graph framebuffer is built lazily, once, from the wrapper's attachment list (see
        // ThinNativeEngine._buildFrameGraphFramebuffer) and does not track later attachment changes. The frame
        // graph swaps the ping/pong textures of a history texture (TAA, IBL shadows accumulation, ...) through
        // setTexture on every frame, so the framebuffer must be dropped here: otherwise the pass keeps rendering
        // into the texture the framebuffer was originally built from, the read texture is never written and the
        // history stays black. Dropping it makes the next bind rebuild it against the texture actually written
        // this frame. Only frame graph framebuffers are invalidated; other wrappers own a framebuffer that is
        // built eagerly and is never rebuilt on bind.
        if (this.__framebuffer && this._engine._isFrameGraphFramebuffer(this.__framebuffer)) {
            this._framebuffer = null;
        }
    }

    public override dispose(disposeOnlyFramebuffers = false): void {
        if (this._layerFramebuffers) {
            for (const framebuffer of this._layerFramebuffers.values()) {
                this._engine._releaseFramebufferObjects(framebuffer);
            }
            this._layerFramebuffers = null;
        }
        this._layered3DFramebufferTexture = undefined;

        if (this.__framebuffers) {
            // Releases all six per-face framebuffers (face 0 is aliased by __framebuffer, so
            // clear that alias here without releasing it again).
            this._framebuffers = null;
        } else {
            this._framebuffer = null;
        }
        this._framebufferDepthStencil = null;

        super.dispose(disposeOnlyFramebuffers);
    }
}
