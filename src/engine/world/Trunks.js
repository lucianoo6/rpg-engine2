import * as THREE from 'three';
import { PPU } from '../pixel/TextureFactory.js';
import { toTexture } from '../pixel/PixelCanvas.js';
import { paintBark } from '../pixel/SpriteFactory.js';
import { patchMaterial } from '../render/MaterialPatch.js';

/**
 * Real 3D tree trunks under billboard canopies. A sprite trunk is a flat
 * card that turns with the camera; a low-poly lathe with chunky pixel bark
 * stays round from every angle, takes light on its sun side and catches
 * the canopy's shadow. Pair with a sprite painted with `trunk3d: true`,
 * which erases its own lower trunk and reports `pc.trunk` = { height,
 * radius } in sprite pixels.
 */
export class TrunkInstances extends THREE.InstancedMesh {
  /**
   * @param {{height:number, radius:number}} size  from the canopy sprite's `pc.trunk`
   * @param {object} o  bark: base colour; seed; capacity; segments: sides of the lathe
   *                    (few sides keep it pixel-art chunky); flare: root spread
   */
  constructor(size, { bark = '#6b4a30', seed = 1, capacity = 256, segments = 9, flare = 1.9 } = {}) {
    const H = size.height / PPU;
    const r = size.radius / PPU;
    // radius profile from the ground up: spreading roots, then a slight taper
    const prof = [
      [r * flare, 0], [r * (1 + (flare - 1) * 0.45), 1.5 / PPU], [r * 1.08, 3.5 / PPU],
      [r, 6 / PPU], [r * 0.86, H], [0, H + 0.5 / PPU], // closed top
    ];
    const lathe = (grow) => new THREE.LatheGeometry(prof.map(([x, y]) => new THREE.Vector2(x + grow, y)), segments);
    const geometry = lathe(0);
    // v in bark-texture repeats so pixels keep the sprite's density
    const barkPc = paintBark({ bark, seed });
    const uv = geometry.attributes.uv;
    const pos = geometry.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) * PPU) / barkPc.h);
    // u wraps the circumference a whole number of times
    const around = Math.max(1, Math.round((2 * Math.PI * r * PPU) / barkPc.w));
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * around);
    const map = toTexture(barkPc, { repeat: true });
    const material = patchMaterial(new THREE.MeshLambertMaterial({ map }), { clouds: true, cutout: true });
    super(geometry, material, capacity);
    // one-pixel dark rim like the sprites' outline: a slightly fatter
    // back-face shell drawn with the same instance transforms
    const rim = new THREE.InstancedMesh(
      lathe(1 / PPU),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(bark).multiplyScalar(0.32), side: THREE.BackSide }),
      capacity,
    );
    rim.instanceMatrix = this.instanceMatrix;
    rim.frustumCulled = false;
    rim.raycast = () => {};
    this.add(rim);
    this.rim = rim;
    this.castShadow = true;
    this.receiveShadow = true;
    this.count = 0;
    this.trunkHeight = H;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  /** Add a trunk at a canopy's ground point; `rot` turns the bark so neighbours differ. */
  add(x, y, z, { scale = 1, rot = 0, tint = null } = {}) {
    if (this.count >= this.instanceMatrix.count) return -1;
    const i = this.count++;
    this._m.compose(this._p.set(x, y - 0.04, z), this._q.setFromAxisAngle(this._up, rot), this._s.set(scale, scale, scale));
    this.setMatrixAt(i, this._m);
    this.setColorAt(i, tint ? this._c.set(tint) : this._c.setRGB(1, 1, 1));
    return i;
  }

  finalize() {
    this.rim.count = this.count;
    this.instanceMatrix.needsUpdate = true;
    if (this.instanceColor) this.instanceColor.needsUpdate = true;
    this.computeBoundingSphere();
    return this;
  }
}
