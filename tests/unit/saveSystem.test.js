import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveSystem } from '../../src/engine/game/SaveSystem.js';

test('saves round-trip and fail soft without storage', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const s = new SaveSystem('t');
  assert.equal(s.load(), null);
  assert.equal(s.save({ map: 'inn', flags: ['a'] }), true);
  assert.equal(s.load().map, 'inn');
  s.saveSettings({ quality: 'low' });
  assert.equal(s.loadSettings().quality, 'low');
  s.clear();
  assert.equal(s.load(), null);

  globalThis.localStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(s.save({ map: 'x' }), false);
  assert.equal(s.load(), null);
  assert.doesNotThrow(() => s.clear());
  delete globalThis.localStorage;
});
