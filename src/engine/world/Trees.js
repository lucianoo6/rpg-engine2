import { SpriteInstances } from '../sprites/SpriteInstances.js';
import { toTexture, toNormalTexture } from '../pixel/PixelCanvas.js';
import * as SF from '../pixel/SpriteFactory.js';
import { PPU } from '../pixel/TextureFactory.js';
import { TrunkInstances } from './Trunks.js';
import { ClusterCanopy } from './Canopy.js';

/**
 * Tree species in every crown style the engine supports. The style is an
 * art-direction choice, so it is made per campaign (and may be overridden per
 * map), never hard-wired into map code:
 *
 *   broadleaf: 'sprite'   one painted crown card (cleanest silhouette, cheapest)
 *              'clusters' crown of leaf clusters placed in 3D
 *              'twigs'    clusters plus loose twigs at the edge
 *   conifer:   'sprite'   one painted pine
 *              'layers'   stacked skirts of needle clumps placed in 3D
 *   trunks:    '3d'       real round trunk under sprite crowns
 *              'sprite'   painted trunk (cluster crowns always use 3D trunks)
 */
export const FOLIAGE_STYLES = {
  broadleaf: ['sprite', 'clusters', 'twigs'],
  conifer: ['sprite', 'layers'],
  trunks: ['3d', 'sprite'],
};

export const DEFAULT_FOLIAGE = { broadleaf: 'twigs', conifer: 'sprite', trunks: '3d' };

/**
 * Merge foliage settings, later layers winning (e.g. engine default →
 * campaign → map → debug URL). Layers may be objects or JSON strings (Tiled
 * map properties); unknown keys or values are reported and ignored.
 */
export function resolveFoliage(...layers) {
  const out = { ...DEFAULT_FOLIAGE };
  for (let layer of layers) {
    if (!layer) continue;
    if (typeof layer === 'string') {
      try { layer = JSON.parse(layer); } catch { console.warn(`[hd2d] foliage: not JSON: ${layer}`); continue; }
    }
    for (const [k, v] of Object.entries(layer)) {
      if (v == null || v === '') continue;
      if (!FOLIAGE_STYLES[k]) console.warn(`[hd2d] foliage: unknown key "${k}"`);
      else if (!FOLIAGE_STYLES[k].includes(v)) console.warn(`[hd2d] foliage: "${v}" is not a ${k} style (${FOLIAGE_STYLES[k].join(', ')})`);
      else out[k] = v;
    }
  }
  return out;
}

const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Several species of one kind of tree drawn together: all crowns share one
 * atlas mesh and all trunks one mesh (each species' bark colour is an
 * instance tint), so a whole forest of species costs the draw calls of one.
 *
 *   const g = new TreeGroup({ kind: 'broadleaf', style, species: [{ seed: 3, capacity: 160 }, { seed: 7, leaf: '#c9773a' }] });
 *   g.species[1].add(x, y, z, { scale, flip, tint });
 *   g.finalize(); for (const m of g.meshes) scene.add(m);
 *
 * kind: 'broadleaf' | 'conifer'; style: resolveFoliage() result;
 * species: paint options seed, leaf, bark, fruit (broadleaf), tiers (conifer)
 * and capacity (trees of that species).
 */
export class TreeGroup {
  constructor({ kind = 'broadleaf', style = DEFAULT_FOLIAGE, species = [{}], wind }) {
    const conifer = kind === 'conifer';
    const crownStyle = conifer ? style.conifer : style.broadleaf;
    const defBark = conifer ? '#5e4030' : '#6b4a30';
    const defLeaf = conifer ? '#2f6a4c' : '#4f8c3b';
    const specs = species.map((o) => ({ seed: 1, tiers: 5, fruit: null, capacity: 64, ...o, bark: o.bark || defBark, leaf: o.leaf || defLeaf }));
    const total = specs.reduce((a, o) => a + o.capacity, 0);
    this.kind = kind;
    this.style = crownStyle;
    this.trunks = null;
    this.canopies = [];
    let trunkSize = null;
    let trunkHeights = specs.map(() => 1);
    const makeSpecies = [];

    if (crownStyle === 'sprite') {
      const trunk3d = style.trunks !== 'sprite';
      const pcs = specs.map((o) => (conifer ? SF.paintPine : SF.paintTree)({ ...o, normals: true, trunk3d }));
      const mesh = SpriteInstances.fromVariants(pcs, { capacity: total, wind: wind ?? (conifer ? 0.05 : 0.08), sunFacingShadow: true, align: 'bottom' });
      this.sets = [mesh];
      if (trunk3d) {
        trunkSize = pcs[0].trunk;
        trunkHeights = pcs.map((pc) => pc.trunk.height / trunkSize.height);
      }
      specs.forEach((_, i) => makeSpecies.push((x, y, z, o) => mesh.variants[i].add(x, y, z, o)));
    } else {
      const clusterSets = specs.map((o) => (conifer
        ? { clusters: [0, 1, 2].map((k) => SF.paintNeedleClump({ seed: o.seed * 10 + k, leaf: o.leaf, normals: true })), twigs: [] }
        : {
          clusters: [0, 1, 2, 3].map((k) => SF.paintLeafCluster({ seed: o.seed * 10 + k, leaf: o.leaf, fruit: k % 2 ? o.fruit : null, normals: true })),
          twigs: crownStyle === 'twigs' ? [0, 1].map((k) => SF.paintTwig({ seed: o.seed * 10 + k, leaf: o.leaf, bark: o.bark, normals: true })) : [],
        }));
      const pcs = [];
      const frames = clusterSets.map((c) => {
        const f = { clusterFrames: c.clusters.map((_, k) => pcs.length + k) };
        pcs.push(...c.clusters);
        f.twigFrames = c.twigs.map((_, k) => pcs.length + k);
        pcs.push(...c.twigs);
        return f;
      });
      const count = 10, twigCount = 4;
      const perTree = conifer ? 18 : count + 1 + (crownStyle === 'twigs' ? twigCount : 0);
      const mesh = SpriteInstances.fromVariants(pcs, {
        capacity: total * perTree, wind: wind ?? (conifer ? 0.03 : 0.04), sunFacingShadow: true, pivot: conifer ? [0.5, 0.92] : [0.5, 0.5],
      });
      this.sets = [mesh];
      const crown = conifer ? { bottom: 2.5, top: 6.1, rx: 1.6, clumpWidth: 30 / PPU } : { height: 3.75, rx: 1.75, ry: 1.4 };
      specs.forEach((o, i) => {
        const canopy = new ClusterCanopy({ crown: conifer ? { ...crown, tiers: o.tiers } : crown, count, twigCount, atlas: { mesh, ...frames[i] } });
        this.canopies.push(canopy);
        makeSpecies.push((x, y, z, opt) => canopy.add(x, y, z, opt));
      });
      trunkSize = conifer ? { height: 4.3 * PPU, radius: 3.4 } : { height: 3.75 * PPU * 0.97, radius: 4 };
    }

    if (trunkSize) {
      const ref = hexRgb(specs[0].bark);
      this.trunks = new TrunkInstances(trunkSize, { bark: specs[0].bark, seed: specs[0].seed, capacity: total });
      this._barkTint = specs.map((o) => hexRgb(o.bark).map((v, k) => v / Math.max(1, ref[k])));
    }
    this.species = specs.map((o, i) => ({
      ...o,
      add: (x, y, z, { scale = 1, flip = false, tint = null } = {}) => {
        makeSpecies[i](x, y, z, { scale, flip, tint });
        if (!this.trunks) return;
        // bark turned per tree from its position, so neighbours differ and the caller's random sequence is untouched
        const t = hexRgb(tint || '#ffffff').map((v, k) => v * this._barkTint[i][k]);
        this.trunks.add(x, y, z, { scale, heightScale: trunkHeights[i], rot: (x * 12.9898 + z * 78.233) % (Math.PI * 2), tint: rgbHex(t) });
      },
    }));
  }

  /** Every mesh to add to the scene (after finalize). */
  get meshes() {
    return [...this.sets, ...(this.trunks ? [this.trunks] : [])].filter((m) => m.count > 0);
  }

  finalize() {
    for (const s of this.sets) s.finalize();
    if (this.trunks) this.trunks.finalize();
    for (const m of [...this.sets, this.trunks]) if (m) m.frustumCulled = false;
    return this;
  }
}

/**
 * One species on its own (a TreeGroup of one), e.g. for map prefabs:
 *   new TreeSpecies({ kind: 'broadleaf', style, seed: 3, leaf: '#5a9440', capacity: 160 })
 */
export class TreeSpecies extends TreeGroup {
  constructor({ kind = 'broadleaf', style = DEFAULT_FOLIAGE, wind, ...opts } = {}) {
    super({ kind, style, wind, species: [opts] });
  }

  /** Plant one tree on the ground at (x, y, z). */
  add(x, y, z, o) {
    this.species[0].add(x, y, z, o);
  }
}
