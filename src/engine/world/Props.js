import * as THREE from 'three';
import { Textures } from '../pixel/TextureFactory.js';
import { worldMaterial } from '../render/Materials.js';
import { patchMaterial } from '../render/MaterialPatch.js';

/**
 * Parametric 3D props built from boxes and quads with pixel textures.
 * Builders append geometry to a StaticBatch and return gameplay info
 * (footprints for collision, anchors for lights and particle emitters).
 */

const M = (name) => worldMaterial(name);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** Materials that the day/night cycle animates. */
export const propMaterials = {
  _window: null,
  _lantern: null,
  get window() {
    if (!this._window) {
      const m = new THREE.MeshLambertMaterial({ map: Textures.window(), emissiveMap: Textures.windowGlow(), emissive: new THREE.Color('#ffb257') });
      m.emissiveIntensity = 0;
      m.name = 'windowGlass';
      patchMaterial(m, { clouds: true, cutout: true });
      this._window = m;
    }
    return this._window;
  },
  get lantern() {
    if (!this._lantern) {
      this._lantern = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffa94d') });
      this._lantern.name = 'lanternGlass';
      this._lantern.userData.baseColor = new THREE.Color('#ffa94d');
    }
    return this._lantern;
  },
};

export function boxGeo(w, h, d, tex, stretch = false) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (stretch || !tex) return g;
  const t = Textures[tex]();
  const uU = t.userData.unitsU, uV = t.userData.unitsV;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const uv = g.attributes.uv;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / uU, (uv.getY(i) * dims[f][1]) / uV);
    }
  }
  return g;
}

function polyGeo(points, uvs) {
  // points: 3 or 4 Vector3 in CCW order (seen from the front)
  const pos = [];
  const uv = [];
  const tris = points.length === 4 ? [0, 1, 2, 0, 2, 3] : [0, 1, 2];
  for (const i of tris) {
    pos.push(points[i].x, points[i].y, points[i].z);
    uv.push(uvs[i][0], uvs[i][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

function addBox(batch, mat, tex, w, h, d, x, y, z, base, ry = 0, stretch = false) {
  const local = new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1));
  batch.add(boxGeo(w, h, d, tex, stretch), mat || M(tex), base.clone().multiply(local));
}

/** Gable roof with overhangs, ridge along local X. Roof base sits at y = 0. */
function addRoof(batch, base, { w, d, rh, ov = 0.45, so = 0.35, thick = 0.14, roofTex = 'roofRed', gableTex = 'plaster' }) {
  const t = Textures[roofTex]();
  const uU = t.userData.unitsU, uV = t.userData.unitsV;
  const xL = -(w / 2 + so), xR = w / 2 + so;
  const zE = d / 2 + ov;
  const eaveY = -rh * ov / (d / 2);
  const L = Math.hypot(zE, rh - eaveY);
  const sl = (a, b, c, e) => polyGeo([a, b, c, e], [[a.x / uU, 0], [b.x / uU, 0], [c.x / uU, L / uV], [e.x / uU, L / uV]]);
  const roofMat = M(roofTex);
  batch.add(sl(V(xL, eaveY, zE), V(xR, eaveY, zE), V(xR, rh, 0), V(xL, rh, 0)), roofMat, base);
  const back = polyGeo([V(xR, eaveY, -zE), V(xL, eaveY, -zE), V(xL, rh, 0), V(xR, rh, 0)], [[0, 0], [(xR - xL) / uU, 0], [(xR - xL) / uU, L / uV], [0, L / uV]]);
  batch.add(back, roofMat, base);
  // undersides
  const wood = M('planksDark');
  const tY = thick;
  batch.add(polyGeo([V(xL, eaveY - tY, zE), V(xL, rh - tY, 0), V(xR, rh - tY, 0), V(xR, eaveY - tY, zE)], [[0, 0], [0, 1], [2, 1], [2, 0]]), wood, base);
  batch.add(polyGeo([V(xR, eaveY - tY, -zE), V(xR, rh - tY, 0), V(xL, rh - tY, 0), V(xL, eaveY - tY, -zE)], [[0, 0], [0, 1], [2, 1], [2, 0]]), wood, base);
  // fascia boards
  const beam = M('beam');
  for (const s of [1, -1]) {
    const z = s * zE;
    const pts = s > 0
      ? [V(xL, eaveY - tY, z), V(xR, eaveY - tY, z), V(xR, eaveY, z), V(xL, eaveY, z)]
      : [V(xR, eaveY - tY, z), V(xL, eaveY - tY, z), V(xL, eaveY, z), V(xR, eaveY, z)];
    batch.add(polyGeo(pts, [[0, 0], [w, 0], [w, 0.15], [0, 0.15]]), beam, base);
  }
  // verge boards (sloped side edges)
  for (const [x, s] of [[xR, 1], [xL, -1]]) {
    const front = [V(x, eaveY - tY, zE), V(x, rh - tY, 0), V(x, rh, 0), V(x, eaveY, zE)];
    const backq = [V(x, rh - tY, 0), V(x, eaveY - tY, -zE), V(x, eaveY, -zE), V(x, rh, 0)];
    for (const q of [front, backq]) {
      const pts = s > 0 ? q : [q[3], q[2], q[1], q[0]];
      batch.add(polyGeo(pts, [[0, 0], [L, 0], [L, 0.15], [0, 0.15]]), beam, base);
    }
  }
  // gable triangles
  const gt = Textures[gableTex]();
  const gU = gt.userData.unitsU, gV = gt.userData.unitsV;
  batch.add(polyGeo([V(w / 2, 0, d / 2), V(w / 2, 0, -d / 2), V(w / 2, rh, 0)], [[0, 0], [d / gU, 0], [d / 2 / gU, rh / gV]]), M(gableTex), base);
  batch.add(polyGeo([V(-w / 2, 0, -d / 2), V(-w / 2, 0, d / 2), V(-w / 2, rh, 0)], [[0, 0], [d / gU, 0], [d / 2 / gU, rh / gV]]), M(gableTex), base);
  // ridge cap
  addBox(batch, null, 'beam', xR - xL + 0.1, 0.16, 0.26, 0, rh - 0.02, 0, base);
  return { eaveY, zE };
}

function baseMatrix(x, y, z, ry) {
  return new THREE.Matrix4().compose(V(x, y, z), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ry), V(1, 1, 1));
}

/**
 * A timber-framed cottage.
 * opts: w, d, wallH, roofH, roofTex, wallTex, door:{x}, windows:[{face,x}],
 *       chimney:{x,z}|null, ry (multiples of PI/2)
 */
export function buildHouse(batch, x, y, z, opts = {}) {
  const o = {
    w: 6, d: 4, wallH: 2.4, roofH: 1.9, roofTex: 'roofRed', wallTex: 'plaster',
    door: { x: 0 }, windows: [{ face: 'front', x: -1.8 }, { face: 'front', x: 1.8 }],
    chimney: { x: 1.6, z: -0.8 }, ry: 0, shutters: '#3f6f8f', ...opts,
  };
  const { w, d, wallH, roofH } = o;
  const base = baseMatrix(x, y, z, o.ry);
  const found = 0.45;
  const top = found + wallH;
  const info = { lights: [], chimneys: [], flowerBoxes: [], door: null };
  const toWorld = (lx, ly, lz) => V(lx, ly, lz).applyMatrix4(base);

  addBox(batch, null, 'brick', w + 0.3, found, d + 0.3, 0, found / 2, 0, base);
  addBox(batch, null, o.wallTex, w, wallH, d, 0, found + wallH / 2, 0, base);
  // timber frame
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(batch, null, 'beam', 0.24, wallH, 0.24, sx * w / 2, found + wallH / 2, sz * d / 2, base);
  for (const yy of [found + 0.08, top - 0.08]) {
    addBox(batch, null, 'beam', w + 0.1, 0.16, 0.08, 0, yy, d / 2 + 0.02, base);
    addBox(batch, null, 'beam', w + 0.1, 0.16, 0.08, 0, yy, -d / 2 - 0.02, base);
    addBox(batch, null, 'beam', 0.08, 0.16, d + 0.1, w / 2 + 0.02, yy, 0, base);
    addBox(batch, null, 'beam', 0.08, 0.16, d + 0.1, -w / 2 - 0.02, yy, 0, base);
  }
  // door
  if (o.door) {
    const dx = o.door.x;
    addBox(batch, M('door'), 'door', 0.95, 1.75, 0.1, dx, found + 0.875, d / 2 + 0.03, base, 0, true);
    addBox(batch, null, 'beam', 0.16, 1.95, 0.16, dx - 0.56, found + 0.97, d / 2 + 0.05, base);
    addBox(batch, null, 'beam', 0.16, 1.95, 0.16, dx + 0.56, found + 0.97, d / 2 + 0.05, base);
    addBox(batch, null, 'beam', 1.36, 0.18, 0.18, dx, found + 1.9, d / 2 + 0.06, base);
    addBox(batch, null, 'slab', 1.4, 0.24, 0.5, dx, 0.12, d / 2 + 0.4, base);
    info.door = toWorld(dx, 0, d / 2 + 0.9);
    // little wall lantern beside the door
    addBox(batch, propMaterials.lantern, null, 0.2, 0.26, 0.2, dx + 0.9, found + 1.75, d / 2 + 0.18, base, 0, true);
    addBox(batch, null, 'iron', 0.28, 0.06, 0.28, dx + 0.9, found + 1.91, d / 2 + 0.18, base);
    addBox(batch, null, 'iron', 0.06, 0.06, 0.2, dx + 0.9, found + 1.75, d / 2 + 0.06, base);
    info.lights.push(toWorld(dx + 0.9, found + 1.75, d / 2 + 0.4));
  }
  // windows
  for (const win of o.windows) {
    const faceRot = { front: 0, right: Math.PI / 2, back: Math.PI, left: -Math.PI / 2 }[win.face];
    const depth = win.face === 'front' || win.face === 'back' ? d : w;
    const fb = base.clone().multiply(baseMatrix(0, 0, 0, faceRot));
    const wy = found + wallH * 0.56;
    const zf = depth / 2;
    addBox(batch, propMaterials.window, 'window', 0.95, 0.95, 0.08, win.x, wy, zf + 0.02, fb, 0, true);
    if (o.shutters) {
      addBox(batch, null, 'planksDark', 0.3, 1.0, 0.06, win.x - 0.66, wy, zf + 0.05, fb);
      addBox(batch, null, 'planksDark', 0.3, 1.0, 0.06, win.x + 0.66, wy, zf + 0.05, fb);
    }
    addBox(batch, null, 'beam', 1.15, 0.12, 0.14, win.x, wy + 0.53, zf + 0.06, fb);
    if (win.flowers !== false) {
      addBox(batch, null, 'planks', 1.0, 0.22, 0.28, win.x, wy - 0.6, zf + 0.15, fb);
      const p = V(win.x, wy - 0.49, zf + 0.17).applyMatrix4(fb);
      info.flowerBoxes.push(p);
    }
  }
  // roof
  const roofBase = base.clone().multiply(baseMatrix(0, top, 0, 0));
  const roof = addRoof(batch, roofBase, { w, d, rh: roofH, roofTex: o.roofTex, gableTex: o.wallTex });
  // chimney
  if (o.chimney) {
    const cx = o.chimney.x, cz = o.chimney.z;
    const roofY = roofH * (1 - Math.abs(cz) / (d / 2));
    const h = roofY + 1.0;
    addBox(batch, null, 'brick', 0.6, h + 0.3, 0.6, cx, top + h / 2 - 0.15, cz, base);
    addBox(batch, null, 'slab', 0.74, 0.14, 0.74, cx, top + h, cz, base);
    info.chimneys.push(toWorld(cx, top + h + 0.15, cz));
  }
  // collision footprint in world space
  const corners = [V(-w / 2 - 0.2, 0, -d / 2 - 0.2), V(w / 2 + 0.2, 0, d / 2 + 0.25)].map((p) => p.applyMatrix4(base));
  info.footprint = {
    minX: Math.min(corners[0].x, corners[1].x), maxX: Math.max(corners[0].x, corners[1].x),
    minZ: Math.min(corners[0].z, corners[1].z), maxZ: Math.max(corners[0].z, corners[1].z),
  };
  info.roofEave = roof.eaveY + top;
  return info;
}

/** Fence through a list of [x, z] points (posts every ~1 unit). Returns colliders. */
export function buildFence(batch, points, groundAt, { height = 0.9 } = {}) {
  const colliders = [];
  for (let s = 0; s < points.length - 1; s++) {
    const [x0, z0] = points[s];
    const [x1, z1] = points[s + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.round(len));
    const ang = Math.atan2(-(z1 - z0), x1 - x0);
    for (let k = 0; k <= n; k++) {
      if (k === 0 && s > 0) continue;
      const t = k / n;
      const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      const gy = groundAt(px, pz);
      addBox(batch, null, 'planks', 0.16, height, 0.16, px, gy + height / 2, pz, new THREE.Matrix4());
      addBox(batch, null, 'planks', 0.22, 0.08, 0.22, px, gy + height, pz, new THREE.Matrix4());
    }
    for (let k = 0; k < n; k++) {
      const ta = k / n, tb = (k + 1) / n;
      const ax = x0 + (x1 - x0) * ta, az = z0 + (z1 - z0) * ta;
      const bx = x0 + (x1 - x0) * tb, bz = z0 + (z1 - z0) * tb;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const gy = Math.max(groundAt(ax, az), groundAt(bx, bz));
      const seg = Math.hypot(bx - ax, bz - az);
      for (const ry of [0.38, 0.72]) {
        const m = new THREE.Matrix4().compose(V(mx, gy + ry * height, mz), new THREE.Quaternion().setFromAxisAngle(V(0, 1, 0), ang), V(1, 1, 1));
        batch.add(boxGeo(seg, 0.1, 0.07, 'planks'), M('planks'), m);
      }
    }
    colliders.push({ x0, z0, x1, z1 });
  }
  return colliders;
}

export function buildCrate(batch, x, y, z, { size = 0.8, ry = 0 } = {}) {
  addBox(batch, M('crate'), 'crate', size, size, size, x, y + size / 2, z, new THREE.Matrix4(), ry, true);
}

export function buildBarrel(batch, x, y, z, { r = 0.36, h = 0.86 } = {}) {
  const side = new THREE.CylinderGeometry(r * 0.9, r * 0.9, h, 10, 3, true);
  // bulge the middle ring
  const p = side.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i);
    const k = 1 + 0.12 * (1 - Math.pow((yy / (h / 2)), 2));
    p.setX(i, p.getX(i) * k);
    p.setZ(i, p.getZ(i) * k);
  }
  side.computeVertexNormals();
  const uv = side.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * 2);
  batch.add(side, M('barrel'), new THREE.Matrix4().makeTranslation(x, y + h / 2, z));
  const lid = new THREE.CircleGeometry(r * 0.9, 10);
  lid.rotateX(-Math.PI / 2);
  batch.add(lid, M('barrelTop'), new THREE.Matrix4().makeTranslation(x, y + h, z));
}

/** Street lamp; returns the lantern position for a light. */
export function buildLampPost(batch, x, y, z, { height = 2.5, dir = 1 } = {}) {
  const I = new THREE.Matrix4();
  addBox(batch, null, 'stone', 0.4, 0.3, 0.4, x, y + 0.15, z, I);
  addBox(batch, null, 'iron', 0.14, height, 0.14, x, y + height / 2, z, I);
  addBox(batch, null, 'iron', 0.62, 0.08, 0.08, x + dir * 0.26, y + height - 0.05, z, I);
  const lx = x + dir * 0.5, ly = y + height - 0.38;
  addBox(batch, propMaterials.lantern, null, 0.3, 0.38, 0.3, lx, ly, z, I, 0, true);
  addBox(batch, null, 'iron', 0.4, 0.07, 0.4, lx, ly + 0.22, z, I);
  addBox(batch, null, 'iron', 0.36, 0.06, 0.36, lx, ly - 0.2, z, I);
  const cap = new THREE.ConeGeometry(0.26, 0.22, 4, 1);
  cap.rotateY(Math.PI / 4);
  batch.add(cap, M('iron'), new THREE.Matrix4().makeTranslation(lx, ly + 0.35, z));
  return V(lx, ly, z);
}

export function buildWell(batch, x, y, z) {
  const ring = new THREE.CylinderGeometry(0.95, 1.0, 0.85, 14, 1, true);
  const uv = ring.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 0.4);
  batch.add(ring, M('brick'), new THREE.Matrix4().makeTranslation(x, y + 0.425, z));
  const inner = new THREE.CylinderGeometry(0.75, 0.75, 0.85, 14, 1, true);
  inner.scale(-1, 1, 1);
  const n = inner.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), n.getY(i), -n.getZ(i));
  batch.add(inner, M('brick'), new THREE.Matrix4().makeTranslation(x, y + 0.425, z));
  const rim = new THREE.RingGeometry(0.73, 1.02, 14, 1);
  rim.rotateX(-Math.PI / 2);
  batch.add(rim, M('slab'), new THREE.Matrix4().makeTranslation(x, y + 0.86, z));
  const water = new THREE.CircleGeometry(0.75, 14);
  water.rotateX(-Math.PI / 2);
  batch.add(water, M('iron'), new THREE.Matrix4().makeTranslation(x, y + 0.35, z));
  const I = new THREE.Matrix4();
  for (const s of [-1, 1]) addBox(batch, null, 'beam', 0.16, 2.0, 0.16, x + s * 0.88, y + 1.0, z, I);
  addBox(batch, null, 'beam', 2.0, 0.12, 0.12, x, y + 1.6, z, I);
  addBox(batch, M('barrel'), 'barrel', 0.28, 0.3, 0.28, x + 0.2, y + 1.15, z, I);
  const roofBase = baseMatrix(x, y + 2.0, z, 0);
  addRoof(batch, roofBase, { w: 1.9, d: 1.5, rh: 0.75, ov: 0.25, so: 0.2, thick: 0.08, roofTex: 'roofThatch', gableTex: 'planks' });
}

/** Wooden deck between two points (bridge or pier). Returns deck top height. */
export function buildDeck(batch, x0, z0, x1, z1, y, { rails = true, posts = true, postDepth = 1.4 } = {}) {
  const I = new THREE.Matrix4();
  const w = x1 - x0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  addBox(batch, null, 'deck', w, 0.16, d, cx, y - 0.08, cz, I);
  const alongX = w >= d;
  const len = alongX ? w : d;
  const n = Math.max(1, Math.round(len / 1.5));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    for (const s of [0, 1]) {
      const px = alongX ? x0 + w * t : s ? x1 - 0.1 : x0 + 0.1;
      const pz = alongX ? (s ? z1 - 0.1 : z0 + 0.1) : z0 + d * t;
      if (posts) addBox(batch, null, 'beam', 0.18, postDepth, 0.18, px, y - postDepth / 2, pz, I);
      if (rails) addBox(batch, null, 'beam', 0.14, 0.75, 0.14, px, y + 0.37, pz, I);
    }
  }
  if (rails) {
    for (const s of [0, 1]) {
      if (alongX) addBox(batch, null, 'planks', w, 0.1, 0.1, cx, y + 0.72, s ? z1 - 0.1 : z0 + 0.1, I);
      else addBox(batch, null, 'planks', 0.1, 0.1, d, s ? x1 - 0.1 : x0 + 0.1, y + 0.72, cz, I);
    }
  }
  return y;
}

export function buildStall(batch, x, y, z, { w = 2.6, d = 1.4, awning = 'awning' } = {}) {
  const I = new THREE.Matrix4();
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) addBox(batch, null, 'beam', 0.14, sz > 0 ? 1.9 : 2.3, 0.14, x + sx * w / 2, y + (sz > 0 ? 0.95 : 1.15), z + sz * d / 2, I);
  addBox(batch, null, 'planks', w, 0.9, 0.5, x, y + 0.45, z + d / 2 - 0.25, I);
  addBox(batch, null, 'deck', w + 0.16, 0.08, 0.62, x, y + 0.93, z + d / 2 - 0.25, I);
  // sloped striped awning
  const a = Textures[awning]();
  const uU = a.userData.unitsU;
  const front = V(0, y + 1.95, z + d / 2 + 0.35), back = V(0, y + 2.4, z - d / 2 - 0.05);
  const L = front.distanceTo(back);
  const xl = x - w / 2 - 0.2, xr = x + w / 2 + 0.2;
  batch.add(polyGeo([V(xl, front.y, front.z), V(xr, front.y, front.z), V(xr, back.y, back.z), V(xl, back.y, back.z)], [[0, 0], [(xr - xl) / uU, 0], [(xr - xl) / uU, L], [0, L]]), M(awning), I);
  batch.add(polyGeo([V(xl, front.y - 0.02, front.z), V(xl, back.y - 0.02, back.z), V(xr, back.y - 0.02, back.z), V(xr, front.y - 0.02, front.z)], [[0, 0], [0, L], [(xr - xl) / uU, L], [(xr - xl) / uU, 0]]), M(awning), I);
  addBox(batch, M(awning), awning, w + 0.4, 0.22, 0.04, x, y + 1.85, z + d / 2 + 0.36, I);
  return { counterTop: V(x, y + 0.97, z + d / 2 - 0.25) };
}

export function buildBench(batch, x, y, z, { len = 1.6, ry = 0 } = {}) {
  const base = baseMatrix(x, y, z, ry);
  addBox(batch, null, 'planks', len, 0.1, 0.45, 0, 0.45, 0, base);
  for (const s of [-1, 1]) addBox(batch, null, 'beam', 0.12, 0.42, 0.4, s * (len / 2 - 0.15), 0.21, 0, base);
}

/** Ring of stones and crossed logs; the flame sprite is added separately. */
export function buildCampfireBase(batch, x, y, z) {
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * Math.PI * 2;
    const s = 0.26 + (k % 3) * 0.03;
    addBox(batch, null, 'stone', s, s * 0.75, s, x + Math.cos(a) * 0.62, y + s * 0.35, z + Math.sin(a) * 0.62, new THREE.Matrix4(), a);
  }
  for (let k = 0; k < 3; k++) {
    const log = new THREE.CylinderGeometry(0.09, 0.1, 0.95, 6);
    log.rotateZ(Math.PI / 2 - 0.25);
    log.rotateY((k / 3) * Math.PI);
    batch.add(log, M('planksDark'), new THREE.Matrix4().makeTranslation(x, y + 0.18, z));
  }
}

export function buildShrine(batch, x, y, z) {
  const I = new THREE.Matrix4();
  addBox(batch, null, 'slab', 4.2, 0.3, 3.2, x, y + 0.15, z, I);
  addBox(batch, null, 'slab', 3.2, 0.3, 2.2, x, y + 0.45, z, I);
  for (const s of [-1, 1]) {
    addBox(batch, null, 'brick', 0.55, 3.0, 0.55, x + s * 1.3, y + 0.6 + 1.5, z - 0.4, I);
    addBox(batch, null, 'slab', 0.75, 0.2, 0.75, x + s * 1.3, y + 0.7, z - 0.4, I);
  }
  addBox(batch, null, 'slab', 3.5, 0.32, 0.8, x, y + 3.65, z - 0.4, I);
  addBox(batch, null, 'roofBlue', 3.9, 0.16, 1.0, x, y + 3.9, z - 0.4, I);
  addBox(batch, null, 'stone', 0.9, 0.7, 0.7, x, y + 0.95, z - 0.4, I);
  return { altar: V(x, y + 1.3, z - 0.4), torches: [V(x - 1.3, y + 3.05, z + 0.05), V(x + 1.3, y + 3.05, z + 0.05)] };
}
