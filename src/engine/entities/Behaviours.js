/**
 * Small, composable AI behaviours for characters. With a NavGrid they walk
 * real paths around obstacles; without one they head straight for targets.
 * Set `enabled = false` (e.g. during dialogue) to pause them.
 */

/** Stroll around a home point, pausing now and then. */
export class Wander {
  constructor(character, { radius = 2.5, pause = [1.5, 4.5], speed = 0.55, nav = null } = {}) {
    this.c = character;
    this.home = { x: character.position.x, z: character.position.z };
    this.radius = radius;
    this.pause = pause;
    this.speed = speed;
    this.nav = nav;
    this.wait = Math.random() * 2;
    this.enabled = true;
    this._walking = false;
  }

  set enabled(v) {
    this._enabled = v;
    if (!v && this.c) this.c.cancelPath();
  }

  get enabled() {
    return this._enabled;
  }

  update(dt) {
    const c = this.c;
    if (!this._enabled || this._walking) return;
    if (this.wait > 0) {
      this.wait -= dt;
      c.intent.set(0, 0);
      return;
    }
    const a = Math.random() * Math.PI * 2;
    const d = Math.random() * this.radius;
    const tx = this.home.x + Math.cos(a) * d, tz = this.home.z + Math.sin(a) * d;
    this._walking = true;
    c.walkTo(tx, tz, { nav: this.nav, speed: this.speed }).then(() => {
      this._walking = false;
      this.wait = this.pause[0] + Math.random() * (this.pause[1] - this.pause[0]);
    });
  }
}

/** Walk a loop of waypoints. */
export class Patrol {
  constructor(character, points, { speed = 0.6, pause = 1.5, nav = null } = {}) {
    this.c = character;
    this.points = points;
    this.i = 0;
    this.speed = speed;
    this.pause = pause;
    this.nav = nav;
    this.wait = 0;
    this.enabled = true;
    this._walking = false;
  }

  set enabled(v) {
    this._enabled = v;
    if (!v && this.c) this.c.cancelPath();
  }

  get enabled() {
    return this._enabled;
  }

  update(dt) {
    if (!this._enabled || this._walking) return;
    if (this.wait > 0) {
      this.wait -= dt;
      this.c.intent.set(0, 0);
      return;
    }
    const [x, z] = this.points[this.i];
    this._walking = true;
    this.c.walkTo(x, z, { nav: this.nav, speed: this.speed }).then(() => {
      this._walking = false;
      this.i = (this.i + 1) % this.points.length;
      this.wait = this.pause;
    });
  }
}
