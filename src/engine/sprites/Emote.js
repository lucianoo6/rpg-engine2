import { PixelCanvas, toTexture } from '../pixel/PixelCanvas.js';
import { hex } from '../pixel/Palette.js';
import { Billboard } from './Billboard.js';

/**
 * Pixel-art speech balloons ("!", "?", "♪", "…", "♥", "z") that pop above a
 * character's head — the classic RPG way to show a reaction.
 */

const GLYPHS = {
  '!': ['..#..', '..#..', '..#..', '..#..', '.....', '..#..'],
  '?': ['.###.', '#...#', '...#.', '..#..', '.....', '..#..'],
  '♪': ['..##.', '..#.#', '..#..', '..#..', '###..', '##...'],
  '…': ['.....', '.....', '.....', '.....', '.....', '#.#.#'],
  '♥': ['.....', '##.##', '#####', '#####', '.###.', '..#..'],
  z: ['.....', '####.', '..#..', '.#...', '####.', '.....'],
};
const COLORS = { '!': '#d8452f', '?': '#3f6fb8', '♪': '#3f9a5b', '…': '#3a3445', '♥': '#d84a7a', z: '#5a63a8' };

const cache = new Map();
function balloonTexture(icon) {
  if (cache.has(icon)) return cache.get(icon);
  const pc = new PixelCanvas(16, 16);
  const white = hex('#fdfaf2'), shade = hex('#d9d2c3'), ink = hex('#2a2230');
  // rounded bubble 14x11 with a tail
  for (let y = 1; y < 12; y++) {
    for (let x = 1; x < 15; x++) {
      const corner = (x === 1 || x === 14) && (y === 1 || y === 11);
      if (corner) continue;
      pc.set(x, y, y > 9 ? shade : white);
    }
  }
  for (const [x, y] of [[6, 12], [7, 12], [8, 12], [7, 13]]) pc.set(x, y, white);
  const g = GLYPHS[icon] || GLYPHS['!'];
  const c = hex(COLORS[icon] || '#2a2230');
  g.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === '#') pc.set(5 + x, 3 + y, c);
  });
  pc.outline({ color: ink });
  const tex = toTexture(pc);
  cache.set(icon, tex);
  return tex;
}

export class Emote {
  constructor(parent, target, icon = '!', { duration = 1.3, height = 2.15 } = {}) {
    this.sprite = new Billboard(balloonTexture(icon), { lit: false, castShadow: false, receiveShadow: false, transparent: true, alphaTest: 0.5 });
    this.sprite.material.depthTest = false;
    this.sprite.renderOrder = 30;
    this.target = target;
    this.height = height;
    this.duration = duration;
    this.t = 0;
    parent.add(this.sprite);
    this.done = false;
  }

  update(dt) {
    this.t += dt;
    const k = Math.min(1, this.t / 0.18);
    const pop = k < 1 ? 0.4 + 0.8 * k - 0.2 * k * k : 1; // overshoot-ish pop
    const out = Math.max(0, (this.t - (this.duration - 0.15)) / 0.15);
    const s = pop * (1 - out);
    this.sprite.scale.setScalar(Math.max(0.001, s));
    const p = this.target.position;
    this.sprite.position.set(p.x, p.y + this.height + Math.sin(Math.min(1, this.t * 4) * Math.PI) * 0.12, p.z);
    if (this.t >= this.duration) {
      this.sprite.removeFromParent();
      this.done = true;
    }
    return !this.done;
  }
}
