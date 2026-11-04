import * as THREE from 'three';
import { CHARACTER_ANIMATIONS, DIRS } from '../pixel/CharacterFactory.js';

/**
 * Sprite sheets from image files, in the same shape the procedural
 * generators produce, so Character / Billboard can't tell the difference.
 *
 *  - Aseprite JSON export (array or hash, "Split Layers" off): frame rects
 *    come from `frames`, animations from `meta.frameTags`. Tags are named
 *    `<animation>_<direction>` (e.g. `walk_left`, `idle_down`) or just
 *    `<animation>` for sheets without directions. Tag direction
 *    forward / reverse / pingpong is honoured; fps comes from frame durations.
 *  - Plain PNG in the engine's character grid layout (rows down, left,
 *    right, up; columns idle0, idle1, walkA, pass, walkB), e.g. a sheet
 *    exported from the procedural generator and repainted by hand.
 */

const loader = new THREE.TextureLoader();

export function pixelTexture(tex) {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.userData.pixelWidth = tex.image.width;
  tex.userData.pixelHeight = tex.image.height;
  return tex;
}

function loadTexture(url) {
  return new Promise((resolve, reject) => loader.load(url, (t) => resolve(pixelTexture(t)), undefined, reject));
}

/** Build a sheet from parsed Aseprite JSON plus its loaded texture. */
export function sheetFromAseprite(json, texture) {
  const list = Array.isArray(json.frames) ? json.frames : Object.values(json.frames);
  const frameRects = list.map((f) => ({ x: f.frame.x, y: f.frame.y, w: f.frame.w, h: f.frame.h }));
  const durations = list.map((f) => f.duration || 100);
  const frameW = frameRects[0].w, frameH = frameRects[0].h;
  const animations = {};
  const directions = new Set();
  for (const tag of json.meta.frameTags || []) {
    const m = /^(.*?)(?:_(down|left|right|up))?$/.exec(tag.name);
    const anim = m[1];
    const dir = m[2] || null;
    const seq = [];
    for (let i = tag.from; i <= tag.to; i++) seq.push(i);
    let frames = seq;
    if (tag.direction === 'reverse') frames = seq.slice().reverse();
    else if (tag.direction === 'pingpong') frames = seq.concat(seq.slice(1, -1).reverse());
    const avg = frames.reduce((a, i) => a + durations[i], 0) / frames.length;
    const a = (animations[anim] ||= { frames, fps: 1000 / avg, byDir: {} });
    if (dir) { a.byDir[dir] = frames; directions.add(dir); } else a.frames = frames;
    if (/walk|run/.test(anim)) a.steps = [0, Math.floor(frames.length / 2)];
  }
  if (!animations.idle) animations.idle = { frames: [0], fps: 1, byDir: {} };
  if (!animations.walk) animations.walk = animations.idle;
  if (!animations.run) animations.run = { ...animations.walk, fps: animations.walk.fps * 1.6 };
  const dirs = directions.size ? DIRS.filter((d) => directions.has(d)) : ['down'];
  for (const a of Object.values(animations)) if (!a.frames || !a.frames.length) a.frames = a.byDir[dirs[0]] || [0];
  return { texture, frameRects, frameW, frameH, directions: dirs, animations };
}

/** Engine character-grid PNG (24x32 frames, 5 columns, 4 direction rows). */
export function sheetFromGrid(texture, { frameW = 24, frameH = 32 } = {}) {
  const cols = Math.round(texture.image.width / frameW);
  const rows = Math.round(texture.image.height / frameH);
  return { texture, frameW, frameH, cols, rows, directions: DIRS.slice(0, rows), animations: CHARACTER_ANIMATIONS };
}

/** Load a sheet: `*.json` = Aseprite export (image path is relative to it), otherwise a grid PNG. */
export async function loadSpriteSheet(url, opts = {}) {
  if (/\.json(\?|$)/i.test(url)) {
    const json = await (await fetch(url)).json();
    const imgUrl = new URL(json.meta.image, new URL(url, location.href)).href;
    return sheetFromAseprite(json, await loadTexture(imgUrl));
  }
  return sheetFromGrid(await loadTexture(url), opts);
}

/**
 * Describe a grid sheet (e.g. from makeCharacterSheet) as Aseprite JSON so
 * it can be opened, repainted and re-exported in Aseprite.
 */
export function gridSheetToAseprite(sheet, imageName) {
  const frames = [];
  const tags = [];
  for (let r = 0; r < sheet.rows; r++) {
    for (let c = 0; c < sheet.cols; c++) {
      frames.push({
        filename: `${sheet.directions[r]} ${c}`,
        frame: { x: c * sheet.frameW, y: r * sheet.frameH, w: sheet.frameW, h: sheet.frameH },
        rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: sheet.frameW, h: sheet.frameH },
        sourceSize: { w: sheet.frameW, h: sheet.frameH },
        duration: c < 2 ? 420 : 125,
      });
    }
    const base = r * sheet.cols;
    tags.push({ name: `idle_${sheet.directions[r]}`, from: base, to: base + 1, direction: 'forward' });
    tags.push({ name: `walk_${sheet.directions[r]}`, from: base + 2, to: base + 4, direction: 'pingpong' });
  }
  return {
    frames,
    meta: {
      app: 'hd2d-engine', version: '1', image: imageName, format: 'RGBA8888',
      size: { w: sheet.cols * sheet.frameW, h: sheet.rows * sheet.frameH }, scale: '1', frameTags: tags,
    },
  };
}
