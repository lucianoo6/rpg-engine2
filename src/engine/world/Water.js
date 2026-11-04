import * as THREE from 'three';
import { globalUniforms } from '../render/MaterialPatch.js';

/**
 * Stylised pixel water.
 *  - Shading is snapped to the 16 texel/unit grid so it reads as pixel art.
 *  - A baked shore-distance field drives shallow colour and animated foam.
 *  - Sun glints are HDR, so the bloom pass makes them twinkle.
 *  - Nearby lamps leave shimmering reflection streaks at night.
 */

const MAX_LIGHTS = 8;

function bakeShoreField(map, x0, z0, x1, z1, level, res = 4, maxDist = 3) {
  const w = (x1 - x0) * res;
  const h = (z1 - z0) * res;
  const data = new Uint8Array(w * h);
  const land = (i, j) => !map.inBounds(i, j) || map.h(i, j) > level;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + (x + 0.5) / res;
      const pz = z0 + (y + 0.5) / res;
      let best = maxDist;
      const ci = Math.floor(px), cj = Math.floor(pz);
      for (let j = cj - maxDist; j <= cj + maxDist; j++) {
        for (let i = ci - maxDist; i <= ci + maxDist; i++) {
          if (!land(i, j)) continue;
          const dx = Math.max(i - px, 0, px - (i + 1));
          const dz = Math.max(j - pz, 0, pz - (j + 1));
          best = Math.min(best, Math.hypot(dx, dz));
        }
      }
      data[y * w + x] = Math.round((best / maxDist) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

const WATER_VERT = /* glsl */ `
varying vec3 vWorld;
#include <fog_pars_vertex>
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const WATER_FRAG = /* glsl */ `
uniform float uTime;
uniform sampler2D uShore;
uniform vec4 uRegion;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uAmbient;
uniform vec4 uLightPos[${MAX_LIGHTS}];
uniform vec3 uLightColor[${MAX_LIGHTS}];
uniform int uLightCount;
varying vec3 vWorld;
#include <fog_pars_fragment>

float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  vec2 wp = (floor(vWorld.xz * 16.0) + 0.5) / 16.0;
  vec2 suv = (wp - uRegion.xy) / uRegion.zw;
  float shore = texture2D(uShore, suv).r * 3.0;
  float t = uTime;

  float depthMix = smoothstep(0.15, 2.4, shore);
  vec3 col = mix(uShallow, uDeep, depthMix);

  // slow swell (colour bands) plus thin pixel ripple lines
  float w1 = sin(wp.x * 2.3 + t * 0.9 + sin(wp.y * 1.4 + t * 0.4) * 1.8);
  float w2 = sin(wp.y * 3.1 - t * 0.8 + sin(wp.x * 1.7 - t * 0.3) * 1.5);
  float waves = (w1 + w2) * 0.5;
  float nn = n2(wp * 2.4 + vec2(t * 0.35, -t * 0.25));
  float sig = waves * 0.65 + nn * 0.55;
  float crest = step(0.72, sig) * (1.0 - step(0.83, sig));
  float trough = step(sig, -0.35);
  float swell = n2(wp * 0.35 + vec2(t * 0.05, t * 0.03));
  col *= 0.88 + swell * 0.24;
  col = mix(col, col * 0.78, trough);
  col = mix(col, mix(col, uFoam, 0.38), crest);

  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.0);
  col = mix(col, uSky, 0.05 + fres * 0.3);

  vec3 light = uAmbient + uSunColor * max(uSunDir.y, 0.0) * 0.75;
  col *= light;

  float edge = shore + (n2(wp * 3.0 + t * 0.5) - 0.5) * 0.25 + sin(t * 1.4 + (wp.x + wp.y) * 1.2) * 0.05;
  float foam = 1.0 - step(0.2, edge);
  float ring = 1.0 - step(0.055, abs(edge - 0.5 - 0.12 * sin(t * 0.8)));
  col = mix(col, uFoam * light * 1.05, max(foam, ring * 0.5));

  vec2 cell = floor(wp * 16.0);
  float spark = step(0.982, h21(cell + floor(t * 2.5) * 7.0));
  col += uSunColor * spark * crest * 2.6 * smoothstep(0.05, 0.4, uSunDir.y);

  for (int i = 0; i < ${MAX_LIGHTS}; i++) {
    if (i >= uLightCount) break;
    // the mirror image sits between the light's base and the camera, never behind it
    vec2 toCam = normalize(cameraPosition.xz - uLightPos[i].xz + 1e-4);
    float h = max(uLightPos[i].y - vWorld.y, 0.0);
    float k = h / (h + max(cameraPosition.y - vWorld.y, 0.1));
    vec2 base = uLightPos[i].xz;
    vec2 d = wp - (base + toCam * k * length(cameraPosition.xz - base));
    float along = dot(d, toCam);
    float perp = dot(d, vec2(-toCam.y, toCam.x));
    float fall = exp(-(perp * perp * 6.0 + along * along * 0.45)) * smoothstep(-0.1, 0.5, dot(wp - base, toCam));
    fall = floor(fall * 4.0) / 4.0; // banded, pixel-art glow
    float shimmer = 0.55 + 0.45 * step(0.0, sin(along * 9.0 + t * 3.0 + nn * 4.0));
    col += uLightColor[i] * fall * shimmer * 0.5;
  }

  float alpha = mix(0.62, 0.93, depthMix);
  alpha = max(alpha, max(foam, ring * 0.6));
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
}`;

export class Water extends THREE.Mesh {
  constructor(map, { x0, z0, x1, z1, level = map.waterLevel, deep = '#1d5a78', shallow = '#3fa3ad', foam = '#e8f6f2', sky = '#9cc8e8' } = {}) {
    const geometry = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((x0 + x1) / 2, level, (z0 + z1) / 2);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uTime: globalUniforms.uTime,
      uShore: { value: bakeShoreField(map, x0, z0, x1, z1, level) },
      uRegion: { value: new THREE.Vector4(x0, z0, x1 - x0, z1 - z0) },
      uDeep: { value: new THREE.Color(deep) },
      uShallow: { value: new THREE.Color(shallow) },
      uFoam: { value: new THREE.Color(foam) },
      uSky: { value: new THREE.Color(sky) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uAmbient: { value: new THREE.Color(0.4, 0.4, 0.45) },
      uLightPos: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
      uLightColor: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Color()) },
      uLightCount: { value: 0 },
    });
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      transparent: true,
      fog: true,
      depthWrite: true,
    });
    super(geometry, material);
    this.name = 'water';
    this.reflectionStrength = 0.22;
    this.renderOrder = 1;
  }

  /** Feed environment lighting (called by the day/night cycle). */
  setEnvironment({ sunColor, sunDir, ambient, sky }) {
    const u = this.material.uniforms;
    if (sunColor) u.uSunColor.value.copy(sunColor);
    if (sunDir) u.uSunDir.value.copy(sunDir);
    if (ambient) u.uAmbient.value.copy(ambient);
    if (sky) u.uSky.value.copy(sky);
  }

  /** Lights reflected on the surface: [{ position, color, intensity }]. */
  setReflectedLights(lights) {
    const u = this.material.uniforms;
    let n = 0;
    for (const l of lights) {
      if (n >= MAX_LIGHTS) break;
      if (l.intensity <= 0.001) continue;
      u.uLightPos.value[n].set(l.position.x, l.position.y, l.position.z, 1);
      u.uLightColor.value[n].copy(l.color).multiplyScalar(l.intensity * this.reflectionStrength);
      n++;
    }
    u.uLightCount.value = n;
  }
}

const FALL_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uSize;
uniform vec3 uDeep;
uniform vec3 uLight;
uniform vec3 uFoam;
uniform vec3 uTint;
varying vec2 vUv;
#include <fog_pars_fragment>
float h11(float p) { return fract(sin(p * 91.7) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float n2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 res = uSize * 16.0;
  vec2 px = floor(vUv * res);
  float colId = floor(px.x / 2.0);
  float spd = 26.0 * (0.8 + 0.5 * h11(colId));
  float y = px.y + uTime * spd;
  float n = n2(vec2(px.x * 0.3, y * 0.07));
  float streak = step(0.82, fract(y / (10.0 + 14.0 * h11(colId + 4.0))));
  float tone = n * 0.75 + streak * 0.4;
  vec3 c = mix(uDeep, uLight, step(0.42, tone));
  c = mix(c, uFoam, step(0.78, tone));
  float lip = step(res.y - 3.0, px.y);
  c = mix(c, uFoam, lip);
  float bottom = 1.0 - smoothstep(0.0, 14.0, px.y + n * 8.0 - 2.0);
  c = mix(c, uFoam, bottom);
  float edge = min(px.x, res.x - 1.0 - px.x);
  float ragged = 1.0 + floor(2.5 * n2(vec2(0.0, y * 0.12)));
  if (edge < ragged - 1.0) discard;
  c = mix(c, uDeep * 0.8, step(edge, ragged));
  gl_FragColor = vec4(c * uTint, 0.94);
  #include <fog_fragment>
}`;

/**
 * Curved sheet of falling water. The profile rolls over the lip in a
 * quarter circle, then falls away from the cliff (z grows with the square
 * root of the drop, like a real jet), so it reads as water, not a panel.
 * `height` is the total drop from the lip top to the pool.
 */
function waterfallGeometry(width, height, lip = 0.32, cols = 6, rows = 28) {
  const fall = Math.max(0.1, height - lip);
  const pts = []; // [y, z, s] along the profile, bottom to top
  const nFall = Math.round(rows * 0.8), nLip = rows - nFall;
  for (let k = 0; k <= nFall; k++) {
    const y = (k / nFall) * fall;
    pts.push([y, 0.05 + 0.42 * Math.sqrt((fall - y) / fall)]);
  }
  for (let k = 1; k <= nLip; k++) {
    const th = Math.PI / 2 - (k / nLip) * (Math.PI / 2);
    pts.push([fall + lip * Math.cos(th), 0.05 - lip + lip * Math.sin(th)]);
  }
  const lens = [0];
  for (let k = 1; k < pts.length; k++) lens.push(lens[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  const total = lens[lens.length - 1];
  const pos = [], uv = [], idx = [];
  for (let k = 0; k < pts.length; k++) {
    for (let c = 0; c <= cols; c++) {
      const u = c / cols;
      // the sheet narrows slightly as it falls
      const squeeze = 1 - 0.06 * (1 - pts[k][0] / height);
      pos.push((u - 0.5) * width * squeeze, pts[k][0], pts[k][1]);
      uv.push(u, lens[k] / total);
    }
  }
  for (let k = 0; k < pts.length - 1; k++) {
    for (let c = 0; c < cols; c++) {
      const a = k * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
      idx.push(a, b, e, a, e, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.length = total;
  return g;
}

export class Waterfall extends THREE.Mesh {
  constructor({ width = 3, height = 3, deep = '#3b7fa3', light = '#8fd3e6', foam = '#f2fbff' } = {}) {
    const geometry = waterfallGeometry(width, height);
    const length = geometry.userData.length;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uTime: globalUniforms.uTime,
      uSize: { value: new THREE.Vector2(width, length) },
      uDeep: { value: new THREE.Color(deep) },
      uLight: { value: new THREE.Color(light) },
      uFoam: { value: new THREE.Color(foam) },
      uTint: { value: new THREE.Color(1, 1, 1) },
    });
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        #include <fog_pars_vertex>
        void main() {
          vUv = uv;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: FALL_FRAG,
      transparent: true,
      fog: true,
    });
    super(geometry, material);
    this.name = 'waterfall';
  }

  setTint(color) {
    this.material.uniforms.uTint.value.copy(color);
  }
}
