import * as THREE from 'three';
import { Textures } from '../pixel/TextureFactory.js';
import { worldMaterial } from '../render/Materials.js';
import { hash2 } from '../core/Random.js';
import { patchMaterial } from '../render/MaterialPatch.js';

/**
 * Turns a TileMap into merged block geometry, one mesh per texture.
 *  - Tops use world-space UVs so textures flow seamlessly across tiles.
 *  - Sides are anchored to the tile's top edge, so grassy lips and brick
 *    courses line up on every step regardless of its height.
 *  - Vertex colours carry baked voxel ambient occlusion plus a little
 *    per-tile tint variation, which sells the hand-painted diorama look.
 */

const AO_LEVELS = [0.5, 0.68, 0.84, 1.0];

class Bucket {
  constructor() {
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = [];
    this.idx = [];
  }
  quad(p, n, uv, c, flip = false) {
    const base = this.pos.length / 3;
    for (let k = 0; k < 4; k++) {
      this.pos.push(...p[k]);
      this.nor.push(...n);
      this.uv.push(...uv[k]);
      this.col.push(c[k], c[k], c[k]);
    }
    if (flip) this.idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

export function buildTerrain(map, { edgeDepth = -4 } = {}) {
  const buckets = new Map();
  const bucket = (name) => {
    if (!buckets.has(name)) buckets.set(name, new Bucket());
    return buckets.get(name);
  };
  const H = (i, j) => (map.inBounds(i, j) ? map.h(i, j) : edgeDepth);
  const fringes = new Map();
  const fringe = (name) => {
    if (!fringes.has(name)) fringes.set(name, new Bucket());
    return fringes.get(name);
  };

  for (let j = 0; j < map.depth; j++) {
    for (let i = 0; i < map.width; i++) {
      const h = H(i, j);
      const t = map.typeAt(i, j);
      const tint = 0.95 + hash2(i, j, 77) * 0.07;

      // ---- top face with voxel AO ----
      const topTex = Textures[t.top]();
      const uU = topTex.userData.unitsU, uV = topTex.userData.unitsV;
      const ao = (cx, cz) => {
        const dx = cx ? 1 : -1, dz = cz ? 1 : -1;
        const s1 = H(i + dx, j) > h + 0.01 ? 1 : 0;
        const s2 = H(i, j + dz) > h + 0.01 ? 1 : 0;
        const c = H(i + dx, j + dz) > h + 0.01 ? 1 : 0;
        const level = s1 && s2 ? 0 : 3 - (s1 + s2 + c);
        return AO_LEVELS[level] * tint;
      };
      // corners: a=(i,j+1) b=(i+1,j+1) c=(i+1,j) d=(i,j)
      const ca = ao(0, 1), cb = ao(1, 1), cc = ao(1, 0), cd = ao(0, 0);
      bucket(t.top).quad(
        [[i, h, j + 1], [i + 1, h, j + 1], [i + 1, h, j], [i, h, j]],
        [0, 1, 0],
        [[i / uU, -(j + 1) / uV], [(i + 1) / uU, -(j + 1) / uV], [(i + 1) / uU, -j / uV], [i / uU, -j / uV]],
        [ca, cb, cc, cd],
        ca + cc < cb + cd,
      );

      // ---- soft border: this tile's fringe spills onto lower-priority neighbours ----
      if (t.fringe) {
        const depth = 0.5;
        const fr = [
          [0, 1, (y) => [[i, y, j + 1], [i + 1, y, j + 1], [i + 1, y, j + 1 + depth], [i, y, j + 1 + depth]], i, 0.008],
          [0, -1, (y) => [[i + 1, y, j], [i, y, j], [i, y, j - depth], [i + 1, y, j - depth]], -(i + 1), 0.010],
          [1, 0, (y) => [[i + 1, y, j], [i + 1, y, j + 1], [i + 1 + depth, y, j + 1], [i + 1 + depth, y, j]], j, 0.012],
          [-1, 0, (y) => [[i, y, j + 1], [i, y, j], [i - depth, y, j], [i - depth, y, j + 1]], -(j + 1), 0.014],
        ];
        for (const [di, dj, pts, u0, lift] of fr) {
          const nt = map.typeAt(i + di, j + dj);
          if (!nt || Math.abs(H(i + di, j + dj) - h) > 0.01) continue;
          if ((nt.priority ?? 99) >= (t.priority ?? 0) || nt.fringe) continue;
          // u runs along the edge (texture spans 2 units), v from the edge (1) outwards (0)
          const u = u0 / 2;
          let p = pts(h + lift);
          let uv = [[u, 1], [u + 0.5, 1], [u + 0.5, 0], [u, 0]];
          // keep the quad facing up (counter-clockwise seen from above)
          const ax = p[1][0] - p[0][0], az = p[1][2] - p[0][2], bx = p[2][0] - p[0][0], bz = p[2][2] - p[0][2];
          if (az * bx - ax * bz < 0) { p = p.reverse(); uv = uv.reverse(); }
          fringe(t.fringe).quad(p, [0, 1, 0], uv, [tint, tint, tint, tint]);
        }
      }

      // ---- side faces ----
      const sideTex = Textures[t.side]();
      const sU = sideTex.userData.unitsU, sV = sideTex.userData.unitsV;
      const v = (y) => 1 - (h - y) / sV;
      const sides = [
        // [di, dj, normal, corners(y0,y1) -> 4 points, u-coordinate fn]
        [0, 1, [0, 0, 1], (y0, y1) => [[i, y0, j + 1], [i + 1, y0, j + 1], [i + 1, y1, j + 1], [i, y1, j + 1]], [i, i + 1]],
        [0, -1, [0, 0, -1], (y0, y1) => [[i + 1, y0, j], [i, y0, j], [i, y1, j], [i + 1, y1, j]], [-(i + 1), -i]],
        [1, 0, [1, 0, 0], (y0, y1) => [[i + 1, y0, j + 1], [i + 1, y0, j], [i + 1, y1, j], [i + 1, y1, j + 1]], [-(j + 1), -j]],
        [-1, 0, [-1, 0, 0], (y0, y1) => [[i, y0, j], [i, y0, j + 1], [i, y1, j + 1], [i, y1, j]], [j, j + 1]],
      ];
      for (const [di, dj, n, pts, [u0, u1]] of sides) {
        const nh = H(i + di, j + dj);
        if (nh >= h - 0.001) continue;
        const y0 = nh, y1 = h;
        const drop = h - nh;
        const bottomShade = drop > 1 ? 0.55 : 0.68;
        bucket(t.side).quad(
          pts(y0, y1),
          n,
          [[u0 / sU, v(y0)], [u1 / sU, v(y0)], [u1 / sU, v(y1)], [u0 / sU, v(y1)]],
          [bottomShade * tint, bottomShade * tint, tint, tint],
        );
      }
    }
  }

  const group = new THREE.Group();
  group.name = 'terrain';
  for (const [name, b] of buckets) {
    const mesh = new THREE.Mesh(b.build(), worldMaterial(name, { vertexColors: true }));
    mesh.name = `terrain:${name}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  for (const [name, b] of fringes) {
    const mat = new THREE.MeshLambertMaterial({ map: Textures[name](), vertexColors: true, alphaTest: 0.5 });
    patchMaterial(mat, { clouds: true });
    mat.name = `fringe:${name}`;
    const mesh = new THREE.Mesh(b.build(), mat);
    mesh.name = `terrain:fringe:${name}`;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}
