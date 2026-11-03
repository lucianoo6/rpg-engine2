/**
 * Gameplay-side view of the level: ground height queries, walkability with
 * step limits, circle/box colliders for props, and interactables.
 */
export class World {
  constructor(map) {
    this.map = map;
    this.circles = [];
    this.boxes = [];
    this.interactables = [];
    this.zones = [];
    this.maxStep = 0.55;
  }

  addCircle(x, z, r, tag = null) {
    const c = { x, z, r, tag };
    this.circles.push(c);
    return c;
  }

  addBox(minX, minZ, maxX, maxZ, tag = null) {
    const b = { minX, minZ, maxX, maxZ, tag };
    this.boxes.push(b);
    return b;
  }

  /** Named rectangular regions (used for location banners, music cues...). */
  addZone(name, minX, minZ, maxX, maxZ, data = {}) {
    this.zones.push({ name, minX, minZ, maxX, maxZ, ...data });
  }

  zoneAt(x, z) {
    for (const zn of this.zones) if (x >= zn.minX && x <= zn.maxX && z >= zn.minZ && z <= zn.maxZ) return zn;
    return null;
  }

  addInteractable(obj) {
    this.interactables.push(obj);
    return obj;
  }

  /** Walkable surface height at a point (bridges override the tile). */
  groundAt(x, z) {
    const i = Math.floor(x), j = Math.floor(z);
    const m = this.map;
    if (!m.inBounds(i, j)) return -10;
    const k = m.idx(i, j);
    const deck = m.deck[k];
    if (!Number.isNaN(deck)) return deck;
    return m.height[k];
  }

  isBlockedPoint(x, z, fromY) {
    const i = Math.floor(x), j = Math.floor(z);
    const m = this.map;
    if (!m.inBounds(i, j)) return true;
    const k = m.idx(i, j);
    if (m.solid[k]) return true;
    if (m.types[m.type[k]].walkable === false && Number.isNaN(m.deck[k])) return true;
    const g = this.groundAt(x, z);
    if (g < 0 && Number.isNaN(m.deck[k])) return true; // water
    return Math.abs(g - fromY) > this.maxStep;
  }

  /** Can a circle of radius r stand at (x, z), arriving from height fromY? */
  canStand(x, z, r, fromY, ignore = null) {
    const pts = [[x, z], [x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r], [x - r, z], [x + r, z], [x, z - r], [x, z + r]];
    for (const [px, pz] of pts) if (this.isBlockedPoint(px, pz, fromY)) return false;
    for (const c of this.circles) {
      if (c === ignore) continue;
      const dx = x - c.x, dz = z - c.z;
      const rr = r + c.r;
      if (dx * dx + dz * dz < rr * rr) return false;
    }
    for (const b of this.boxes) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ) return false;
    }
    return true;
  }
}
