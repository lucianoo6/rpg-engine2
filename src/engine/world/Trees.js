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

/**
 * One species of tree, built in the given style. Use it the same way in every
 * style: add() trees, then put `meshes` in the scene after finalize().
 *
 *   new TreeSpecies({ kind: 'broadleaf', style, seed: 3, leaf: '#5a9440', capacity: 160 })
 *
 * kind: 'broadleaf' | 'conifer'; style: resolveFoliage() result;
 * paint options: seed, leaf, bark, fruit (broadleaf), tiers (conifer).
 */
export class TreeSpecies {
  constructor({ kind = 'broadleaf', style = DEFAULT_FOLIAGE, seed = 1, leaf, bark, fruit = null, tiers = 5, capacity = 64, wind }) {
    const conifer = kind === 'conifer';
    const crownStyle = conifer ? style.conifer : style.broadleaf;
    bark = bark || (conifer ? '#5e4030' : '#6b4a30');
    leaf = leaf || (conifer ? '#2f6a4c' : '#4f8c3b');
    this.kind = kind;
    this.style = crownStyle;
    this.trunks = null;
    this.canopy = null;
    if (crownStyle === 'sprite') {
      const trunk3d = style.trunks !== 'sprite';
      const pc = (conifer ? SF.paintPine : SF.paintTree)({ seed, leaf, bark, fruit, tiers, normals: true, trunk3d });
      this.sprite = new SpriteInstances(toTexture(pc), {
        capacity, wind: wind ?? (conifer ? 0.05 : 0.08), normalMap: toNormalTexture(pc.normal), sunFacingShadow: true,
      });
      if (trunk3d) this.trunks = new TrunkInstances(pc.trunk, { bark, seed, capacity });
      this.sets = [this.sprite];
    } else if (conifer) {
      this.canopy = new ClusterCanopy({
        clusters: [0, 1, 2].map((k) => SF.paintNeedleClump({ seed: seed * 10 + k, leaf, normals: true })),
        crown: { tiers, bottom: 2.5, top: 6.1, rx: 1.6, clumpWidth: 30 / PPU },
        pivot: [0.5, 0.92],
        capacity,
        wind: wind ?? 0.03,
      });
      this.trunks = new TrunkInstances({ height: 4.3 * PPU, radius: 3.4 }, { bark, seed, capacity });
      this.sets = this.canopy.sets;
    } else {
      this.canopy = new ClusterCanopy({
        clusters: [0, 1, 2, 3].map((k) => SF.paintLeafCluster({ seed: seed * 10 + k, leaf, fruit: k % 2 ? fruit : null, normals: true })),
        twigs: crownStyle === 'twigs' ? [0, 1].map((k) => SF.paintTwig({ seed: seed * 10 + k, leaf, bark, normals: true })) : [],
        crown: { height: 3.75, rx: 1.75, ry: 1.4 },
        capacity,
        wind: wind ?? 0.04,
      });
      this.trunks = new TrunkInstances({ height: 3.75 * PPU * 0.97, radius: 4 }, { bark, seed, capacity });
      this.sets = this.canopy.sets;
    }
  }

  /** Plant one tree on the ground at (x, y, z). */
  add(x, y, z, { scale = 1, flip = false, tint = null } = {}) {
    if (this.sprite) this.sprite.add(x, y, z, { scale, flip, tint });
    else this.canopy.add(x, y, z, { scale, tint });
    // bark turned per tree from its position, so neighbours differ and the caller's random sequence is untouched
    if (this.trunks) this.trunks.add(x, y, z, { scale, rot: (x * 12.9898 + z * 78.233) % (Math.PI * 2), tint });
  }

  /** Every mesh to add to the scene (after finalize). */
  get meshes() {
    return [...this.sets, ...(this.trunks && this.trunks.count ? [this.trunks] : [])].filter((m) => m.count > 0);
  }

  finalize() {
    for (const s of this.sets) s.finalize();
    if (this.trunks) this.trunks.finalize();
    for (const m of [...this.sets, this.trunks]) if (m) m.frustumCulled = false;
    return this;
  }
}
