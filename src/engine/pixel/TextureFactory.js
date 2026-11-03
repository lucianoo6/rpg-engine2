import { PixelCanvas, toTexture } from './PixelCanvas.js';
import { hex, ramp, shift, mix } from './Palette.js';
import { RNG, fbm, bayer, hash2, makeVoronoi, clamp } from '../core/Random.js';

/** World pixel density: every world unit is 16 texels. */
export const PPU = 16;

const q = (v, steps, x, y, dither = 0.6) =>
  clamp(Math.floor((v + (bayer(x, y) - 0.5) * (dither / steps)) * steps), 0, steps - 1);

/* ------------------------------------------------------------------ */
/*  Ground (top) surfaces — all tile seamlessly, 64px = 4 world units  */
/* ------------------------------------------------------------------ */

export function paintGrass({ base = '#5f9e3f', seed = 1, size = 64, flowers = true } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 6, 0.055);
  const rng = new RNG(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const n = fbm(u, v, { freq: 4, octaves: 3, seed }) * 0.65 + fbm(u, v, { freq: 16, octaves: 2, seed: seed + 9 }) * 0.35;
      pc.set(x, y, r[1 + q(n * 1.15 - 0.07, 3, x, y)]);
    }
  }
  // Blade strokes: light tip, mid body, dark shadow at the root.
  for (let k = 0; k < size * 4.5; k++) {
    const x = rng.int(0, size - 1);
    const y = rng.int(0, size - 1);
    const light = rng.chance(0.6);
    pc.setWrap(x, y, light ? r[4] : r[3]);
    pc.setWrap(x, y + 1, r[2]);
    if (rng.chance(0.5)) pc.setWrap(x + 1, y + 1, r[0]);
  }
  for (let k = 0; k < size * 0.6; k++) {
    const x = rng.int(0, size - 1), y = rng.int(0, size - 1);
    pc.setWrap(x, y, r[5]);
  }
  if (flowers) {
    const petals = [hex('#f4f1e2'), hex('#f6d860'), hex('#e98fb0')];
    for (let k = 0; k < size / 10; k++) {
      const x = rng.int(0, size - 1), y = rng.int(0, size - 1);
      pc.setWrap(x, y, rng.pick(petals));
      pc.setWrap(x, y + 1, r[0]);
    }
  }
  return pc;
}

export function paintDirt({ base = '#a27b54', seed = 2, size = 64 } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 5, 0.06);
  const rng = new RNG(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, { freq: 5, octaves: 3, seed });
      pc.set(x, y, r[1 + q(n, 3, x, y)]);
    }
  }
  for (let k = 0; k < size * 0.8; k++) {
    const x = rng.int(0, size - 1), y = rng.int(0, size - 1);
    const w = rng.chance(0.5) ? 2 : 1;
    for (let i = 0; i < w; i++) pc.setWrap(x + i, y, r[4]);
    for (let i = 0; i < w; i++) pc.setWrap(x + i, y + 1, r[0]);
  }
  return pc;
}

export function paintCobble({ base = '#a39b8b', seed = 3, size = 64, cells = 8 } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 6, 0.06);
  const vor = makeVoronoi(size, cells, seed, 0.75);
  const cell = size / cells;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const { d1, d2, id, cx, cy } = vor(x + 0.5, y + 0.5);
      const edge = d2 - d1;
      if (edge < 1.5) {
        pc.set(x, y, r[0]);
        continue;
      }
      const hv = hash2(id, 3, seed);
      let tone = hv < 0.3 ? 2 : hv > 0.78 ? 4 : 3;
      const rx = (x + 0.5 - cx) / cell, ry = (y + 0.5 - cy) / cell;
      if (edge < 3.2) tone += rx + ry < 0 ? 1 : -1;
      const n = fbm(x / size, y / size, { freq: 16, octaves: 1, seed: seed + 4 });
      if (n > 0.78) tone -= 1;
      pc.set(x, y, r[clamp(tone, 1, 5)]);
    }
  }
  return pc;
}

export function paintSand({ base = '#dcc590', seed = 4, size = 64 } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 5, 0.05);
  const rng = new RNG(seed);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, { freq: 6, octaves: 3, seed });
      pc.set(x, y, r[1 + q(n, 3, x, y)]);
    }
  }
  for (let k = 0; k < size * 1.2; k++) pc.setWrap(rng.int(0, size), rng.int(0, size), rng.chance(0.7) ? r[0] : r[4]);
  return pc;
}

export function paintSlab({ base = '#9e9a90', seed = 5, size = 64 } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 6, 0.06);
  const rng = new RNG(seed);
  const rows = [0, 16, 32, 48];
  for (const [ri, ry] of rows.entries()) {
    let x = ri % 2 ? -8 : 0;
    while (x < size) {
      const w = rng.pick([16, 16, 24]);
      const tone = rng.int(2, 3);
      for (let j = 0; j < 16; j++) {
        for (let i = 0; i < w; i++) {
          const px = x + i, py = ry + j;
          let t = tone;
          if (i === 0 || j === 0) t = 0;
          else if (i === 1 || j === 1) t = tone + 1;
          else if (j === 15 || i === w - 1) t = tone - 1;
          const n = fbm(((px % size) + size) % size / size, py / size, { freq: 12, octaves: 2, seed });
          if (n > 0.72 && t > 1) t -= 1;
          pc.setWrap(px, py, r[clamp(t, 0, 5)]);
        }
      }
      x += w;
    }
  }
  return pc;
}

export function paintFarmland({ base = '#7b5637', seed = 6, size = 64 } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 5, 0.06);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, { freq: 8, octaves: 2, seed });
      const row = y % 8;
      let t = row < 2 ? 3 : row < 5 ? 2 : row < 7 ? 1 : 0;
      if (n > 0.66) t = Math.min(4, t + 1);
      if (n < 0.3) t = Math.max(0, t - 1);
      pc.set(x, y, r[t]);
    }
  }
  return pc;
}

/* ------------------------------------------------------------------ */
/*  Side surfaces (cliffs, steps). Width tiles, height clamps so the    */
/*  grassy lip always sits on the top edge of a step.                   */
/* ------------------------------------------------------------------ */

function paintLip(pc, grassBase, seed, maxDepth = 5) {
  const g = ramp(grassBase, 5, 0.06);
  const rng = new RNG(seed);
  for (let x = 0; x < pc.w; x++) {
    const n = fbm(x / pc.w, 0.5, { freq: 8, octaves: 2, seed });
    let depth = Math.round(2 + n * (maxDepth - 1));
    if (rng.chance(0.12)) depth += rng.int(2, 5); // hanging blades
    for (let y = 0; y < depth; y++) {
      const t = y === 0 ? 4 : y === depth - 1 ? 1 : y < 2 ? 3 : 2;
      pc.set(x, y, g[t]);
    }
    pc.set(x, depth, shift(g[0], -0.12)); // contact shadow under the lip
  }
}

export function paintCliff({ base = '#8b8070', grass = '#5f9e3f', seed = 7, w = 64, h = 64 } = {}) {
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 6, 0.065);
  const rng = new RNG(seed);
  let y = 0;
  while (y < h) {
    const lh = rng.int(6, 10);
    let x = -rng.int(0, 10);
    while (x < w) {
      const bw = rng.int(9, 18);
      const tone = rng.int(2, 3);
      for (let j = 0; j < lh; j++) {
        for (let i = 0; i < bw; i++) {
          const px = x + i, py = y + j;
          let t = tone;
          if (i === 0 || j === lh - 1) t = 0;
          else if (j === 0) t = tone + 2;
          else if (j === 1 || i === 1) t = tone + 1;
          else if (j >= lh - 3) t = tone - 1;
          const n = fbm(((px % w) + w) % w / w, py / h, { freq: 10, octaves: 2, seed });
          if (n > 0.7) t -= 1;
          if (n < 0.25) t += 1;
          pc.setWrap(px, py, r[clamp(t, 0, 5)]);
        }
      }
      x += bw;
    }
    y += lh;
  }
  // moss streaks
  const m = ramp('#557d3a', 3, 0.06);
  for (let k = 0; k < w / 6; k++) {
    const x = rng.int(0, w - 1);
    const len = rng.int(3, 14);
    for (let j = 0; j < len; j++) if (rng.chance(0.8)) pc.set(x, 5 + j, m[rng.int(0, 2)]);
  }
  paintLip(pc, grass, seed + 1, 6);
  return pc;
}

export function paintEarthSide({ base = '#7a573a', grass = '#5f9e3f', seed = 8, w = 64, h = 32, lip = true } = {}) {
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 5, 0.06);
  const rng = new RNG(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / w, y / h, { freq: 6, octaves: 3, seed });
      const band = Math.sin(y * 0.9 + n * 6) * 0.15;
      pc.set(x, y, r[1 + q(n + band, 3, x, y)]);
    }
  }
  for (let k = 0; k < w / 3; k++) {
    const x = rng.int(0, w - 1), y = rng.int(4, h - 2);
    pc.set(x, y, r[4]); pc.set(x + 1, y, r[3]); pc.set(x, y + 1, r[0]); pc.set(x + 1, y + 1, r[0]);
  }
  if (lip) paintLip(pc, grass, seed + 2, 5);
  return pc;
}

export function paintBrick({ base = '#9b9384', seed = 9, w = 32, h = 32, bw = 8, bh = 4, lip = null } = {}) {
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 6, 0.06);
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / bh);
    const off = row % 2 ? bw / 2 : 0;
    for (let x = 0; x < w; x++) {
      const bx = Math.floor((x + off) / bw);
      const lx = (x + off) % bw;
      const ly = y % bh;
      const hv = hash2(bx, row, seed);
      let t = hv < 0.33 ? 2 : hv > 0.75 ? 4 : 3;
      if (lx === 0 || ly === bh - 1) t = 0;
      else if (ly === 0) t += 1;
      else if (ly === bh - 2) t -= 1;
      const n = fbm(x / w, y / h, { freq: 8, octaves: 2, seed });
      if (n > 0.74 && t > 0) t -= 1;
      pc.set(x, y, r[clamp(t, 0, 5)]);
    }
  }
  if (lip) paintLip(pc, lip, seed + 3, 3);
  return pc;
}

/* ------------------------------------------------------------------ */
/*  Building & prop materials                                           */
/* ------------------------------------------------------------------ */

export function paintPlanks({ base = '#9c6b40', seed = 10, w = 32, h = 32, plank = 8, vertical = true } = {}) {
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 5, 0.06);
  const rng = new RNG(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = vertical ? x : y;
      const b = vertical ? y : x;
      const idx = Math.floor(a / plank);
      const la = a % plank;
      const hv = hash2(idx, 0, seed);
      let t = hv < 0.35 ? 1 : hv > 0.7 ? 3 : 2;
      const grain = fbm(((vertical ? x : y) * 4 % w) / w, b / h, { freq: 4, octaves: 2, seed: seed + idx });
      if (grain > 0.68) t -= 1;
      if (la === 0) t = 0;
      else if (la === 1) t += 1;
      pc.set(x, y, r[clamp(t, 0, 4)]);
    }
  }
  for (let k = 0; k < (w / plank) * 2; k++) {
    const idx = k % (w / plank);
    const p = idx * plank + Math.floor(plank / 2);
    const b = k < w / plank ? 2 : (vertical ? h : w) - 3;
    if (vertical) pc.set(p, b, r[0]);
    else pc.set(b, p, r[0]);
  }
  if (rng.chance(1)) {
    // knot
    const kx = rng.int(2, w - 3), ky = rng.int(2, h - 3);
    pc.set(kx, ky, r[0]);
  }
  return pc;
}

export function paintPlaster({ base = '#e6d8bb', seed = 11, w = 32, h = 32 } = {}) {
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 5, 0.035);
  const rng = new RNG(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = fbm(x / w, y / h, { freq: 4, octaves: 3, seed });
      pc.set(x, y, r[1 + q(n, 3, x, y, 0.8)]);
    }
  }
  for (let k = 0; k < 3; k++) {
    let x = rng.int(0, w - 1), y = rng.int(0, h - 1);
    for (let i = 0; i < rng.int(2, 5); i++) {
      pc.setWrap(x, y, r[0]);
      x += rng.int(-1, 1); y += 1;
    }
  }
  return pc;
}

export function paintRoof({ base = '#b5533c', seed = 12, w = 32, h = 32 } = {}) {
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 6, 0.07);
  const sh = 4, sw = 8;
  for (let y = 0; y < h; y++) {
    const row = Math.floor(y / sh);
    const off = row % 2 ? sw / 2 : 0;
    const ly = y % sh;
    for (let x = 0; x < w; x++) {
      const col = Math.floor((x + off) / sw);
      const lx = (x + off) % sw;
      const hv = hash2(col, row, seed);
      let t = hv < 0.3 ? 2 : hv > 0.8 ? 4 : 3;
      // v runs up the slope; bottom edge of each shingle is shadowed by the row below
      if (ly === 0) t = 0;
      else if (ly === 1) t -= 1;
      else if (ly === sh - 1) t += 1;
      if (lx === 0) t -= 1;
      if ((lx === 1 || lx === sw - 1) && ly === 1) t = 0; // rounded corners
      pc.set(x, h - 1 - y, r[clamp(t, 0, 5)]);
    }
  }
  return pc;
}

export function paintWindow({ glass = '#2c3b58', frame = '#5a3b26', emissive = false } = {}) {
  const pc = new PixelCanvas(16, 16);
  const f = ramp(frame, 4, 0.07);
  const g = ramp(glass, 4, 0.08);
  const warm = ramp('#ffbf66', 4, 0.07);
  const black = [0, 0, 0];
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const border = x < 2 || x > 13 || y < 2 || y > 12;
      const mull = x === 7 || x === 8 || y === 7;
      if (y >= 13) {
        // sill
        pc.set(x, y, emissive ? black : y === 13 ? f[3] : y === 14 ? f[2] : f[0]);
      } else if (border || mull) {
        pc.set(x, y, emissive ? black : x === 0 || y === 0 ? f[2] : x === 15 ? f[0] : f[1]);
      } else if (emissive) {
        const d = Math.hypot(x - 7.5, y - 6.5) / 8;
        pc.set(x, y, warm[clamp(3 - Math.floor(d * 4), 0, 3)]);
      } else {
        const refl = (x + y) % 9 === 0 || (x + y) % 9 === 1;
        pc.set(x, y, refl && y < 7 ? g[3] : y < 4 ? g[2] : g[1]);
      }
    }
  }
  return pc;
}

export function paintDoor({ base = '#7a4b2c', seed = 13 } = {}) {
  const pc = new PixelCanvas(16, 32);
  const r = ramp(base, 5, 0.07);
  const iron = ramp('#4a4a52', 3, 0.1);
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 16; x++) {
      let t = 2;
      if (x < 1 || x > 14 || y < 1) t = 0;
      else if ((x - 1) % 5 === 0) t = 1;
      else if ((x - 1) % 5 === 1) t = 3;
      const n = fbm(x / 16, y / 32, { freq: 3, octaves: 2, seed, tile: false });
      if (n > 0.66 && t === 2) t = 1;
      pc.set(x, y, r[t]);
    }
  }
  for (const by of [6, 24]) {
    for (let x = 1; x < 15; x++) {
      pc.set(x, by, iron[1]);
      pc.set(x, by + 1, iron[0]);
    }
    pc.set(2, by, iron[2]);
    pc.set(13, by, iron[2]);
  }
  pc.set(12, 16, hex('#e2b44f'));
  pc.set(12, 17, hex('#9c6f22'));
  return pc;
}

export function paintCrate({ base = '#b3844f', seed = 14 } = {}) {
  const pc = paintPlanks({ base, seed, w: 16, h: 16, plank: 4, vertical: false });
  const r = ramp(base, 5, 0.08);
  for (let i = 0; i < 16; i++) {
    for (const [x, y] of [[i, 0], [i, 15], [0, i], [15, i]]) pc.set(x, y, r[0]);
    for (const [x, y] of [[i, 1], [1, i]]) pc.set(x, y, r[4]);
    if (i > 1 && i < 14) {
      pc.set(i, i, r[3]);
      pc.set(i, i + 1, r[1]);
    }
  }
  return pc;
}

export function paintBarrel({ base = '#8f5d34', seed = 15 } = {}) {
  const pc = paintPlanks({ base, seed, w: 32, h: 16, plank: 4, vertical: true });
  const m = ramp('#5b5d66', 4, 0.09);
  for (const by of [2, 12]) {
    for (let x = 0; x < 32; x++) {
      pc.set(x, by, m[3]);
      pc.set(x, by + 1, m[1]);
    }
  }
  return pc;
}

export function paintBarrelTop({ base = '#8f5d34' } = {}) {
  const pc = new PixelCanvas(16, 16);
  const r = ramp(base, 5, 0.07);
  pc.ellipse(8, 8, 8, 8, (x, y, nx, ny) => {
    const d = Math.hypot(nx, ny);
    if (d > 0.82) return hex('#4f5058');
    return r[Math.floor(d * 8) % 2 ? 2 : 3];
  });
  return pc;
}

export function paintStone({ base = '#8f8b84', seed = 16, size = 32 } = {}) {
  const pc = new PixelCanvas(size, size);
  const r = ramp(base, 5, 0.065);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x / size, y / size, { freq: 4, octaves: 4, seed });
      pc.set(x, y, r[q(n * 1.2 - 0.1, 5, x, y)]);
    }
  }
  return pc;
}

export function paintStripes({ a = '#c8463b', b = '#f1e6cf', w = 16, h = 16, stripe = 4 } = {}) {
  const pc = new PixelCanvas(w, h);
  const ra = ramp(a, 3, 0.07), rb = ramp(b, 3, 0.05);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const r = Math.floor(x / stripe) % 2 ? rb : ra;
      pc.set(x, y, r[y < 2 ? 2 : y > h - 3 ? 0 : 1]);
    }
  }
  return pc;
}

export function paintFlat(color, size = 4) {
  return new PixelCanvas(size, size).fill(hex(color));
}

/* ------------------------------------------------------------------ */
/*  Texture library (cached)                                            */
/* ------------------------------------------------------------------ */

const cache = new Map();

/**
 * Get a texture by recipe name. `units` records how many world units the
 * texture spans so geometry builders can produce matching UVs.
 */
export function getTexture(name, recipe, opts = {}) {
  if (cache.has(name)) return cache.get(name);
  const pc = recipe();
  const tex = toTexture(pc, { repeat: true, mipmaps: true, ...opts });
  tex.userData.unitsU = pc.w / PPU;
  tex.userData.unitsV = pc.h / PPU;
  tex.name = name;
  cache.set(name, tex);
  return tex;
}

export const Textures = {
  grass: () => getTexture('grass', () => paintGrass()),
  meadow: () => getTexture('meadow', () => paintGrass({ base: '#79ad45', seed: 21 })),
  forest: () => getTexture('forest', () => paintGrass({ base: '#477f3a', seed: 22, flowers: false })),
  dirt: () => getTexture('dirt', () => paintDirt()),
  cobble: () => getTexture('cobble', () => paintCobble()),
  sand: () => getTexture('sand', () => paintSand()),
  lakebed: () => getTexture('lakebed', () => paintSand({ base: '#8f8462', seed: 31 })),
  slab: () => getTexture('slab', () => paintSlab()),
  farmland: () => getTexture('farmland', () => paintFarmland()),
  cliff: () => getTexture('cliff', () => paintCliff(), { clampV: true }),
  earthSide: () => getTexture('earthSide', () => paintEarthSide(), { clampV: true }),
  forestSide: () => getTexture('forestSide', () => paintEarthSide({ grass: '#477f3a', seed: 18 }), { clampV: true }),
  meadowSide: () => getTexture('meadowSide', () => paintEarthSide({ grass: '#79ad45', seed: 19 }), { clampV: true }),
  dirtSide: () => getTexture('dirtSide', () => paintEarthSide({ lip: false, seed: 20 }), { clampV: true }),
  sandSide: () => getTexture('sandSide', () => paintEarthSide({ base: '#b59a68', lip: false, seed: 23 }), { clampV: true }),
  brick: () => getTexture('brick', () => paintBrick()),
  brickLip: () => getTexture('brickLip', () => paintBrick({ lip: '#5f9e3f', seed: 24 }), { clampV: true }),
  planks: () => getTexture('planks', () => paintPlanks()),
  planksDark: () => getTexture('planksDark', () => paintPlanks({ base: '#5c3b25', seed: 25 })),
  deck: () => getTexture('deck', () => paintPlanks({ base: '#a3794d', seed: 26, vertical: false, plank: 6 })),
  plaster: () => getTexture('plaster', () => paintPlaster()),
  plasterBlue: () => getTexture('plasterBlue', () => paintPlaster({ base: '#cfd6d8', seed: 27 })),
  beam: () => getTexture('beam', () => paintPlanks({ base: '#5a3a24', w: 16, h: 16, plank: 16, seed: 28 })),
  roofRed: () => getTexture('roofRed', () => paintRoof({ base: '#b04f3a' })),
  roofBlue: () => getTexture('roofBlue', () => paintRoof({ base: '#4d6a8f', seed: 29 })),
  roofGreen: () => getTexture('roofGreen', () => paintRoof({ base: '#5f7d45', seed: 30 })),
  roofThatch: () => getTexture('roofThatch', () => paintRoof({ base: '#c49a52', seed: 32 })),
  window: () => getTexture('window', () => paintWindow(), { mipmaps: false }),
  windowGlow: () => getTexture('windowGlow', () => paintWindow({ emissive: true }), { mipmaps: false }),
  door: () => getTexture('door', () => paintDoor(), { mipmaps: false }),
  crate: () => getTexture('crate', () => paintCrate()),
  barrel: () => getTexture('barrel', () => paintBarrel()),
  barrelTop: () => getTexture('barrelTop', () => paintBarrelTop()),
  stone: () => getTexture('stone', () => paintStone()),
  awning: () => getTexture('awning', () => paintStripes()),
  awningBlue: () => getTexture('awningBlue', () => paintStripes({ a: '#3f6fa8' })),
  iron: () => getTexture('iron', () => paintStone({ base: '#4c4d55', seed: 33, size: 8 })),
};

export { mix };
