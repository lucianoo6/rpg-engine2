import * as THREE from 'three';
import { Billboard, SpriteAnimator } from '../sprites/Billboard.js';
import { softCircleCanvas } from '../pixel/SpriteFactory.js';
import { damp } from '../core/Random.js';

let blobTexture = null;
function blobShadowTexture() {
  if (!blobTexture) {
    blobTexture = new THREE.CanvasTexture(softCircleCanvas(64, 0.15, 1, '0,0,0'));
  }
  return blobTexture;
}

/**
 * A walking sprite: billboard + animator + blob shadow + collision-aware
 * movement over stepped terrain. Facing is stored in world space and
 * mapped to the sheet's down/left/right/up rows relative to the camera,
 * so characters keep facing the right way when the camera orbits.
 */
export class Character {
  constructor(world, sheet, { name = 'Character', x = 0, z = 0, speed = 3.0, runSpeed = 5.4, radius = 0.3, scale = 1, solid = true } = {}) {
    this.world = world;
    this.sheet = sheet;
    this.name = name;
    this.speed = speed;
    this.runSpeed = runSpeed;
    this.radius = radius;
    this.root = new THREE.Group();
    this.root.name = name;
    this.isCharacter = true;
    this.sprite = new Billboard(sheet.texture, sheet.frameRects
      ? { frameSize: [sheet.frameW, sheet.frameH] }
      : { frames: [sheet.cols, sheet.rows] });
    this.sprite.scale.setScalar(scale);
    this.root.add(this.sprite);
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 0.6).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, opacity: 0.38, depthWrite: false, color: 0x000000, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    );
    blob.scale.setScalar(scale * (sheet.frameW > 20 ? 0.95 : 0.8));
    blob.position.y = 0.02;
    blob.renderOrder = 2;
    this.blob = blob;
    this.root.add(blob);
    this.animator = new SpriteAnimator(this.sprite, sheet);
    this.onStep = null; // (character, animationName) => void, e.g. footstep sounds
    this.animator.onStep = (anim) => this.onStep && this.onStep(this, anim);
    this.position = this.root.position;
    this.position.set(x, world.groundAt(x, z), z);
    this.facing = new THREE.Vector2(0, 1); // world xz; +z = towards the camera
    this.intent = new THREE.Vector2();
    this.running = false;
    this.moving = false;
    this.velocity = new THREE.Vector3();
    this.collider = solid ? world.addCircle(x, z, radius, this) : null;
    this.lockFacing = false;
    this._path = null;
    this.talking = false; // plays the 'talk' animation while idle (set by the dialogue)
    this._hop = null;
  }

  /** A little jump of surprise or joy. Resolves when the character lands. */
  hop(height = 0.32, duration = 0.3) {
    return new Promise((resolve) => {
      if (this._hop) this._hop.resolve();
      this._hop = { t: 0, height, duration, resolve };
    });
  }

  /** Move this character into another World (map change), optionally to a new spot. */
  setWorld(world, x = this.position.x, z = this.position.z) {
    this.cancelPath();
    if (this.collider) this.world.removeCircle(this.collider);
    this.world = world;
    this.position.set(x, world.groundAt(x, z), z);
    this.collider = this.collider ? world.addCircle(x, z, this.radius, this) : null;
  }

  /**
   * Walk to (x, z), following a NavGrid path when `nav` is given.
   * Resolves true on arrival, false when no path exists or the walker
   * gets stuck. A new walkTo() or cancelPath() resolves the old one false.
   */
  walkTo(x, z, { nav = null, run = false, stopDistance = 0.12, speed = 1 } = {}) {
    this.cancelPath();
    const pts = nav ? nav.findPath(this.position.x, this.position.z, x, z) : [[x, z]];
    if (!pts || !pts.length) return Promise.resolve(false);
    return new Promise((resolve) => {
      this._path = { pts, i: 0, run, stop: stopDistance, speed, resolve, stuck: 0 };
    });
  }

  cancelPath() {
    if (!this._path) return;
    const p = this._path;
    this._path = null;
    this.intent.set(0, 0);
    this.running = false;
    p.resolve(false);
  }

  get walking() {
    return !!this._path;
  }

  _followPath(dt) {
    const p = this._path;
    const [tx, tz] = p.pts[p.i];
    const dx = tx - this.position.x, dz = tz - this.position.z;
    const d = Math.hypot(dx, dz);
    const last = p.i === p.pts.length - 1;
    if (d < (last ? Math.max(0.08, p.stop) : 0.2)) {
      if (last) {
        this._path = null;
        this.intent.set(0, 0);
        this.running = false;
        p.resolve(true);
        return;
      }
      p.i++;
      this._followPath(dt);
      return;
    }
    // slow down for the final approach so we don't overshoot
    const k = last ? Math.min(1, d / 0.4 + 0.25) : 1;
    this.intent.set((dx / d) * p.speed * k, (dz / d) * p.speed * k);
    this.running = p.run;
  }

  faceToward(x, z) {
    const dx = x - this.position.x, dz = z - this.position.z;
    if (Math.hypot(dx, dz) > 1e-3) this.facing.set(dx, dz).normalize();
  }

  /** Try to move along (dx, dz) with axis-separated sliding. Returns moved distance. */
  _move(dx, dz) {
    const p = this.position;
    const y = this.world.groundAt(p.x, p.z);
    let moved = 0;
    const tryAt = (nx, nz) => this.world.canStand(nx, nz, this.radius, y, this.collider);
    if (tryAt(p.x + dx, p.z + dz)) {
      p.x += dx; p.z += dz; moved = Math.hypot(dx, dz);
    } else {
      if (dx && tryAt(p.x + dx, p.z)) { p.x += dx; moved += Math.abs(dx); }
      if (dz && tryAt(p.x, p.z + dz)) { p.z += dz; moved += Math.abs(dz); }
    }
    return moved;
  }

  update(dt, camYaw = 0) {
    if (this._path && dt > 0) this._followPath(dt);
    const len = this.intent.length();
    const sp = (this.running ? this.runSpeed : this.speed) * Math.min(1, len);
    let moved = 0;
    const px = this.position.x, pz = this.position.z;
    if (len > 0.05 && dt > 0) {
      const dx = (this.intent.x / len) * sp * dt;
      const dz = (this.intent.y / len) * sp * dt;
      if (!this.lockFacing) this.facing.set(this.intent.x, this.intent.y).normalize();
      moved = this._move(dx, dz);
    }
    this.moving = moved > 1e-4;
    if (this._path && dt > 0) {
      const p = this._path;
      p.stuck = this.moving ? 0 : p.stuck + dt;
      if (p.stuck > 0.8) this.cancelPath(); // blocked (e.g. by another character)
    }
    this.velocity.set((this.position.x - px) / Math.max(dt, 1e-4), 0, (this.position.z - pz) / Math.max(dt, 1e-4));
    if (this.collider) { this.collider.x = this.position.x; this.collider.z = this.position.z; }

    const ground = this.world.groundAt(this.position.x, this.position.z);
    this.position.y = Math.abs(ground - this.position.y) > 2 ? ground : damp(this.position.y, ground, 18, dt);

    // facing relative to the camera
    const c = Math.cos(camYaw), s = Math.sin(camYaw);
    const lx = c * this.facing.x - s * this.facing.y;
    const lz = s * this.facing.x + c * this.facing.y;
    let dir;
    if (Math.abs(lx) > Math.abs(lz) * 1.05) dir = lx < 0 ? 'left' : 'right';
    else dir = lz < 0 ? 'up' : 'down';
    this.animator.setDirection(dir);
    const idle = this.talking && this.sheet.animations.talk ? 'talk' : 'idle';
    this.animator.play(this.moving ? (this.running ? 'run' : 'walk') : idle);
    this.animator.update(dt);
    if (this._hop) {
      const h = this._hop;
      h.t += dt;
      const k = Math.min(1, h.t / h.duration);
      this.sprite.position.y = Math.sin(k * Math.PI) * h.height;
      if (k >= 1) {
        this.sprite.position.y = 0;
        this._hop = null;
        h.resolve();
      }
    }
  }

  dispose() {
    this.root.removeFromParent();
  }
}
