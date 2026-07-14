/**
 * Re-exports pure implementation and applies runtime side effects.
 * Import computeShaderParticleSystem.pure for tree-shakeable, side-effect-free usage.
 */
export * from "./computeShaderParticleSystem.pure";

import "../ShadersWGSL/gpuUpdateParticles.compute";
import "../Shaders/gpuUpdateParticles.compute";

import { RegisterComputeShaderParticleSystem } from "./computeShaderParticleSystem.pure";
RegisterComputeShaderParticleSystem();
