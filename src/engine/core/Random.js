/**
 * Deterministic randomness and noise helpers.
 * Every procedural asset in the engine is seeded, so the same seed always
 * produces the same pixel art, map decoration and particle layout.
 */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class RNG {
  constructor(seed = 1) {
    this._next = mulberry32(seed);
  }
  next() {
    return this._next();
  }
  range(min, max) {
    return min + (max - min) * this._next();
  }
  /** Integer in [min, max] (inclusive). */
  int(min, max) {
    return Math.floor(min + (max - min + 1) * this._next());
  }
  pick(arr) {
    return arr[Math.floor(this._next() * arr.length)];
  }
  chance(p) {
    return this._next() < p;
  }
}

/** Integer lattice hash in [0, 1). */
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const smooth = (t) => t * t * (3 - 2 * t);
const mod = (a, n) => ((a % n) + n) % n;

/** Smooth value noise. Pass `period` to make it tile seamlessly. */
export function valueNoise(x, y, seed = 0, period = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = smooth(x - xi);
  const fy = smooth(y - yi);
  let x0 = xi, x1 = xi + 1, y0 = yi, y1 = yi + 1;
  if (period > 0) {
    x0 = mod(x0, period); x1 = mod(x1, period);
    y0 = mod(y0, period); y1 = mod(y1, period);
  }
  const a = hash2(x0, y0, seed);
  const b = hash2(x1, y0, seed);
  const c = hash2(x0, y1, seed);
  const d = hash2(x1, y1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Fractal noise in [0, 1].
 * When `tile` is true, (u, v) are expected in [0, 1) and the result tiles.
 */
export function fbm(u, v, { freq = 4, octaves = 4, seed = 0, gain = 0.5, tile = true } = {}) {
  let amp = 1;
  let sum = 0;
  let norm = 0;
  let f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(u * f, v * f, seed + o * 17, tile ? f : 0);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** 4x4 ordered-dither threshold in [0, 1). */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer(x, y) {
  return BAYER4[(y & 3) * 4 + (x & 3)] / 16;
}

/**
 * Tileable Worley/voronoi helper. Returns nearest and second-nearest
 * distances (in pixels) plus the id of the nearest cell.
 */
export function makeVoronoi(size, cells, seed = 0, jitter = 0.8) {
  const cellSize = size / cells;
  const pts = [];
  for (let j = 0; j < cells; j++) {
    for (let i = 0; i < cells; i++) {
      const jx = (hash2(i, j, seed) - 0.5) * jitter;
      const jy = (hash2(i, j, seed + 7) - 0.5) * jitter;
      pts.push({ x: (i + 0.5 + jx) * cellSize, y: (j + 0.5 + jy) * cellSize, id: j * cells + i });
    }
  }
  return function sample(px, py) {
    const ci = Math.floor(px / cellSize);
    const cj = Math.floor(py / cellSize);
    let d1 = Infinity, d2 = Infinity, id = 0, cx = 0, cy = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const ii = ci + di;
        const jj = cj + dj;
        const p = pts[mod(jj, cells) * cells + mod(ii, cells)];
        const ox = Math.floor(ii / cells) * size;
        const oy = Math.floor(jj / cells) * size;
        const x = p.x + ox;
        const y = p.y + oy;
        const d = Math.hypot(px - x, py - y);
        if (d < d1) {
          d2 = d1; d1 = d; id = p.id; cx = x; cy = y;
        } else if (d < d2) {
          d2 = d;
        }
      }
    }
    return { d1, d2, id, cx, cy };
  };
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent exponential damping. */
export const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
