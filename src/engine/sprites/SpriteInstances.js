import * as THREE from 'three';
import { spriteGeometry, makeSpriteMaterial } from './Billboard.js';
import { makeShadowMaterials } from '../render/MaterialPatch.js';
import { PPU } from '../pixel/TextureFactory.js';

/**
 * Thousands of static billboards (trees, grass, flowers, rocks) in one draw
 * call. Billboarding and wind run in the vertex shader; per-instance tint
 * and horizontal flip add variety without extra textures.
 */
export class SpriteInstances extends THREE.InstancedMesh {
  constructor(texture, { capacity = 256, pivot = [0.5, 0], lit = true, alphaTest = 0.5, wind = 0, castShadow = true, receiveShadow = true, tilt = 0.55, scale = 1 } = {}) {
    const w = (texture.userData.pixelWidth / PPU) * scale;
    const h = (texture.userData.pixelHeight / PPU) * scale;
    const geometry = spriteGeometry(w, h, pivot[0], pivot[1], tilt).clone();
    const flip = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aFlip', flip);
    const material = makeSpriteMaterial(texture, { lit, alphaTest, wind, windHeight: h, flip: true, cutout: true });
    super(geometry, material, capacity);
    const sh = makeShadowMaterials({ billboard: true, wind, windHeight: h, flip: true });
    this.customDepthMaterial = sh.depth;
    this.customDistanceMaterial = sh.distance;
    this.castShadow = castShadow;
    this.receiveShadow = receiveShadow;
    this.count = 0;
    this.spriteWidth = w;
    this.spriteHeight = h;
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  /** Add an instance; returns its index or -1 when full. */
  add(x, y, z, { scale = 1, flip = false, tint = null } = {}) {
    if (this.count >= this.instanceMatrix.count) return -1;
    const i = this.count++;
    this._m.makeScale(scale, scale, scale).setPosition(x, y, z);
    this.setMatrixAt(i, this._m);
    this.geometry.attributes.aFlip.setX(i, flip ? 1 : 0);
    this.setColorAt(i, tint ? this._c.set(tint) : this._c.setRGB(1, 1, 1));
    return i;
  }

  /**
   * Upload instance data. With `shuffle`, instances are put in random order
   * so setDensity() can thin them out evenly instead of region by region.
   */
  finalize({ shuffle = false } = {}) {
    if (shuffle) this._shuffle();
    this.total = this.count;
    this.instanceMatrix.needsUpdate = true;
    if (this.instanceColor) this.instanceColor.needsUpdate = true;
    this.geometry.attributes.aFlip.needsUpdate = true;
    this.computeBoundingSphere();
    this.computeBoundingBox();
    return this;
  }

  /** Draw only a fraction of the instances (quality setting for ground cover). */
  setDensity(f) {
    this.count = Math.round((this.total ?? this.count) * Math.max(0, Math.min(1, f)));
  }

  _shuffle() {
    const n = this.count;
    const m = this.instanceMatrix.array;
    const c = this.instanceColor ? this.instanceColor.array : null;
    const fl = this.geometry.attributes.aFlip.array;
    const swap = (arr, a, b, size) => {
      for (let k = 0; k < size; k++) {
        const t = arr[a * size + k];
        arr[a * size + k] = arr[b * size + k];
        arr[b * size + k] = t;
      }
    };
    let seed = 1234567;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      swap(m, i, j, 16);
      if (c) swap(c, i, j, 3);
      swap(fl, i, j, 1);
    }
  }
}
