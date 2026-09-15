fn sampleIcdf(icdf: texture_2d<f32>, uv: vec2f) -> vec4f {
    let size = vec2i(textureDimensions(icdf, 0));
    let coordinate = clamp(vec2i(floor(uv * vec2f(size))), vec2i(0), size - vec2i(1));
    return textureLoad(icdf, coordinate, 0);
}
