/**
 * Small, composable AI behaviours for characters.
 */

/** Stroll around a home point, pausing now and then. */
export class Wander {
  constructor(character, { radius = 2.5, pause = [1.5, 4.5], speed = 0.55 } = {}) {
    this.c = character;
    this.home = { x: character.position.x, z: character.position.z };
    this.radius = radius;
    this.pause = pause;
    this.speed = speed;
    this.wait = Math.random() * 2;
    this.target = null;
    this.stuck = 0;
    this.enabled = true;
  }

  update(dt) {
    const c = this.c;
    if (!this.enabled) { c.intent.set(0, 0); return; }
    if (this.wait > 0) {
      this.wait -= dt;
      c.intent.set(0, 0);
      return;
    }
    if (!this.target) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * this.radius;
      this.target = { x: this.home.x + Math.cos(a) * d, z: this.home.z + Math.sin(a) * d };
      this.stuck = 0;
    }
    const dx = this.target.x - c.position.x, dz = this.target.z - c.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15 || this.stuck > 0.6) {
      this.target = null;
      this.wait = this.pause[0] + Math.random() * (this.pause[1] - this.pause[0]);
      c.intent.set(0, 0);
      return;
    }
    c.intent.set((dx / dist) * this.speed, (dz / dist) * this.speed);
    if (!c.moving) this.stuck += dt;
    else this.stuck = 0;
  }
}

/** Walk a loop of waypoints. */
export class Patrol {
  constructor(character, points, { speed = 0.6, pause = 1.5 } = {}) {
    this.c = character;
    this.points = points;
    this.i = 0;
    this.speed = speed;
    this.pause = pause;
    this.wait = 0;
    this.enabled = true;
  }

  update(dt) {
    const c = this.c;
    if (!this.enabled || this.wait > 0) {
      this.wait -= dt;
      c.intent.set(0, 0);
      return;
    }
    const p = this.points[this.i];
    const dx = p[0] - c.position.x, dz = p[1] - c.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.2) {
      this.i = (this.i + 1) % this.points.length;
      this.wait = this.pause;
      c.intent.set(0, 0);
      return;
    }
    c.intent.set((dx / d) * this.speed, (dz / d) * this.speed);
  }
}
