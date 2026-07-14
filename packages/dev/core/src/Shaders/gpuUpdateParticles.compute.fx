#version 310 es
precision highp float;
precision highp int;
struct Particle {
vec3 position; float age;
vec3 size; float life;
vec4 seed;
vec3 direction; float dummy0;
#ifdef CUSTOMEMITTER
vec3 initialPosition; float dummy1;
#endif
#ifndef COLORGRADIENTS
vec4 color;
#endif
#ifndef BILLBOARD
vec3 initialDirection; float dummy2;
#endif
#ifdef NOISE
vec3 noiseCoordinates1; float dummy3;
vec3 noiseCoordinates2; float dummy4;
#endif
#ifdef ANGULARSPEEDGRADIENTS
float angle;
#else
vec2 angle;
#endif
#ifdef ANIMATESHEET
float cellIndex;
#ifdef ANIMATESHEETRANDOMSTART
float cellStartOffset;
#endif
#endif
};
layout(std140, binding = 0) readonly buffer SimParamsBuffer {
float currentCount;
float timeDelta;
float stopFactor;
int randomTextureSize;
vec2 lifeTime;
vec2 emitPower;
float emitIndex;
float emitCount;
#ifndef COLORGRADIENTS
vec4 color1;
vec4 color2;
#endif
vec2 sizeRange;
vec4 scaleRange;
vec4 angleRange;
vec3 gravity;
#ifdef LIMITVELOCITYGRADIENTS
float limitVelocityDamping;
#endif
#ifdef ANIMATESHEET
vec4 cellInfos;
#endif
#ifdef NOISE
vec3 noiseStrength;
#endif
#ifdef FLOWMAP
mat4 flowMapProjection;
float flowMapStrength;
#endif
#ifndef LOCAL
mat4 emitterWM;
#endif
#ifdef ATTRACTORS
int attractorCount;
vec4 attractorPositionAndStrength[MAX_ATTRACTORS];
#endif
#ifdef STARTSIZEGRADIENTS
float startSizeGradientFactor;
#endif
#ifdef LIFETIMEGRADIENTS
vec2 lifeTimeGradientRange;
#endif
#ifdef MESHEMITTER
int meshTriangleCount;
int meshTextureWidth;
vec3 direction1;
vec3 direction2;
#endif
#ifdef BOXEMITTER
vec3 direction1;
vec3 direction2;
vec3 minEmitBox;
vec3 maxEmitBox;
#endif
#ifdef CONEEMITTER
vec2 radius;
float coneAngle;
vec2 height;
#ifdef DIRECTEDCONEEMITTER
vec3 direction1;
vec3 direction2;
#else
float directionRandomizer;
#endif
#endif
#ifdef CYLINDEREMITTER
float radius;
float height;
float radiusRange;
#ifdef DIRECTEDCYLINDEREMITTER
vec3 direction1;
vec3 direction2;
#else
float directionRandomizer;
#endif
#endif
#ifdef HEMISPHERICEMITTER
float radius;
float radiusRange;
float directionRandomizer;
#endif
#ifdef POINTEMITTER
vec3 direction1;
vec3 direction2;
#endif
#ifdef SPHEREEMITTER
float radius;
float radiusRange;
#ifdef DIRECTEDSPHEREEMITTER
vec3 direction1;
vec3 direction2;
#else
float directionRandomizer;
#endif
#endif
} params;
layout(std430, binding = 1) readonly buffer ParticlesInBuffer { Particle particles[]; } particlesIn;
layout(std430, binding = 2) buffer ParticlesOutBuffer { Particle particles[]; } particlesOut;
layout(binding = 3) uniform highp sampler2D randomTexture;
layout(binding = 4) uniform highp sampler2D randomTexture2;
#ifdef SIZEGRADIENTS
layout(binding = 17) uniform highp sampler2D sizeGradientTexture;
#endif
#ifdef ANGULARSPEEDGRADIENTS
layout(binding = 19) uniform highp sampler2D angularSpeedGradientTexture;
#endif
#ifdef VELOCITYGRADIENTS
layout(binding = 21) uniform highp sampler2D velocityGradientTexture;
#endif
#ifdef LIMITVELOCITYGRADIENTS
layout(binding = 23) uniform highp sampler2D limitVelocityGradientTexture;
#endif
#ifdef DRAGGRADIENTS
layout(binding = 25) uniform highp sampler2D dragGradientTexture;
#endif
#ifdef NOISE
layout(binding = 27) uniform highp sampler2D noiseTexture;
#endif
#ifdef FLOWMAP
layout(binding = 29) uniform highp sampler2D flowMapTexture;
#endif
#ifdef MESHEMITTER
layout(binding = 30) uniform highp sampler2D meshPositionTexture;
#ifdef MESHNORMALS
layout(binding = 31) uniform highp sampler2D meshNormalTexture;
#endif
#endif
vec3 getRandomVec3(float offset, float vertexID) {
return texelFetch(randomTexture2, ivec2(int(vertexID * offset / params.currentCount * float(params.randomTextureSize)) % params.randomTextureSize, 0), 0).rgb;
}
vec4 getRandomVec4(float offset, float vertexID) {
return texelFetch(randomTexture, ivec2(int(vertexID * offset / params.currentCount * float(params.randomTextureSize)) % params.randomTextureSize, 0), 0);
}
layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;
void main() {
uint index = gl_GlobalInvocationID.x;
float vertexID = float(index);
if (index >= uint(params.currentCount)) { return; }
float PI = 3.14159;
float timeDelta = params.timeDelta;
float newAge = particlesIn.particles[index].age + timeDelta;
float life = particlesIn.particles[index].life;
vec4 seed = particlesIn.particles[index].seed;
vec3 direction = particlesIn.particles[index].direction;
#ifdef EMITRATECTRL
float offsetFromEmitIndex = vertexID - params.emitIndex;
if (offsetFromEmitIndex < 0.0) { offsetFromEmitIndex += params.currentCount; }
bool shouldEmit = offsetFromEmitIndex < params.emitCount && params.stopFactor != 0.;
#else
bool shouldEmit = newAge >= life && params.stopFactor != 0.;
#endif
if (shouldEmit) {
vec3 newPosition;
vec3 newDirection;
vec4 randoms = getRandomVec4(seed.x, vertexID);
float outLife = params.lifeTime.x + (params.lifeTime.y - params.lifeTime.x) * randoms.r;
#ifdef LIFETIMEGRADIENTS
particlesOut.particles[index].life = params.lifeTimeGradientRange.x + (params.lifeTimeGradientRange.y - params.lifeTimeGradientRange.x) * randoms.r;
#else
particlesOut.particles[index].life = outLife;
#endif
#ifdef EMITRATECTRL
particlesOut.particles[index].age = 0.0;
#else
particlesOut.particles[index].age = newAge - life;
#endif
particlesOut.particles[index].seed = seed;
float sizex;
#ifdef SIZEGRADIENTS
vec2 sizeGradientRange = textureLod(sizeGradientTexture, vec2(0., 0.), 0.).rg;
sizex = sizeGradientRange.x + (sizeGradientRange.y - sizeGradientRange.x) * seed.y;
#else
sizex = params.sizeRange.x + (params.sizeRange.y - params.sizeRange.x) * randoms.g;
#endif
#ifdef STARTSIZEGRADIENTS
sizex *= params.startSizeGradientFactor;
#endif
particlesOut.particles[index].size = vec3(
sizex,
params.scaleRange.x + (params.scaleRange.y - params.scaleRange.x) * randoms.b,
params.scaleRange.z + (params.scaleRange.w - params.scaleRange.z) * randoms.a);
#ifndef COLORGRADIENTS
particlesOut.particles[index].color = params.color1 + (params.color2 - params.color1) * randoms.b;
#endif
#ifndef ANGULARSPEEDGRADIENTS
particlesOut.particles[index].angle = vec2(
params.angleRange.z + (params.angleRange.w - params.angleRange.z) * randoms.r,
params.angleRange.x + (params.angleRange.y - params.angleRange.x) * randoms.a);
#else
particlesOut.particles[index].angle = params.angleRange.z + (params.angleRange.w - params.angleRange.z) * randoms.r;
#endif
#if defined(POINTEMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
newPosition = vec3(0., 0., 0.);
newDirection = params.direction1 + (params.direction2 - params.direction1) * randoms3;
#elif defined(BOXEMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
newPosition = params.minEmitBox + (params.maxEmitBox - params.minEmitBox) * randoms2;
newDirection = params.direction1 + (params.direction2 - params.direction1) * randoms3;
#elif defined(HEMISPHERICEMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
float phi = 2.0 * PI * randoms2.x;
float theta = acos(-1.0 + 2.0 * randoms2.y);
float randX = cos(phi) * sin(theta);
float randY = cos(theta);
float randZ = sin(phi) * sin(theta);
newPosition = (params.radius - (params.radius * params.radiusRange * randoms2.z)) * vec3(randX, abs(randY), randZ);
newDirection = normalize(newPosition + params.directionRandomizer * randoms3);
#elif defined(SPHEREEMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
float phi = 2.0 * PI * randoms2.x;
float theta = acos(-1.0 + 2.0 * randoms2.y);
float randX = cos(phi) * sin(theta);
float randY = cos(theta);
float randZ = sin(phi) * sin(theta);
newPosition = (params.radius - (params.radius * params.radiusRange * randoms2.z)) * vec3(randX, randY, randZ);
#ifdef DIRECTEDSPHEREEMITTER
newDirection = params.direction1 + (params.direction2 - params.direction1) * randoms3;
#else
newDirection = normalize(newPosition + params.directionRandomizer * randoms3);
#endif
#elif defined(CYLINDEREMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
float yPos = (-0.5 + randoms2.x) * params.height;
float angle = randoms2.y * PI * 2.;
float inverseRadiusRangeSquared = (1. - params.radiusRange) * (1. - params.radiusRange);
float positionRadius = params.radius * sqrt(inverseRadiusRangeSquared + randoms2.z * (1. - inverseRadiusRangeSquared));
float xPos = positionRadius * cos(angle);
float zPos = positionRadius * sin(angle);
newPosition = vec3(xPos, yPos, zPos);
#ifdef DIRECTEDCYLINDEREMITTER
newDirection = params.direction1 + (params.direction2 - params.direction1) * randoms3;
#else
angle = angle + (-0.5 + randoms3.x) * PI * params.directionRandomizer;
newDirection = vec3(cos(angle), (-0.5 + randoms3.y) * params.directionRandomizer, sin(angle));
newDirection = normalize(newDirection);
#endif
#elif defined(CONEEMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
float s = 2.0 * PI * randoms2.x;
#ifdef CONEEMITTERSPAWNPOINT
float h = 0.0001;
#else
float h = randoms2.y * params.height.y;
h = 1. - h * h;
#endif
float lRadius = params.radius.x - params.radius.x * randoms2.z * params.radius.y;
lRadius = lRadius * h;
float randX = lRadius * sin(s);
float randZ = lRadius * cos(s);
float randY = h * params.height.x;
newPosition = vec3(randX, randY, randZ);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
#ifdef DIRECTEDCONEEMITTER
newDirection = params.direction1 + (params.direction2 - params.direction1) * randoms3;
#else
if (abs(cos(params.coneAngle)) == 1.0) { newDirection = vec3(0., 1.0, 0.); } else { newDirection = normalize(newPosition + params.directionRandomizer * randoms3); }
#endif
#elif defined(MESHEMITTER)
vec3 randoms2 = getRandomVec3(seed.y, vertexID);
vec3 randoms3 = getRandomVec3(seed.z, vertexID);
int triIdx = int(floor(randoms2.x * float(params.meshTriangleCount)));
triIdx = min(triIdx, params.meshTriangleCount - 1);
int baseTexel = triIdx * 3;
int t0 = baseTexel;
int t1 = baseTexel + 1;
int t2 = baseTexel + 2;
vec3 v0 = texelFetch(meshPositionTexture, ivec2(t0 % params.meshTextureWidth, t0 / params.meshTextureWidth), 0).xyz;
vec3 v1 = texelFetch(meshPositionTexture, ivec2(t1 % params.meshTextureWidth, t1 / params.meshTextureWidth), 0).xyz;
vec3 v2 = texelFetch(meshPositionTexture, ivec2(t2 % params.meshTextureWidth, t2 / params.meshTextureWidth), 0).xyz;
float bu = randoms2.y;
float bv = randoms2.z * (1.0 - bu);
float bw = 1.0 - bu - bv;
newPosition = bu * v0 + bv * v1 + bw * v2;
#ifdef MESHNORMALS
vec3 n0 = texelFetch(meshNormalTexture, ivec2(t0 % params.meshTextureWidth, t0 / params.meshTextureWidth), 0).xyz;
vec3 n1 = texelFetch(meshNormalTexture, ivec2(t1 % params.meshTextureWidth, t1 / params.meshTextureWidth), 0).xyz;
vec3 n2 = texelFetch(meshNormalTexture, ivec2(t2 % params.meshTextureWidth, t2 / params.meshTextureWidth), 0).xyz;
newDirection = normalize(bu * n0 + bv * n1 + bw * n2);
#else
newDirection = params.direction1 + (params.direction2 - params.direction1) * randoms3;
#endif
#elif defined(CUSTOMEMITTER)
newPosition = particlesIn.particles[index].initialPosition;
particlesOut.particles[index].initialPosition = newPosition;
#else
newPosition = vec3(0., 0., 0.);
newDirection = 2.0 * (getRandomVec3(seed.w, vertexID) - vec3(0.5, 0.5, 0.5));
#endif
float power = params.emitPower.x + (params.emitPower.y - params.emitPower.x) * randoms.a;
#ifdef LOCAL
particlesOut.particles[index].position = newPosition;
#else
particlesOut.particles[index].position = (params.emitterWM * vec4(newPosition, 1.)).xyz;
#endif
#ifdef CUSTOMEMITTER
particlesOut.particles[index].direction = direction;
#ifndef BILLBOARD
particlesOut.particles[index].initialDirection = direction;
#endif
#else
#ifdef LOCAL
vec3 initial = newDirection;
#else
vec3 initial = (params.emitterWM * vec4(newDirection, 0.)).xyz;
#endif
particlesOut.particles[index].direction = initial * power;
#ifndef BILLBOARD
particlesOut.particles[index].initialDirection = initial;
#endif
#endif
#ifdef ANIMATESHEET
particlesOut.particles[index].cellIndex = params.cellInfos.x;
#ifdef ANIMATESHEETRANDOMSTART
particlesOut.particles[index].cellStartOffset = randoms.a * outLife;
#endif
#endif
#ifdef NOISE
particlesOut.particles[index].noiseCoordinates1 = particlesIn.particles[index].noiseCoordinates1;
particlesOut.particles[index].noiseCoordinates2 = particlesIn.particles[index].noiseCoordinates2;
#endif
} else {
float directionScale = timeDelta;
particlesOut.particles[index].age = newAge;
float ageGradient = newAge / life;
#ifdef VELOCITYGRADIENTS
vec2 velocityGradientRange = textureLod(velocityGradientTexture, vec2(ageGradient, 0.), 0.).rg;
directionScale = directionScale * (velocityGradientRange.x + (velocityGradientRange.y - velocityGradientRange.x) * seed.w);
#endif
#ifdef DRAGGRADIENTS
vec2 dragGradientRange = textureLod(dragGradientTexture, vec2(ageGradient, 0.), 0.).rg;
directionScale = directionScale * (1.0 - (dragGradientRange.x + (dragGradientRange.y - dragGradientRange.x) * seed.x));
#endif
vec3 position = particlesIn.particles[index].position;
#if defined(CUSTOMEMITTER)
particlesOut.particles[index].position = position + (direction - position) * ageGradient;
particlesOut.particles[index].initialPosition = particlesIn.particles[index].initialPosition;
#else
particlesOut.particles[index].position = position + direction * directionScale;
#endif
particlesOut.particles[index].life = life;
particlesOut.particles[index].seed = seed;
#ifndef COLORGRADIENTS
particlesOut.particles[index].color = particlesIn.particles[index].color;
#endif
#ifdef SIZEGRADIENTS
vec2 sizeGradientRange = textureLod(sizeGradientTexture, vec2(ageGradient, 0.), 0.).rg;
particlesOut.particles[index].size = vec3(
sizeGradientRange.x + (sizeGradientRange.y - sizeGradientRange.x) * seed.y,
particlesIn.particles[index].size.yz);
#else
particlesOut.particles[index].size = particlesIn.particles[index].size;
#endif
#ifndef BILLBOARD
particlesOut.particles[index].initialDirection = particlesIn.particles[index].initialDirection;
#endif
#ifdef CUSTOMEMITTER
particlesOut.particles[index].direction = direction;
#else
vec3 updatedDirection = direction + params.gravity * timeDelta;
#ifdef FLOWMAP
vec4 clipSpace = (params.flowMapProjection * vec4(position, 1.));
vec3 ndcSpace = clipSpace.xyz / clipSpace.w;
vec2 flowMapUV = ndcSpace.xy * 0.5 + 0.5;
vec4 flowMapValue = textureLod(flowMapTexture, flowMapUV, 0.);
vec3 flowMapDirection = (flowMapValue.xyz * 2.0 - 1.0) * flowMapValue.w;
updatedDirection += flowMapDirection * timeDelta * params.flowMapStrength;
#endif
#ifdef LIMITVELOCITYGRADIENTS
vec2 limitVelocityRange = textureLod(limitVelocityGradientTexture, vec2(ageGradient, 0.), 0.).rg;
float limitVelocity = limitVelocityRange.x + (limitVelocityRange.y - limitVelocityRange.x) * seed.y;
float currentVelocity = length(updatedDirection);
if (currentVelocity > limitVelocity) { updatedDirection = updatedDirection * params.limitVelocityDamping; }
#endif
#ifdef ATTRACTORS
{ for (int i = 0; i < params.attractorCount; i = i + 1) { vec3 toAttractor = params.attractorPositionAndStrength[i].xyz - position; float distSq = dot(toAttractor, toAttractor) + 1.0; updatedDirection = updatedDirection + (params.attractorPositionAndStrength[i].w / distSq) * normalize(toAttractor) * timeDelta; } }
#endif
particlesOut.particles[index].direction = updatedDirection;
#ifdef NOISE
vec3 noiseCoordinates1 = particlesIn.particles[index].noiseCoordinates1;
vec3 noiseCoordinates2 = particlesIn.particles[index].noiseCoordinates2;
float fetchedR = textureLod(noiseTexture, vec2(noiseCoordinates1.x, noiseCoordinates1.y) * vec2(0.5, 0.5) + vec2(0.5, 0.5), 0.).r;
float fetchedG = textureLod(noiseTexture, vec2(noiseCoordinates1.z, noiseCoordinates2.x) * vec2(0.5, 0.5) + vec2(0.5, 0.5), 0.).r;
float fetchedB = textureLod(noiseTexture, vec2(noiseCoordinates2.y, noiseCoordinates2.z) * vec2(0.5, 0.5) + vec2(0.5, 0.5), 0.).r;
vec3 force = vec3(-1. + 2. * fetchedR, -1. + 2. * fetchedG, -1. + 2. * fetchedB) * params.noiseStrength;
particlesOut.particles[index].direction = particlesOut.particles[index].direction + force * timeDelta;
particlesOut.particles[index].noiseCoordinates1 = noiseCoordinates1;
particlesOut.particles[index].noiseCoordinates2 = noiseCoordinates2;
#endif
#endif
#ifdef ANGULARSPEEDGRADIENTS
vec2 angularSpeedRange = textureLod(angularSpeedGradientTexture, vec2(ageGradient, 0.), 0.).rg;
float angularSpeed = angularSpeedRange.x + (angularSpeedRange.y - angularSpeedRange.x) * seed.z;
particlesOut.particles[index].angle = particlesIn.particles[index].angle + angularSpeed * timeDelta;
#else
vec2 angle = particlesIn.particles[index].angle;
particlesOut.particles[index].angle = vec2(angle.x + angle.y * timeDelta, angle.y);
#endif
#ifdef ANIMATESHEET
float offsetAge = particlesOut.particles[index].age;
float dist = params.cellInfos.y - params.cellInfos.x;
#ifdef ANIMATESHEETRANDOMSTART
float cellStartOffset = particlesIn.particles[index].cellStartOffset;
particlesOut.particles[index].cellStartOffset = cellStartOffset;
offsetAge = offsetAge + cellStartOffset;
#else
float cellStartOffset = 0.;
#endif
float ratio;
if (params.cellInfos.w == 1.0) { ratio = clamp(mod(cellStartOffset + params.cellInfos.z * offsetAge, life) / life, 0., 1.0); }
else { ratio = clamp((cellStartOffset + params.cellInfos.z * offsetAge) / life, 0., 1.0); }
particlesOut.particles[index].cellIndex = float(int(params.cellInfos.x + ratio * dist));
#endif
}
}
