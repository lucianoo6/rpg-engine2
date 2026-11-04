import * as THREE from 'three';
import { globalUniforms } from '../render/MaterialPatch.js';

/**
 * Time-of-day system. Keyframes describe the whole mood of a moment —
 * sun/moon, sky and ground bounce light, fog, exposure and colour grade —
 * and the cycle blends between them, then pushes the result into lights,
 * fog, post-processing and any listeners (lamps, windows, fireflies...).
 */

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);

export const DEFAULT_KEYFRAMES = [
  { t: 0.0, name: 'Midnight', sun: '#7d93d6', sunI: 1.1, az: -20, el: 58, sky: '#34447a', ground: '#1a1a2a', hemiI: 1.5, fog: '#141d3a', fogNear: 30, fogFar: 72, exposure: 1.75, night: 1, shafts: 0, clouds: 0, sat: 0.92, contrast: 1.06, tint: '#dde3ff', bloom: 0.75 },
  { t: 4.8, name: 'Before Dawn', sun: '#8a8fc8', sunI: 0.8, az: 30, el: 35, sky: '#3c4778', ground: '#1e1c2a', hemiI: 1.4, fog: '#2a3052', fogNear: 30, fogFar: 72, exposure: 1.6, night: 0.92, shafts: 0, clouds: 0, sat: 0.92, contrast: 1.04, tint: '#e2e4ff', bloom: 0.7 },
  { t: 6.4, name: 'Dawn', sun: '#ff9f72', sunI: 2.2, az: 70, el: 10, sky: '#9a9bd0', ground: '#4d3a3c', hemiI: 1.1, fog: '#d4a49a', fogNear: 30, fogFar: 78, exposure: 1.1, night: 0.35, shafts: 0.9, clouds: 0.15, sat: 1.06, contrast: 1.04, tint: '#ffe2dc', bloom: 0.65 },
  { t: 9.0, name: 'Morning', sun: '#ffe9c9', sunI: 3.2, az: 52, el: 38, sky: '#bcd7ff', ground: '#5f5a44', hemiI: 1.25, fog: '#bcd2e8', fogNear: 34, fogFar: 85, exposure: 1.0, night: 0, shafts: 0.55, clouds: 0.32, sat: 1.08, contrast: 1.05, tint: '#fffaf2', bloom: 0.5 },
  { t: 13.0, name: 'Noon', sun: '#fff5e6', sunI: 3.6, az: 18, el: 60, sky: '#c6defc', ground: '#6a6348', hemiI: 1.3, fog: '#c7dcef', fogNear: 36, fogFar: 90, exposure: 0.95, night: 0, shafts: 0.3, clouds: 0.38, sat: 1.06, contrast: 1.05, tint: '#ffffff', bloom: 0.45 },
  { t: 16.5, name: 'Golden Hour', sun: '#ffc685', sunI: 3.3, az: -42, el: 26, sky: '#a8b6e2', ground: '#6e5342', hemiI: 1.1, fog: '#e6c39c', fogNear: 32, fogFar: 82, exposure: 1.02, night: 0, shafts: 1, clouds: 0.28, sat: 1.12, contrast: 1.07, tint: '#fff0dc', bloom: 0.6 },
  { t: 18.6, name: 'Dusk', sun: '#ff7b4f', sunI: 1.8, az: -66, el: 9, sky: '#7270b0', ground: '#3d2c33', hemiI: 1.15, fog: '#a76b7c', fogNear: 30, fogFar: 76, exposure: 1.3, night: 0.6, shafts: 0.4, clouds: 0.1, sat: 1.08, contrast: 1.06, tint: '#ffd9d6', bloom: 0.75 },
  { t: 20.2, name: 'Night', sun: '#8095d8', sunI: 1.0, az: -35, el: 50, sky: '#34427a', ground: '#1a1826', hemiI: 1.45, fog: '#18203e', fogNear: 30, fogFar: 72, exposure: 1.7, night: 1, shafts: 0, clouds: 0, sat: 0.95, contrast: 1.06, tint: '#dde3ff', bloom: 0.75 },
];

const lerp = (a, b, t) => a + (b - a) * t;

export class DayNightCycle {
  constructor({ scene, sun, hemi, post = null, keyframes = DEFAULT_KEYFRAMES, time = 16.5, speed = 0 }) {
    this.scene = scene;
    this.sun = sun;
    this.hemi = hemi;
    this.post = post;
    this.keys = keyframes.slice().sort((a, b) => a.t - b.t);
    this.time = time;
    this.speed = speed; // in-game hours per real second
    this.indoor = null;
    this.listeners = [];
    this.focus = new THREE.Vector3();
    this.shadowHalfSize = 20;
    this.state = {
      sunColor: new THREE.Color(), sunDir: new THREE.Vector3(0, 1, 0), sunIntensity: 1,
      sky: new THREE.Color(), ground: new THREE.Color(), hemiIntensity: 1,
      fog: new THREE.Color(), fogNear: 30, fogFar: 80, exposure: 1, night: 0, shafts: 0, clouds: 0,
      saturation: 1, contrast: 1, tint: new THREE.Color(1, 1, 1), bloom: 0.5, name: '',
    };
    this._ca = new THREE.Color();
    this._cb = new THREE.Color();
    this._m = new THREE.Matrix4();
    this._mi = new THREE.Matrix4();
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._transition = null;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  /** Smoothly advance the clock to `hour` over `seconds` (used by resting). */
  transitionTo(hour, seconds = 3) {
    let delta = (hour - this.time + 24) % 24;
    if (delta < 0.01) delta = 24;
    this._transition = { from: this.time, delta, t: 0, dur: seconds };
  }

  get hourLabel() {
    const h = Math.floor(this.time);
    const m = Math.floor((this.time - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  _sample(time) {
    const keys = this.keys;
    let a = keys[keys.length - 1], b = keys[0];
    for (let i = 0; i < keys.length; i++) {
      if (keys[i].t > time) {
        b = keys[i];
        a = keys[(i - 1 + keys.length) % keys.length];
        break;
      }
      if (i === keys.length - 1) { a = keys[i]; b = keys[0]; }
    }
    const span = (b.t - a.t + 24) % 24 || 24;
    let f = ((time - a.t + 24) % 24) / span;
    f = f * f * (3 - 2 * f);
    return { a, b, f };
  }

  update(dt) {
    if (this._transition) {
      const tr = this._transition;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - Math.pow(-2 * tr.t + 2, 2) / 2;
      this.time = (tr.from + tr.delta * e) % 24;
      if (tr.t >= 1) this._transition = null;
    } else {
      this.time = (this.time + this.speed * dt + 24) % 24;
    }
    const { a, b, f } = this._sample(this.time);
    const s = this.state;
    const col = (out, ka, kb) => out.copy(this._ca.set(ka)).lerp(this._cb.set(kb), f);
    col(s.sunColor, a.sun, b.sun);
    col(s.sky, a.sky, b.sky);
    col(s.ground, a.ground, b.ground);
    col(s.fog, a.fog, b.fog);
    col(s.tint, a.tint, b.tint);
    s.sunIntensity = lerp(a.sunI, b.sunI, f);
    s.hemiIntensity = lerp(a.hemiI, b.hemiI, f);
    s.fogNear = lerp(a.fogNear, b.fogNear, f);
    s.fogFar = lerp(a.fogFar, b.fogFar, f);
    s.exposure = lerp(a.exposure, b.exposure, f);
    s.night = lerp(a.night, b.night, f);
    s.shafts = lerp(a.shafts, b.shafts, f);
    s.clouds = lerp(a.clouds, b.clouds, f);
    s.saturation = lerp(a.sat, b.sat, f);
    s.contrast = lerp(a.contrast, b.contrast, f);
    s.bloom = lerp(a.bloom, b.bloom, f);
    s.name = f < 0.5 ? a.name : b.name;
    const az = lerp(a.az, b.az, f) * DEG;
    const el = lerp(a.el, b.el, f) * DEG;
    s.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    this.apply();
  }

  /**
   * Indoor mode: time keeps running (state, night level, listeners) but the
   * sun is switched off and a fixed interior mood replaces sky, fog and grade.
   * Pass null to go back outdoors.
   */
  setIndoor(env) {
    if (!env) { this.indoor = null; return; }
    const C = (v) => new THREE.Color(v);
    this.indoor = {
      sky: C(env.sky ?? '#ffd8a8'), ground: C(env.ground ?? '#3a2a20'), hemiI: env.hemiI ?? 0.9,
      fog: C(env.fog ?? '#0e0b09'), fogNear: env.fogNear ?? 30, fogFar: env.fogFar ?? 70,
      exposure: env.exposure ?? 1.2, sat: env.sat ?? 1.05, contrast: env.contrast ?? 1.06,
      tint: C(env.tint ?? '#fff1e0'), bloom: env.bloom ?? 0.7,
    };
  }

  apply() {
    const s = this.state;
    const indoor = this.indoor;
    const env = indoor
      ? { sky: indoor.sky, ground: indoor.ground, hemiI: indoor.hemiI, fog: indoor.fog, fogNear: indoor.fogNear, fogFar: indoor.fogFar, exposure: indoor.exposure, sat: indoor.sat, contrast: indoor.contrast, tint: indoor.tint, bloom: indoor.bloom, clouds: 0 }
      : { sky: s.sky, ground: s.ground, hemiI: s.hemiIntensity, fog: s.fog, fogNear: s.fogNear, fogFar: s.fogFar, exposure: s.exposure, sat: s.saturation, contrast: s.contrast, tint: s.tint, bloom: s.bloom, clouds: s.clouds };
    this.sun.color.copy(s.sunColor);
    this.sun.intensity = indoor ? 0 : s.sunIntensity;
    // no sun shadow pass indoors (but render it once so the shader never samples an empty map)
    this.sun.shadow.autoUpdate = !indoor || !this.sun.shadow.map;
    this.hemi.color.copy(env.sky);
    this.hemi.groundColor.copy(env.ground);
    this.hemi.intensity = env.hemiI;
    if (this.scene.fog) {
      this.scene.fog.color.copy(env.fog);
      this.scene.fog.near = env.fogNear;
      this.scene.fog.far = env.fogFar;
    }
    if (this.scene.background && this.scene.background.isColor) this.scene.background.copy(env.fog);
    globalUniforms.uCloudStrength.value = env.clouds;
    globalUniforms.uSunYaw.value = Math.atan2(s.sunDir.x, s.sunDir.z);
    if (this.post) {
      this.post.grade.exposure = env.exposure * this.post.grade.exposureBias;
      this.post.grade.saturation = env.sat * this.post.grade.saturationBias;
      this.post.grade.contrast = env.contrast;
      this.post.grade.tint.copy(env.tint);
      this.post.bloom.strength = env.bloom * this.post.bloom.strengthBias;
    }
    this._placeSun();
    for (const fn of this.listeners) fn(s, this);
  }

  /** Keep the shadow frustum centred on the action, snapped to texels to avoid shimmer. */
  _placeSun() {
    const s = this.state;
    const sun = this.sun;
    const half = this.shadowHalfSize;
    const cam = sun.shadow.camera;
    cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half;
    cam.near = 1; cam.far = 140;
    cam.updateProjectionMatrix();
    const texel = (2 * half) / sun.shadow.mapSize.x;
    this._m.lookAt(this._v.set(0, 0, 0), this._p.copy(s.sunDir).negate(), UP);
    this._mi.copy(this._m).invert();
    const p = this._p.copy(this.focus).applyMatrix4(this._mi);
    p.x = Math.round(p.x / texel) * texel;
    p.y = Math.round(p.y / texel) * texel;
    p.applyMatrix4(this._m);
    sun.target.position.copy(p);
    sun.position.copy(p).addScaledVector(s.sunDir, 60);
    sun.target.updateMatrixWorld();
  }
}
