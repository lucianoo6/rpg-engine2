/**
 * Grid world data. Tile (i, j) covers x in [i, i+1], z in [j, j+1] and has a
 * height (multiples of 0.5 give the classic stepped diorama look) and a
 * type index into a tile-type table.
 *
 * Tile types: { name, top: textureFn, side: textureFn, walkable }
 */
export class TileMap {
  constructor(width, depth, types) {
    this.width = width;
    this.depth = depth;
    this.types = types;
    this.typeIndex = Object.fromEntries(types.map((t, i) => [t.name, i]));
    const n = width * depth;
    this.height = new Float32Array(n);
    this.type = new Uint8Array(n);
    this.solid = new Uint8Array(n);
    this.deck = new Float32Array(n).fill(NaN); // walkable surfaces above the tile (bridges)
    this.waterLevel = -0.18;
  }

  inBounds(i, j) {
    return i >= 0 && j >= 0 && i < this.width && j < this.depth;
  }

  idx(i, j) {
    return j * this.width + i;
  }

  h(i, j) {
    i = Math.max(0, Math.min(this.width - 1, i));
    j = Math.max(0, Math.min(this.depth - 1, j));
    return this.height[this.idx(i, j)];
  }

  typeAt(i, j) {
    if (!this.inBounds(i, j)) return null;
    return this.types[this.type[this.idx(i, j)]];
  }

  set(i, j, h, typeName) {
    if (!this.inBounds(i, j)) return;
    const k = this.idx(i, j);
    if (h !== undefined && h !== null) this.height[k] = h;
    if (typeName) this.type[k] = this.typeIndex[typeName];
  }

  /** Apply fn(i, j) -> {h?, type?} | null to every tile in a rect. */
  each(fn, i0 = 0, j0 = 0, i1 = this.width - 1, j1 = this.depth - 1) {
    for (let j = Math.max(0, j0); j <= Math.min(this.depth - 1, j1); j++) {
      for (let i = Math.max(0, i0); i <= Math.min(this.width - 1, i1); i++) {
        const r = fn(i, j, this.height[this.idx(i, j)], this.types[this.type[this.idx(i, j)]].name);
        if (r) this.set(i, j, r.h, r.type);
      }
    }
  }

  fillRect(i0, j0, i1, j1, h, type) {
    this.each(() => ({ h, type }), i0, j0, i1, j1);
  }

  setSolid(i0, j0, i1, j1, v = 1) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.inBounds(i, j)) this.solid[this.idx(i, j)] = v;
  }

  setDeck(i0, j0, i1, j1, y) {
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (this.inBounds(i, j)) this.deck[this.idx(i, j)] = y;
  }

  isWaterTile(i, j) {
    return this.inBounds(i, j) && this.height[this.idx(i, j)] < 0;
  }
}
