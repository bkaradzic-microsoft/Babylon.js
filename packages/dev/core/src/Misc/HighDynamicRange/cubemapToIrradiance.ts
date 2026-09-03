import { Vector3 } from "../../Maths/math.vector";
import { Clamp } from "../../Maths/math.scalar.functions";
import { ToLinearSpace } from "../../Maths/math.constants";
import { Constants } from "../../Engines/constants";
import { type CubeMapInfo } from "./panoramaToCubemap";

/**
 * Describes how a cube face stored in a CubeMapInfo maps onto world-space axes.
 * Mirrors CubeMapToSphericalPolynomialTools so both diffuse paths agree on orientation.
 */
class FaceOrientation {
    constructor(
        public readonly name: string,
        public readonly worldAxisForNormal: Vector3,
        public readonly worldAxisForFileX: Vector3,
        public readonly worldAxisForFileY: Vector3
    ) {}
}

/**
 * Bakes a cosine-convolved irradiance cube map on the CPU.
 *
 * Used as a fallback on engines that cannot render the GPU irradiance prefilter (Babylon Native,
 * WebGL1). Spherical harmonics are a 3rd-order approximation and lose a large amount of energy on
 * high-contrast HDR environments; a direct convolution keeps the peaks and matches the GPU prefilter.
 */
export class CubeMapToIrradianceMapTools {
    private static _FileFaces: FaceOrientation[] = [
        new FaceOrientation("right", new Vector3(1, 0, 0), new Vector3(0, 0, -1), new Vector3(0, -1, 0)), // +X
        new FaceOrientation("left", new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, -1, 0)), // -X
        new FaceOrientation("up", new Vector3(0, 1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, 1)), // +Y
        new FaceOrientation("down", new Vector3(0, -1, 0), new Vector3(1, 0, 0), new Vector3(0, 0, -1)), // -Y
        new FaceOrientation("front", new Vector3(0, 0, 1), new Vector3(1, 0, 0), new Vector3(0, -1, 0)), // +Z
        new FaceOrientation("back", new Vector3(0, 0, -1), new Vector3(-1, 0, 0), new Vector3(0, -1, 0)), // -Z
    ];

    private static _AreaElement(x: number, y: number): number {
        return Math.atan2(x * y, Math.sqrt(x * x + y * y + 1.0));
    }

    /**
     * Converts a cube map to a cosine-convolved irradiance cube map.
     *
     * The result stores irradiance divided by PI (the same quantity the GPU prefilter writes and the
     * PBR shaders expect), so it can be uploaded directly as the material's irradiance texture.
     * @param cubeInfo The source cube map, in linear space.
     * @param outputSize Face size of the generated irradiance cube map. Irradiance is very low
     * frequency, so a small face is enough and keeps the convolution affordable.
     * @returns One Float32Array of RGB texels per face, ordered +X, -X, +Y, -Y, +Z, -Z.
     */
    public static ConvertCubeMapToIrradianceMap(cubeInfo: CubeMapInfo, outputSize = 16): Float32Array[] {
        const size = cubeInfo.size;
        const stride = cubeInfo.format === Constants.TEXTUREFORMAT_RGBA ? 4 : 3;
        const isByte = cubeInfo.type === Constants.TEXTURETYPE_UNSIGNED_BYTE;

        // Flatten the source into (direction, radiance, solid angle) triples once. Every output texel
        // integrates over all of them, so precomputing avoids repeating the per-texel trigonometry.
        const texelCount = size * size * 6;
        const dirX = new Float32Array(texelCount);
        const dirY = new Float32Array(texelCount);
        const dirZ = new Float32Array(texelCount);
        const radR = new Float32Array(texelCount);
        const radG = new Float32Array(texelCount);
        const radB = new Float32Array(texelCount);
        const solidAngle = new Float32Array(texelCount);

        const du = 2.0 / size;
        const halfTexel = 0.5 * du;
        const minUV = halfTexel - 1.0;

        let index = 0;
        for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
            const face = this._FileFaces[faceIndex];
            const dataArray = (<any>cubeInfo)[face.name];
            const nx = face.worldAxisForNormal.x;
            const ny = face.worldAxisForNormal.y;
            const nz = face.worldAxisForNormal.z;
            const xx = face.worldAxisForFileX.x;
            const xy = face.worldAxisForFileX.y;
            const xz = face.worldAxisForFileX.z;
            const yx = face.worldAxisForFileY.x;
            const yy = face.worldAxisForFileY.y;
            const yz = face.worldAxisForFileY.z;

            let v = minUV;
            for (let y = 0; y < size; y++) {
                let u = minUV;
                for (let x = 0; x < size; x++) {
                    const wx = xx * u + yx * v + nx;
                    const wy = xy * u + yy * v + ny;
                    const wz = xz * u + yz * v + nz;
                    const invLength = 1.0 / Math.sqrt(wx * wx + wy * wy + wz * wz);
                    dirX[index] = wx * invLength;
                    dirY[index] = wy * invLength;
                    dirZ[index] = wz * invLength;

                    solidAngle[index] =
                        this._AreaElement(u - halfTexel, v - halfTexel) -
                        this._AreaElement(u - halfTexel, v + halfTexel) -
                        this._AreaElement(u + halfTexel, v - halfTexel) +
                        this._AreaElement(u + halfTexel, v + halfTexel);

                    const offset = y * size * stride + x * stride;
                    let r = dataArray[offset + 0];
                    let g = dataArray[offset + 1];
                    let b = dataArray[offset + 2];

                    if (isNaN(r)) {
                        r = 0;
                    }
                    if (isNaN(g)) {
                        g = 0;
                    }
                    if (isNaN(b)) {
                        b = 0;
                    }

                    if (isByte) {
                        r /= 255;
                        g /= 255;
                        b /= 255;
                    }

                    if (cubeInfo.gammaSpace) {
                        r = Math.pow(Clamp(r), ToLinearSpace);
                        g = Math.pow(Clamp(g), ToLinearSpace);
                        b = Math.pow(Clamp(b), ToLinearSpace);
                    }

                    // No upper clamp here: unlike the spherical-harmonics path, the GPU prefilter this
                    // stands in for integrates the raw radiance. Clamping would swallow the sun peak of a
                    // high-contrast HDR and leave the baked irradiance far too dark.
                    radR[index] = Math.max(r, 0);
                    radG[index] = Math.max(g, 0);
                    radB[index] = Math.max(b, 0);

                    index++;
                    u += du;
                }
                v += du;
            }
        }

        // Convolve: for every output direction N, average the source radiance weighted by
        // max(0, dot(N, L)) * dOmega. Normalising by the same cosine weights yields E / PI.
        const outDu = 2.0 / outputSize;
        const outHalfTexel = 0.5 * outDu;
        const outMinUV = outHalfTexel - 1.0;
        const results: Float32Array[] = [];

        for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
            const face = this._FileFaces[faceIndex];
            const output = new Float32Array(outputSize * outputSize * 3);
            const nx = face.worldAxisForNormal.x;
            const ny = face.worldAxisForNormal.y;
            const nz = face.worldAxisForNormal.z;
            const xx = face.worldAxisForFileX.x;
            const xy = face.worldAxisForFileX.y;
            const xz = face.worldAxisForFileX.z;
            const yx = face.worldAxisForFileY.x;
            const yy = face.worldAxisForFileY.y;
            const yz = face.worldAxisForFileY.z;

            // Match the source-face V walk above (v from outMinUV upward). An earlier attempt walked
            // V top-down to "fix" seams for WebGL upload, but CPU irradiance is only consumed on
            // engines that cannot GPU-prefilter (Babylon Native / WebGL1), and that inverted V made
            // every face disagree with its neighbours under bgfx/Native cube sampling — diffuse IBL
            // then looked like chrome mirrors instead of soft irradiance (tests 118/119 ~34%).
            let v = outMinUV;
            for (let y = 0; y < outputSize; y++) {
                let u = outMinUV;
                for (let x = 0; x < outputSize; x++) {
                    const wx = xx * u + yx * v + nx;
                    const wy = xy * u + yy * v + ny;
                    const wz = xz * u + yz * v + nz;
                    const invLength = 1.0 / Math.sqrt(wx * wx + wy * wy + wz * wz);
                    const ndx = wx * invLength;
                    const ndy = wy * invLength;
                    const ndz = wz * invLength;

                    let sumR = 0;
                    let sumG = 0;
                    let sumB = 0;
                    let sumWeight = 0;

                    for (let i = 0; i < texelCount; i++) {
                        const cosine = ndx * dirX[i] + ndy * dirY[i] + ndz * dirZ[i];
                        if (cosine <= 0) {
                            continue;
                        }
                        const weight = cosine * solidAngle[i];
                        sumR += radR[i] * weight;
                        sumG += radG[i] * weight;
                        sumB += radB[i] * weight;
                        sumWeight += weight;
                    }

                    const offset = y * outputSize * 3 + x * 3;
                    if (sumWeight > 0) {
                        output[offset + 0] = sumR / sumWeight;
                        output[offset + 1] = sumG / sumWeight;
                        output[offset + 2] = sumB / sumWeight;
                    }

                    u += outDu;
                }
                v += outDu;
            }

            results.push(output);
        }

        return results;
    }
}
