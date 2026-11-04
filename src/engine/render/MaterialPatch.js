import * as THREE from 'three';

/**
 * Engine-wide shader uniforms shared by every patched material.
 * Updating a value here updates every sprite, tree and tile at once.
 */
export const globalUniforms = {
  uTime: { value: 0 },
  uCamYaw: { value: 0 },
  uWindStrength: { value: 1 },
  uCloudStrength: { value: 0.3 },
  uCloudScale: { value: 0.05 },
  uCloudSpeed: { value: new THREE.Vector2(0.7, 0.25) },
  uPointScale: { value: 800 },
  // occlusion cutout: a dithered see-through window around the player
  uResolution: { value: new THREE.Vector2(1, 1) },
  uCutCenter: { value: new THREE.Vector2(0.5, 0.5) },
  uCutRadius: { value: 0.13 },
  uCutDist: { value: 0 },
  uCutY: { value: 0 },
  uCutStrength: { value: 0 },
};

const VERT_PARS = /* glsl */ `
uniform float uTime;
uniform float uCamYaw;
uniform float uWindStrength;
#ifdef HD_FLIP
attribute float aFlip;
#endif
#ifdef HD_WORLDPOS
varying vec3 vHdWorld;
#endif
vec2 hdOrigin() {
  #ifdef USE_INSTANCING
    return (modelMatrix * instanceMatrix[3]).xz;
  #else
    return modelMatrix[3].xz;
  #endif
}
vec3 hdBillboard(vec3 p) {
  float c = cos(uCamYaw), s = sin(uCamYaw);
  return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z);
}
`;

const WIND = /* glsl */ `
  {
    vec2 o = hdOrigin();
    float ph = dot(o, vec2(0.37, 0.71));
    float hgt = clamp(transformed.y / HD_WIND_HEIGHT, 0.0, 1.0);
    float gust = 0.6 + 0.4 * sin(uTime * 0.31 + o.x * 0.05);
    float sway = sin(uTime * 1.6 + ph) * 0.65 + sin(uTime * 2.7 + ph * 1.7) * 0.35;
    transformed.x += sway * gust * HD_WIND * uWindStrength * hgt * hgt;
  }
`;

const FRAG_PARS = /* glsl */ `
uniform float uTime;
varying vec3 vHdWorld;
#ifdef HD_CLOUDS
uniform float uCloudStrength;
uniform float uCloudScale;
uniform vec2 uCloudSpeed;
float hdHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float hdNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hdHash(i), hdHash(i + vec2(1, 0)), f.x), mix(hdHash(i + vec2(0, 1)), hdHash(i + vec2(1, 1)), f.x), f.y);
}
float hdCloudShadow() {
  vec2 p = vHdWorld.xz * uCloudScale + uCloudSpeed * uTime * uCloudScale;
  float n = hdNoise(p) * 0.55 + hdNoise(p * 2.1 + 3.7) * 0.3 + hdNoise(p * 4.3 + 1.3) * 0.15;
  return smoothstep(0.48, 0.66, n) * uCloudStrength;
}
#endif
#ifdef HD_CUTOUT
uniform vec2 uResolution;
uniform vec2 uCutCenter;
uniform float uCutRadius;
uniform float uCutDist;
uniform float uCutY;
uniform float uCutStrength;
const float HD_BAYER[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
void hdCutout() {
  if (uCutStrength <= 0.0) return;
  if (distance(cameraPosition, vHdWorld) > uCutDist - 1.2 || vHdWorld.y < uCutY + 0.45) return;
  vec2 sp = gl_FragCoord.xy / uResolution;
  vec2 d = (sp - uCutCenter) * vec2(uResolution.x / uResolution.y, 1.0);
  float fade = (1.0 - smoothstep(0.45, 1.0, length(d) / uCutRadius)) * uCutStrength * 0.9;
  ivec2 b = ivec2(mod(gl_FragCoord.xy, 4.0));
  if (fade > (HD_BAYER[b.y * 4 + b.x] + 0.5) / 16.0) discard;
}
#endif
`;

/**
 * Injection points (three.js shader chunks) that could not be found. If a
 * three.js upgrade renames a chunk, the matching feature would silently
 * vanish; instead it is recorded here and reported once in the console.
 * tests/unit/materialPatch.test.js fails when this is not empty.
 */
export const missingInjections = new Set();

function inject(src, target, replacement, label) {
  if (!src.includes(target)) {
    const key = `${label}: ${target}`;
    if (!missingInjections.has(key)) {
      missingInjections.add(key);
      console.warn(`[hd2d] shader injection point missing (${key}); this three.js version may be incompatible.`);
    }
    return src;
  }
  return src.replace(target, replacement);
}

/**
 * Inject engine features into a built-in three.js material:
 *  - billboard: rotate the quad around Y to face the camera (yaw only),
 *               so sprites stay upright like HD-2D characters.
 *  - wind:      sway amplitude in world units (0 disables), stronger at the top.
 *  - clouds:    drifting cloud shadows modulating direct light.
 *  - cutout:    dithered see-through hole where geometry hides the player.
 *  - flip:      per-instance horizontal UV flip via an `aFlip` attribute.
 */
export function patchMaterial(material, { billboard = false, wind = 0, windHeight = 1, clouds = false, cutout = false, flip = false } = {}) {
  const isDepth = material.isMeshDepthMaterial || material.isMeshDistanceMaterial;
  const useClouds = clouds && !isDepth;
  const useCutout = cutout && !isDepth;
  const needWorld = useClouds || useCutout;
  const key = `hd2d|${billboard}|${wind}|${windHeight}|${useClouds}|${useCutout}|${flip}`;
  material.onBeforeCompile = (shader) => {
    for (const k of ['uTime', 'uCamYaw', 'uWindStrength']) shader.uniforms[k] = globalUniforms[k];
    let defs = '';
    if (wind > 0) defs += `#define HD_WIND ${wind.toFixed(4)}\n#define HD_WIND_HEIGHT ${windHeight.toFixed(4)}\n`;
    if (useClouds) defs += '#define HD_CLOUDS\n';
    if (useCutout) defs += '#define HD_CUTOUT\n';
    if (needWorld) defs += '#define HD_WORLDPOS\n';
    if (flip) defs += '#define HD_FLIP\n';
    const kind = material.type;
    let vs = inject(shader.vertexShader, '#include <common>', `#include <common>\n${defs}${VERT_PARS}`, `${kind} vertex`);
    if (billboard && vs.includes('#include <beginnormal_vertex>')) {
      vs = inject(vs, '#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = hdBillboard(objectNormal);', `${kind} vertex`);
    }
    let begin = '#include <begin_vertex>\n';
    if (wind > 0) begin += WIND;
    if (billboard) begin += 'transformed = hdBillboard(transformed);\n';
    vs = inject(vs, '#include <begin_vertex>', begin, `${kind} vertex`);
    if (flip) {
      vs = inject(vs, '#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\nif (aFlip > 0.5) vMapUv.x = 1.0 - vMapUv.x;\n#endif', `${kind} vertex`);
    }
    if (needWorld) {
      vs = inject(
        vs,
        '#include <project_vertex>',
        `#include <project_vertex>
        #ifdef USE_INSTANCING
          vHdWorld = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
        #else
          vHdWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #endif`,
        `${kind} vertex`,
      );
      for (const k of ['uCloudStrength', 'uCloudScale', 'uCloudSpeed', 'uResolution', 'uCutCenter', 'uCutRadius', 'uCutDist', 'uCutY', 'uCutStrength']) {
        shader.uniforms[k] = globalUniforms[k];
      }
      let fs = inject(shader.fragmentShader, '#include <common>', `#include <common>\n${defs}${FRAG_PARS}`, `${kind} fragment`);
      if (useCutout) fs = inject(fs, '#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nhdCutout();', `${kind} fragment`);
      if (useClouds) {
        fs = inject(
          fs,
          '#include <lights_fragment_end>',
          '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= 1.0 - hdCloudShadow();',
          `${kind} fragment`,
        );
      }
      shader.fragmentShader = fs;
    }
    shader.vertexShader = vs;
  };
  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}

/** Shadow-pass materials that mirror the billboard/wind deformation. */
export function makeShadowMaterials(opts) {
  const depth = new THREE.MeshDepthMaterial();
  const distance = new THREE.MeshDistanceMaterial();
  patchMaterial(depth, { ...opts, clouds: false, cutout: false });
  patchMaterial(distance, { ...opts, clouds: false, cutout: false });
  return { depth, distance };
}
