import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A minimal stand-in for basis_transcoder.js: the real worker body only needs the BASIS factory API.
const FakeBasisTranscoderSource = `
var BASIS = function (options) {
    var wasmByteLength = options.wasmBinary.byteLength;
    return Promise.resolve({
        initializeBasis: function () {},
        BasisFile: function (data) {
            this.getHasAlpha = function () { return false; };
            this.getNumImages = function () { return 1; };
            this.getNumLevels = function () { return 2; };
            this.getImageWidth = function (image, level) { return 4 >> level; };
            this.getImageHeight = function (image, level) { return 4 >> level; };
            this.startTranscoding = function () { return true; };
            this.getImageTranscodedSizeInBytes = function () { return 8; };
            this.transcodeImage = function (dst, image, level, format) {
                dst[0] = data[0];
                dst[1] = wasmByteLength;
                dst[2] = format;
                dst[3] = level;
                return true;
            };
            this.close = function () {};
            this.delete = function () {};
        },
    });
};
`;

describe("Basis main-thread transcoding", () => {
    beforeEach(() => {
        vi.resetModules();
        (globalThis as any)._native = {};
    });

    afterEach(() => {
        delete (globalThis as any)._native;
        vi.restoreAllMocks();
        vi.resetModules();
    });

    it("transcodes with the shared worker logic when no Worker is available", async () => {
        const { Tools } = await import("core/Misc/tools.pure");
        const { TranscodeAsync } = await import("core/Misc/basis.pure");
        const loadFile = vi.spyOn(Tools, "LoadFileAsync").mockImplementation(async (url: string) => {
            return url.endsWith(".js") ? FakeBasisTranscoderSource : new ArrayBuffer(5);
        });

        const result = await TranscodeAsync(new Uint8Array([42]), { supportedCompressionFormats: { s3tc: true, etc1: false, etc2: false, pvrtc: false, astc: false, bc7: false } });

        expect(loadFile).toHaveBeenCalledTimes(2);
        // cTFBC1 for an opaque file when S3TC is supported.
        expect(result.format).toBe(2);
        expect(result.success).toBe(true);
        const levels = result.fileInfo.images[0].levels;
        expect(levels.map((level) => [level.width, level.height])).toEqual([
            [4, 4],
            [2, 2],
        ]);
        expect(Array.from(levels[1].transcodedPixels as Uint8Array).slice(0, 4)).toEqual([42, 5, 2, 1]);
    });

    it("rejects the transcode when the transcoder fails", async () => {
        const { Tools } = await import("core/Misc/tools.pure");
        const { TranscodeAsync } = await import("core/Misc/basis.pure");
        const failingSource = FakeBasisTranscoderSource.replace("return true;\n            };\n            this.close", "return false;\n            };\n            this.close");
        vi.spyOn(Tools, "LoadFileAsync").mockImplementation(async (url: string) => {
            return url.endsWith(".js") ? failingSource : new ArrayBuffer(5);
        });

        await expect(
            TranscodeAsync(new Uint8Array([1]), { supportedCompressionFormats: { s3tc: true, etc1: false, etc2: false, pvrtc: false, astc: false, bc7: false } })
        ).rejects.toBe("Transcode is not supported on this device");
    });
});
