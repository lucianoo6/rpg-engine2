import { PixelCanvas, toTexture } from './PixelCanvas.js';
import { hex, ramp, shift } from './Palette.js';

/**
 * Paper-doll character generator.
 *
 * Produces a 4-direction sprite sheet (down, left, right, up) with idle and
 * walk frames from a small description: palette, hair style, outfit pieces
 * and accessories. Every NPC in the demo comes out of this one function.
 *
 * Sheet layout: rows = [down, left, right, up]; columns = FRAMES below.
 */

export const FRAME_W = 24;
export const FRAME_H = 32;
export const DIRS = ['down', 'left', 'right', 'up'];
const FRAMES = [
  { name: 'idle0', bob: 0, breath: 0, lift: [0, 0], swing: 0, stride: 0 },
  { name: 'idle1', bob: 0, breath: 1, lift: [0, 0], swing: 0, stride: 0 },
  { name: 'walkA', bob: -1, breath: 0, lift: [1, 0], swing: 1, stride: 1 },
  { name: 'pass', bob: 0, breath: 0, lift: [0, 0], swing: 0, stride: 0 },
  { name: 'walkB', bob: -1, breath: 0, lift: [0, 1], swing: -1, stride: -1 },
  // running: longer stride, bigger arm swing, upper body leaning into the run
  { name: 'runA', bob: -1, breath: 0, lift: [2, 0], swing: 2, stride: 2, lean: 1 },
  { name: 'runPass', bob: 0, breath: 0, lift: [0, 0], swing: 0, stride: 0, lean: 1 },
  { name: 'runB', bob: -1, breath: 0, lift: [0, 2], swing: -2, stride: -2, lean: 1 },
  // talking: mouth open / closed
  { name: 'talkOpen', bob: 0, breath: 0, lift: [0, 0], swing: 0, stride: 0, mouth: 1 },
  { name: 'talkClosed', bob: 0, breath: 1, lift: [0, 0], swing: 0, stride: 0 },
];

export const CHARACTER_ANIMATIONS = {
  idle: { frames: [0, 0, 1, 1], fps: 2.4 },
  walk: { frames: [2, 3, 4, 3], fps: 8, steps: [0, 2] },
  run: { frames: [5, 6, 7, 6], fps: 12, steps: [0, 2] },
  talk: { frames: [8, 9, 8, 0, 9], fps: 7 },
};

/** Animations for older 5-column sheets (no run / talk frames). */
export const BASIC_CHARACTER_ANIMATIONS = {
  idle: CHARACTER_ANIMATIONS.idle,
  walk: CHARACTER_ANIMATIONS.walk,
  run: { frames: [2, 3, 4, 3], fps: 13, steps: [0, 2] },
};

const L = [-0.6, -0.7, 0.4];
function litIndex(nx, ny, steps = 4) {
  const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
  const d = nx * L[0] + ny * L[1] + nz * L[2];
  if (d > 0.62) return steps - 1;
  if (d > 0.2) return steps - 2;
  if (d > -0.15) return Math.max(0, steps - 3);
  return 0;
}

const R = (c, n = 4, s = 0.085) => ramp(c, n, s);

export function makeCharacterSheet(desc = {}) {
  const o = {
    skin: '#f1c39b',
    hair: '#6b3f26',
    hairStyle: 'short',
    eyes: '#2a2238',
    tunic: '#3f7f8c',
    trim: '#e2b94f',
    pants: '#4b3a2e',
    boots: '#3d2b20',
    scarf: null,
    cape: null,
    robe: false,
    hat: null,
    beard: null,
    apron: null,
    staff: null,
    child: false,
    ...desc,
  };
  const pal = {
    skin: R(o.skin, 4, 0.07),
    hair: R(o.hair),
    eyes: hex(o.eyes),
    tunic: R(o.tunic),
    trim: R(o.trim),
    pants: R(o.pants),
    boots: R(o.boots),
    scarf: o.scarf ? R(o.scarf) : null,
    cape: o.cape ? R(o.cape) : null,
    hat: o.hat ? R(o.hat.color || '#5a4a8a') : null,
    hatTrim: o.hat ? R(o.hat.trim || o.trim) : null,
    beard: o.beard ? R(o.beard, 4, 0.06) : null,
    apron: o.apron ? R(o.apron, 4, 0.06) : null,
    staff: R('#7a5332'),
    orb: R(o.staff || '#7fe3ff', 4, 0.1),
  };
  const lay = o.child
    ? { hy: 15.5, torsoTop: 21, belt: 24, hem: 26, legTop: 27, bootTop: 29 }
    : { hy: 11, torsoTop: 17, belt: 22, hem: 25, legTop: 26, bootTop: 29 };

  const sheet = new PixelCanvas(FRAME_W * FRAMES.length, FRAME_H * 4);
  for (let fi = 0; fi < FRAMES.length; fi++) {
    for (const dir of ['down', 'left', 'up']) {
      const pc = new PixelCanvas(FRAME_W, FRAME_H);
      drawFrame(pc, dir, FRAMES[fi], o, pal, lay);
      if (dir === 'left' && FRAMES[fi].lean) leanForward(pc, lay.legTop - 1, FRAMES[fi].lean);
      pc.outline({ darken: 0.34 });
      const row = DIRS.indexOf(dir);
      sheet.blit(pc, fi * FRAME_W, row * FRAME_H);
      if (dir === 'left') sheet.blit(pc, fi * FRAME_W, 2 * FRAME_H, { flipX: true });
    }
  }
  const texture = toTexture(sheet);
  return {
    texture,
    canvas: sheet,
    frameW: FRAME_W,
    frameH: FRAME_H,
    cols: FRAMES.length,
    rows: 4,
    directions: DIRS,
    animations: CHARACTER_ANIMATIONS,
  };
}

/* ------------------------------------------------------------------ */

function rectShade(pc, x0, y0, x1, y1, r, { lightCols = 1, darkCols = 1, bottomDark = true } = {}) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let k = 2;
      if (x < x0 + lightCols) k = 3;
      else if (x > x1 - darkCols) k = 1;
      if (bottomDark && y === y1 && k > 0) k -= 1;
      pc.set(x, y, r[k]);
    }
  }
}

function drawLegs(pc, dir, f, o, pal, lay) {
  if (o.robe) {
    // only the boot tips peek out from under a robe
    const by = 30;
    if (dir === 'left') {
      rectShade(pc, 8 - f.stride, by, 11 - f.stride, 31, pal.boots);
    } else {
      rectShade(pc, 8, by + f.lift[0], 10, 31, pal.boots);
      rectShade(pc, 13, by + f.lift[1], 15, 31, pal.boots);
    }
    return;
  }
  const { legTop, bootTop } = lay;
  if (dir === 'left') {
    const s = f.stride;
    // far leg (darker), then near leg
    const legs = s === 0 ? [[10, 0]] : [[10 + s * 2, 1], [10 - s * 2, 0]];
    for (const [lx, far] of legs) {
      const lift = s === 0 ? 0 : far ? 1 : 0;
      const pr = far ? pal.pants.map((c) => shift(c, -0.08)) : pal.pants;
      const brr = far ? pal.boots.map((c) => shift(c, -0.08)) : pal.boots;
      rectShade(pc, lx, legTop, lx + 2, bootTop - 1 - lift, pr, { bottomDark: false });
      rectShade(pc, lx - 1, bootTop - lift, lx + 2, 31 - lift, brr);
    }
    return;
  }
  const sides = [[8, f.lift[0]], [13, f.lift[1]]];
  for (const [lx, lift] of sides) {
    rectShade(pc, lx, legTop, lx + 2, bootTop - 1 - lift, pal.pants, { bottomDark: false });
    const bx0 = lx === 8 ? lx - 1 : lx;
    rectShade(pc, bx0, bootTop - lift, bx0 + 3, 31 - lift, pal.boots);
    pc.set(bx0 + 1, bootTop - lift, pal.boots[3]);
  }
  if (!o.robe) {
    for (let y = legTop; y < legTop + 2; y++) { pc.set(11, y, pal.pants[1]); pc.set(12, y, pal.pants[0]); }
  }
}

function drawTorso(pc, dir, f, o, pal, lay) {
  const top = lay.torsoTop + f.bob;
  const hem = o.robe ? 29 : lay.hem;
  const side = dir === 'left';
  const x0 = side ? 9 : 7;
  const x1 = side ? 14 : 16;
  for (let y = top; y <= hem; y++) {
    let a = x0, b = x1;
    if (y === top) { a += 1; b -= 1; }
    const flare = o.robe ? Math.floor((y - top) / 4) : y >= hem - 1 ? 1 : 0;
    a -= flare; b += flare;
    for (let x = a; x <= b; x++) {
      let k = 2;
      if (x <= a) k = 3;
      else if (x >= b - (side ? 0 : 1)) k = 1;
      if (y === hem) k = Math.max(0, k - 1);
      pc.set(x, y, pal.tunic[k]);
    }
    if (o.robe && y > lay.belt + f.bob + 1 && !side) {
      pc.set(11, y, pal.tunic[1]);
    }
  }
  // trim along hem
  if (!o.robe) {
    const flare = 1;
    for (let x = x0 - flare; x <= x1 + flare; x++) pc.set(x, hem, pal.trim[x <= x0 ? 2 : 1]);
  }
  // belt
  const by = lay.belt + f.bob;
  for (let x = x0; x <= x1; x++) pc.set(x, by, shift(pal.pants[0], -0.05));
  if (dir === 'down') {
    pc.set(11, by, pal.trim[3]);
    pc.set(12, by, pal.trim[2]);
  } else if (side) {
    pc.set(10, by, pal.trim[3]);
  }
  // collar / neckline
  if (dir === 'down') {
    pc.set(11, top, pal.skin[1]);
    pc.set(12, top, pal.skin[1]);
    pc.set(11, top + 1, pal.tunic[0]);
    pc.set(12, top + 1, pal.tunic[0]);
  }
  if (o.apron && dir !== 'up') {
    const ax0 = side ? 8 : 8, ax1 = side ? 9 : 15;
    for (let y = by + 1; y <= hem + 1; y++) {
      for (let x = ax0; x <= ax1; x++) pc.set(x, y, pal.apron[x === ax0 ? 3 : y === hem + 1 ? 1 : 2]);
    }
    if (dir === 'down') for (let y = top + 1; y < by; y++) { pc.set(9, y, pal.apron[2]); pc.set(14, y, pal.apron[1]); }
  }
}

function drawArms(pc, dir, f, o, pal, lay, which) {
  const top = lay.torsoTop + 1 + f.bob;
  if (dir === 'left') {
    // which: 'far' (behind torso) or 'near'
    const s = which === 'far' ? -f.swing : f.swing;
    const ax = 10 - Math.round(s * 1.5);
    const r = which === 'far' ? pal.tunic.map((c) => shift(c, -0.1)) : pal.tunic;
    const sk = which === 'far' ? pal.skin.map((c) => shift(c, -0.08)) : pal.skin;
    for (let y = top; y < top + 5; y++) {
      const t = (y - top) / 4;
      const x = Math.round(ax + 1 - s * t * 0.0);
      pc.set(x, y, r[3]); pc.set(x + 1, y, r[2]); pc.set(x + 2, y, r[1]);
    }
    pc.set(ax + 1, top + 5, sk[2]); pc.set(ax + 2, top + 5, sk[1]);
    pc.set(ax + 1, top + 6, sk[1]); pc.set(ax + 2, top + 6, sk[0]);
    return;
  }
  for (const [x, swing, lightSide] of [[5, f.swing, true], [17, -f.swing, false]]) {
    const dy = Math.max(-1, Math.min(1, swing));
    const r = pal.tunic;
    for (let y = top - (dy < 0 ? 0 : 0); y < top + 5 + dy; y++) {
      pc.set(x, y, lightSide ? r[3] : r[1]);
      pc.set(x + 1, y, lightSide ? r[2] : r[0]);
    }
    const hy = top + 5 + dy;
    pc.set(x, hy, pal.skin[lightSide ? 2 : 1]);
    pc.set(x + 1, hy, pal.skin[lightSide ? 2 : 1]);
    pc.set(x, hy + 1, pal.skin[1]);
    pc.set(x + 1, hy + 1, pal.skin[0]);
  }
}

function headShape(dir) {
  return dir === 'left' ? { cx: 11, rx: 5.6, ry: 5.6 } : { cx: 12, rx: 6.1, ry: 5.6 };
}

function drawHead(pc, dir, f, o, pal, lay) {
  const hy = lay.hy + f.bob + f.breath;
  const { cx, rx, ry } = headShape(dir);
  // neck
  for (let x = 10; x <= 13; x++) pc.set(x - (dir === 'left' ? 1 : 0), Math.round(hy + ry - 0.5), pal.skin[1]);
  pc.ellipse(cx, hy, rx, ry, (x, y, nx, ny) => pal.skin[litIndex(nx, ny)]);
  if (dir === 'down') {
    const ey = Math.round(hy) + 1;
    for (const ex of [9, 14]) {
      pc.set(ex, ey - 1, pal.eyes);
      pc.set(ex, ey, pal.eyes);
    }
    pc.set(8, ey + 2, shift(pal.skin[2], -0.04).map((v, i) => (i === 0 ? Math.min(255, v + 20) : v)));
    pc.set(15, ey + 2, shift(pal.skin[2], -0.04).map((v, i) => (i === 0 ? Math.min(255, v + 20) : v)));
    if (f.mouth) {
      const m = shift(pal.skin[0], -0.3);
      pc.set(11, ey + 2, m);
      pc.set(12, ey + 2, m);
      pc.set(11, ey + 3, shift(pal.skin[0], -0.15));
    }
  } else if (dir === 'left') {
    const ey = Math.round(hy) + 1;
    pc.set(7, ey - 1, pal.eyes);
    pc.set(7, ey, pal.eyes);
    pc.set(5, ey + 1, pal.skin[2]); // nose
    if (f.mouth) pc.set(6, ey + 3, shift(pal.skin[0], -0.3));
  }
}

function inHead(x, y, cx, cy, rx, ry, grow = 0) {
  const nx = (x + 0.5 - cx) / (rx + grow);
  const ny = (y + 0.5 - cy) / (ry + grow);
  return nx * nx + ny * ny <= 1;
}

function drawHair(pc, dir, f, o, pal, lay, layer) {
  const hy = lay.hy + f.bob + f.breath;
  const { cx, rx, ry } = headShape(dir);
  const style = o.hairStyle;
  const hr = pal.hair;
  const shadeAt = (x, y) => {
    const nx = (x + 0.5 - cx) / (rx + 1);
    const ny = (y + 0.5 - hy) / (ry + 1);
    return hr[litIndex(nx, ny)];
  };
  if (layer === 'back') {
    if (style === 'long' || style === 'braid') {
      const len = style === 'long' ? (dir === 'left' ? 4 : 7) : 4;
      for (let y = Math.round(hy); y < Math.round(hy + ry + len); y++) {
        const x0 = dir === 'left' ? 12 : 5;
        const x1 = dir === 'left' ? 15 : 18;
        for (let x = x0; x <= x1; x++) pc.set(x, y, hr[x === x0 ? 2 : x === x1 ? 0 : 1]);
      }
    }
    return;
  }
  if (style === 'none') return;
  const top = Math.floor(hy - ry - 1);
  for (let y = top; y <= Math.ceil(hy + ry); y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (!inHead(x, y, cx, hy, rx, ry, 0.9)) continue;
      const ly = y + 0.5 - hy; // relative to head centre
      let isHair = false;
      if (dir === 'up') {
        isHair = ly < ry - 1.2;
      } else if (dir === 'down') {
        isHair = ly < -1.6 || ((x <= 6 || x >= 17) && ly < 2.5);
        if (ly >= -1.6 && ly < -0.4) isHair = (x + (style === 'spiky' ? 0 : 1)) % 3 !== 0 || x <= 7 || x >= 16; // fringe
      } else {
        isHair = ly < -1.6 || (x >= 11 && ly < 2.8) || x >= 14;
        if (ly >= -1.6 && ly < -0.4 && x < 11) isHair = x % 3 !== 0;
      }
      if (style === 'bald' && dir !== 'up') isHair = isHair && (ly > -3.6) && (dir === 'left' ? x >= 11 : x <= 6 || x >= 17);
      if (style === 'bald' && dir === 'up') isHair = ly > -2.5 && ly < ry - 1.2;
      if (isHair) pc.set(x, y, shadeAt(x, y));
    }
  }
  // shine
  if (style !== 'bald' && dir !== 'up') {
    const sy = Math.round(hy - ry + 1);
    for (const x of dir === 'left' ? [8, 9, 10] : [9, 10, 11]) if (pc.alpha(x, sy)) pc.set(x, sy, shift(hr[3], 0.06));
  }
  if (style === 'spiky') {
    for (const [sx, h] of [[7, 2], [10, 3], [13, 3], [16, 2]]) {
      for (let j = 1; j <= h; j++) pc.set(sx + (dir === 'left' ? 1 : 0) + (j > 1 ? 1 : 0), top - j + 1, hr[2]);
    }
  }
  if (style === 'bun') {
    const bx = dir === 'left' ? 14 : 12;
    const by = dir === 'up' || dir === 'down' ? top - 1 : top + 1;
    pc.ellipse(bx, by, 2.6, 2.4, (x, y, nx, ny) => hr[litIndex(nx, ny)]);
  }
  if (style === 'braid' && dir !== 'down') {
    const bx = dir === 'left' ? 14 : 11;
    for (let y = Math.round(hy + 2); y < Math.round(hy + 10); y++) {
      pc.set(bx, y, hr[(y % 2) ? 1 : 2]); pc.set(bx + 1, y, hr[(y % 2) ? 0 : 1]);
    }
  }
  if (o.child && dir === 'down' && style !== 'bald') {
    // little pig-tails for the kid
  }
}

function drawBeard(pc, dir, f, o, pal, lay) {
  if (!pal.beard || dir === 'up') return;
  const hy = Math.round(lay.hy + f.bob + f.breath);
  const br = pal.beard;
  if (dir === 'down') {
    for (let j = 0; j < 7; j++) {
      const half = Math.max(1, 5 - Math.floor(j * 0.7));
      for (let x = 12 - half; x < 12 + half; x++) pc.set(x, hy + 2 + j, br[x < 11 ? 3 : x > 13 ? 1 : 2]);
    }
    pc.set(11, hy + 3, br[0]); pc.set(12, hy + 3, br[0]);
  } else {
    for (let j = 0; j < 6; j++) {
      for (let x = 5; x < 10 - Math.floor(j * 0.6); x++) pc.set(x, hy + 2 + j, br[x === 5 ? 3 : 2]);
    }
  }
}

function drawHat(pc, dir, f, o, pal, lay) {
  if (!o.hat) return;
  const hy = Math.round(lay.hy + f.bob + f.breath);
  const { cx, rx, ry } = headShape(dir);
  const h = pal.hat;
  const t = pal.hatTrim;
  const type = o.hat.type;
  if (type === 'wizard') {
    const brimY = hy - 3;
    for (let x = 2; x <= 21; x++) {
      pc.set(x, brimY, h[x < 6 ? 3 : x > 18 ? 1 : 2]);
      pc.set(x, brimY + 1, h[0]);
    }
    for (let x = 6; x <= 17; x++) pc.set(x, brimY - 1, t[x < 8 ? 3 : 2]);
    const tipBend = dir === 'left' ? 4 : 3;
    const coneH = Math.min(8, brimY - 1);
    for (let j = 0; j < coneH; j++) {
      const half = Math.max(0.5, 5.2 - j * (4.6 / coneH));
      const bend = Math.round((j / (coneH - 1)) ** 2 * tipBend);
      const c = 12 + bend - (dir === 'left' ? 1 : 0);
      for (let x = Math.round(c - half); x <= Math.round(c + half - 1); x++) {
        const rel = (x - (c - half)) / (half * 2);
        pc.set(x, brimY - 2 - j, h[rel < 0.3 ? 3 : rel > 0.7 ? 1 : 2]);
      }
    }
  } else if (type === 'straw') {
    const brimY = hy - 3;
    for (let x = 1; x <= 22; x++) {
      pc.set(x, brimY, h[x < 5 ? 3 : x > 19 ? 1 : 2]);
      pc.set(x, brimY + 1, h[x % 2 ? 1 : 0]);
    }
    for (let y = brimY - 4; y < brimY; y++) {
      for (let x = 7; x <= 16; x++) pc.set(x, y, h[x < 9 ? 3 : x > 14 ? 1 : 2]);
    }
    for (let x = 7; x <= 16; x++) pc.set(x, brimY - 1, t[x < 9 ? 3 : 1]);
  } else if (type === 'helmet') {
    for (let y = hy - 8; y <= hy; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        if (!inHead(x, y, cx, hy, rx, ry, 1)) continue;
        const nx = (x + 0.5 - cx) / (rx + 1), ny = (y + 0.5 - hy) / (ry + 1);
        pc.set(x, y, y === hy ? h[0] : h[litIndex(nx, ny)]);
      }
    }
    if (dir === 'down') { pc.set(11, hy + 1, h[1]); pc.set(12, hy + 1, h[0]); }
    if (dir !== 'up') {
      const px = dir === 'left' ? 9 : 12;
      for (let y = hy - 7; y < hy - 2; y++) pc.set(px, y, t[3]);
    }
  } else if (type === 'hood') {
    for (let y = hy - 8; y <= hy + 6; y++) {
      for (let x = 0; x < FRAME_W; x++) {
        if (!inHead(x, y, cx, hy, rx, ry, 1.2)) continue;
        const ly = y + 0.5 - hy;
        let face = false;
        if (dir === 'down') face = x >= 8 && x <= 15 && ly > -2.5 && ly < 4.5;
        if (dir === 'left') face = x <= 9 && ly > -2.5 && ly < 4.5;
        if (face) continue;
        const nx = (x + 0.5 - cx) / (rx + 1.2), ny = (y + 0.5 - hy) / (ry + 1.2);
        pc.set(x, y, h[litIndex(nx, ny)]);
      }
    }
  } else if (type === 'bandana') {
    for (let x = 0; x < FRAME_W; x++) {
      for (const y of [hy - 3, hy - 2]) {
        if (inHead(x, y, cx, hy, rx, ry, 0.9)) pc.set(x, y, h[y === hy - 3 ? 3 : 1]);
      }
    }
    if (dir !== 'down') {
      const kx = dir === 'left' ? 16 : 12;
      pc.set(kx, hy - 1, h[2]); pc.set(kx + 1, hy, h[1]); pc.set(kx, hy, h[1]);
    }
  }
}

function drawScarf(pc, dir, f, o, pal, lay) {
  if (!pal.scarf) return;
  const y = lay.torsoTop + f.bob;
  const s = pal.scarf;
  if (dir === 'left') {
    for (let x = 9; x <= 13; x++) { pc.set(x, y - 1, s[x < 11 ? 3 : 2]); pc.set(x, y, s[1]); }
    const wave = f.bob !== 0 ? 1 : 0;
    for (let j = 0; j < 4; j++) { pc.set(14 + Math.floor(j / 2), y + j - wave, s[2]); pc.set(15 + Math.floor(j / 2), y + j - wave, s[0]); }
    return;
  }
  for (let x = 8; x <= 15; x++) { pc.set(x, y - 1, s[x < 10 ? 3 : 2]); pc.set(x, y, s[x > 13 ? 0 : 1]); }
  if (dir === 'down') {
    for (let j = 1; j < 5; j++) { pc.set(14, y + j, s[2]); pc.set(15, y + j, s[0]); }
  } else {
    for (let j = 1; j < 4; j++) { pc.set(9, y + j, s[3]); pc.set(10, y + j, s[1]); }
  }
}

function drawCape(pc, dir, f, o, pal, lay, layer) {
  if (!pal.cape) return;
  const top = lay.torsoTop + f.bob;
  const c = pal.cape;
  if (dir === 'up' && layer === 'front') {
    for (let y = top; y <= lay.hem + 2; y++) {
      const flare = Math.floor((y - top) / 4);
      for (let x = 7 - flare; x <= 16 + flare; x++) pc.set(x, y, c[x <= 8 - flare ? 3 : x >= 15 + flare ? 0 : (x + y) % 7 === 0 ? 1 : 2]);
    }
  } else if (dir === 'left' && layer === 'back') {
    const flow = f.bob !== 0 ? 1 : 0;
    for (let y = top; y <= lay.hem + 2; y++) {
      const ext = Math.floor((y - top) / 3) + flow;
      for (let x = 12; x <= 14 + ext; x++) pc.set(x, y, c[x >= 14 + ext ? 0 : 1]);
    }
  } else if (dir === 'down' && layer === 'back') {
    for (let y = top + 1; y <= lay.hem + 2; y++) {
      for (let x = 6; x <= 17; x++) pc.set(x, y, c[0]);
    }
  }
}

function drawStaff(pc, dir, f, o, pal, lay, layer) {
  if (!o.staff) return;
  const front = (dir === 'left' && layer === 'front') || (dir === 'down' && layer === 'front') || (dir === 'up' && layer === 'back');
  if (!front) return;
  const x = dir === 'left' ? 8 : dir === 'down' ? 19 : 4;
  const top = Math.round(lay.hy - 7 + f.bob);
  for (let y = top + 2; y <= 31; y++) {
    pc.set(x, y, pal.staff[2]);
    pc.set(x + 1, y, pal.staff[0]);
  }
  pc.ellipse(x + 1, top, 2.2, 2.2, (px, py, nx, ny) => pal.orb[litIndex(nx, ny)]);
  pc.set(x, top - 1, [255, 255, 255]);
}

/** Shift every row above `rowLimit` towards the facing side (side view faces left). */
function leanForward(pc, rowLimit, px) {
  for (let y = 0; y < rowLimit; y++) {
    for (let x = 0; x < pc.w; x++) {
      const src = pc.get(x + px, y);
      if (src && src[3]) pc.set(x, y, src);
      else pc.clear(x, y);
    }
  }
}

function drawFrame(pc, dir, f, o, pal, lay) {
  drawHair(pc, dir, f, o, pal, lay, 'back');
  drawCape(pc, dir, f, o, pal, lay, 'back');
  drawStaff(pc, dir, f, o, pal, lay, 'back');
  if (dir === 'left') drawArms(pc, dir, f, o, pal, lay, 'far');
  drawLegs(pc, dir, f, o, pal, lay);
  drawTorso(pc, dir, f, o, pal, lay);
  drawCape(pc, dir, f, o, pal, lay, 'front');
  if (dir === 'left') drawArms(pc, dir, f, o, pal, lay, 'near');
  else drawArms(pc, dir, f, o, pal, lay);
  drawHead(pc, dir, f, o, pal, lay);
  drawHair(pc, dir, f, o, pal, lay, 'front');
  drawBeard(pc, dir, f, o, pal, lay);
  drawHat(pc, dir, f, o, pal, lay);
  drawScarf(pc, dir, f, o, pal, lay);
  drawStaff(pc, dir, f, o, pal, lay, 'front');
}

/* ------------------------------------------------------------------ */
/*  Small critter: a cat. Rows: [left, right]; cols: walk x4, idle x2   */
/* ------------------------------------------------------------------ */

export function makeCatSheet({ fur = '#d98a3d', stripes = true } = {}) {
  const W = 16, H = 12;
  const r = R(fur, 4, 0.09);
  const sheet = new PixelCanvas(W * 6, H * 2);
  const legSets = [
    [[4, 0], [6, 1], [10, 0], [12, 1]],
    [[5, 0], [6, 0], [11, 0], [12, 0]],
    [[3, 1], [7, 0], [9, 1], [13, 0]],
    [[5, 0], [6, 0], [11, 0], [12, 0]],
  ];
  for (let fi = 0; fi < 6; fi++) {
    const pc = new PixelCanvas(W, H);
    const walking = fi < 4;
    const legs = walking ? legSets[fi] : legSets[1];
    const bob = walking && (fi === 1 || fi === 3) ? -1 : 0;
    for (const [lx, lift] of legs) {
      for (let y = 8; y <= 11 - lift; y++) pc.set(lx, y, r[lx < 8 ? 1 : 0]);
    }
    pc.ellipse(8.5, 6.5 + bob, 5, 2.7, (x, y, nx, ny) => {
      let k = litIndex(nx * 0.8, ny);
      if (stripes && x % 3 === 0 && ny < 0.3 && k > 0) k -= 1;
      return r[k];
    });
    // tail
    const flick = fi === 5 ? 1 : 0;
    pc.line(13, 6 + bob, 14, 3 + bob, r[1]);
    pc.line(14, 3 + bob, 15 - flick, 1 + bob, r[2]);
    // head
    pc.ellipse(4, 4.5 + bob, 3, 2.7, (x, y, nx, ny) => r[litIndex(nx, ny)]);
    pc.set(2, 1 + bob, r[2]); pc.set(2, 2 + bob, r[2]); pc.set(5, 1 + bob, r[2]); pc.set(5, 2 + bob, r[1]);
    pc.set(3, 4 + bob, hex('#2a2a1a'));
    pc.set(1, 5 + bob, hex('#e8a0a0'));
    pc.set(4, 6 + bob, r[3]);
    pc.outline({ darken: 0.36 });
    sheet.blit(pc, fi * W, 0);
    sheet.blit(pc, fi * W, H, { flipX: true });
  }
  return {
    texture: toTexture(sheet),
    canvas: sheet,
    frameW: W,
    frameH: H,
    cols: 6,
    rows: 2,
    directions: ['left', 'right'],
    animations: {
      idle: { frames: [4, 4, 4, 5], fps: 2 },
      walk: { frames: [0, 1, 2, 3], fps: 9, steps: [0, 2] },
      run: { frames: [0, 1, 2, 3], fps: 14, steps: [0, 2] },
    },
  };
}
