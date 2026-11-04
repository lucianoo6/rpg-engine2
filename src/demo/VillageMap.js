import { TileMap } from '../engine/world/TileMap.js';
import { valueNoise } from '../engine/core/Random.js';
import { tileTypes } from '../engine/world/TileTypes.js';

/**
 * Layout of "Hollowbrook", the demo village, authored in code:
 * a two-tier cliff plateau with a shrine and waterfall to the north, a lake
 * and river to the east, a raised cobbled square in the middle, meadows and
 * a farm to the south-west. All heights are multiples of 0.5.
 */

export const TILE_TYPES = tileTypes();

export const W = 56;
export const D = 46;

/** Points of interest shared by the decorator and the game logic. */
export const POI = {
  start: [22, 33.2],
  square: { x: 22, z: 25, r: 5.6 },
  crystal: [22, 25.2],
  well: [18.2, 27.6],
  stall: [24.6, 21.2],
  campfire: [27.2, 34.6],
  stairs: { x0: 17, x1: 18, top: 9 },
  shrine: [17.6, 5.2],
  waterfall: { x0: 30, x1: 33, z: 10 },
  lake: { x: 35.5, z: 15.2, rx: 8.6, rz: 5.6 },
  pier: { x0: 30.1, x1: 31.9, z0: 13.6, z1: 20.6, y: 0.28 },
  bridge: { x0: 41.2, x1: 47.0, z0: 27.85, z1: 30.15, y: 0.3 },
  houses: [
    { name: 'inn', x: 10.5, z: 19.6, w: 7, d: 4.4, roofTex: 'roofRed', wallTex: 'plaster', door: { x: 1.2 }, windows: [{ face: 'front', x: -1.9 }, { face: 'front', x: 2.8, flowers: false }, { face: 'right', x: 0 }], chimney: { x: -2.2, z: -0.9 } },
    { name: 'cottage', x: 33.6, z: 25.4, w: 5.2, d: 3.6, roofTex: 'roofBlue', wallTex: 'plasterBlue', door: { x: -1.0 }, windows: [{ face: 'front', x: 1.1 }, { face: 'left', x: 0 }], chimney: { x: 1.4, z: -0.6 } },
    { name: 'farmhouse', x: 11.5, z: 29.6, w: 5.2, d: 3.8, roofTex: 'roofGreen', wallTex: 'plaster', door: { x: 0.9 }, windows: [{ face: 'front', x: -1.2 }, { face: 'right', x: 0 }], chimney: { x: -1.3, z: 0.6 } },
    { name: 'hut', x: 34.2, z: 36.2, w: 4.4, d: 3.4, wallH: 2.1, roofH: 1.6, roofTex: 'roofThatch', wallTex: 'plaster', door: { x: -0.8 }, windows: [{ face: 'front', x: 1.0 }], chimney: null },
  ],
  paths: [
    { pts: [[22, 46], [22, 40], [21.5, 33], [22, 30]], w: 1.15 },
    { pts: [[20.5, 20.5], [18.5, 17], [17.5, 15]], w: 1.05 },
    { pts: [[26.5, 22], [29.5, 21.2], [31.2, 20.6]], w: 0.95 },
    { pts: [[27, 27.5], [33, 29], [41.5, 29]], w: 1.05 },
    { pts: [[46.5, 29], [55.5, 28.5]], w: 1.05 },
    { pts: [[17.2, 27], [14, 30.5], [12.4, 32.2]], w: 0.9 },
    { pts: [[25, 30], [26.4, 32.6]], w: 0.85 },
    { pts: [[28.6, 35.6], [32.5, 38.4]], w: 0.85 },
    { pts: [[11.8, 22.4], [13, 21.8]], w: 0.8 },
  ],
  river: [[40, 19], [43, 23.5], [44.2, 29], [45.6, 35], [46.4, 41], [47, 46.5]],
  farm: { x0: 3, z0: 33, x1: 9, z1: 37 },
  terrace: { x0: 2, z0: 38, x1: 9, z1: 43 },
};

function distToSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz || 1)));
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

export function distToPolyline(px, pz, pts) {
  let d = Infinity;
  for (let k = 0; k < pts.length - 1; k++) d = Math.min(d, distToSeg(px, pz, pts[k][0], pts[k][1], pts[k + 1][0], pts[k + 1][1]));
  return d;
}

export function plateauEdge(i) {
  if (i >= 14 && i <= 21) return 9;
  if (i >= 28 && i <= 35) return 9;
  return Math.round(9 + Math.sin(i * 0.45) * 1.1 + Math.sin(i * 0.17 + 1) * 0.9);
}

export function backEdge(i) {
  return Math.round(3 + Math.sin(i * 0.3 + 2) * 1.2);
}

export function isInLake(x, z) {
  const L = POI.lake;
  const n = (valueNoise(x * 0.35, z * 0.35, 5) - 0.5) * 0.35;
  const dx = (x - L.x) / L.rx, dz = (z - L.z) / L.rz;
  return dx * dx + dz * dz < 1 + n;
}

export function createVillageMap() {
  const map = new TileMap(W, D, TILE_TYPES);
  map.waterLevel = -0.18;
  map.fillRect(0, 0, W - 1, D - 1, 0, 'grass');

  // forest floor around the borders, meadow in the south
  map.each((i, j) => {
    const edge = Math.min(i, W - 1 - i, D - 1 - j);
    const n = valueNoise(i * 0.3, j * 0.3, 2);
    if (edge < 3 + n * 2) return { type: 'forest' };
    if (j > 32 && valueNoise(i * 0.15, j * 0.15, 9) > 0.45) return { type: 'meadow' };
    return null;
  });

  // two-tier plateau with cliffs
  for (let i = 0; i < W; i++) {
    const e = plateauEdge(i), b = backEdge(i);
    for (let j = 0; j <= e; j++) map.set(i, j, j <= b ? 4 : 3, j <= b ? 'highland' : 'plateau');
  }

  // lake with sandy shore
  map.each((i, j, h) => {
    const x = i + 0.5, z = j + 0.5;
    if (h > 0.1) return null;
    if (isInLake(x, z)) {
      const L = POI.lake;
      const deep = ((x - L.x) / L.rx) ** 2 + ((z - L.z) / L.rz) ** 2 < 0.45;
      return { h: deep ? -1 : -0.5, type: 'lakebed' };
    }
    return null;
  });
  // outflow river
  map.each((i, j, h) => {
    if (h > 0.1) return null;
    const d = distToPolyline(i + 0.5, j + 0.5, POI.river);
    if (d < 1.25) return { h: -0.5, type: 'lakebed' };
    return null;
  });
  // shores
  map.each((i, j, h, type) => {
    if (h !== 0) return null;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (map.isWaterTile(i + di, j + dj)) return { type: 'sand' };
    }
    return null;
  });

  // river running off the plateau (feeds the waterfall)
  const wf = POI.waterfall;
  for (let i = wf.x0; i < wf.x1; i++) for (let j = 0; j <= plateauEdge(i); j++) map.set(i, j, 2, 'lakebed');

  // dirt paths
  map.each((i, j, h, type) => {
    if (h !== 0 || type === 'lakebed') return null;
    for (const p of POI.paths) {
      const n = (valueNoise(i * 0.5, j * 0.5, 11) - 0.5) * 0.5;
      if (distToPolyline(i + 0.5, j + 0.5, p.pts) < p.w + n) return { type: 'path' };
    }
    return null;
  });

  // raised cobble square
  const S = POI.square;
  map.each((i, j, h) => {
    if (h !== 0) return null;
    const d = Math.hypot(i + 0.5 - S.x, (j + 0.5 - S.z) * 1.1);
    if (d < S.r) return { h: 0.5, type: 'cobble' };
    return null;
  });

  // stone stairs up the cliff
  const st = POI.stairs;
  for (let k = 0; k < 6; k++) {
    const j = st.top + 1 + k;
    for (let i = st.x0; i <= st.x1; i++) map.set(i, j, 2.5 - k * 0.5, 'slab');
  }
  // path on the plateau to the shrine
  for (let j = 3; j <= st.top; j++) for (let i = st.x0; i <= st.x1; i++) if (map.h(i, j) === 3) map.set(i, j, 3, 'path');
  for (let j = 2; j <= 7; j++) for (let i = 14; i <= 21; i++) {
    if (Math.hypot(i + 0.5 - POI.shrine[0], (j + 0.5 - POI.shrine[1]) * 1.3) < 3.4) map.set(i, j, 3, 'path');
  }
  for (let j = 0; j <= 3; j++) for (let i = 14; i <= 21; i++) map.set(i, j, 3, j < 2 ? 'plateau' : map.typeAt(i, j).name === 'path' ? 'path' : 'plateau');

  // farm field and a raised meadow terrace
  const F = POI.farm;
  map.fillRect(F.x0, F.z0, F.x1, F.z1, 0, 'farm');
  const T = POI.terrace;
  map.each((i, j) => ({ h: 0.5, type: 'meadow' }), T.x0, T.z0, T.x1, T.z1);
  map.each((i, j) => ({ h: 1.0, type: 'meadow' }), T.x0, T.z0 + 1, T.x1 - 2, T.z1);

  // walkable decks over water
  const P = POI.pier;
  map.setDeck(Math.floor(P.x0), Math.floor(P.z0), Math.floor(P.x1 - 0.01), Math.floor(P.z1 - 0.01), P.y);
  const B = POI.bridge;
  map.setDeck(Math.floor(B.x0), Math.floor(B.z0 + 0.2), Math.floor(B.x1 - 0.01), Math.floor(B.z1 - 0.2), B.y);
  return map;
}
