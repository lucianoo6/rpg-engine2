/**
 * Map data, independent of where it was authored.
 *
 *   {
 *     width, depth,                 // tiles
 *     tileTypes: [...],             // extra/override tile types (see TileTypes.js)
 *     types:   [name, ...],         // width * depth tile type names, row by row
 *     heights: [number, ...],       // width * depth heights in world units
 *     objects: [{ type, name, x, z, w, d, props }],   // x/z = centre, in tiles
 *     properties: { ... }           // title, indoor, camera, waterLevel, scripts...
 *   }
 *
 * parseMapData() accepts this native format ("format": "hd2d-map") or a
 * Tiled JSON map (.tmj), using these conventions:
 *  - a tile layer named "ground": each tile's custom property `type` gives
 *    the tile type (a `height` property, if present, sets the height too)
 *  - an optional tile layer named "height": tiles carry a `height` property
 *  - every object layer: objects become map objects; their class/type picks
 *    the prefab, custom properties become `props`
 *  - map custom properties become `properties`
 */

const FLIP_MASK = 0x1fffffff;

function propsToObject(list) {
  const out = {};
  for (const p of list || []) out[p.name] = p.value;
  return out;
}

function flattenLayers(layers, out = []) {
  for (const l of layers || []) {
    if (l.type === 'group') flattenLayers(l.layers, out);
    else out.push(l);
  }
  return out;
}

export function isTiledMap(json) {
  return json && (json.tiledversion !== undefined || (Array.isArray(json.layers) && json.tilewidth !== undefined));
}

/** `externalTilesets`: { sourcePath: tilesetJson } for tilesets saved as separate .tsj files. */
export function parseTiled(json, { externalTilesets = {} } = {}) {
  if (json.infinite) throw new Error('Infinite Tiled maps are not supported; set a fixed map size.');
  if (json.orientation && json.orientation !== 'orthogonal') throw new Error('Only orthogonal Tiled maps are supported.');
  const W = json.width, D = json.height;
  const tw = json.tilewidth, th = json.tileheight;
  const tileProps = new Map(); // gid -> props
  for (const ts of json.tilesets || []) {
    const def = ts.source ? { ...externalTilesets[ts.source], firstgid: ts.firstgid } : ts;
    if (!def.tiles && ts.source && !externalTilesets[ts.source]) console.warn(`Tileset ${ts.source} was not provided; its tiles carry no properties.`);
    for (const t of def.tiles || []) tileProps.set(ts.firstgid + t.id, propsToObject(t.properties));
  }
  const layers = flattenLayers(json.layers);
  const types = new Array(W * D).fill(null);
  const heights = new Array(W * D).fill(0);
  const ground = layers.find((l) => l.type === 'tilelayer' && /^ground$/i.test(l.name));
  if (!ground) throw new Error('Tiled map needs a tile layer named "ground".');
  const readLayer = (layer, fn) => {
    if (layer.encoding && layer.encoding !== 'csv') throw new Error(`Layer "${layer.name}": save tile layer data as CSV (Base64 is not supported).`);
    layer.data.forEach((gid, k) => {
      const id = gid & FLIP_MASK;
      if (id) fn(k, tileProps.get(id) || {});
    });
  };
  readLayer(ground, (k, p) => {
    if (p.type) types[k] = p.type;
    if (p.height !== undefined) heights[k] = Number(p.height);
  });
  const hl = layers.find((l) => l.type === 'tilelayer' && /^height$/i.test(l.name));
  if (hl) readLayer(hl, (k, p) => { if (p.height !== undefined) heights[k] = Number(p.height); });

  const objects = [];
  for (const l of layers) {
    if (l.type !== 'objectgroup') continue;
    for (const o of l.objects || []) {
      const props = propsToObject(o.properties);
      const w = (o.width || 0) / tw, d = (o.height || 0) / th;
      const rect = !o.point && w > 0 && d > 0;
      objects.push({
        type: o.type || o.class || props.type || '',
        name: o.name || '',
        x: o.x / tw + (rect ? w / 2 : 0),
        z: o.y / th + (rect ? d / 2 : 0),
        w: rect ? w : 0,
        d: rect ? d : 0,
        props,
        layer: l.name,
      });
    }
  }
  const properties = propsToObject(json.properties);
  const parseJson = (v) => (typeof v === 'string' && v.trim() ? JSON.parse(v) : v);
  return {
    width: W,
    depth: D,
    tileTypes: properties.tileTypes ? parseJson(properties.tileTypes) : [],
    types: types.map((t) => t || properties.defaultType || 'void'),
    heights,
    objects,
    properties,
  };
}

export function parseNative(json) {
  const W = json.width, D = json.depth;
  if (json.types.length !== W * D || json.heights.length !== W * D) throw new Error('types/heights must have width * depth entries');
  return {
    width: W,
    depth: D,
    tileTypes: json.tileTypes || [],
    types: json.types.map((t) => (typeof t === 'number' ? json.typeNames[t] : t)),
    heights: json.heights,
    objects: (json.objects || []).map((o) => ({ w: 0, d: 0, props: {}, name: '', ...o })),
    properties: json.properties || {},
  };
}

export function parseMapData(json, opts) {
  if (isTiledMap(json)) return parseTiled(json, opts);
  if (json.format === 'hd2d-map') return parseNative(json);
  throw new Error('Unknown map format: expected a Tiled .tmj map or { "format": "hd2d-map" }.');
}

/** Fetch and parse a map file; external Tiled tilesets (.tsj) are fetched too. */
export async function loadMapData(url) {
  const json = await (await fetch(url)).json();
  const externalTilesets = {};
  if (isTiledMap(json)) {
    for (const ts of json.tilesets || []) {
      if (!ts.source) continue;
      if (!/\.(tsj|json)$/i.test(ts.source)) throw new Error(`Tileset ${ts.source}: export tilesets as JSON (.tsj) or embed them in the map.`);
      externalTilesets[ts.source] = await (await fetch(new URL(ts.source, new URL(url, location.href)))).json();
    }
  }
  return parseMapData(json, { externalTilesets });
}

/** Serialise map data to the compact native format (e.g. after editing in code). */
export function toNative(data) {
  const typeNames = [...new Set(data.types)];
  return {
    format: 'hd2d-map',
    version: 1,
    width: data.width,
    depth: data.depth,
    tileTypes: data.tileTypes,
    typeNames,
    types: data.types.map((t) => typeNames.indexOf(t)),
    heights: data.heights,
    objects: data.objects,
    properties: data.properties,
  };
}
