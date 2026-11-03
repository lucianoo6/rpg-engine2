import * as THREE from 'three';
import { globalUniforms } from '../render/MaterialPatch.js';

/**
 * Fake volumetric "god ray": an additive, camera-facing quad that leans
 * along the sunlight, with soft edges, slow drifting streaks and fog fade.
 */
const VERT = /* glsl */ `
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  float edge = smoothstep(0.0, 0.4, vUv.x) * smoothstep(1.0, 0.6, vUv.x);
  float along = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.7, vUv.y);
  float streak = 0.55 + 0.25 * sin(vUv.x * 17.0 + uSeed + uTime * 0.35) + 0.2 * sin(vUv.x * 37.0 - uTime * 0.6 + uSeed * 2.0);
  float pulse = 0.85 + 0.15 * sin(uTime * 0.5 + uSeed);
  float a = edge * along * streak * pulse * uIntensity;
  #ifdef USE_FOG
    a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor = vec4(uColor * a, 1.0);
}`;

export class LightShaft extends THREE.Group {
  constructor({ width = 1.6, length = 10, color = '#ffe0a0', intensity = 0.55, lean = 0.5, seed = Math.random() * 10 } = {}) {
    super();
    const geometry = new THREE.PlaneGeometry(width, length);
    geometry.translate(0, length / 2, 0);
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog]);
    Object.assign(uniforms, {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uTime: globalUniforms.uTime,
      uSeed: { value: seed },
    });
    this.material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.rotation.z = lean;
    this.add(this.mesh);
    this.baseIntensity = intensity;
    this.renderOrder = 5;
  }

  update(yaw, visibility) {
    this.rotation.y = yaw;
    this.material.uniforms.uIntensity.value = this.baseIntensity * visibility;
    this.visible = visibility > 0.01;
  }
}
