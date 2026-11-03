import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/**
 * The HD-2D look lives here.
 *
 *  scene ──► sceneRT (HDR + depth, MSAA)
 *        ──► bokeh DoF gather (half res, depth-aware circle of confusion
 *            blended with a screen-space tilt-shift band)
 *        ──► composite sharp/blurred ──► colorRT
 *        ──► bloom (added into colorRT)
 *        ──► grade: ACES tone map, sRGB, saturation/contrast/tint, cool
 *            shadow lift, vignette, chromatic fringe, grain, letterbox, fade
 */

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const COC = /* glsl */ `
#include <packing>
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform float uFocus;
uniform float uFocusRange;
uniform float uNearRange;
uniform float uFarRange;
uniform float uNearStr;
uniform float uFarStr;
uniform float uMaxBlur;
uniform float uTiltCenter;
uniform float uTiltWidth;
uniform float uTiltStr;
float viewDist(vec2 uv) {
  float d = texture2D(tDepth, uv).x;
  return -perspectiveDepthToViewZ(d, uNear, uFar);
}
float cocPx(float dist, float sy) {
  float diff = dist - uFocus;
  float c = diff > 0.0
    ? smoothstep(uFocusRange, uFocusRange + uFarRange, diff) * uFarStr
    : smoothstep(uFocusRange * 0.6, uFocusRange * 0.6 + uNearRange, -diff) * uNearStr;
  float tilt = smoothstep(uTiltWidth, uTiltWidth + 0.32, abs(sy - uTiltCenter)) * uTiltStr;
  return clamp(max(c, tilt), 0.0, 1.0) * uMaxBlur;
}
`;

const DOF_GATHER = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
${COC}
#define SAMPLES 40
#define GOLDEN 2.39996323
void main() {
  float cd = viewDist(vUv);
  float cc = cocPx(cd, vUv.y);
  vec3 acc = texture2D(tColor, vUv).rgb;
  float wsum = 1.0;
  float spread = 0.0;
  for (int i = 0; i < SAMPLES; i++) {
    float fi = float(i) + 0.5;
    float r = sqrt(fi / float(SAMPLES)) * uMaxBlur;
    float a = fi * GOLDEN;
    vec2 suv = vUv + vec2(cos(a), sin(a)) * r * uTexel;
    float sd = viewDist(suv);
    float sc = cocPx(sd, suv.y);
    if (sd > cd) sc = min(sc, cc * 1.5); // background must not bleed over sharper foreground
    float w = smoothstep(r - 1.5, r + 0.5, sc);
    vec3 s = texture2D(tColor, suv).rgb;
    // gently favour bright samples so highlights open into bokeh discs
    w *= 1.0 + 0.35 * clamp(dot(s, vec3(0.3333)) - 1.0, 0.0, 4.0);
    acc += s * w;
    wsum += w;
    spread += step(0.5, w);
  }
  gl_FragColor = vec4(acc / wsum, max(cc / uMaxBlur, spread / float(SAMPLES) * 1.5));
}`;

const DOF_COMPOSITE = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform float uEnabled;
varying vec2 vUv;
${COC}
void main() {
  vec3 sharp = texture2D(tColor, vUv).rgb;
  if (uEnabled < 0.5) { gl_FragColor = vec4(sharp, 1.0); return; }
  vec4 blur = texture2D(tBlur, vUv);
  float c = cocPx(viewDist(vUv), vUv.y);
  float m = max(smoothstep(0.6, 2.6, c), smoothstep(0.08, 0.35, blur.a) * smoothstep(0.2, 1.2, c + blur.a * 2.0));
  gl_FragColor = vec4(mix(sharp, blur.rgb, clamp(m, 0.0, 1.0)), 1.0);
}`;

const GRADE = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uResolution;
uniform float uExposure;
uniform float uContrast;
uniform float uSaturation;
uniform float uVignette;
uniform float uGrain;
uniform float uChroma;
uniform float uTime;
uniform float uLiftAmount;
uniform float uLetterbox;
uniform float uFade;
uniform vec3 uTint;
uniform vec3 uLift;
varying vec2 vUv;

vec3 RRTAndODTFit(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 acesFitted(vec3 color) {
  const mat3 inM = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 outM = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(outM * RRTAndODTFit(inM * color), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 dc = vUv - 0.5;
  float r2 = dot(dc, dc);
  vec2 off = dc * r2 * uChroma * 0.03;
  vec3 hdr = vec3(texture2D(tColor, vUv - off).r, texture2D(tColor, vUv).g, texture2D(tColor, vUv + off).b);
  vec3 c = toSRGB(acesFitted(hdr * uExposure / 0.6));
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += uLift * uLiftAmount * (1.0 - lum) * (1.0 - lum);
  c = mix(vec3(lum), c, uSaturation);
  c = (c - 0.5) * uContrast + 0.5;
  c *= uTint;
  float v = smoothstep(0.98, 0.25, length(dc * vec2(1.0, 1.25)) * 1.35);
  c *= mix(1.0, v, uVignette);
  float g = fract(sin(dot(floor(vUv * uResolution) + fract(uTime * 7.13) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  c += g * uGrain;
  float bars = step(vUv.y, uLetterbox) + step(1.0 - uLetterbox, vUv.y);
  c = mix(c, vec3(0.0), clamp(bars, 0.0, 1.0));
  c = mix(c, vec3(0.0), uFade);
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export class PostFX {
  constructor(renderer, scene, camera, { samples = 4 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.enabled = true;
    this.renderScale = 1;
    this.pixelate = false;

    this.dof = {
      enabled: true,
      focusDistance: 22,
      focusRange: 2.2,
      nearRange: 5,
      farRange: 12,
      nearStrength: 1,
      farStrength: 1,
      maxBlur: 0.011, // fraction of screen height
      tiltCenter: 0.45,
      tiltWidth: 0.2,
      tiltStrength: 0.55,
    };
    this.bloom = { enabled: true, strength: 0.6, strengthBias: 1, radius: 0.55, threshold: 0.9 };
    this.grade = {
      enabled: true,
      exposure: 1,
      exposureBias: 1,
      contrast: 1.05,
      saturation: 1.1,
      saturationBias: 1,
      tint: new THREE.Color(1, 1, 1),
      lift: new THREE.Color('#3a2a6a'),
      liftAmount: 0.06,
      vignette: 0.5,
      grain: 0.03,
      chroma: 0.6,
      letterbox: 0,
      fade: 0,
    };

    const rtOpts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    this.dofRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);
    this.colorRT = new THREE.WebGLRenderTarget(1, 1, rtOpts);

    const cocUniforms = () => ({
      tDepth: { value: this.sceneRT.depthTexture },
      uNear: { value: 0.1 }, uFar: { value: 100 },
      uFocus: { value: 20 }, uFocusRange: { value: 2 }, uNearRange: { value: 5 }, uFarRange: { value: 12 },
      uNearStr: { value: 1 }, uFarStr: { value: 1 }, uMaxBlur: { value: 10 },
      uTiltCenter: { value: 0.45 }, uTiltWidth: { value: 0.2 }, uTiltStr: { value: 0.5 },
    });
    this.gatherMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.sceneRT.texture }, uTexel: { value: new THREE.Vector2() }, ...cocUniforms() },
      vertexShader: QUAD_VERT,
      fragmentShader: DOF_GATHER,
    });
    this.compositeMat = new THREE.ShaderMaterial({
      uniforms: { tColor: { value: this.sceneRT.texture }, tBlur: { value: this.dofRT.texture }, uEnabled: { value: 1 }, ...cocUniforms() },
      vertexShader: QUAD_VERT,
      fragmentShader: DOF_COMPOSITE,
    });
    this.gradeMat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.colorRT.texture },
        uResolution: { value: new THREE.Vector2() },
        uExposure: { value: 1 }, uContrast: { value: 1 }, uSaturation: { value: 1 },
        uVignette: { value: 0.5 }, uGrain: { value: 0.03 }, uChroma: { value: 0.5 }, uTime: { value: 0 },
        uLiftAmount: { value: 0.05 }, uLetterbox: { value: 0 }, uFade: { value: 0 },
        uTint: { value: new THREE.Color(1, 1, 1) }, uLift: { value: new THREE.Color() },
      },
      vertexShader: QUAD_VERT,
      fragmentShader: GRADE,
    });
    this.quad = new FullScreenQuad(this.gatherMat);
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.9);
    this.time = 0;
    this.width = 1;
    this.height = 1;
    this.pixelRatio = 1;
  }

  setSize(width, height, pixelRatio = 1) {
    this.width = width;
    this.height = height;
    this.pixelRatio = pixelRatio;
    const s = pixelRatio * this.renderScale;
    const w = Math.max(1, Math.floor(width * s));
    const h = Math.max(1, Math.floor(height * s));
    this.sceneRT.setSize(w, h);
    this.sceneRT.depthTexture.image.width = w;
    this.sceneRT.depthTexture.image.height = h;
    this.colorRT.setSize(w, h);
    this.dofRT.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1));
    this.bloomPass.setSize(w, h);
    const filter = this.pixelate ? THREE.NearestFilter : THREE.LinearFilter;
    this.colorRT.texture.minFilter = this.colorRT.texture.magFilter = filter;
    this.colorRT.texture.needsUpdate = true;
    this.gatherMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this.gradeMat.uniforms.uResolution.value.set(w, h);
    this.internalWidth = w;
    this.internalHeight = h;
  }

  setRenderScale(scale, pixelate = this.pixelate) {
    this.renderScale = scale;
    this.pixelate = pixelate;
    this.setSize(this.width, this.height, this.pixelRatio);
  }

  _syncCoc(u) {
    const d = this.dof;
    u.uNear.value = this.camera.near;
    u.uFar.value = this.camera.far;
    u.uFocus.value = d.focusDistance;
    u.uFocusRange.value = d.focusRange;
    u.uNearRange.value = d.nearRange;
    u.uFarRange.value = d.farRange;
    u.uNearStr.value = d.nearStrength;
    u.uFarStr.value = d.farStrength;
    u.uMaxBlur.value = d.maxBlur * this.internalHeight;
    u.uTiltCenter.value = d.tiltCenter;
    u.uTiltWidth.value = d.tiltWidth;
    u.uTiltStr.value = d.tiltStrength;
  }

  render(dt) {
    const r = this.renderer;
    this.time += dt;
    if (!this.enabled) {
      r.setRenderTarget(null);
      r.render(this.scene, this.camera);
      return;
    }
    r.setRenderTarget(this.sceneRT);
    r.clear();
    r.render(this.scene, this.camera);

    const dofOn = this.dof.enabled && this.dof.maxBlur > 0;
    if (dofOn) {
      this._syncCoc(this.gatherMat.uniforms);
      this.quad.material = this.gatherMat;
      r.setRenderTarget(this.dofRT);
      this.quad.render(r);
    }
    this._syncCoc(this.compositeMat.uniforms);
    this.compositeMat.uniforms.uEnabled.value = dofOn ? 1 : 0;
    this.quad.material = this.compositeMat;
    r.setRenderTarget(this.colorRT);
    this.quad.render(r);

    if (this.bloom.enabled && this.bloom.strength > 0) {
      this.bloomPass.strength = this.bloom.strength;
      this.bloomPass.radius = this.bloom.radius;
      this.bloomPass.threshold = this.bloom.threshold;
      this.bloomPass.render(r, null, this.colorRT, dt, false);
    }

    const g = this.grade;
    const u = this.gradeMat.uniforms;
    const on = g.enabled;
    u.uExposure.value = g.exposure;
    u.uContrast.value = on ? g.contrast : 1;
    u.uSaturation.value = on ? g.saturation : 1;
    u.uVignette.value = on ? g.vignette : 0;
    u.uGrain.value = on ? g.grain : 0;
    u.uChroma.value = on ? g.chroma : 0;
    u.uLiftAmount.value = on ? g.liftAmount : 0;
    u.uTint.value.copy(on ? g.tint : new THREE.Color(1, 1, 1));
    u.uLift.value.copy(g.lift);
    u.uLetterbox.value = g.letterbox;
    u.uFade.value = g.fade;
    u.uTime.value = this.time;
    this.quad.material = this.gradeMat;
    r.setRenderTarget(null);
    this.quad.render(r);
  }
}
