import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventRunner, parseScript } from '../../src/engine/game/Events.js';

function fakeGame({ picks = [] } = {}) {
  const log = [];
  const actors = { player: { name: 'Wren', faceToward: () => {} }, Marta: { name: 'Marta', walkTo: async (x, z) => { log.push(`walk ${x},${z}`); return true; }, faceToward: () => {} } };
  const game = {
    log,
    flags: new Set(),
    scripts: { greet: [{ do: 'say', text: 'named' }] },
    dialogue: {
      say: async (l) => { for (const x of [].concat(l)) log.push(`say ${x.speaker}: ${x.text}`); },
      choose: async (s, text, options) => { const p = picks.shift() ?? 0; log.push(`choose ${options[p]}`); return p; },
    },
    banner: { show: (t) => log.push(`banner ${t}`) },
    sfx: { crystal: () => log.push('sfx crystal') },
    cycle: { transitionTo: (h) => log.push(`time ${h}`) },
    rig: {},
    actor: (n, ctx) => (n === 'self' ? ctx.self : actors[n] || null),
    point: (p) => (Array.isArray(p) ? p : [1, 2]),
    nav: () => null,
    wait: async () => {},
    fadeTo: async (v) => log.push(`fade ${v}`),
    emote: async (a, icon) => log.push(`emote ${a.name} ${icon}`),
    cameraReset: () => {},
    warp: async (m, s) => log.push(`warp ${m} ${s}`),
    save: () => log.push('save'),
    findScript: (n) => game.scripts[n],
  };
  return game;
}

test('parseScript accepts text, JSON, references and arrays', () => {
  assert.deepEqual(parseScript('Hi|Bye', null, 'Rook'), [{ do: 'say', speaker: 'Rook', text: 'Hi' }, { do: 'say', speaker: 'Rook', text: 'Bye' }]);
  assert.deepEqual(parseScript('@welcome'), [{ do: 'run', script: 'welcome' }]);
  assert.deepEqual(parseScript('[{"do":"save"}]'), [{ do: 'save' }]);
  assert.equal(parseScript(''), null);
});

test('commands run in order with branches, flags and named scripts', async () => {
  const g = fakeGame({ picks: [1] });
  const ev = new EventRunner(g);
  await ev.run([
    { do: 'emote', who: 'Marta', icon: '!' },
    { do: 'walk', who: 'Marta', to: [3, 4] },
    { do: 'say', who: 'Marta', text: 'Hello' },
    { do: 'choose', who: 'Marta', text: 'Room?', options: ['Yes', 'No'], then: [[{ do: 'flag', set: 'yes' }], [{ do: 'flag', set: 'no' }]] },
    { do: 'if', flag: 'no', then: [{ do: 'run', script: 'greet' }], else: [{ do: 'save' }] },
    { do: 'time', hour: 7.5, s: 0 },
    { do: 'sound', name: 'crystal' },
    { do: 'warp', map: 'village', spawn: 'innDoor' },
  ]);
  assert.deepEqual(g.log, [
    'emote Marta !', 'walk 3,4', 'say Marta: Hello', 'choose No', 'say : named', 'time 7.5', 'sfx crystal', 'warp village innDoor',
  ]);
  assert.ok(g.flags.has('no') && !g.flags.has('yes'));
  assert.equal(ev.busy, false);
});

test('"self" resolves to the NPC being talked to', async () => {
  const g = fakeGame();
  await new EventRunner(g).run([{ do: 'say', who: 'self', text: 'me' }], { self: { name: 'Rook' } });
  assert.deepEqual(g.log, ['say Rook: me']);
});

test('custom commands can be registered; unknown ones are skipped', async () => {
  const g = fakeGame();
  const ev = new EventRunner(g);
  ev.register('give', (c) => g.log.push(`give ${c.item}`));
  const warn = console.warn;
  console.warn = () => {};
  await ev.run([{ do: 'nope' }, { do: 'give', item: 'apple' }]);
  console.warn = warn;
  assert.deepEqual(g.log, ['give apple']);
});
