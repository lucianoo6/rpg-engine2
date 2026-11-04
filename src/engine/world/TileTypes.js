/**
 * The engine's built-in tile types. A tile type names the texture recipe
 * for its top and for its sides, and the footstep surface it sounds like.
 * Maps (code or data) can add their own: { name, top, side, surface, walkable }.
 */
export const DEFAULT_TILE_TYPES = [
  { name: 'grass', top: 'grass', side: 'earthSide', surface: 'grass' },
  { name: 'meadow', top: 'meadow', side: 'meadowSide', surface: 'grass' },
  { name: 'forest', top: 'forest', side: 'forestSide', surface: 'grass' },
  { name: 'plateau', top: 'grass', side: 'cliff', surface: 'grass' },
  { name: 'highland', top: 'forest', side: 'cliff', surface: 'grass' },
  { name: 'path', top: 'dirt', side: 'dirtSide', surface: 'dirt' },
  { name: 'cobble', top: 'cobble', side: 'brick', surface: 'stone' },
  { name: 'sand', top: 'sand', side: 'sandSide', surface: 'sand' },
  { name: 'lakebed', top: 'lakebed', side: 'sandSide', surface: 'sand' },
  { name: 'slab', top: 'slab', side: 'brick', surface: 'stone' },
  { name: 'farm', top: 'farmland', side: 'dirtSide', surface: 'dirt' },
  // interiors
  { name: 'floor', top: 'floorboards', side: 'beam', surface: 'wood' },
  { name: 'wall', top: 'beam', side: 'interiorWall', surface: 'wood', walkable: false },
  { name: 'stonewall', top: 'slab', side: 'brick', surface: 'stone', walkable: false },
  { name: 'hearth', top: 'slab', side: 'brick', surface: 'stone' },
  { name: 'void', top: 'iron', side: 'iron', surface: 'stone', walkable: false },
];

/** Merge custom tile types over the defaults (same name replaces). */
export function tileTypes(extra = []) {
  const byName = new Map(DEFAULT_TILE_TYPES.map((t) => [t.name, t]));
  for (const t of extra) byName.set(t.name, { ...byName.get(t.name), ...t });
  return [...byName.values()];
}
