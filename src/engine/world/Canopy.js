import { SpriteInstances } from '../sprites/SpriteInstances.js';

/**
 * Tree crowns built from many leaf-cluster billboards placed in 3D around
 * the trunk top, instead of one painted card. When the camera turns, the
 * near clusters slide over the far ones, which reads as real volume. Each
 * cluster is itself painted as a bunch of smaller lobes (paintLeafCluster),
 * and optional twigs (paintTwig) break the silhouette at the edge.
 *
 * Every cluster and twig variant of a species is packed into one atlas
 * strip, so the whole species is a single SpriteInstances (one draw call,
 * plus one per shadow pass). Placement is derived from the tree position,
 * so it is stable and does not disturb the caller's random sequence.
 */
export class ClusterCanopy {
  /**
   * @param {object} o
   *   clusters: PixelCanvas[] leaf-cluster variants (with .normal for volume)
   *   twigs:    PixelCanvas[] twig variants (optional, [] for none)
   *   crown:    round: { height, rx, ry } centre height above the ground and radii, world units;
   *             conifer: { tiers, bottom, top, rx, clumpWidth } (see _addConifer)
   *   pivot:    cluster sprite anchor ([0.5, 0.15] suits hanging conifer skirts)
   *   count:    clusters per tree; twigCount: twigs per tree
   *   capacity: trees this canopy can hold
   *   wind:     sway amplitude per cluster
   *   atlas:    { mesh, clusterFrames, twigFrames } to draw into a mesh shared
   *             with other species (see TreeGroup) instead of an own one
   */
  constructor({ clusters = [], twigs = [], crown, count = 10, twigCount = 4, capacity = 64, wind = 0.04, pivot = [0.5, 0.5], atlas = null }) {
    this.crown = crown;
    this.perTree = count;
    this.twigCount = twigs.length ? twigCount : 0;
    if (atlas) {
      // share a mesh with other species: atlas = { mesh, clusterFrames, twigFrames }
      this.mesh = atlas.mesh;
      this.clusterFrames = atlas.clusterFrames;
      this.twigFrames = atlas.twigFrames || [];
      this.twigCount = this.twigFrames.length ? twigCount : 0;
      this.sets = [];
      return;
    }
    this.clusterFrames = clusters.map((_, i) => i);
    this.twigFrames = twigs.map((_, i) => clusters.length + i);
    const perTree = count + 1 + this.twigCount;
    this.mesh = SpriteInstances.fromVariants([...clusters, ...twigs], { capacity: capacity * perTree, pivot, wind, sunFacingShadow: true });
    this.sets = [this.mesh];
  }

  /** Grow a crown over a trunk standing at (x, y, z). */
  add(x, y, z, o = {}) {
    if (this.crown.tiers) return this._addConifer(x, y, z, o);
    return this._addRound(x, y, z, o);
  }

  _rand(x, z) {
    let seed = (Math.floor(x * 73.1) * 92821 + Math.floor(z * 51.7) * 68917) >>> 0;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
    return { rnd, range: (a, b) => a + (b - a) * rnd() };
  }

  _shade(tint) {
    const base = tint ? parseInt(tint.slice(1), 16) : 0xffffff;
    return (k) => {
      const r = ((base >> 16) & 255) * k, g = ((base >> 8) & 255) * k, b = (base & 255) * k;
      return `#${[r, g, b].map((v) => Math.round(Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
    };
  }

  /**
   * Conifer: stacked skirts (crown.tiers) of needle clumps around the trunk,
   * wide at the bottom and narrowing to a tip; crown.bottom and crown.top
   * are heights above the ground, crown.rx the radius of the lowest skirt.
   */
  _addConifer(x, y, z, { scale = 1, tint = null } = {}) {
    const { rnd, range } = this._rand(x, z);
    const shade = this._shade(tint);
    const { tiers, bottom, top, rx, clumpWidth } = this.crown;
    const pick = (frames) => frames[Math.floor(rnd() * frames.length)];
    const put = (ex, ey, ez, o) => this.mesh.add(ex, ey, ez, { ...o, frame: pick(this.clusterFrames) });
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < tiers; k++) {
      const f = k / (tiers - 1); // 0 = lowest skirt
      const hb = y + (bottom + (top - bottom) * f * 0.82) * scale;
      const R = rx * (1 - f * 0.68) * scale;
      const n = Math.max(1, Math.round(4 - f * 3));
      const light = 0.8 + 0.26 * f;
      for (let i = 0; i < n; i++) {
        const az = a0 + (i / n) * Math.PI * 2 + k * 0.9 + range(-0.25, 0.25);
        const d = n === 1 ? 0 : R * range(0.3, 0.4);
        const s = ((R * 1.75) / clumpWidth) * range(0.92, 1.06);
        put(x + Math.cos(az) * d, hb + range(-0.06, 0.06), z + Math.sin(az) * d, { scale: s, flip: rnd() < 0.5, tint: shade(light * range(0.95, 1.03)) });
      }
    }
    // the tip
    put(x, y + top * scale, z, { scale: ((rx * 0.42) / clumpWidth) * scale * 1.6, flip: rnd() < 0.5, tint: shade(1.06) });
  }

  _addRound(x, y, z, { scale = 1, tint = null } = {}) {
    const { rnd, range } = this._rand(x, z);
    const { height, rx, ry } = this.crown;
    const cy = y + height * scale;
    const a0 = rnd() * Math.PI * 2;
    const shade = this._shade(tint);
    const put = (frames, ex, ey, ez, s, k) => {
      const frame = frames[Math.floor(rnd() * frames.length)];
      this.mesh.add(ex, ey, ez, { scale: s, flip: rnd() < 0.5, tint: shade(k), frame });
    };
    // a dark core fills the gaps, so the crown never looks hollow
    put(this.clusterFrames, x, cy - 0.15 * scale, z, scale * 1.05, 0.72);
    // rings from the top down; lower clusters sit in the crown's own shade
    const rings = [[1.25, 1], [0.6, 3], [0.05, 4], [-0.55, 3]];
    let placed = 0;
    for (const [elev, n] of rings) {
      for (let k = 0; k < n && placed < this.perTree; k++, placed++) {
        const az = a0 + (k / n) * Math.PI * 2 + elev * 1.7 + range(-0.35, 0.35);
        const e = elev + range(-0.15, 0.15);
        const d = range(0.62, 0.78);
        const ex = x + Math.cos(e) * Math.cos(az) * rx * d * scale;
        const ez = z + Math.cos(e) * Math.sin(az) * rx * d * scale;
        const ey = cy + Math.sin(e) * ry * d * scale;
        put(this.clusterFrames, ex, ey, ez, scale * range(0.85, 1.12), 0.86 + 0.22 * (0.5 + 0.5 * Math.sin(e)));
      }
    }
    for (let k = 0; k < this.twigCount; k++) {
      const az = a0 + ((k + 0.5) / this.twigCount) * Math.PI * 2 + range(-0.3, 0.3);
      const e = range(-0.35, 0.45);
      const d = range(0.98, 1.1);
      put(
        this.twigFrames,
        x + Math.cos(e) * Math.cos(az) * rx * d * scale,
        cy + Math.sin(e) * ry * d * scale,
        z + Math.cos(e) * Math.sin(az) * rx * d * scale,
        scale * range(0.85, 1.1),
        0.8 + 0.2 * (0.5 + 0.5 * Math.sin(e)),
      );
    }
  }

  finalize() {
    for (const m of this.sets) m.finalize();
    return this;
  }
}
