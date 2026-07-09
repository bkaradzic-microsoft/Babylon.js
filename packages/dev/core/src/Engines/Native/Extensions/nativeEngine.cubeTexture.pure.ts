/** This file must only contain pure code and pure imports */

import { InternalTextureSource, InternalTexture } from "../../../Materials/Textures/internalTexture";
import { Texture } from "../../../Materials/Textures/texture.pure";
import { CreateRadianceImageDataArrayBufferViews, GetEnvInfo, UploadEnvSpherical } from "../../../Misc/environmentTextureTools.pure";
import { type IWebRequest } from "../../../Misc/interfaces/iWebRequest";
import { type Scene } from "../../../scene.pure";
import { type Nullable } from "../../../types";
import { Constants } from "../../constants";
import { ThinNativeEngine } from "../../thinNativeEngine.pure";
import { _GetCompatibleTextureLoader } from "../../../Materials/Textures/Loaders/textureLoaderManager";

let _Registered = false;
/**
 * Register side effects for nativeEngineCubeTexture.
 * Safe to call multiple times; only the first call has an effect.
 */
export function RegisterNativeEngineCubeTexture(): void {
    if (_Registered) {
        return;
    }
    _Registered = true;

    ThinNativeEngine.prototype.createCubeTexture = function (
        rootUrl: string,
        scene: Nullable<Scene>,
        files: Nullable<string[]>,
        noMipmap?: boolean,
        onLoad: Nullable<(data?: any) => void> = null,
        onError: Nullable<(message?: string, exception?: any) => void> = null,
        format?: number,
        forcedExtension: any = null,
        createPolynomials = false,
        lodScale: number = 0,
        lodOffset: number = 0,
        fallback: Nullable<InternalTexture> = null,
        loaderOptions?: any,
        useSRGBBuffer = false,
        buffer: Nullable<ArrayBufferView> = null
    ): InternalTexture {
        const texture = fallback ? fallback : new InternalTexture(this, InternalTextureSource.Cube);
        texture.isCube = true;
        texture.url = rootUrl;
        texture.generateMipMaps = !noMipmap;
        texture._lodGenerationScale = lodScale;
        texture._lodGenerationOffset = lodOffset;
        texture._useSRGBBuffer = this._getUseSRGBBuffer(useSRGBBuffer, !!noMipmap);

        if (!this._doNotHandleContextLost) {
            texture._extension = forcedExtension;
            texture._files = files;
            texture._buffer = buffer;
        }

        const lastDot = rootUrl.lastIndexOf(".");
        const extension = forcedExtension ? forcedExtension : lastDot > -1 ? rootUrl.substring(lastDot).toLowerCase() : "";

        // Single-file container cubemaps (.dds/.ktx/.ktx2) are routed through the shared JS
        // texture loader below; .env keeps its bespoke path.
        const loaderPromise = extension === ".env" ? null : _GetCompatibleTextureLoader(extension);

        // TODO: use texture loader to load env files?
        if (extension === ".env") {
            const onLoadData = (data: ArrayBufferView) => {
                const info = GetEnvInfo(data)!;
                texture.width = info.width;
                texture.height = info.width;

                UploadEnvSpherical(texture, info);

                const specularInfo = info.specular;
                if (!specularInfo) {
                    throw new Error(`Nothing else parsed so far`);
                }

                texture._lodGenerationScale = specularInfo.lodGenerationScale;
                const imageData = CreateRadianceImageDataArrayBufferViews(data, info);

                texture.format = Constants.TEXTUREFORMAT_RGBA;
                texture.type = Constants.TEXTURETYPE_UNSIGNED_BYTE;
                texture.generateMipMaps = true;
                texture.getEngine().updateTextureSamplingMode(Texture.TRILINEAR_SAMPLINGMODE, texture);
                texture._isRGBD = true;
                texture.invertY = true;

                this._engine.loadCubeTextureWithMips(
                    texture._hardwareTexture!.underlyingResource,
                    imageData,
                    false,
                    texture._useSRGBBuffer,
                    () => {
                        texture.isReady = true;
                        if (onLoad) {
                            onLoad();
                        }
                    },
                    () => {
                        throw new Error("Could not load a native cube texture.");
                    }
                );
            };

            if (buffer) {
                onLoadData(buffer);
            } else if (files && files.length === 6) {
                throw new Error(`Multi-file loading not allowed on env files.`);
            } else {
                const onInternalError = (request?: IWebRequest, exception?: any) => {
                    if (onError && request) {
                        onError(request.status + " " + request.statusText, exception);
                    }
                };

                this._loadFile(
                    rootUrl,
                    (data) => {
                        onLoadData(new Uint8Array(data as ArrayBuffer, 0, (data as ArrayBuffer).byteLength));
                    },
                    undefined,
                    undefined,
                    true,
                    onInternalError
                );
            }
        } else if (loaderPromise && !files) {
            // Single-file container (.dds/.ktx/.ktx2) cubemap: route through the shared JS
            // texture loader. loadCubeData uploads each face/mip via _upload*ToTextureDirectly
            // and, when createPolynomials is set, computes the diffuse-IBL spherical harmonics
            // in JS (no GPU readback) and assigns texture._sphericalPolynomial.
            if (!texture._hardwareTexture) {
                texture._hardwareTexture = this._createHardwareTexture();
            }
            const onLoadDataAsync = async (data: ArrayBufferView): Promise<void> => {
                try {
                    const loader = await loaderPromise;
                    loader.loadCubeData(
                        data,
                        texture,
                        createPolynomials,
                        (loadData?: any) => {
                            // Assign the JS-computed diffuse-IBL spherical harmonics so PBR
                            // materials find them synchronously instead of falling back to
                            // the GPU-readback SH path (which never resolves on Native).
                            // Also forward loadData so the prefiltered-cube onLoad wrapper
                            // (createPrefilteredCubeTexture) can set _source and the SH too.
                            if (loadData?.info?.sphericalPolynomial) {
                                texture._sphericalPolynomial = loadData.info.sphericalPolynomial;
                            }
                            texture.isReady = true;
                            texture.getEngine().updateTextureSamplingMode(Texture.TRILINEAR_SAMPLINGMODE, texture);
                            texture.onLoadedObservable.notifyObservers(texture);
                            texture.onLoadedObservable.clear();
                            if (onLoad) {
                                onLoad(loadData);
                            }
                        },
                        (message?: string, exception?: any) => {
                            if (onError) {
                                onError(message, exception);
                            }
                        },
                        loaderOptions
                    );
                } catch (exception: any) {
                    if (onError) {
                        onError(exception?.message, exception);
                    }
                }
            };
            if (buffer) {
                void onLoadDataAsync(buffer);
            } else {
                this._loadFile(
                    rootUrl,
                    (data) => void onLoadDataAsync(new Uint8Array(data as ArrayBuffer)),
                    undefined,
                    undefined,
                    true,
                    (request?: IWebRequest, exception?: any) => {
                        if (onError && request) {
                            onError(request.status + " " + request.statusText, exception);
                        }
                    }
                );
            }
        } else {
            if (!files || files.length !== 6) {
                throw new Error("Cannot load cubemap because 6 files were not defined");
            }

            // Reorder from [+X, +Y, +Z, -X, -Y, -Z] to [+X, -X, +Y, -Y, +Z, -Z].
            const reorderedFiles = [files[0], files[3], files[1], files[4], files[2], files[5]];
            // eslint-disable-next-line github/no-then
            Promise.all(reorderedFiles.map(async (file) => await this._loadFileAsync(file, undefined, true).then((data) => new Uint8Array(data, 0, data.byteLength))))
                // eslint-disable-next-line github/no-then
                .then(async (data) => {
                    return await new Promise<void>((resolve, reject) => {
                        this._engine.loadCubeTexture(texture._hardwareTexture!.underlyingResource, data, !noMipmap, true, texture._useSRGBBuffer, resolve, reject);
                    });
                })
                // eslint-disable-next-line github/no-then
                .then(
                    () => {
                        texture.isReady = true;
                        if (onLoad) {
                            onLoad();
                        }
                    },
                    (error) => {
                        if (onError) {
                            onError(`Failed to load cubemap: ${error.message}`, error);
                        }
                    }
                );
        }

        this._internalTexturesCache.push(texture);

        return texture;
    };

    // Native configures cube sampling via updateTextureSamplingMode; there are no per-cubemap
    // GL sampler params to set. Implemented as a no-op so the shared loaders (which call it) work.
    ThinNativeEngine.prototype._setCubeMapTextureParams = function (_texture: InternalTexture, _loadMipmap: boolean, _maxLevel?: number): void {};
}
