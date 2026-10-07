/** This file must only contain pure code and pure imports */

import { type Nullable } from "../types";
import { Tools } from "./tools.pure";
import { Logger } from "./logger";
import { Texture } from "../Materials/Textures/texture.pure";
import { InternalTexture, InternalTextureSource } from "../Materials/Textures/internalTexture";
import { Constants } from "../Engines/constants";
import { initializeWebWorker, workerFunction } from "./basisWorker";
import { type AbstractEngine } from "core/Engines/abstractEngine.pure";
import { type Engine } from "core/Engines/engine.pure";

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * Info about the .basis files
 */
export class BasisFileInfo {
    /**
     * If the file has alpha
     */
    public hasAlpha: boolean;
    /**
     * Info about each image of the basis file
     */
    public images: Array<{ levels: Array<{ width: number; height: number; transcodedPixels: ArrayBufferView }> }>;
}

/**
 * Result of transcoding a basis file
 */
class TranscodeResult {
    /**
     * Info about the .basis file
     */
    public fileInfo: BasisFileInfo;
    /**
     * Format to use when loading the file
     */
    public format: number;
}

/**
 * Configuration options for the Basis transcoder
 */
export class BasisTranscodeConfiguration {
    /**
     * Supported compression formats used to determine the supported output format of the transcoder
     */
    supportedCompressionFormats?: {
        /**
         * etc1 compression format
         */
        etc1?: boolean;
        /**
         * s3tc compression format
         */
        s3tc?: boolean;
        /**
         * pvrtc compression format
         */
        pvrtc?: boolean;
        /**
         * etc2 compression format
         */
        etc2?: boolean;
        /**
         * astc compression format
         */
        astc?: boolean;
        /**
         * bc7 compression format
         */
        bc7?: boolean;
    };
    /**
     * If mipmap levels should be loaded for transcoded images (Default: true)
     */
    loadMipmapLevels?: boolean;
    /**
     * Index of a single image to load (Default: all images)
     */
    loadSingleImage?: number;
}

/**
 * @internal
 * Enum of basis transcoder formats
 */
enum BASIS_FORMATS {
    cTFETC1 = 0,
    cTFETC2 = 1,
    cTFBC1 = 2,
    cTFBC3 = 3,
    cTFBC4 = 4,
    cTFBC5 = 5,
    cTFBC7 = 6,
    cTFPVRTC1_4_RGB = 8,
    cTFPVRTC1_4_RGBA = 9,
    cTFASTC_4x4 = 10,
    cTFATC_RGB = 11,
    cTFATC_RGBA_INTERPOLATED_ALPHA = 12,
    cTFRGBA32 = 13,
    cTFRGB565 = 14,
    cTFBGR565 = 15,
    cTFRGBA4444 = 16,
    cTFFXT1_RGB = 17,
    cTFPVRTC2_4_RGB = 18,
    cTFPVRTC2_4_RGBA = 19,
    cTFETC2_EAC_R11 = 20,
    cTFETC2_EAC_RG11 = 21,
}

/**
 * Used to load .Basis files
 * See https://github.com/BinomialLLC/basis_universal/tree/master/webgl
 */
export const BasisToolsOptions = {
    /**
     * URL to use when loading the basis transcoder
     */
    JSModuleURL: `${Tools._DefaultCdnUrl}/basisTranscoder/1/basis_transcoder.js`,
    /**
     * URL to use when loading the wasm module for the transcoder
     */
    WasmModuleURL: `${Tools._DefaultCdnUrl}/basisTranscoder/1/basis_transcoder.wasm`,
};

/**
 * Get the internal format to be passed to texImage2D corresponding to the .basis format value
 * @param basisFormat format chosen from GetSupportedTranscodeFormat
 * @param engine
 * @returns internal format corresponding to the Basis format
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const GetInternalFormatFromBasisFormat = (basisFormat: number, engine: AbstractEngine) => {
    let format;
    switch (basisFormat) {
        case BASIS_FORMATS.cTFETC1:
            format = Constants.TEXTUREFORMAT_COMPRESSED_RGB_ETC1_WEBGL;
            break;
        case BASIS_FORMATS.cTFBC1:
            format = Constants.TEXTUREFORMAT_COMPRESSED_RGB_S3TC_DXT1;
            break;
        case BASIS_FORMATS.cTFBC4:
            format = Constants.TEXTUREFORMAT_COMPRESSED_RGBA_S3TC_DXT5;
            break;
        case BASIS_FORMATS.cTFASTC_4x4:
            format = Constants.TEXTUREFORMAT_COMPRESSED_RGBA_ASTC_4x4;
            break;
        case BASIS_FORMATS.cTFETC2:
            format = Constants.TEXTUREFORMAT_COMPRESSED_RGBA8_ETC2_EAC;
            break;
        case BASIS_FORMATS.cTFBC7:
            format = Constants.TEXTUREFORMAT_COMPRESSED_RGBA_BPTC_UNORM;
            break;
    }

    if (format === undefined) {
        // eslint-disable-next-line no-throw-literal
        throw "The chosen Basis transcoder format is not currently supported";
    }

    return format;
};

let WorkerPromise: Nullable<Promise<Worker>> = null;
let LocalWorker: Nullable<Worker> = null;
let ActionId = 0;
const IgnoreSupportedFormats = false;

/**
 * True when we should run the Basis transcoder on the JS thread instead of a
 * Worker. Babylon Native has no real Worker threads, and its sync XHR path
 * (required by worker importScripts) returns empty bodies — so the browser
 * blob-worker handshake cannot load basis_transcoder.js there.
 * @returns True if Basis should transcode on the main thread
 */
const ShouldUseMainThreadBasis = (): boolean => {
    // Native embedder global. Also fall back when Worker/Blob/URL are missing.
    if (typeof (globalThis as any)._native !== "undefined") {
        return true;
    }
    if (typeof Worker === "undefined" || typeof URL !== "function" || typeof Blob === "undefined") {
        return true;
    }
    return false;
};

/**
 * Build a Worker-shaped object that transcodes on the main thread after
 * asynchronously loading the transcoder JS + wasm (no importScripts / Worker).
 *
 * Mirrors the transcode path in basisWorker.workerFunction without evaluating
 * that function (it assigns bare `onmessage` under "use strict", which throws
 * outside a real WorkerGlobalScope).
 * @param wasmBinary Preloaded basis_transcoder.wasm bytes
 * @returns A Worker-compatible object that posts transcode results on the main thread
 */
const CreateMainThreadBasisWorkerAsync = async (wasmBinary: ArrayBuffer): Promise<Worker> => {
    const jsUrl = Tools.GetBabylonScriptURL(BasisToolsOptions.JSModuleURL);
    // LoadFileAsync works on Native; sync XHR / importScripts does not.
    const jsSource = (await Tools.LoadFileAsync(jsUrl, false)) as string;
    // eslint-disable-next-line no-new-func
    new Function(jsSource)();
    const basisFactory = (globalThis as any).BASIS;
    if (typeof basisFactory !== "function") {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        throw "Basis transcoder JS loaded but global BASIS factory is missing";
    }
    const basisModule = await basisFactory({ wasmBinary });
    basisModule.initializeBasis();

    // Format ids match basisWorker._BASIS_FORMAT / BASIS_FORMATS.
    const FMT = {
        cTFETC1: 0,
        cTFETC2: 1,
        cTFBC1: 2,
        cTFBC3: 3,
        cTFBC7: 6,
        cTFPVRTC1_4_RGB: 8,
        cTFPVRTC1_4_RGBA: 9,
        cTFASTC_4x4: 10,
        cTFRGB565: 14,
    };

    const getSupportedFormat = (config: BasisTranscodeConfiguration, fileInfo: BasisFileInfo): Nullable<number> => {
        const s = config.supportedCompressionFormats;
        if (!s) {
            return null;
        }
        if (s.astc) {
            return FMT.cTFASTC_4x4;
        }
        if (s.bc7) {
            return FMT.cTFBC7;
        }
        if (s.s3tc) {
            return fileInfo.hasAlpha ? FMT.cTFBC3 : FMT.cTFBC1;
        }
        if (s.pvrtc) {
            return fileInfo.hasAlpha ? FMT.cTFPVRTC1_4_RGBA : FMT.cTFPVRTC1_4_RGB;
        }
        if (s.etc2) {
            return FMT.cTFETC2;
        }
        if (s.etc1) {
            return FMT.cTFETC1;
        }
        return FMT.cTFRGB565;
    };

    // Port of basisWorker.ConvertDxtToRgb565 (fallback when no GPU format matches).
    const convertDxtToRgb565 = (src: Uint8Array, srcByteOffset: number, width: number, height: number): Uint16Array => {
        const c = new Uint16Array(4);
        const dst = new Uint16Array(width * height);
        const blockWidth = width / 4;
        const blockHeight = height / 4;
        for (let blockY = 0; blockY < blockHeight; blockY++) {
            for (let blockX = 0; blockX < blockWidth; blockX++) {
                const i = srcByteOffset + 8 * (blockY * blockWidth + blockX);
                c[0] = src[i] | (src[i + 1] << 8);
                c[1] = src[i + 2] | (src[i + 3] << 8);
                c[2] =
                    ((2 * (c[0] & 0x1f) + 1 * (c[1] & 0x1f)) / 3) |
                    (((2 * (c[0] & 0x7e0) + 1 * (c[1] & 0x7e0)) / 3) & 0x7e0) |
                    (((2 * (c[0] & 0xf800) + 1 * (c[1] & 0xf800)) / 3) & 0xf800);
                c[3] =
                    ((2 * (c[1] & 0x1f) + 1 * (c[0] & 0x1f)) / 3) |
                    (((2 * (c[1] & 0x7e0) + 1 * (c[0] & 0x7e0)) / 3) & 0x7e0) |
                    (((2 * (c[1] & 0xf800) + 1 * (c[0] & 0xf800)) / 3) & 0xf800);
                for (let row = 0; row < 4; row++) {
                    const m = src[i + 4 + row];
                    let dstI = (blockY * 4 + row) * width + blockX * 4;
                    dst[dstI++] = c[m & 0x3];
                    dst[dstI++] = c[(m >> 2) & 0x3];
                    dst[dstI++] = c[(m >> 4) & 0x3];
                    dst[dstI] = c[(m >> 6) & 0x3];
                }
            }
        }
        return dst;
    };

    const transcodeLevel = (loadedFile: any, imageIndex: number, levelIndex: number, format: number, convertToRgb565: boolean): Nullable<Uint8Array | Uint16Array> => {
        const dstSize = loadedFile.getImageTranscodedSizeInBytes(imageIndex, levelIndex, format);
        let dst: Uint8Array | Uint16Array = new Uint8Array(dstSize);
        if (!loadedFile.transcodeImage(dst, imageIndex, levelIndex, format, 1, 0)) {
            return null;
        }
        if (convertToRgb565) {
            const alignedWidth = (loadedFile.getImageWidth(imageIndex, levelIndex) + 3) & ~3;
            const alignedHeight = (loadedFile.getImageHeight(imageIndex, levelIndex) + 3) & ~3;
            dst = convertDxtToRgb565(dst, 0, alignedWidth, alignedHeight);
        }
        return dst;
    };

    type Listener = (msg: MessageEvent) => void;
    const listeners: Listener[] = [];

    const deliverToMain = (data: any) => {
        const evt = { data } as MessageEvent;
        const fire = () => {
            for (const fn of listeners.slice()) {
                fn(evt);
            }
            if (typeof (mainThreadWorker as any).onmessage === "function") {
                (mainThreadWorker as any).onmessage(evt);
            }
        };
        if (typeof setTimeout === "function") {
            setTimeout(fire, 0);
        } else {
            fire();
        }
    };

    const handleTranscode = (eventData: any) => {
        const config: BasisTranscodeConfiguration = eventData.config;
        const imgData = eventData.imageData;
        const loadedFile = new basisModule.BasisFile(imgData);
        const hasAlpha = loadedFile.getHasAlpha();
        const imageCount = loadedFile.getNumImages();
        const images: BasisFileInfo["images"] = [];
        for (let i = 0; i < imageCount; i++) {
            const levels: BasisFileInfo["images"][number]["levels"] = [];
            const levelCount = loadedFile.getNumLevels(i);
            for (let level = 0; level < levelCount; level++) {
                levels.push({
                    width: loadedFile.getImageWidth(i, level),
                    height: loadedFile.getImageHeight(i, level),
                    // Filled in after transcode; placeholder satisfies the type.
                    transcodedPixels: new Uint8Array(0),
                });
            }
            images.push({ levels });
        }
        const fileInfo: BasisFileInfo = { hasAlpha, images };

        let format = eventData.ignoreSupportedFormats ? null : getSupportedFormat(config, fileInfo);
        let needsConversion = false;
        if (format === null) {
            needsConversion = true;
            format = fileInfo.hasAlpha ? FMT.cTFBC3 : FMT.cTFBC1;
        }

        let success = true;
        if (!loadedFile.startTranscoding()) {
            success = false;
        }

        for (let imageIndex = 0; imageIndex < fileInfo.images.length && success; imageIndex++) {
            const image = fileInfo.images[imageIndex];
            if (config.loadSingleImage === undefined || config.loadSingleImage === imageIndex) {
                let mipCount = image.levels.length;
                if (config.loadMipmapLevels === false) {
                    mipCount = 1;
                }
                for (let levelIndex = 0; levelIndex < mipCount; levelIndex++) {
                    const pixels = transcodeLevel(loadedFile, imageIndex, levelIndex, format!, needsConversion);
                    if (!pixels) {
                        success = false;
                        break;
                    }
                    image.levels[levelIndex].transcodedPixels = pixels;
                }
            }
        }

        loadedFile.close();
        loadedFile.delete();

        if (needsConversion) {
            format = -1;
        }
        deliverToMain({ action: "transcode", success, id: eventData.id, fileInfo, format });
    };

    const mainThreadWorker = {
        onmessage: null as Nullable<Listener>,
        postMessage: (data: any, _transfer?: ArrayBuffer[]) => {
            const run = () => {
                if (data && data.action === "init") {
                    deliverToMain({ action: "init" });
                    return;
                }
                if (data && data.action === "transcode") {
                    try {
                        handleTranscode(data);
                    } catch (e) {
                        deliverToMain({ action: "transcode", success: false, id: data.id, error: e });
                    }
                }
            };
            if (typeof setTimeout === "function") {
                setTimeout(run, 0);
            } else {
                run();
            }
        },
        addEventListener: (type: string, fn: Listener) => {
            if (type === "message") {
                listeners.push(fn);
            }
        },
        removeEventListener: (type: string, fn: Listener) => {
            if (type !== "message") {
                return;
            }
            const idx = listeners.indexOf(fn);
            if (idx >= 0) {
                listeners.splice(idx, 1);
            }
        },
        terminate: () => {
            listeners.length = 0;
        },
    };

    return mainThreadWorker as unknown as Worker;
};

const CreateWorkerAsync = async () => {
    if (!WorkerPromise) {
        WorkerPromise = new Promise((res, reject) => {
            if (LocalWorker) {
                res(LocalWorker);
            } else {
                Tools.LoadFileAsync(Tools.GetBabylonScriptURL(BasisToolsOptions.WasmModuleURL))
                    // eslint-disable-next-line github/no-then
                    .then(async (wasmBinary) => {
                        if (ShouldUseMainThreadBasis()) {
                            try {
                                const worker = await CreateMainThreadBasisWorkerAsync(wasmBinary as ArrayBuffer);
                                LocalWorker = worker;
                                res(worker);
                            } catch (e) {
                                reject(e instanceof Error ? e : new Error(String(e)));
                            }
                            return;
                        }
                        if (typeof URL !== "function") {
                            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                            reject("Basis transcoder requires an environment with a URL constructor");
                            return;
                        }
                        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
                        const workerBlobUrl = URL.createObjectURL(new Blob([`(${workerFunction})()`], { type: "application/javascript" }));
                        LocalWorker = new Worker(workerBlobUrl);
                        // eslint-disable-next-line github/no-then
                        initializeWebWorker(LocalWorker, wasmBinary, BasisToolsOptions.JSModuleURL).then(res, reject);
                    })
                    // eslint-disable-next-line github/no-then
                    .catch(reject);
            }
        });
    }
    return await WorkerPromise;
};

/**
 * Set the worker to use for transcoding
 * @param worker The worker that will be used for transcoding
 */
export const SetBasisTranscoderWorker = (worker: Worker) => {
    LocalWorker = worker;
};

/**
 * Transcodes a loaded image file to compressed pixel data
 * @param data image data to transcode
 * @param config configuration options for the transcoding
 * @returns a promise resulting in the transcoded image
 */
export const TranscodeAsync = async (data: ArrayBuffer | ArrayBufferView, config: BasisTranscodeConfiguration): Promise<TranscodeResult> => {
    const dataView = data instanceof ArrayBuffer ? new Uint8Array(data) : data;

    return await new Promise((res, rej) => {
        // eslint-disable-next-line github/no-then
        CreateWorkerAsync().then(
            () => {
                const actionId = ActionId++;
                const messageHandler = (msg: any) => {
                    if (msg.data.action === "transcode" && msg.data.id === actionId) {
                        LocalWorker!.removeEventListener("message", messageHandler);
                        if (!msg.data.success) {
                            // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                            rej("Transcode is not supported on this device");
                        } else {
                            res(msg.data);
                        }
                    }
                };
                LocalWorker!.addEventListener("message", messageHandler);

                const dataViewCopy = new Uint8Array(dataView.byteLength);
                dataViewCopy.set(new Uint8Array(dataView.buffer, dataView.byteOffset, dataView.byteLength));
                LocalWorker!.postMessage({ action: "transcode", id: actionId, imageData: dataViewCopy, config: config, ignoreSupportedFormats: IgnoreSupportedFormats }, [
                    dataViewCopy.buffer,
                ]);
            },
            (error) => {
                // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
                rej(error);
            }
        );
    });
};

/**
 * Binds a texture according to its underlying target.
 * @param texture texture to bind
 * @param engine the engine to bind the texture in
 */
const BindTexture = (texture: InternalTexture, engine: Engine): void => {
    let target: GLenum = engine._gl?.TEXTURE_2D;
    if (texture.isCube) {
        target = engine._gl?.TEXTURE_CUBE_MAP;
    }

    engine._bindTextureDirectly(target, texture, true);
};

/**
 * Loads a texture from the transcode result
 * @param texture texture load to
 * @param transcodeResult the result of transcoding the basis file to load from
 */
export const LoadTextureFromTranscodeResult = (texture: InternalTexture, transcodeResult: TranscodeResult) => {
    const engine = texture.getEngine() as Engine;
    for (let i = 0; i < transcodeResult.fileInfo.images.length; i++) {
        const rootImage = transcodeResult.fileInfo.images[i].levels[0];
        texture._invertVScale = texture.invertY;
        if (transcodeResult.format === -1 || transcodeResult.format === BASIS_FORMATS.cTFRGB565) {
            // No compatable compressed format found, fallback to RGB
            texture.type = Constants.TEXTURETYPE_UNSIGNED_SHORT_5_6_5;
            texture.format = Constants.TEXTUREFORMAT_RGB;

            if (engine._features.basisNeedsPOT && (Math.log2(rootImage.width) % 1 !== 0 || Math.log2(rootImage.height) % 1 !== 0)) {
                // Create non power of two texture
                const source = new InternalTexture(engine, InternalTextureSource.Temp);

                texture._invertVScale = texture.invertY;
                source.type = Constants.TEXTURETYPE_UNSIGNED_SHORT_5_6_5;
                source.format = Constants.TEXTUREFORMAT_RGB;
                // Fallback requires aligned width/height
                source.width = (rootImage.width + 3) & ~3;
                source.height = (rootImage.height + 3) & ~3;
                BindTexture(source, engine);
                engine._uploadDataToTextureDirectly(source, new Uint16Array(rootImage.transcodedPixels.buffer), i, 0, Constants.TEXTUREFORMAT_RGB, true);

                // Resize to power of two
                engine._rescaleTexture(source, texture, engine.scenes[0], engine._getInternalFormat(Constants.TEXTUREFORMAT_RGB), () => {
                    engine._releaseTexture(source);
                    BindTexture(texture, engine);
                });
            } else {
                // Fallback is already inverted
                texture._invertVScale = !texture.invertY;

                // Upload directly
                texture.width = (rootImage.width + 3) & ~3;
                texture.height = (rootImage.height + 3) & ~3;
                texture.samplingMode = Constants.TEXTURE_LINEAR_LINEAR;
                BindTexture(texture, engine);
                engine._uploadDataToTextureDirectly(texture, new Uint16Array(rootImage.transcodedPixels.buffer), i, 0, Constants.TEXTUREFORMAT_RGB, true);
            }
        } else {
            texture.width = rootImage.width;
            texture.height = rootImage.height;
            texture.generateMipMaps = transcodeResult.fileInfo.images[i].levels.length > 1;

            const format = BasisTools.GetInternalFormatFromBasisFormat(transcodeResult.format, engine);
            texture.format = format;

            BindTexture(texture, engine);

            // Upload all mip levels in the file
            const levels = transcodeResult.fileInfo.images[i].levels;

            for (let index = 0; index < levels.length; index++) {
                const level = levels[index];
                engine._uploadCompressedDataToTextureDirectly(texture, format, level.width, level.height, level.transcodedPixels, i, index);
            }

            if (engine._features.basisNeedsPOT && (Math.log2(texture.width) % 1 !== 0 || Math.log2(texture.height) % 1 !== 0)) {
                Logger.Warn(
                    "Loaded .basis texture width and height are not a power of two. Texture wrapping will be set to Texture.CLAMP_ADDRESSMODE as other modes are not supported with non power of two dimensions in webGL 1."
                );
                texture._cachedWrapU = Texture.CLAMP_ADDRESSMODE;
                texture._cachedWrapV = Texture.CLAMP_ADDRESSMODE;
            }
        }
    }
};

/**
 * Used to load .Basis files
 * See https://github.com/BinomialLLC/basis_universal/tree/master/webgl
 */
export const BasisTools = {
    /**
     * URL to use when loading the basis transcoder
     */
    JSModuleURL: BasisToolsOptions.JSModuleURL,
    /**
     * URL to use when loading the wasm module for the transcoder
     */
    WasmModuleURL: BasisToolsOptions.WasmModuleURL,

    /**
     * Get the internal format to be passed to texImage2D corresponding to the .basis format value
     * @param basisFormat format chosen from GetSupportedTranscodeFormat
     * @returns internal format corresponding to the Basis format
     */
    GetInternalFormatFromBasisFormat,

    /**
     * Transcodes a loaded image file to compressed pixel data
     * @param data image data to transcode
     * @param config configuration options for the transcoding
     * @returns a promise resulting in the transcoded image
     */
    TranscodeAsync,

    /**
     * Loads a texture from the transcode result
     * @param texture texture load to
     * @param transcodeResult the result of transcoding the basis file to load from
     */
    LoadTextureFromTranscodeResult,
};

let _Registered = false;
/**
 * Register side effects for basis.
 * Safe to call multiple times; only the first call has an effect.
 */
export function RegisterBasis(): void {
    if (_Registered) {
        return;
    }
    _Registered = true;

    Object.defineProperty(BasisTools, "JSModuleURL", {
        get: function (this: null) {
            return BasisToolsOptions.JSModuleURL;
        },
        set: function (this: null, value: string) {
            BasisToolsOptions.JSModuleURL = value;
        },
    });

    Object.defineProperty(BasisTools, "WasmModuleURL", {
        get: function (this: null) {
            return BasisToolsOptions.WasmModuleURL;
        },
        set: function (this: null, value: string) {
            BasisToolsOptions.WasmModuleURL = value;
        },
    });
}
