/** @internal */
// eslint-disable-next-line @typescript-eslint/naming-convention
export interface EngineFeatures {
    /** Force using Bitmap when Bitmap or HTMLImageElement can be used */
    forceBitmapOverHTMLImageElement: boolean;

    /** Indicates that the engine support rendering to as well as copying to lod float textures */
    supportRenderAndCopyToLodForFloatTextures: boolean;

    /** Indicates that the engine support handling depth/stencil textures */
    supportDepthStencilTexture: boolean;

    /** Indicates that the engine support shadow samplers */
    supportShadowSamplers: boolean;

    /** Indicates to check the matrix bytes per bytes to know if it has changed or not. If false, only the updateFlag of the matrix is checked */
    uniformBufferHardCheckMatrix: boolean;

    /** Indicates that prefiltered mipmaps can be generated in some processes (for eg when loading an HDR cube texture) */
    allowTexturePrefiltering: boolean;

    /** Indicates that a GPU-convolved irradiance TEXTURE can be generated for diffuse IBL. When false (eg Babylon
     * Native, WebGL1) diffuse IBL falls back to CPU spherical harmonics even if allowTexturePrefiltering is true. */
    allowIrradianceTexturePrefiltering: boolean;

    /** Indicates to track the usage of ubos and to create new ones as necessary during a frame duration */
    trackUbosInFrame: boolean;

    /** Indicates that the current content of a ubo should be compared to the content of the corresponding GPU buffer and the GPU buffer updated only if different. Requires trackUbosInFrame to be true */
    checkUbosContentBeforeUpload: boolean;

    /** Indicates that the Cascaded Shadow Map technic is supported */
    supportCSM: boolean;

    /** Indicates that the textures transcoded by the basis transcoder must have power of 2 width and height */
    basisNeedsPOT: boolean;

    /** Indicates that the engine supports 3D textures */
    support3DTextures: boolean;

    /** Indicates that constants need a type suffix in shaders (used by realtime filtering...) */
    needTypeSuffixInShaderConstants: boolean;

    /** Indicates that MSAA is supported */
    supportMSAA: boolean;

    /** Indicates that SSAO2 is supported */
    supportSSAO2: boolean;

    /** Indicates that IBL Shadows are supported */
    supportIBLShadows: boolean;

    /** Indicates that some additional texture formats are supported (like TEXTUREFORMAT_R for eg) */
    supportExtendedTextureFormats: boolean;

    /** Indicates that the switch/case construct is supported in shaders */
    supportSwitchCaseInShader: boolean;

    /** Indicates that synchronous texture reading is supported */
    supportSyncTextureRead: boolean;

    /** Indicates that y should be inverted when dealing with bitmaps (notably in environment tools) */
    needsInvertingBitmap: boolean;

    /** Indicates that the engine should cache the bound UBO */
    useUBOBindingCache: boolean;

    /** Indicates that the inliner should be run over every shader code */
    needShaderCodeInlining: boolean;

    /** Indicates that even if we don't have to update the properties of a uniform buffer (because of some optimzations in the material) we still need to bind the uniform buffer themselves */
    needToAlwaysBindUniformBuffers: boolean;

    /**  Indicates that the engine supports render passes */
    supportRenderPasses: boolean;

    /**  Indicates that the engine supports sprite instancing */
    supportSpriteInstancing: boolean;

    /** Indicates that the stride and (byte) offset of a vertex buffer must always be a multiple of 4 bytes */
    forceVertexBufferStrideAndOffsetMultiple4Bytes: boolean;

    /**
     * Indicates that the engine cannot resolve a multisampled depth attachment into a single-sample, shader
     * readable depth texture. WebGL does this with a DEPTH_BUFFER_BIT blit and WebGPU with a resolve pass, so a
     * frame graph depth texture can be MSAA and still be sampled by a later task (volumetric lighting, SSR...).
     * When this is true the frame graph clamps its render target textures to a single sample, because a
     * multisampled depth texture would read back as zero in every pass that samples it.
     */
    forceSingleSampleFrameGraphTextures: boolean;

    /** @internal */
    _checkNonFloatVertexBuffersDontRecreatePipelineContext: boolean;
}
