import { PixelCanvas } from './PixelCanvas.js';
import { hex, ramp, shift } from './Palette.js';
import { RNG, bayer, clamp, makeVoronoi, valueNoise, fbm } from '../core/Random.js';

/**
 * Procedural pixel-art sprite painters: foliage, rocks, effects.
 * Shapes are lit with fake normals and quantised onto hue-shifted ramps
 * with ordered dithering, then outlined — the same steps a pixel artist
 * would take by hand.
 */

const LIGHT = (() => {
  const v = [-0.55, -0.72, 0.42];
  const l = Math.hypot(...v);
  return v.map((c) => c / l);
})();

const quant = (s, steps, x, y, dither = 0.7) =>
  clamp(Math.floor((s + (bayer(x, y) - 0.5) * (dither / steps)) * steps), 0, steps - 1);

/**
 * Normal maps for sprites: painters that receive a canvas with a `normal`
 * PixelCanvas also write the fake surface normal of every pixel into it,
 * encoded tangent-space style (R = right, G = up, B = towards the viewer).
 * Lit by real scene lights, foliage then gets volume instead of looking
 * like a painted card.
 */
function setN(pc, x, y, nx, ny, nz) {
  if (!pc.normal) return;
  const l = Math.hypot(nx, ny, nz) || 1;
  pc.normal.set(x, y, [Math.round((nx / l * 0.5 + 0.5) * 255), Math.round((-ny / l * 0.5 + 0.5) * 255), Math.round((nz / l * 0.5 + 0.5) * 255)]);
}

/** Give outline / highlight pixels added after shading a normal from their neighbours. */
function finishNormals(pc) {
  if (!pc.normal) return;
  const n = pc.normal;
  const fill = [];
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      if (!pc.alpha(x, y) || n.alpha(x, y)) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = n.get(x + dx, y + dy);
        if (q && q[3]) { r += q[0]; g += q[1]; b += q[2]; c++; }
      }
      fill.push([x, y, c ? [r / c, g / c, b / c] : [128, 128, 255]]);
    }
  }
  for (const [x, y, v] of fill) n.set(x, y, v.map(Math.round));
}

function paintTrunk(pc, { cx, top, bottom, base = 2.5, flare = 2.6, bark, seed }) {
  const br = ramp(bark, 5, 0.075);
  const h = bottom - top;
  for (let y = Math.floor(top); y < bottom; y++) {
    const t = (y - top) / h;
    const sway = Math.sin(t * 2.6 + seed) * 1.3 * (1 - t);
    let half = base + t * 0.9;
    if (t > 0.82) half += (t - 0.82) * flare * 5;
    const c = cx + sway;
    for (let x = Math.floor(c - half); x <= Math.ceil(c + half); x++) {
      const nx = (x + 0.5 - c) / half;
      if (Math.abs(nx) > 1) continue;
      let k;
      if (pc.normal) {
        // lighting comes from the normal map: keep only a hint of baked shading
        k = nx > 0.7 ? 1 : nx < -0.6 ? 3 : 2;
      } else {
        k = nx < -0.45 ? 3 : nx > 0.35 ? 1 : 2;
        if (nx > 0.75) k = 0;
      }
      if ((x * 7 + Math.floor(y / 3)) % 5 === 0 && k > 0) k -= 1; // bark grain
      pc.set(x, y, br[k]);
      if (pc.trunkPixels) pc.trunkPixels.push([x, y, br[k]]);
      // round trunk; the flaring roots tilt their normals up and outwards
      setN(pc, x, y, nx, t > 0.82 ? -0.5 * (t - 0.82) * 5 : 0, Math.sqrt(Math.max(0.05, 1 - nx * nx)));
    }
  }
}

/**
 * For trees whose lower trunk is a real 3D mesh (see world/Trunks.js):
 * erase the trunk pixels the canopy left visible and report where the
 * mesh has to reach, in sprite pixels above the bottom edge.
 */
function cutTrunk(pc, { cx, base }) {
  const px = pc.trunkPixels;
  delete pc.trunkPixels;
  const still = ([x, y, c]) => {
    const q = pc.get(x, y);
    return q && q[3] && q[0] === c[0] && q[1] === c[1] && q[2] === c[2];
  };
  // highest row where the trunk shows below the canopy at its centre
  let top = pc.h;
  for (const p of px) if (Math.abs(p[0] + 0.5 - cx) < 1.5 && still(p)) top = Math.min(top, p[1]);
  for (const p of px) {
    if (p[1] < top || !still(p)) continue;
    pc.clear(p[0], p[1]);
    if (pc.normal) pc.normal.clear(p[0], p[1]);
  }
  // the mesh tucks a few pixels up behind the leaves
  pc.trunk = { height: pc.h - top + 3, radius: base + 1 };
}

/**
 * Tileable bark for 3D trunks: vertical grain on a ramp, no baked side
 * shading (the scene lights the cylinder). `w` pixels wrap around once.
 */
export function paintBark({ bark = '#6b4a30', seed = 1, w = 16, h = 32 } = {}) {
  const pc = new PixelCanvas(w, h);
  const br = ramp(bark, 5, 0.075);
  for (let x = 0; x < w; x++) {
    const col = valueNoise(x * 0.9, 0, seed);
    for (let y = 0; y < h; y++) {
      const n = valueNoise(x * 0.9, y / 4, seed + 3) * 0.6 + col * 0.4;
      let k = n > 0.66 ? 1 : n < 0.36 ? 3 : 2;
      if ((x * 7 + Math.floor(y / 3)) % 5 === 0 && k < 4) k += 1; // grain crevices
      if (valueNoise(x * 2.1, y * 0.7, seed + 7) > 0.8) k = Math.max(0, k - 1); // worn ridges
      pc.set(x, y, br[k]);
    }
  }
  return pc;
}

function blobSurface(blobs, x, y) {
  let best = null;
  let bestZ = -Infinity;
  for (const b of blobs) {
    const ang = Math.atan2(y - b.y, x - b.x);
    const rr = b.r * (1 + 0.09 * Math.sin(ang * 7 + b.p) + 0.05 * Math.sin(ang * 13 + b.p * 2));
    const dx = (x - b.x) / rr;
    const dy = (y - b.y) / rr;
    const d2 = dx * dx + dy * dy;
    if (d2 >= 1) continue;
    const nz = Math.sqrt(1 - d2);
    const z = nz * rr + b.z;
    if (z > bestZ) {
      bestZ = z;
      best = { nx: dx, ny: dy, nz, b };
    }
  }
  return best;
}

/** Leafy canopy built from overlapping lit spheres with per-cluster highlights. */
function paintCanopy(pc, blobs, { leaf, seed, cy, clump = 5, highlight = true }) {
  const lr = ramp(leaf, 6, 0.07);
  const vor = makeVoronoi(Math.max(pc.w, pc.h), Math.round(Math.max(pc.w, pc.h) / clump), seed + 3, 0.9);
  const cellR = clump * 0.75;
  for (let y = 0; y < pc.h; y++) {
    for (let x = 0; x < pc.w; x++) {
      const s = blobSurface(blobs, x + 0.5, y + 0.5);
      if (!s) continue;
      const v = vor(x + 0.5, y + 0.5);
      let cnx = (x + 0.5 - v.cx) / cellR;
      let cny = (y + 0.5 - v.cy) / cellR;
      const c2 = Math.min(0.95, cnx * cnx + cny * cny);
      const cnz = Math.sqrt(1 - c2);
      let nx = s.nx + cnx * 0.55;
      let ny = s.ny + cny * 0.55;
      let nz = s.nz + cnz * 0.35;
      const nl = Math.hypot(nx, ny, nz);
      nx /= nl; ny /= nl; nz /= nl;
      setN(pc, x, y, nx, ny, nz);
      let lit = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) * 0.5 + 0.5;
      if (pc.normal) lit = 0.62 + (lit - 0.62) * 0.35; // real lights do most of the shading
      lit -= Math.max(0, (y - cy) / pc.h) * 0.55; // underside ambient occlusion
      lit -= (v.d2 - v.d1 < 1.2 ? 0.12 : 0); // crevices between clumps
      lit += (valueNoise(x / 2.5, y / 2.5, seed) - 0.5) * 0.12;
      const k = quant(lit * 1.05, 6, x, y);
      pc.set(x, y, lr[k]);
    }
  }
  if (highlight) {
    const rng = new RNG(seed + 11);
    for (let i = 0; i < blobs.length * 3; i++) {
      const b = rng.pick(blobs);
      const x = Math.round(b.x - b.r * rng.range(0.1, 0.55));
      const y = Math.round(b.y - b.r * rng.range(0.2, 0.6));
      if (pc.alpha(x, y)) pc.set(x, y, shift(lr[5], 0.06));
    }
  }
}

export function paintTree({ seed = 1, w = 80, h = 96, leaf = '#4f8c3b', bark = '#6b4a30', fruit = null, density = 1, normals = false, trunk3d = false } = {}) {
  const rng = new RNG(seed);
  const pc = new PixelCanvas(w, h);
  if (normals) pc.normal = new PixelCanvas(w, h);
  if (trunk3d) pc.trunkPixels = [];
  const cx = w / 2;
  paintTrunk(pc, { cx, top: h * 0.42, bottom: h - 1, base: 3, bark, seed });
  // branches reaching into the canopy
  const br = ramp(bark, 5, 0.075);
  for (const dir of [-1, 1]) {
    const len = rng.int(7, 11);
    const y0 = Math.round(h * 0.58);
    pc.line(cx + dir, y0, cx + dir * len, y0 - len, br[dir < 0 ? 3 : 1]);
    pc.line(cx + dir, y0 + 1, cx + dir * len, y0 - len + 1, br[1]);
  }
  const ccy = h * 0.36;
  const blobs = [{ x: cx, y: ccy, r: w * 0.3, z: 0, p: rng.range(0, 6) }];
  const n = Math.round(9 * density);
  for (let i = 0; i < n; i++) {
    const a = -Math.PI * (i + 0.5) / n + rng.range(-0.25, 0.25);
    const d = w * rng.range(0.17, 0.24);
    blobs.push({
      x: cx + Math.cos(a) * d * 1.15,
      y: ccy + Math.sin(a) * d * 0.95 + w * 0.04,
      r: w * rng.range(0.13, 0.19),
      z: rng.range(-2, 5),
      p: rng.range(0, 6),
    });
  }
  for (const dir of [-1, 1]) {
    blobs.push({ x: cx + dir * w * 0.25, y: ccy + w * 0.17, r: w * 0.16, z: rng.range(-3, 1), p: rng.range(0, 6) });
  }
  blobs.push({ x: cx + rng.range(-3, 3), y: ccy + w * 0.2, r: w * 0.17, z: 2, p: rng.range(0, 6) });
  paintCanopy(pc, blobs, { leaf, seed, cy: ccy });
  if (fruit) {
    const fr = ramp(fruit, 3, 0.1);
    for (let i = 0; i < 9; i++) {
      const b = rng.pick(blobs);
      const x = Math.round(b.x + rng.range(-0.6, 0.6) * b.r);
      const y = Math.round(b.y + rng.range(-0.3, 0.7) * b.r);
      if (pc.alpha(x, y) && pc.alpha(x + 1, y + 1)) {
        pc.set(x, y, fr[2]); pc.set(x + 1, y, fr[1]);
        pc.set(x, y + 1, fr[1]); pc.set(x + 1, y + 1, fr[0]);
      }
    }
  }
  if (trunk3d) cutTrunk(pc, { cx, base: 3 });
  pc.outline({ darken: 0.28 });
  finishNormals(pc);
  return pc;
}

export function paintPine({ seed = 1, w = 56, h = 104, leaf = '#2f6a4c', bark = '#5e4030', tiers = 5, normals = false, trunk3d = false } = {}) {
  const rng = new RNG(seed);
  const pc = new PixelCanvas(w, h);
  if (normals) pc.normal = new PixelCanvas(w, h);
  if (trunk3d) pc.trunkPixels = [];
  const cx = w / 2;
  paintTrunk(pc, { cx, top: h * 0.7, bottom: h - 1, base: 2.5, bark, seed, flare: 2 });
  const lr = ramp(leaf, 6, 0.07);
  const top = 3;
  const bottom = h * 0.86;
  const span = bottom - top;
  const tierList = [];
  for (let k = 0; k < tiers; k++) {
    const apex = top + (k / tiers) * span * 0.78;
    const base = apex + span * (0.32 + 0.1 * (k / tiers));
    const half = (w / 2 - 2) * (0.38 + 0.62 * ((k + 1) / tiers));
    tierList.push({ apex, base, half, p: rng.range(0, 6) });
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = -1;
      for (let k = 0; k < tiers; k++) {
        const t = tierList[k];
        const rel = (y + 0.5 - t.apex) / (t.base - t.apex);
        if (rel < 0 || rel > 1.08) continue;
        const half = t.half * Math.pow(Math.min(rel, 1), 0.85);
        const jag = (Math.abs(((x + Math.round(t.p * 3)) % 5) - 2) / 2) * 0.09;
        if (Math.abs(x + 0.5 - cx) > half) continue;
        if (rel > 1 - jag + 0.08) continue;
        hit = k;
        break;
      }
      if (hit < 0) continue;
      const t = tierList[hit];
      const rel = (y + 0.5 - t.apex) / (t.base - t.apex);
      const half = Math.max(1, t.half * Math.pow(Math.min(rel, 1), 0.85));
      const nx = (x + 0.5 - cx) / half;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx));
      const needle = (valueNoise(x / 1.5, y / 3.5, seed + 9) - 0.5) * 0.5;
      setN(pc, x, y, nx + needle * 0.4, -0.45 + rel * 0.25, nz);
      let lit = (nx * LIGHT[0] + -0.45 * LIGHT[1] + nz * LIGHT[2]) * 0.5 + 0.5;
      if (pc.normal) lit = 0.62 + (lit - 0.62) * 0.35;
      lit -= rel * 0.28; // lower part of each skirt is shaded
      if (hit > 0) {
        const prev = tierList[hit - 1];
        if (y < prev.base + 3 && y > prev.base - 1) lit -= 0.22; // shadow cast by the tier above
      }
      lit += (valueNoise(x / 1.5, y / 3.5, seed) - 0.5) * 0.22; // needle texture
      pc.set(x, y, lr[quant(lit * 1.08, 6, x, y)]);
    }
  }
  if (trunk3d) cutTrunk(pc, { cx, base: 2.5 });
  pc.outline({ darken: 0.26 });
  finishNormals(pc);
  return pc;
}

export function paintBush({ seed = 1, w = 32, h = 24, leaf = '#4a8a3a', flowers = null, normals = false } = {}) {
  const rng = new RNG(seed);
  const pc = new PixelCanvas(w, h);
  if (normals) pc.normal = new PixelCanvas(w, h);
  const blobs = [];
  for (let i = 0; i < 5; i++) {
    blobs.push({
      x: w / 2 + rng.range(-w * 0.26, w * 0.26),
      y: h * 0.62 + rng.range(-h * 0.18, h * 0.08),
      r: rng.range(h * 0.3, h * 0.42),
      z: rng.range(-1, 2),
      p: rng.range(0, 6),
    });
  }
  blobs.forEach((b) => { b.y = Math.min(b.y, h - b.r - 1); });
  paintCanopy(pc, blobs, { leaf, seed, cy: h * 0.5, clump: 4 });
  if (flowers) {
    const fr = ramp(flowers, 3, 0.08);
    for (let i = 0; i < 10; i++) {
      const x = rng.int(2, w - 3), y = rng.int(2, h - 4);
      if (pc.alpha(x, y)) { pc.set(x, y, fr[2]); pc.set(x, y + 1, fr[0]); }
    }
  }
  pc.outline({ darken: 0.28 });
  finishNormals(pc);
  return pc;
}

export function paintTuft({ seed = 1, w = 16, h = 12, base = '#5f9e3f', blades = 7 } = {}) {
  const rng = new RNG(seed);
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 5, 0.08);
  for (let i = 0; i < blades; i++) {
    const x0 = Math.round(w / 2 + rng.range(-w * 0.3, w * 0.3));
    const len = rng.int(Math.floor(h * 0.45), h - 1);
    const lean = rng.range(-3, 3);
    for (let j = 0; j < len; j++) {
      const t = j / len;
      const x = Math.round(x0 + lean * t * t);
      const y = h - 1 - j;
      pc.set(x, y, r[t > 0.8 ? 4 : t > 0.45 ? 3 : t > 0.2 ? 2 : 1]);
    }
  }
  return pc;
}

export function paintFlowers({ seed = 1, w = 16, h = 14, color = '#f2d65b', stem = '#4f8c3b', count = 4 } = {}) {
  const rng = new RNG(seed);
  const pc = paintTuft({ seed, w, h, base: stem, blades: 4 });
  const pr = ramp(color, 3, 0.08);
  const center = hex('#f9e7a0');
  for (let i = 0; i < count; i++) {
    const x = rng.int(3, w - 4);
    const y = rng.int(1, Math.floor(h * 0.55));
    pc.line(x, y + 2, x + rng.int(-1, 1), h - 1, ramp(stem, 3, 0.08)[1]);
    pc.set(x, y, pr[2]); pc.set(x - 1, y + 1, pr[1]); pc.set(x + 1, y + 1, pr[1]);
    pc.set(x, y + 2, pr[0]); pc.set(x, y + 1, center);
  }
  return pc;
}

export function paintReeds({ seed = 1, w = 16, h = 26 } = {}) {
  const rng = new RNG(seed);
  const pc = paintTuft({ seed, w, h, base: '#6f9a45', blades: 9 });
  const cat = ramp('#7a4a2c', 3, 0.08);
  for (let i = 0; i < 3; i++) {
    const x = rng.int(4, w - 5);
    const top = rng.int(1, 6);
    pc.line(x, top + 4, x, h - 1, ramp('#6f9a45', 3, 0.08)[1]);
    for (let j = 0; j < 4; j++) {
      pc.set(x, top + j, cat[j < 1 ? 2 : 1]);
      pc.set(x + 1, top + j, cat[0]);
    }
  }
  return pc;
}

export function paintRock({ seed = 1, w = 24, h = 16, base = '#8d8a82', moss = true } = {}) {
  const rng = new RNG(seed);
  const pc = new PixelCanvas(w, h);
  const r = ramp(base, 6, 0.07);
  const blobs = [
    { x: w * 0.45, y: h * 0.7, r: h * 0.6, z: 0, p: rng.range(0, 6) },
    { x: w * 0.68, y: h * 0.78, r: h * 0.42, z: -1, p: rng.range(0, 6) },
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = blobSurface(blobs, x + 0.5, y + 0.5);
      if (!s || y > h - 2) continue;
      // faceted look: quantise the normal before lighting
      const nx = Math.round(s.nx * 2) / 2, ny = Math.round(s.ny * 2) / 2;
      const nz = Math.sqrt(Math.max(0.05, 1 - nx * nx - ny * ny));
      let lit = (nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]) * 0.5 + 0.5;
      lit += (valueNoise(x / 2, y / 2, seed) - 0.5) * 0.15;
      let c = r[quant(lit, 6, x, y, 0.4)];
      if (moss && s.ny < -0.45 && valueNoise(x / 3, y / 2, seed + 5) > 0.45) c = ramp('#6a9442', 3, 0.07)[lit > 0.6 ? 2 : 1];
      pc.set(x, y, c);
    }
  }
  pc.outline({ darken: 0.3 });
  return pc;
}

export function paintSign({ text = true } = {}) {
  const pc = new PixelCanvas(16, 22);
  const w = ramp('#9c6b40', 5, 0.07);
  pc.shadedRect(7, 8, 3, 14, w);
  for (let y = 2; y < 10; y++) {
    for (let x = 1; x < 15; x++) {
      let k = 2;
      if (y === 2) k = 4;
      else if (y === 9) k = 0;
      else if (x === 1) k = 3;
      else if (x === 14) k = 1;
      pc.set(x, y, w[k]);
    }
  }
  if (text) {
    const ink = hex('#3a2416');
    for (const x of [3, 4, 6, 8, 9, 10, 12]) pc.set(x, 4, ink);
    for (const x of [3, 5, 6, 7, 9, 11, 12]) pc.set(x, 6, ink);
  }
  pc.outline({ darken: 0.3 });
  return pc;
}

/** A horizontal strip of looping flame frames. */
export function paintFireFrames({ frames = 8, w = 16, h = 24, seed = 3, palette = ['#ffeaa0', '#ffc23d', '#ff8a1f', '#e0441c', '#8e1f1a'] } = {}) {
  const sheet = new PixelCanvas(w * frames, h);
  const pal = palette.map(hex);
  const period = 8; // noise wraps every 8 units, so the loop is seamless
  for (let f = 0; f < frames; f++) {
    const off = (f / frames) * period;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const fy = 1 - (y + 0.5) / h; // 0 bottom -> 1 top
        const fx = (x + 0.5 - w / 2) / (w / 2);
        const width = (1 - fy) * 0.95 * (0.65 + 0.35 * Math.sin(fy * 3.1));
        const n = valueNoise(x * 0.35, y * 0.22 + off, seed, period) * 0.6
          + valueNoise(x * 0.5, y * 0.33 + off * 2, seed + 1, period * 2) * 0.4;
        let heat = 1 - Math.abs(fx) / Math.max(0.05, width);
        heat = heat * (1.1 - fy * 0.85) + (n - 0.5) * 0.9 - fy * 0.25;
        if (heat <= 0.05) continue;
        const k = heat > 0.85 ? 0 : heat > 0.62 ? 1 : heat > 0.38 ? 2 : heat > 0.18 ? 3 : 4;
        sheet.set(f * w + x, y, pal[k]);
      }
    }
  }
  return sheet;
}

export function paintLilyPad({ seed = 1, flower = false } = {}) {
  const pc = new PixelCanvas(16, 16);
  const r = ramp('#4f8f45', 4, 0.07);
  const rng = new RNG(seed);
  const notch = rng.range(0, Math.PI * 2);
  pc.ellipse(8, 8, 6.5, 5.5, (x, y, nx, ny) => {
    const a = Math.atan2(ny, nx);
    let d = Math.abs(((a - notch + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (d > Math.PI - 0.35 && Math.hypot(nx, ny) > 0.2) return null;
    return r[nx + ny < -0.4 ? 3 : nx + ny > 0.5 ? 1 : 2];
  });
  pc.outline({ darken: 0.25 });
  if (flower) {
    const p = ramp('#f2b6c8', 3, 0.08);
    pc.set(8, 7, p[2]); pc.set(7, 8, p[1]); pc.set(9, 8, p[1]); pc.set(8, 8, hex('#ffe680')); pc.set(8, 9, p[0]);
  }
  return pc;
}

export function paintButterfly({ color = '#f5c84c' } = {}) {
  const sheet = new PixelCanvas(16, 8);
  const r = ramp(color, 3, 0.1);
  const body = hex('#3a2a2a');
  // frame 0: wings open
  for (const [x, y, k] of [[1, 1, 2], [2, 1, 2], [1, 2, 1], [2, 2, 2], [2, 3, 1], [5, 1, 2], [6, 1, 2], [5, 2, 2], [6, 2, 1], [5, 3, 1], [1, 4, 0], [6, 4, 0]]) sheet.set(x, y, r[k]);
  for (let y = 1; y < 5; y++) { sheet.set(3, y, body); sheet.set(4, y, body); }
  // frame 1: wings folded
  for (const [x, y, k] of [[10, 1, 2], [13, 1, 2], [10, 2, 1], [13, 2, 1], [11, 3, 0], [12, 3, 0]]) sheet.set(x, y, r[k]);
  for (let y = 1; y < 5; y++) { sheet.set(11, y, body); sheet.set(12, y, body); }
  return sheet;
}

/** Soft radial gradient (not pixel art) used for blob shadows and glows. */
export function softCircleCanvas(size = 64, inner = 0, outer = 1, color = '255,255,255') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, (size / 2) * inner, size / 2, size / 2, (size / 2) * outer);
  g.addColorStop(0, `rgba(${color},1)`);
  g.addColorStop(1, `rgba(${color},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export { fbm };
