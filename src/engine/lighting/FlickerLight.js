import * as THREE from 'three';
import { smoothstep } from '../core/Random.js';

/**
 * Point light with organic flicker, optionally switched by night level.
 * Exposes `color` / `intensity` / `position` so water can reflect it.
 */
export class FlickerLight {
  constructor(parent, position, {
    color = '#ffb062', intensity = 8, distance = 9, decay = 2,
    flicker = 0.12, speed = 1, nightOnly = true, dayLevel = 0,
    castShadow = false, shadowMapSize = 512,
  } = {}) {
    this.light = new THREE.PointLight(color, 0, distance, decay);
    this.light.position.copy(position);
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
    this.base = intensity;
    this.flicker = flicker;
    this.speed = speed;
    this.nightOnly = nightOnly;
    this.dayLevel = dayLevel;
    this.seed = Math.random() * 100;
    this.position = this.light.position;
    this.color = this.light.color;
    this.intensity = 0;
    this.enabled = true;
  }

  update(t, night) {
    const on = this.enabled ? (this.nightOnly ? this.dayLevel + (1 - this.dayLevel) * smoothstep(0.1, 0.55, night) : 1) : 0;
    const s = this.seed, k = t * this.speed;
    const n = Math.sin(k * 7.1 + s) * 0.5 + Math.sin(k * 13.7 + s * 2) * 0.3 + Math.sin(k * 23.3 + s * 3) * 0.2;
    const f = 1 + n * this.flicker;
    this.intensity = this.base * on;
    this.light.intensity = this.intensity * f;
    this.light.visible = true;
  }
}
