import * as THREE from 'three';
import { patchMaterial, makeShadowMaterials } from '../render/MaterialPatch.js';
import { PPU } from '../pixel/TextureFactory.js';

/**
 * Sprite quads that stand upright in the 3D world and turn to face the
 * camera around the vertical axis (in the vertex shader, so shadows and
 * every pass agree). Normals lean back towards the sky so sprites pick up
 * sun and lamp light the way painted HD-2D sprites do.
 */

const geoCache = new Map();
export function spriteGeometry(width, height, pivotX = 0.5, pivotY = 0, tilt = 0.55) {
  const key = `${width.toFixed(4)}|${height.toFixed(4)}|${pivotX}|${pivotY}|${tilt}`;
  if (geoCache.has(key)) return geoCache.get(key);
  const g = new THREE.PlaneGeometry(width, height);
  g.translate((0.5 - pivotX) * width, (0.5 - pivotY) * height, 0);
  const n = new THREE.Vector3(0, tilt, 1).normalize();
  const normals = g.attributes.normal;
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, n.x, n.y, n.z);
  geoCache.set(key, g);
  return g;
}

const shadowCache = new Map();
function shadowMaterialsFor(opts) {
  const key = JSON.stringify(opts);
  if (!shadowCache.has(key)) shadowCache.set(key, makeShadowMaterials(opts));
  return shadowCache.get(key);
}

export function makeSpriteMaterial(map, { lit = true, alphaTest = 0.5, color = 0xffffff, wind = 0, windHeight = 1, flip = false, intensity = 1, transparent = false, blending = THREE.NormalBlending, depthWrite = true, cutout = false } = {}) {
  let material;
  if (lit) {
    material = new THREE.MeshLambertMaterial({ map, alphaTest, color });
  } else {
    material = new THREE.MeshBasicMaterial({ map, alphaTest, color, transparent, blending, depthWrite });
    material.color.multiplyScalar(intensity);
  }
  material.shadowSide = THREE.DoubleSide;
  patchMaterial(material, { billboard: true, wind, windHeight, clouds: lit, flip, cutout });
  return material;
}

export class Billboard extends THREE.Mesh {
  /**
   * @param {THREE.Texture} texture  sprite or sprite sheet
   * @param {object} o
   *   frames: [cols, rows] of the sheet; pivot: [x, y] normalised anchor;
   *   lit: use scene lighting (false = unlit/emissive, e.g. fire);
   *   wind: sway amplitude in world units.
   */
  constructor(texture, o = {}) {
    const [cols, rows] = o.frames || [1, 1];
    const pivot = o.pivot || [0.5, 0];
    const w = o.width ?? texture.userData.pixelWidth / cols / PPU;
    const h = o.height ?? texture.userData.pixelHeight / rows / PPU;
    const map = texture.clone();
    map.needsUpdate = true;
    map.repeat.set(1 / cols, 1 / rows);
    const wind = o.wind || 0;
    const material = makeSpriteMaterial(map, { ...o, wind, windHeight: h });
    super(spriteGeometry(w, h, pivot[0], pivot[1], o.tilt ?? 0.55), material);
    const sh = shadowMaterialsFor({ billboard: true, wind, windHeight: h });
    this.customDepthMaterial = sh.depth;
    this.customDistanceMaterial = sh.distance;
    this.castShadow = o.castShadow ?? true;
    this.receiveShadow = o.receiveShadow ?? true;
    this.cols = cols;
    this.rows = rows;
    this.spriteWidth = w;
    this.spriteHeight = h;
    this.setFrame(0, 0);
  }

  setFrame(col, row) {
    this.material.map.offset.set(col / this.cols, 1 - (row + 1) / this.rows);
  }
}

/**
 * Plays named animations from a sheet description
 * ({ animations: { name: { frames, fps, steps? } }, directions: [...] }).
 * `steps` lists frame-array indices where a foot lands; onStep() fires there.
 */
export class SpriteAnimator {
  constructor(sprite, sheet) {
    this.sprite = sprite;
    this.sheet = sheet;
    this.current = 'idle';
    this.direction = sheet.directions[0];
    this.time = 0;
    this.speed = 1;
    this.onStep = null;
    this._lastIdx = -1;
  }

  play(name) {
    if (this.current === name || !this.sheet.animations[name]) return;
    // keep the walk phase when switching between walk and run
    if (!(/walk|run/.test(this.current) && /walk|run/.test(name))) this.time = 0;
    this.current = name;
    this._lastIdx = -1;
  }

  /** Sheets without a row for `dir` (e.g. side-only critters) keep their last facing. */
  setDirection(dir) {
    if (this.sheet.directions.includes(dir)) this.direction = dir;
  }

  update(dt) {
    const anim = this.sheet.animations[this.current];
    this.time += dt * this.speed;
    const idx = Math.floor(this.time * anim.fps) % anim.frames.length;
    if (idx !== this._lastIdx) {
      if (this._lastIdx !== -1 && anim.steps && anim.steps.includes(idx) && this.onStep) this.onStep(this.current);
      this._lastIdx = idx;
    }
    const row = Math.max(0, this.sheet.directions.indexOf(this.direction));
    this.sprite.setFrame(anim.frames[idx], row);
  }
}
