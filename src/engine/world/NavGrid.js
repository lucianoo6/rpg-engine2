/**
 * Grid path finding over a World. Nodes sit every 1/res units; a node is
 * walkable when a character of `radius` could stand there against static
 * obstacles (tiles, props, trees — other characters are ignored), and an
 * edge is valid when the height change fits the world's step limit.
 *
 * findPath() runs A* (8-way, no corner cutting) and then pulls the string
 * so characters walk straight lines instead of grid zig-zags.
 */
export class NavGrid {
  constructor(world, { res = 2, radius = 0.36 } = {}) {
    this.world = world;
    this.res = res;
    this.radius = radius;
    this.w = world.map.width * res;
    this.d = world.map.depth * res;
    this.walk = null;
    this.h = null;
  }

  build() {
    const { w, d, res, world } = this;
    this.walk = new Uint8Array(w * d);
    this.h = new Float32Array(w * d);
    for (let j = 0; j < d; j++) {
      for (let i = 0; i < w; i++) {
        const x = (i + 0.5) / res, z = (j + 0.5) / res;
        const g = world.groundAt(x, z);
        const k = j * w + i;
        this.h[k] = g;
        this.walk[k] = world.canStand(x, z, this.radius, g, null, true) ? 1 : 0;
      }
    }
    return this;
  }

  /** Re-check nodes in a box after the world changed (e.g. a prop was added). */
  refresh(minX, minZ, maxX, maxZ) {
    if (!this.walk) return;
    const { res, w } = this;
    for (let j = Math.max(0, Math.floor(minZ * res)); j <= Math.min(this.d - 1, Math.ceil(maxZ * res)); j++) {
      for (let i = Math.max(0, Math.floor(minX * res)); i <= Math.min(w - 1, Math.ceil(maxX * res)); i++) {
        const x = (i + 0.5) / res, z = (j + 0.5) / res;
        const g = this.world.groundAt(x, z);
        this.h[j * w + i] = g;
        this.walk[j * w + i] = this.world.canStand(x, z, this.radius, g, null, true) ? 1 : 0;
      }
    }
  }

  _node(x, z) {
    const i = Math.max(0, Math.min(this.w - 1, Math.floor(x * this.res)));
    const j = Math.max(0, Math.min(this.d - 1, Math.floor(z * this.res)));
    return j * this.w + i;
  }

  _nearestWalkable(k, maxRing = 8) {
    if (this.walk[k]) return k;
    const ci = k % this.w, cj = Math.floor(k / this.w);
    for (let r = 1; r <= maxRing; r++) {
      let best = -1, bestD = Infinity;
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (i < 0 || j < 0 || i >= this.w || j >= this.d) continue;
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const n = j * this.w + i;
          const dd = (i - ci) ** 2 + (j - cj) ** 2;
          if (this.walk[n] && dd < bestD) { bestD = dd; best = n; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  _canStep(a, b) {
    return this.walk[b] && Math.abs(this.h[a] - this.h[b]) <= this.world.maxStep;
  }

  /** Straight segment walkable? (sampled on the grid) */
  clearLine(x0, z0, x1, z1) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const n = Math.max(1, Math.ceil(len * this.res * 2));
    let prev = this._node(x0, z0);
    for (let s = 1; s <= n; s++) {
      const t = s / n;
      const k = this._node(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
      if (k !== prev && !this._canStep(prev, k)) return false;
      prev = k;
    }
    return true;
  }

  /**
   * Returns an array of [x, z] waypoints from (x0, z0) towards (x1, z1),
   * or null when the target can't be reached. Unreachable-but-blocked
   * targets (e.g. a spot inside a table) resolve to the nearest free node.
   */
  findPath(x0, z0, x1, z1, { maxNodes = 20000 } = {}) {
    if (!this.walk) this.build();
    const start = this._nearestWalkable(this._node(x0, z0));
    const goal = this._nearestWalkable(this._node(x1, z1));
    if (start < 0 || goal < 0) return null;
    const exactGoal = this.walk[this._node(x1, z1)] === 1;
    const { w } = this;
    const gi = goal % w, gj = Math.floor(goal / w);
    const heur = (k) => {
      const dx = Math.abs((k % w) - gi), dz = Math.abs(Math.floor(k / w) - gj);
      return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    const g = new Map([[start, 0]]);
    const came = new Map();
    const heap = new MinHeap();
    heap.push(start, heur(start));
    const closed = new Set();
    let found = start === goal;
    while (heap.size && !found) {
      const cur = heap.pop();
      if (cur === goal) { found = true; break; }
      if (closed.has(cur)) continue;
      closed.add(cur);
      if (closed.size > maxNodes) break;
      const ci = cur % w, cj = Math.floor(cur / w);
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const ni = ci + di, nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= this.d) continue;
          const n = nj * w + ni;
          if (closed.has(n) || !this._canStep(cur, n)) continue;
          if (di && dj && (!this._canStep(cur, cj * w + ni) || !this._canStep(cur, nj * w + ci))) continue; // no corner cutting
          const cost = g.get(cur) + (di && dj ? Math.SQRT2 : 1) + Math.abs(this.h[n] - this.h[cur]) * 2;
          if (cost < (g.get(n) ?? Infinity)) {
            g.set(n, cost);
            came.set(n, cur);
            heap.push(n, cost + heur(n));
          }
        }
      }
    }
    if (!found) return null;
    const nodes = [goal];
    let k = goal;
    while (k !== start) { k = came.get(k); nodes.push(k); }
    nodes.reverse();
    const pts = nodes.map((n) => [((n % w) + 0.5) / this.res, (Math.floor(n / w) + 0.5) / this.res]);
    if (exactGoal) pts[pts.length - 1] = [x1, z1];
    // string pulling
    const out = [];
    let anchor = [x0, z0];
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.clearLine(anchor[0], anchor[1], pts[j][0], pts[j][1])) j--;
      out.push(pts[j]);
      anchor = pts[j];
      i = j + 1;
    }
    return out;
  }
}

class MinHeap {
  constructor() { this.k = []; this.p = []; }
  get size() { return this.k.length; }
  push(key, pri) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (p[par] <= p[i]) break;
      [k[par], k[i]] = [k[i], k[par]];
      [p[par], p[i]] = [p[i], p[par]];
      i = par;
    }
  }
  pop() {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop(), lp = p.pop();
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [p[m], p[i]] = [p[i], p[m]];
        i = m;
      }
    }
    return top;
  }
}
