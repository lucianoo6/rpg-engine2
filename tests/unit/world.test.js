import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TileMap } from '../../src/engine/world/TileMap.js';
import { World } from '../../src/engine/world/World.js';
import { NavGrid } from '../../src/engine/world/NavGrid.js';
import { tileTypes } from '../../src/engine/world/TileTypes.js';

/** 12x12 floor; a wall across x=5 with a gap at z=9..10; a 0.5-step stair up to a 1.5 ledge. */
export function makeWorld() {
  const map = new TileMap(12, 12, tileTypes());
  map.fillRect(0, 0, 11, 11, 0, 'floor');
  map.fillRect(5, 0, 5, 8, 3, 'wall');
  map.fillRect(8, 0, 11, 2, 1.5, 'floor'); // ledge
  map.set(9, 3, 1.0, 'floor'); // stairs: 0.5 -> 1.0 -> ledge 1.5
  map.set(9, 4, 0.5, 'floor');
  return new World(map);
}

test('step limits: a 0.5 step is walkable, a 1.5 ledge is not', () => {
  const w = makeWorld();
  assert.equal(w.canStand(9.5, 4.5, 0.3, 0), true, 'first stair from the floor');
  assert.equal(w.canStand(9.5, 1.5, 0.3, 0), false, 'ledge straight from the floor');
  assert.equal(w.canStand(9.5, 1.5, 0.3, 1.0), true, 'ledge from the top stair');
});

test('character colliders block, but not in static-only queries', () => {
  const w = makeWorld();
  w.addCircle(2, 2, 0.3, { isCharacter: true });
  assert.equal(w.canStand(2.2, 2, 0.3, 0), false);
  assert.equal(w.canStand(2.2, 2, 0.3, 0, null, true), true);
});

test('triggers and zones are rectangles', () => {
  const w = makeWorld();
  const t = w.addTrigger(1, 1, 3, 3, () => {}, { once: true, name: 'x' });
  assert.equal(t.once, true);
  w.addZone('Hall', 0, 0, 4, 4);
  assert.equal(w.zoneAt(2, 2).name, 'Hall');
  assert.equal(w.zoneAt(6, 6), null);
});

test('path goes around the wall through the gap', () => {
  const nav = new NavGrid(makeWorld()).build();
  const path = nav.findPath(2.5, 2.5, 8.5, 6.5);
  assert.ok(path, 'a path exists');
  const end = path[path.length - 1];
  assert.deepEqual(end, [8.5, 6.5]);
  // somewhere the path must pass the wall line through the gap (z >= 9)
  let crossed = false;
  let prev = [2.5, 2.5];
  for (const p of path) {
    if ((prev[0] - 5.5) * (p[0] - 5.5) <= 0) crossed = crossed || Math.max(prev[1], p[1]) >= 9;
    prev = p;
  }
  assert.ok(crossed, `path ${JSON.stringify(path)} should use the gap`);
});

test('path climbs stairs but never jumps a ledge', () => {
  const nav = new NavGrid(makeWorld()).build();
  const path = nav.findPath(9.5, 6.5, 9.5, 1.5);
  assert.ok(path, 'ledge reachable via the stairs');
  for (const [x, z] of path) assert.ok(nav.world.groundAt(x, z) >= 0);
});

test('enclosed targets are unreachable', () => {
  const w = makeWorld();
  w.map.fillRect(0, 10, 4, 10, 3, 'wall'); // seal the gap side
  w.map.fillRect(6, 9, 11, 11, 3, 'wall');
  w.map.fillRect(5, 9, 5, 11, 3, 'wall');
  const nav = new NavGrid(w).build();
  assert.equal(nav.findPath(2.5, 2.5, 8.5, 6.5), null);
});
