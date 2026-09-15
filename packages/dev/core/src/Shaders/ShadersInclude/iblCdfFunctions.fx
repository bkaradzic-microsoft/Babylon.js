vec4 sampleIcdf(sampler2D icdf, vec2 uv) {
    // Explicit bins preserve nearest-sampling ties when the backend reflects texture coordinates.
    ivec2 size = textureSize(icdf, 0);
    ivec2 coordinate = clamp(ivec2(floor(uv * vec2(size))), ivec2(0), size - ivec2(1));
    return texelFetch(icdf, coordinate, 0);
}
