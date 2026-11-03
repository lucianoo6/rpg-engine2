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
    this.sprite = new Billboard(sheet.texture, { frames: [sheet.cols, sheet.rows] });
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
    this.animator.play(this.moving ? (this.running ? 'run' : 'walk') : 'idle');
    this.animator.update(dt);
  }

  dispose() {
    this.root.removeFromParent();
  }
}
