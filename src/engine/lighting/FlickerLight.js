import * as THREE from 'three';
import { smoothstep } from '../core/Random.js';

/**
 * A light *source* with organic flicker, optionally switched on by the
 * night level. Exposes `position` / `color` / `intensity` so water can
 * reflect it.
 *
 * Pass a LightPool as `parent` and the pool decides which sources get one
 * of its few real PointLights each frame. Pass `null` to create a bare
 * source (a GameMap registers it with the pool when it becomes active).
 * Pass any Object3D instead and the source owns a dedicated PointLight.
 */
export class FlickerLight {
  constructor(parent, position, {
    color = '#ffb062', intensity = 8, distance = 9, decay = 2,
    flicker = 0.12, speed = 1, nightOnly = true, dayLevel = 0,
    castShadow = false, shadowMapSize = 512,
  } = {}) {
    this.position = position.clone();
    this.color = new THREE.Color(color);
    this.distance = distance;
    this.decay = decay;
    this.castShadow = castShadow;
    this.base = intensity;
    this.flicker = flicker;
    this.speed = speed;
    this.nightOnly = nightOnly;
    this.dayLevel = dayLevel;
    this.seed = Math.random() * 100;
    this.intensity = 0; // steady on-level (used by reflections)
    this.current = 0; // with flicker (what a PointLight should emit)
    this.enabled = true;
    this.light = null;
    if (!parent) {
      // bare source; someone registers it with a LightPool later
    } else if (parent.isLightPool) {
      parent.add(this);
    } else {
      this.light = new THREE.PointLight(this.color, 0, distance, decay);
      this.light.position.copy(this.position);
      if (castShadow) {
        this.light.castShadow = true;
        this.light.shadow.mapSize.set(shadowMapSize, shadowMapSize);
        this.light.shadow.bias = -0.002;
        this.light.shadow.normalBias = 0.03;
        this.light.shadow.radius = 3;
        this.light.shadow.camera.near = 0.1;
        this.light.shadow.camera.far = distance;
      }
      parent.add(this.light);
    }
  }

  update(t, night) {
    const on = this.enabled ? (this.nightOnly ? this.dayLevel + (1 - this.dayLevel) * smoothstep(0.1, 0.55, night) : 1) : 0;
    const s = this.seed, k = t * this.speed;
    const n = Math.sin(k * 7.1 + s) * 0.5 + Math.sin(k * 13.7 + s * 2) * 0.3 + Math.sin(k * 23.3 + s * 3) * 0.2;
    this.intensity = this.base * on;
    this.current = this.intensity * (1 + n * this.flicker);
    if (this.light) this.light.intensity = this.current;
  }
}
