import * as THREE from 'three';
import { shift } from './Palette.js';

/**
 * A tiny RGBA framebuffer for authoring pixel art in code.
 * Everything procedural in the engine (terrain, foliage, characters,
 * effects) is painted into one of these and uploaded as a texture.
 */
export class PixelCanvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.data = new Uint8ClampedArray(w * h * 4);
  }

  inside(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  set(x, y, c, a = 255) {
    x |= 0; y |= 0;
    if (!this.inside(x, y) || !c) return;
    const i = (y * this.w + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
  }

  /** Wrapping write, used by tileable textures. */
  setWrap(x, y, c, a = 255) {
    const w = this.w, h = this.h;
    this.set(((x % w) + w) % w, ((y % h) + h) % h, c, a);
  }

  get(x, y) {
    x |= 0; y |= 0;
    if (!this.inside(x, y)) return null;
    const i = (y * this.w + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }

  getWrap(x, y) {
    const w = this.w, h = this.h;
    return this.get(((x % w) + w) % w, ((y % h) + h) % h);
  }

  alpha(x, y) {
    x |= 0; y |= 0;
    if (!this.inside(x, y)) return 0;
    return this.data[(y * this.w + x) * 4 + 3];
  }

  clear(x, y) {
    if (!this.inside(x, y)) return;
    this.data[(y * this.w + x) * 4 + 3] = 0;
  }

  fill(c) {
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) this.set(x, y, c);
    return this;
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  /** Rectangle with cylindrical shading using a 3+ colour ramp (dark -> light). */
  shadedRect(x, y, w, h, r) {
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const t = w <= 1 ? 0.5 : i / (w - 1);
        let k = 1;
        if (t < 0.3) k = 2;
        else if (t > 0.72) k = 0;
        this.set(x + i, y + j, r[Math.min(k, r.length - 1)]);
      }
    }
  }

  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, typeof c === 'function' ? c(x0, y0) : c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /** Filled ellipse; `c` may be a colour or fn(x, y, nx, ny) -> colour. */
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) this.set(x, y, typeof c === 'function' ? c(x, y, nx, ny) : c);
      }
    }
  }

  blit(src, dx, dy, { flipX = false } = {}) {
    for (let y = 0; y < src.h; y++) {
      for (let x = 0; x < src.w; x++) {
        const p = src.get(flipX ? src.w - 1 - x : x, y);
        if (p[3] > 0) this.set(dx + x, dy + y, p, p[3]);
      }
    }
  }

  clone() {
    const c = new PixelCanvas(this.w, this.h);
    c.data.set(this.data);
    return c;
  }

  flippedX() {
    const c = new PixelCanvas(this.w, this.h);
    c.blit(this, 0, 0, { flipX: true });
    return c;
  }

  /**
   * Add a 1px outline around opaque pixels. With no explicit colour a
   * "selective outline" is used: each outline pixel is a dark, hue shifted
   * version of the pixel it borders, which reads softer than pure black.
   */
  outline({ color = null, darken = 0.32, diagonals = false, region = null } = {}) {
    const add = [];
    const dirs = diagonals
      ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
      : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y) > 0) continue;
        if (region && !region(x, y)) continue;
        for (const [dx, dy] of dirs) {
          if (this.alpha(x + dx, y + dy) > 0) {
            const n = this.get(x + dx, y + dy);
            add.push([x, y, color || shift([n[0], n[1], n[2]], -darken, { hueShift: 22 })]);
            break;
          }
        }
      }
    }
    for (const [x, y, c] of add) this.set(x, y, c);
    return this;
  }

  /** Re-colour an outline-free sprite's silhouette edge pixels darker (inner outline). */
  innerEdge(darken = 0.18) {
    const out = this.clone();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        if (this.alpha(x, y) === 0) continue;
        if (this.alpha(x + 1, y) === 0 || this.alpha(x, y + 1) === 0) {
          const p = this.get(x, y);
          out.set(x, y, shift([p[0], p[1], p[2]], -darken));
        }
      }
    }
    this.data.set(out.data);
    return this;
  }

  toCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = this.w;
    canvas.height = this.h;
    const ctx = canvas.getContext('2d');
    ctx.putImageData(new ImageData(this.data, this.w, this.h), 0, 0);
    return canvas;
  }

  /** Paint from an array of strings using a char -> colour map ('.' = empty). */
  static fromAscii(rows, map) {
    const pc = new PixelCanvas(rows[0].length, rows.length);
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const c = map[row[x]];
        if (c) pc.set(x, y, c);
      }
    });
    return pc;
  }
}

/**
 * Upload a PixelCanvas as a texture with pixel-art friendly sampling:
 * nearest neighbour when magnified (crisp texels), optional mipmaps for
 * distant tiling surfaces so they do not shimmer.
 */
/** Upload a normal-map PixelCanvas (linear data, nearest sampling). */
export function toNormalTexture(pc) {
  const tex = toTexture(pc);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/**
 * Pack sprites side by side into one strip of equal cells (the largest
 * width and height) for SpriteInstances with `frames`. Each sprite is
 * centred horizontally; `align` 'center' or 'bottom' places it vertically
 * (bottom keeps ground-anchored sprites on the ground). Normal maps
 * (`.normal`) are packed alongside. Returns the strip with `.normal` and
 * `.frames`.
 */
export function packStrip(pcs, { align = 'center' } = {}) {
  const cw = Math.max(...pcs.map((p) => p.w)), ch = Math.max(...pcs.map((p) => p.h));
  const out = new PixelCanvas(cw * pcs.length, ch);
  const withNormals = pcs.some((p) => p.normal);
  if (withNormals) out.normal = new PixelCanvas(cw * pcs.length, ch);
  pcs.forEach((p, i) => {
    const dx = i * cw + Math.floor((cw - p.w) / 2);
    const dy = align === 'bottom' ? ch - p.h : Math.floor((ch - p.h) / 2);
    out.blit(p, dx, dy);
    if (withNormals && p.normal) out.normal.blit(p.normal, dx, dy);
  });
  out.frames = pcs.length;
  return out;
}

export function toTexture(pc, { repeat = false, mipmaps = false, clampV = false } = {}) {
  const tex = new THREE.CanvasTexture(pc.toCanvas());
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.NearestFilter;
  tex.generateMipmaps = mipmaps;
  tex.wrapS = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.wrapT = repeat && !clampV ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  tex.anisotropy = mipmaps ? 8 : 1;
  tex.userData.pixelWidth = pc.w;
  tex.userData.pixelHeight = pc.h;
  return tex;
}
