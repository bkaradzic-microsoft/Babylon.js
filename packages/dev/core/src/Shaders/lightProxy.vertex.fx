attribute vec3 position;
flat varying highp uint vMask;

// Uniforms
#include<__decl__sceneVertex>

uniform sampler2D lightDataTexture;
uniform vec3 tileMaskResolution;

#include<clusteredLightingFunctions>

void main(void) {
    ClusteredLight light = getClusteredLight(lightDataTexture, gl_InstanceID);
    float range = light.vLightFalloff.x;

    vec4 viewPosition = view * vec4(light.vLightData.xyz, 1);
    vec4 viewPositionSq = viewPosition * viewPosition;

    // Squared distance for both XZ and YZ
    vec2 distSq = viewPositionSq.xy + viewPositionSq.z;
    // Compute the horizontal and vertical angles to rotate by to get the sphere horizon positions
    vec2 sinSq = (range * range) / distSq;
    // Rotation is multiplied by cos (cos^2 and sin*cos) to scale down the vector after rotation
    vec2 cosSq = max(1.0 - sinSq, 0.01);
    // Flip the sin values (reversing rotation) if the position is negative
    vec2 sinCos = position.xy * sqrt(sinSq * cosSq);

    // Apply rotation
#ifdef RIGHT_HANDED
    vec2 rotatedX = mat2(cosSq.x, sinCos.x, -sinCos.x, cosSq.x) * viewPosition.xz;
    vec2 rotatedY = mat2(cosSq.y, sinCos.y, -sinCos.y, cosSq.y) * viewPosition.yz;
#else
    vec2 rotatedX = mat2(cosSq.x, -sinCos.x, sinCos.x, cosSq.x) * viewPosition.xz;
    vec2 rotatedY = mat2(cosSq.y, -sinCos.y, sinCos.y, cosSq.y) * viewPosition.yz;
#endif
    // Apply projection
    vec4 projX = projection * vec4(rotatedX.x, 0, rotatedX.y, 1);
    vec4 projY = projection * vec4(0, rotatedY.x, rotatedY.y, 1);
    // We really do be `max(..., 0.01)` all through this to get rid of them pesky zeros
    vec2 projPosition = vec2(projX.x / max(projX.w, 0.01), projY.y / max(projY.w, 0.01));
    // Override with screen extents if rotation invalid (occurs when inside the sphere).
#ifdef PROXY_FULL_QUAD
    // On Babylon Native the manual sphere-horizon projection above collapses the proxy's
    // vertical extent to a central strip, so most per-light tile coverage is lost and
    // clustered lighting under-renders. Until the projection-convention difference is
    // resolved, cover the whole batch band for every proxy on Native: the reader's
    // per-light distance falloff attenuates any lights that a tighter proxy would have
    // culled, so the result is correct (it only forgoes the tile-culling perf
    // optimisation). WebGL/WebGPU keep the optimised path below.
    projPosition = position.xy;
#else
    // Use float weights instead of the bvec mix overload, which can miscompile on Native.
    vec2 insideSelect = vec2(greaterThan(cosSq, vec2(0.01)));
    projPosition = mix(position.xy, projPosition, insideSelect);
#endif

    // Convert to NDC 0->1 space and scale to the tile resolution
    vec2 halfTileRes = tileMaskResolution.xy / 2.0;
    vec2 tilePosition = (projPosition + 1.0) * halfTileRes;
    // Round to a whole tile boundary with a bit of wiggle room
    vec2 roundSelect = vec2(greaterThan(position.xy, vec2(0)));
    tilePosition = mix(floor(tilePosition) - 0.01, ceil(tilePosition) + 0.01, roundSelect);
    // Clamp within the batch band so the wiggle room can't spill into an adjacent
    // band. This replaces a fragment discard on gl_FragCoord.y, which is unreliable
    // because gl_FragCoord.y is Y-flipped when rendering to a texture on Native.
    tilePosition.y = clamp(tilePosition.y, 0.0, tileMaskResolution.y);
    // Reposition vertically based on current batch
    float offset = float(gl_InstanceID / CLUSTLIGHT_BATCH) * tileMaskResolution.y;
    tilePosition.y = (tilePosition.y + offset) / tileMaskResolution.z;

    // We don't care about depth and don't want it to be clipped so set Z to 0
    gl_Position = vec4(tilePosition / halfTileRes - 1.0, 0, 1);
    vMask = 1u << (gl_InstanceID % CLUSTLIGHT_BATCH);
}
