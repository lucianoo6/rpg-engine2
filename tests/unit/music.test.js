import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Music, MUSIC_MOODS } from '../../src/engine/audio/Music.js';

const MAJOR = new Set([0, 2, 4, 5, 7, 9, 11]);

test('chords are diatonic triads in the key', () => {
  const m = new Music({ ready: false }, { key: 62 });
  for (let d = 1; d <= 7; d++) {
    const c = m.chord(d);
    assert.equal(c.length, 3);
    for (const n of c) assert.ok(MAJOR.has((n - 62 + 120) % 12), `degree ${d} note ${n}`);
  }
});

test('composed melodies stay in key and end on the cadence chord root', () => {
  for (const mood of Object.keys(MUSIC_MOODS)) {
    const m = new Music({ ready: false }, { key: 62, seed: 3, mood });
    for (const prog of MUSIC_MOODS[mood].progressions) {
      const notes = m._compose(prog, MUSIC_MOODS[mood]);
      assert.ok(notes.length > 0);
      for (const n of notes) {
        assert.ok(MAJOR.has((n.midi - 62 + 120) % 12), `${mood}: ${n.midi} out of key`);
        assert.ok(n.step >= 0 && n.step < 24);
      }
      const last = notes[notes.length - 1];
      const root = m.chord(prog[3])[0];
      assert.equal((last.midi - root + 120) % 12, 0, `${mood}: phrase ends on the root`);
    }
  }
});
