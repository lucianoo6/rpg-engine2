import { resolveFoliage } from '../world/Trees.js';
import { TileMap } from '../world/TileMap.js';
import { World } from '../world/World.js';
import { buildTerrain } from '../world/TerrainBuilder.js';
import { StaticBatch } from '../world/StaticBatch.js';
import { tileTypes } from '../world/TileTypes.js';
import { GameMap } from './GameMap.js';
import { parseScript } from './Events.js';

/**
 * Build a GameMap from map data (see MapData.js): terrain from the tile
 * layers, then every object through the prefab registry.
 *
 * Map properties understood here:
 *   title, subtitle          location banner
 *   indoor (bool)            interior lighting; indoorSky/indoorGround/
 *                            indoorExposure/indoorTint/indoorFog tune it
 *   cameraDistance, cameraPitch, cameraBounds ("minX,minZ,maxX,maxZ")
 *   waterLevel, edgeDepth    terrain details
 *   scripts (JSON)           named event scripts: { "name": [commands] }
 */
export async function buildMap(id, data, { prefabs, game }) {
  const types = tileTypes(data.tileTypes);
  const tm = new TileMap(data.width, data.depth, types);
  for (let k = 0; k < data.width * data.depth; k++) {
    let name = data.types[k];
    if (tm.typeIndex[name] === undefined) {
      console.warn(`Map "${id}": unknown tile type "${name}", using "void"`);
      name = 'void';
    }
    tm.set(k % data.width, Math.floor(k / data.width), Number(data.heights[k]) || 0, name);
  }
  const P = data.properties || {};
  if (P.waterLevel !== undefined) tm.waterLevel = Number(P.waterLevel);

  const map = new GameMap(id);
  map.tileMap = tm;
  map.world = new World(tm);
  map.root.add(buildTerrain(tm, { edgeDepth: P.edgeDepth !== undefined ? Number(P.edgeDepth) : -4 }));

  const bounds = P.cameraBounds ? String(P.cameraBounds).split(',').map(Number) : null;
  map.env = {
    title: P.title || id,
    subtitle: P.subtitle || '',
    indoor: P.indoor === true || P.indoor === 'true'
      ? { sky: P.indoorSky, ground: P.indoorGround, exposure: P.indoorExposure, tint: P.indoorTint, fog: P.indoorFog, hemiI: P.indoorLight }
      : null,
    camera: {
      distance: Number(P.cameraDistance || 23),
      pitch: Number(P.cameraPitch || 33),
      bounds: bounds ? { minX: bounds[0], minZ: bounds[1], maxX: bounds[2], maxZ: bounds[3] } : null,
    },
  };
  if (P.scripts) {
    const s = typeof P.scripts === 'string' ? JSON.parse(P.scripts) : P.scripts;
    for (const [name, cmds] of Object.entries(s)) map.scripts[name] = parseScript(cmds, map);
  }

  const batch = new StaticBatch();
  const finish = [];
  const foliage = game && game.foliageFor ? game.foliageFor(P.foliage) : resolveFoliage(P.foliage);
  const ctx = { map, batch, game, foliage, groundAt: (x, z) => map.world.groundAt(x, z), onFinish: (fn) => finish.push(fn) };
  for (const o of data.objects) {
    const fn = prefabs.get(o.type);
    if (!fn) { console.warn(`Map "${id}": no prefab for object type "${o.type}" (${o.name})`); continue; }
    await fn(o, ctx);
  }
  for (const fn of finish) fn();
  map.root.add(batch.build({ name: id }));
  // prefabs built earlier (e.g. wandering NPCs) may already hold the nav grid;
  // rebuild it in place now that every obstacle exists
  if (map.nav) map.nav.build();
  return map;
}
