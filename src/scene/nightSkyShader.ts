/**
 * Night sky: procedural stars + nebula.
 * Base gradient always gives visible sky; stars/nebula add on top.
 */

export const nightSkyVertexShader = /* glsl */ `
varying vec3 vWorldPosition;

void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const nightSkyFragmentShader = /* glsl */ `
precision highp float;

uniform vec3 uCameraPosition;
uniform float uTime;
uniform float uStarExponent;
uniform float uStarMult;
uniform float uStarCull;
uniform float uNebulaBlue;
uniform float uNebulaPurple;
uniform vec3 uNightGroundTint;
uniform float uNightGroundStr;

varying vec3 vWorldPosition;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float hash2(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  vec3 shift = vec3(100.0);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 direction = normalize(vWorldPosition - uCameraPosition);

  float zenith = clamp(direction.y * 0.55 + 0.48, 0.0, 1.0);
  vec3 skyBase = mix(vec3(0.02, 0.03, 0.09), vec3(0.12, 0.2, 0.45), zenith);

  float cr = cos(0.61);
  float sr = sin(0.61);
  vec3 d = vec3(
    cr * direction.x + sr * direction.z,
    direction.y,
    -sr * direction.x + cr * direction.z
  );

  vec3 q = vec3(
    d.x * 719.3 + sin(d.y * 4.2) * 0.08,
    d.y * 683.1 + cos(d.z * 3.7) * 0.08,
    d.z * 701.7 + sin(d.x * 2.9) * 0.08
  );
  vec3 starCell = floor(q);
  float starGrain = hash(starCell);
  float cull = hash2(starCell + vec3(31.7, 12.3, 44.1));
  float stars = 0.0;
  if (cull >= uStarCull) {
    stars = pow(starGrain, uStarExponent) * uStarMult;
    stars *= 0.9 + 0.1 * sin(uTime * 1.5 + starGrain * 20.0);
  }

  vec3 nebulaPos = direction * 3.0 + uTime * 0.005;
  float n = fbm(nebulaPos);

  vec3 term1 = vec3(0.02, 0.08, 0.32) * fbm(nebulaPos * 1.2 + vec3(1.7, 2.3, 0.4)) * uNebulaBlue;
  vec3 term2 = vec3(0.04, 0.12, 0.38) * fbm(nebulaPos * 1.8 + vec3(4.1, 0.2, 3.3)) * uNebulaBlue;
  vec3 term3 = vec3(0.16, 0.04, 0.38) * fbm(nebulaPos * 2.4 + vec3(0.5, 5.0, 1.1)) * uNebulaPurple;
  vec3 term4 = vec3(0.1, 0.02, 0.22) * fbm(nebulaPos * 3.1 + vec3(2.2, 1.1, 4.4)) * uNebulaPurple;

  vec3 finalNebula = (term1 + term2 + term3 + term4) * n * 0.58;

  vec3 shimmer = fbm(nebulaPos * 0.8 + vec3(uTime * 0.02, uTime * 0.015, uTime * 0.018))
    * (uNebulaBlue + uNebulaPurple) * 0.5 * 0.12;
  finalNebula += shimmer;

  vec3 nightColor = skyBase + finalNebula * 3.5 + vec3(stars);

  float nearGround = smoothstep(-0.15, 0.35, direction.y);
  nightColor += uNightGroundTint * uNightGroundStr * (1.0 - nearGround);

  gl_FragColor = vec4(clamp(nightColor, 0.0, 1.0), 1.0);
}
`;
