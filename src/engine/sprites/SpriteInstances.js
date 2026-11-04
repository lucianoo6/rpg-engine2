import * as THREE from 'three';
import { spriteGeometry, makeSpriteMaterial } from './Billboard.js';
import { makeShadowMaterials } from '../render/MaterialPatch.js';
import { PPU } from '../pixel/TextureFactory.js';
import { packStrip, toTexture, toNormalTexture } from '../pixel/PixelCanvas.js';

/**
 * Thousands of static billboards (trees, grass, flowers, rocks) in one draw
 * call. Billboarding and wind run in the vertex shader; per-instance tint
 * and horizontal flip add variety without extra textures.
 */
export class SpriteInstances extends THREE.InstancedMesh {
  constructor(texture, { capacity = 256, pivot = [0.5, 0], lit = true, alphaTest = 0.5, wind = 0, castShadow = true, receiveShadow = true, tilt = 0.55, scale = 1, normalMap = null, sunFacingShadow = false, frames = 0 } = {}) {
    // with `frames`, the texture is a strip of equal cells (see packStrip) and add() picks one per instance
    const w = (texture.userData.pixelWidth / Math.max(1, frames) / PPU) * scale;
    const h = (texture.userData.pixelHeight / PPU) * scale;
    const geometry = spriteGeometry(w, h, pivot[0], pivot[1], tilt).clone();
    const flip = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    geometry.setAttribute('aFlip', flip);
    if (frames > 1) geometry.setAttribute('aFrame', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
    const material = makeSpriteMaterial(texture, { lit, alphaTest, wind, windHeight: h, flip: true, cutout: true, normalMap, frames });
    super(geometry, material, capacity);
    const sh = makeShadowMaterials({ billboard: true, wind, windHeight: h, flip: true, frames, sunFacing: sunFacingShadow });
    this.customDepthMaterial = sh.depth;
    this.customDistanceMaterial = sh.distance;
    this.castShadow = castShadow;
    this.receiveShadow = sunFacingShadow ? false : receiveShadow;
    this.count = 0;
    this.spriteWidth = w;
    this.spriteHeight = h;
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();
  }

  /**
   * Several sprite variants in one draw call: packs the canvases into an
   * atlas strip (normal maps too, when they have `.normal`) and returns the
   * mesh with `variants`, one `{ add(x, y, z, o) }` per canvas, so code that
   * picks a variant and adds to it works unchanged.
   *   align: 'center' | 'bottom' (ground-anchored sprites of different heights)
   */
  static fromVariants(pcs, { align = 'center', ...opts } = {}) {
    const strip = packStrip(pcs, { align });
    const mesh = new SpriteInstances(toTexture(strip), {
      ...opts, frames: strip.frames, normalMap: strip.normal ? toNormalTexture(strip.normal) : null,
    });
    mesh.variants = pcs.map((_, i) => ({ mesh, frame: i, add: (x, y, z, o = {}) => mesh.add(x, y, z, { ...o, frame: i }) }));
    return mesh;
  }

  /** Add an instance; returns its index or -1 when full. */
  add(x, y, z, { scale = 1, flip = false, tint = null, frame = 0 } = {}) {
    if (this.count >= this.instanceMatrix.count) return -1;
    const i = this.count++;
    this._m.makeScale(scale, scale, scale).setPosition(x, y, z);
    this.setMatrixAt(i, this._m);
    this.geometry.attributes.aFlip.setX(i, flip ? 1 : 0);
    if (this.geometry.attributes.aFrame) this.geometry.attributes.aFrame.setX(i, frame);
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
    if (this.geometry.attributes.aFrame) this.geometry.attributes.aFrame.needsUpdate = true;
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
    const fr = this.geometry.attributes.aFrame ? this.geometry.attributes.aFrame.array : null;
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
      if (fr) swap(fr, i, j, 1);
    }
  }
}
