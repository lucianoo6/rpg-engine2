import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Collects many small static meshes and merges them per material, so a
 * whole village of houses, fences and crates costs a handful of draw calls.
 */
export class StaticBatch {
  constructor() {
    this.parts = new Map();
    this._m = new THREE.Matrix4();
  }

  add(geometry, material, matrix) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
    for (const name of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    }
    g.clearGroups();
    if (matrix) g.applyMatrix4(matrix);
    if (!this.parts.has(material)) this.parts.set(material, []);
    this.parts.get(material).push(g);
  }

  /** Helper: position/rotation(y)/scale to matrix. */
  matrix(x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) {
    return new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry),
      new THREE.Vector3(sx, sy, sz),
    );
  }

  build({ castShadow = true, receiveShadow = true, name = 'static' } = {}) {
    const group = new THREE.Group();
    group.name = name;
    for (const [material, geos] of this.parts) {
      const merged = mergeGeometries(geos, false);
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = castShadow;
      mesh.receiveShadow = receiveShadow;
      mesh.name = `${name}:${material.name || 'mat'}`;
      group.add(mesh);
      geos.forEach((g) => g.dispose());
    }
    this.parts.clear();
    return group;
  }
}
