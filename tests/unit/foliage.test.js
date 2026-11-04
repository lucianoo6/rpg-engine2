import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFoliage, DEFAULT_FOLIAGE, FOLIAGE_STYLES } from '../../src/engine/world/Trees.js';

test('foliage style layers: default < campaign < map < debug', () => {
  assert.deepEqual(resolveFoliage(), DEFAULT_FOLIAGE);
  const campaign = { broadleaf: 'sprite', conifer: 'layers' };
  const map = '{"broadleaf":"clusters"}'; // Tiled properties arrive as strings
  const debug = { broadleaf: null, conifer: 'sprite', trunks: '' }; // unset URL params
  assert.deepEqual(resolveFoliage(campaign, map, debug), { broadleaf: 'clusters', conifer: 'sprite', trunks: '3d' });
});

test('foliage ignores unknown keys, values and bad JSON', () => {
  const warn = console.warn;
  const warnings = [];
  console.warn = (m) => warnings.push(m);
  try {
    const r = resolveFoliage({ broadleaf: 'palm', shrubs: 'x' }, '{oops');
    assert.deepEqual(r, DEFAULT_FOLIAGE);
    assert.equal(warnings.length, 3);
  } finally {
    console.warn = warn;
  }
  for (const [k, v] of Object.entries(DEFAULT_FOLIAGE)) assert.ok(FOLIAGE_STYLES[k].includes(v));
});
