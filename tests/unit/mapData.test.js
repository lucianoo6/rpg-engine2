import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMapData, parseTiled, toNative } from '../../src/engine/game/MapData.js';
import { tileTypes } from '../../src/engine/world/TileTypes.js';

const inn = JSON.parse(readFileSync(new URL('../../public/maps/inn.tmj', import.meta.url)));
const tsj = JSON.parse(readFileSync(new URL('../../public/maps/tilesets/hd2d-tiles.tsj', import.meta.url)));
const parse = () => parseMapData(inn, { externalTilesets: { 'tilesets/hd2d-tiles.tsj': tsj } });

test('the inn parses from Tiled with its external tileset', () => {
  const d = parse();
  assert.equal(d.width, 14);
  assert.equal(d.depth, 11);
  assert.equal(d.types.length, 14 * 11);
  const known = new Set(tileTypes().map((t) => t.name));
  for (const t of d.types) assert.ok(known.has(t), `unknown tile type ${t}`);
  assert.equal(d.types[0], 'wall');
  assert.equal(Math.max(...d.heights), 3.5);
  assert.equal(d.properties.indoor, true);
});

test('objects keep type, name, centre and props', () => {
  const d = parse();
  const byName = (n) => d.objects.find((o) => o.name === n);
  assert.equal(byName('Marta').type, 'npc');
  assert.equal(byName('Marta').props.sheet, 'sprites/innkeeper.json');
  const exit = byName('exit');
  assert.equal(exit.type, 'warp');
  assert.deepEqual([exit.x, exit.z, exit.w, exit.d], [7, 10.75, 2, 0.5]);
  const scripts = JSON.parse(d.properties.scripts);
  assert.ok(Array.isArray(scripts.welcome));
});

test('native format round-trips', () => {
  const d = parse();
  const back = parseMapData(JSON.parse(JSON.stringify(toNative(d))));
  assert.deepEqual(back.types, d.types);
  assert.deepEqual(back.heights, d.heights);
  assert.equal(back.objects.length, d.objects.length);
});

test('helpful errors for unsupported Tiled maps', () => {
  assert.throws(() => parseTiled({ ...inn, infinite: true }), /Infinite/);
  assert.throws(() => parseTiled({ ...inn, layers: [] }), /"ground"/);
  const b64 = { ...inn, layers: inn.layers.map((l) => (l.name === 'ground' ? { ...l, encoding: 'base64' } : l)) };
  assert.throws(() => parseTiled(b64, { externalTilesets: { 'tilesets/hd2d-tiles.tsj': tsj } }), /CSV/);
  assert.throws(() => parseMapData({ foo: 1 }), /Unknown map format/);
});
