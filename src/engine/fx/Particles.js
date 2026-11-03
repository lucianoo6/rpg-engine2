import * as THREE from 'three';
import { globalUniforms } from '../render/MaterialPatch.js';

/**
 * CPU-simulated, GPU-drawn particle emitter. Particles are square "pixels"
 * (or soft glows) sized in world units, with colour/alpha over life, HDR
 * intensity for bloom, wobble for fireflies and gravity/drag for embers,
 * leaves, smoke and spray.
 */


const VERT = /* glsl */ `
attribute vec4 aColor;
attribute float aSize;
uniform float uPointScale;
varying vec4 vColor;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = max(1.0, aSize * uPointScale / -mvPosition.z);
  vColor = aColor;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform float uSoft;
uniform float uAdditive;
varying vec4 vColor;
#include <fog_pars_fragment>
void main() {
  float a = vColor.a;
  if (uSoft > 0.5) {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    a *= pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
  }
  if (a < 0.003) discard;
  vec3 c = vColor.rgb;
  #ifdef USE_FOG
    float fogF = smoothstep(fogNear, fogFar, vFogDepth);
    if (uAdditive > 0.5) a *= 1.0 - fogF;
    else c = mix(c, fogColor, fogF);
  #endif
  gl_FragColor = vec4(c, a);
}`;

const range = (r, rnd) => (Array.isArray(r) ? r[0] + (r[1] - r[0]) * rnd() : r);

export class ParticleEmitter extends THREE.Points {
  constructor(opts = {}) {
    const o = {
      max: 200,
      rate: 20,
      lifetime: [1, 2],
      shape: { type: 'point' }, // point | box {size:[x,y,z]} | disc {radius} | sphere {radius}
      velocity: { x: [0, 0], y: [0.5, 1], z: [0, 0] },
      gravity: 0,
      drag: 0,
      size: [0.1, 0.05],
      colors: ['#ffffff', '#ffffff'],
      alpha: [0.1, 0.3], // fade-in / fade-out fraction of life
      opacity: 1,
      intensity: 1,
      additive: true,
      soft: false,
      wobble: 0,
      wobbleFreq: 1,
      blink: 0,
      ...opts,
    };
    const geometry = new THREE.BufferGeometry();
    const pos = new Float32Array(o.max * 3);
    const col = new Float32Array(o.max * 4);
    const siz = new Float32Array(o.max);
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aColor', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(siz, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    uniforms.uPointScale = globalUniforms.uPointScale;
    uniforms.uSoft = { value: o.soft ? 1 : 0 };
    uniforms.uAdditive = { value: o.additive ? 1 : 0 };
    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      fog: true,
    });
    super(geometry, material);
    this.o = o;
    this.frustumCulled = false;
    this.renderOrder = 10;
    this.count = 0;
    this.vel = new Float32Array(o.max * 3);
    this.life = new Float32Array(o.max);
    this.maxLife = new Float32Array(o.max);
    this.seed = new Float32Array(o.max);
    this.home = new Float32Array(o.max * 3);
    this.accum = 0;
    this.level = 1; // scales spawn rate and alpha (e.g. fireflies only at night)
    this.rateScale = 1; // quality setting: fewer particles on slower machines
    this.active = true;
    this.cA = new THREE.Color(o.colors[0]);
    this.cB = new THREE.Color(o.colors[1] ?? o.colors[0]);
    this.rnd = Math.random;
    this.emitter = new THREE.Vector3();
  }

  _spawn() {
    if (this.count >= this.o.max) return;
    const i = this.count++;
    const o = this.o;
    const r = this.rnd;
    let x = 0, y = 0, z = 0;
    const sh = o.shape;
    if (sh.type === 'box') {
      x = (r() - 0.5) * sh.size[0]; y = (r() - 0.5) * sh.size[1]; z = (r() - 0.5) * sh.size[2];
    } else if (sh.type === 'disc') {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * sh.radius;
      x = Math.cos(a) * d; z = Math.sin(a) * d; y = sh.height ? r() * sh.height : 0;
    } else if (sh.type === 'sphere') {
      const a = r() * Math.PI * 2, b = Math.acos(2 * r() - 1), d = Math.cbrt(r()) * sh.radius;
      x = Math.sin(b) * Math.cos(a) * d; y = Math.cos(b) * d; z = Math.sin(b) * Math.sin(a) * d;
    }
    const p = this.geometry.attributes.position.array;
    p[i * 3] = this.emitter.x + x;
    p[i * 3 + 1] = this.emitter.y + y;
    p[i * 3 + 2] = this.emitter.z + z;
    this.home[i * 3] = p[i * 3]; this.home[i * 3 + 1] = p[i * 3 + 1]; this.home[i * 3 + 2] = p[i * 3 + 2];
    this.vel[i * 3] = range(o.velocity.x, r);
    this.vel[i * 3 + 1] = range(o.velocity.y, r);
    this.vel[i * 3 + 2] = range(o.velocity.z, r);
    this.life[i] = 0;
    this.maxLife[i] = range(o.lifetime, r);
    this.seed[i] = r() * 100;
  }

  _kill(i) {
    const last = --this.count;
    if (i === last) return;
    const p = this.geometry.attributes.position.array;
    for (let k = 0; k < 3; k++) {
      p[i * 3 + k] = p[last * 3 + k];
      this.vel[i * 3 + k] = this.vel[last * 3 + k];
      this.home[i * 3 + k] = this.home[last * 3 + k];
    }
    this.life[i] = this.life[last];
    this.maxLife[i] = this.maxLife[last];
    this.seed[i] = this.seed[last];
  }

  burst(n) {
    for (let k = 0; k < n; k++) this._spawn();
  }

  update(dt, t) {
    const o = this.o;
    if (this.active && this.level > 0.001) {
      this.accum += o.rate * this.level * this.rateScale * dt;
      while (this.accum >= 1) {
        this._spawn();
        this.accum -= 1;
      }
    }
    const p = this.geometry.attributes.position.array;
    const c = this.geometry.attributes.aColor.array;
    const s = this.geometry.attributes.aSize.array;
    const dragK = Math.exp(-o.drag * dt);
    for (let i = 0; i < this.count; i++) {
      this.life[i] += dt;
      const lf = this.life[i] / this.maxLife[i];
      if (lf >= 1) {
        this._kill(i);
        i--;
        continue;
      }
      const vi = i * 3;
      this.vel[vi + 1] -= o.gravity * dt;
      this.vel[vi] *= dragK; this.vel[vi + 1] *= dragK; this.vel[vi + 2] *= dragK;
      p[vi] += this.vel[vi] * dt;
      p[vi + 1] += this.vel[vi + 1] * dt;
      p[vi + 2] += this.vel[vi + 2] * dt;
      const sd = this.seed[i];
      if (o.wobble) {
        const w = o.wobble * dt;
        p[vi] += Math.sin(t * o.wobbleFreq + sd) * w;
        p[vi + 1] += Math.sin(t * o.wobbleFreq * 1.3 + sd * 2) * w * 0.6;
        p[vi + 2] += Math.cos(t * o.wobbleFreq * 0.9 + sd * 3) * w;
      }
      let a = o.opacity * this.level;
      if (lf < o.alpha[0]) a *= lf / o.alpha[0];
      else if (lf > 1 - o.alpha[1]) a *= (1 - lf) / o.alpha[1];
      if (o.blink) a *= 1 - o.blink + o.blink * (0.5 + 0.5 * Math.sin(t * 3.1 + sd * 7));
      const ci = i * 4;
      const k = o.intensity;
      c[ci] = (this.cA.r + (this.cB.r - this.cA.r) * lf) * k;
      c[ci + 1] = (this.cA.g + (this.cB.g - this.cA.g) * lf) * k;
      c[ci + 2] = (this.cA.b + (this.cB.b - this.cA.b) * lf) * k;
      c[ci + 3] = a;
      s[i] = o.size[0] + (o.size[1] - o.size[0]) * lf;
    }
    this.geometry.setDrawRange(0, this.count);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }
}

/** Ready-made looks. Each returns options for ParticleEmitter. */
export const ParticlePresets = {
  embers: () => ({ max: 90, rate: 16, lifetime: [1.2, 2.4], shape: { type: 'disc', radius: 0.3 }, velocity: { x: [-0.25, 0.25], y: [0.9, 1.8], z: [-0.25, 0.25] }, gravity: -0.15, drag: 0.4, size: [0.09, 0.04], colors: ['#ffd27a', '#ff4a1c'], alpha: [0.05, 0.5], intensity: 3.2, wobble: 0.6, wobbleFreq: 3 }),
  smoke: () => ({ max: 70, rate: 6, lifetime: [3, 5], shape: { type: 'disc', radius: 0.15 }, velocity: { x: [-0.1, 0.25], y: [0.5, 0.9], z: [-0.1, 0.1] }, drag: 0.15, size: [0.35, 1.3], colors: ['#8d8a8f', '#c9c6c9'], alpha: [0.2, 0.6], opacity: 0.32, additive: false, soft: true, wobble: 0.25, wobbleFreq: 0.8 }),
  fireflies: (area) => ({ max: 70, rate: 9, lifetime: [5, 9], shape: { type: 'box', size: area }, velocity: { x: [-0.15, 0.15], y: [-0.05, 0.12], z: [-0.15, 0.15] }, size: [0.11, 0.11], colors: ['#d8ff7a', '#9dff6a'], alpha: [0.2, 0.3], intensity: 4, wobble: 0.8, wobbleFreq: 0.9, blink: 0.85, soft: true }),
  dust: (area) => ({ max: 120, rate: 14, lifetime: [4, 8], shape: { type: 'box', size: area }, velocity: { x: [-0.06, 0.06], y: [-0.04, 0.06], z: [-0.06, 0.06] }, size: [0.06, 0.06], colors: ['#fff2cf', '#fff2cf'], alpha: [0.3, 0.4], intensity: 1.6, wobble: 0.15, wobbleFreq: 0.6, blink: 0.4 }),
  mist: () => ({ max: 140, rate: 30, lifetime: [1.2, 2.2], shape: { type: 'box', size: [2.6, 0.2, 0.6] }, velocity: { x: [-0.6, 0.6], y: [0.3, 1.1], z: [0.2, 1.0] }, drag: 1.2, size: [0.2, 0.75], colors: ['#ffffff', '#d8eef7'], alpha: [0.1, 0.6], opacity: 0.4, additive: false, soft: true }),
  sparkles: () => ({ max: 60, rate: 10, lifetime: [1, 2], shape: { type: 'sphere', radius: 0.8 }, velocity: { x: [-0.1, 0.1], y: [0.3, 0.7], z: [-0.1, 0.1] }, size: [0.1, 0.02], colors: ['#ffffff', '#7fe6ff'], alpha: [0.2, 0.5], intensity: 4, blink: 0.6 }),
  leaves: (area) => ({ max: 40, rate: 2.2, lifetime: [6, 10], shape: { type: 'box', size: area }, velocity: { x: [0.2, 0.5], y: [-0.45, -0.25], z: [-0.1, 0.2] }, size: [0.12, 0.12], colors: ['#d98b3a', '#b3542a'], alpha: [0.1, 0.2], additive: false, wobble: 1.2, wobbleFreq: 1.6 }),
  petals: (area) => ({ max: 40, rate: 2.5, lifetime: [6, 10], shape: { type: 'box', size: area }, velocity: { x: [0.25, 0.55], y: [-0.3, -0.15], z: [-0.1, 0.2] }, size: [0.09, 0.09], colors: ['#ffd1df', '#f4a6c0'], alpha: [0.1, 0.2], additive: false, wobble: 1.0, wobbleFreq: 1.8 }),
  heal: () => ({ max: 120, rate: 0, lifetime: [0.8, 1.6], shape: { type: 'disc', radius: 0.6 }, velocity: { x: [-0.2, 0.2], y: [1.2, 2.6], z: [-0.2, 0.2] }, drag: 0.8, size: [0.12, 0.03], colors: ['#ffffff', '#86f0ff'], alpha: [0.05, 0.5], intensity: 4 }),
};
