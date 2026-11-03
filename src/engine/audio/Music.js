import { pluck, pad, bass, bell, midiToFreq } from './Synth.js';
import { RNG } from '../core/Random.js';

/**
 * Generative background music. A pastoral 3/4 piece in D major: diatonic
 * chord progressions arranged in an A-A-B-A song form, a harp arpeggio,
 * a soft pad and bass, and melodies composed per phrase from the
 * pentatonic scale (chord tones on strong beats, stepwise motion between).
 *
 * Moods change the tempo, progressions, density and timbre. A mood change
 * waits for the next phrase so transitions always land musically.
 */

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];

export const MUSIC_MOODS = {
  day: {
    bpm: 84, progressions: [[1, 5, 6, 4], [4, 1, 2, 5], [6, 4, 1, 5], [1, 4, 6, 5]], form: [0, 0, 1, 0, 2, 1, 3, 0],
    arp: 'eighths', rest: 0.08, padGain: 0.028, padCutoff: 1100, arpGain: 0.055, melGain: 0.085, bassGain: 0.1,
    bright: 1, send: 0.22, bellMelody: false,
  },
  night: {
    bpm: 60, progressions: [[6, 4, 1, 5], [6, 2, 4, 5], [4, 5, 6, 6], [6, 4, 5, 3]], form: [0, 1, 0, 2, 0, 3, 1, 0],
    arp: 'quarters', rest: 0.38, padGain: 0.04, padCutoff: 650, arpGain: 0.04, melGain: 0.05, bassGain: 0.06,
    bright: 0.5, send: 0.55, bellMelody: true,
  },
};

const RHYTHMS = [[2, 2, 2], [3, 1, 2], [2, 1, 1, 2], [4, 2], [1, 1, 2, 2], [2, 4]];
const CADENCE = [[4, 2], [6], [3, 3]];

export class Music {
  constructor(ae, { key = 62, seed = 7, mood = 'day' } = {}) {
    this.ae = ae;
    this.key = key; // MIDI note of the tonic (62 = D4)
    this.rng = new RNG(seed);
    this.mood = mood;
    this.pendingMood = mood;
    this.playing = false;
    this.level = 1;
    this.step = 0; // eighth note within the current phrase
    this.formPos = 0;
    this.nextTime = 0;
    this.melodies = {};
    this.pentatonic = [];
    for (let o = -1; o <= 2; o++) for (const p of PENTA) this.pentatonic.push(key + p + 12 * o);
    this.pentatonic = this.pentatonic.filter((m) => m >= key + 3 && m <= key + 26).sort((a, b) => a - b);
    this._lastMel = key + 14;
  }

  get cfg() {
    return MUSIC_MOODS[this.mood];
  }

  get eighth() {
    return 60 / this.cfg.bpm / 2;
  }

  setMood(name) {
    if (MUSIC_MOODS[name]) this.pendingMood = name;
  }

  start(at = this.ae.time + 0.1) {
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = at;
  }

  stop() {
    this.playing = false;
  }

  /** Diatonic triad on a scale degree (1-7), as MIDI notes. */
  chord(degree) {
    const i = degree - 1;
    return [i, i + 2, i + 4].map((k) => this.key + MAJOR[k % 7] + 12 * Math.floor(k / 7));
  }

  _progression() {
    const c = this.cfg;
    return c.progressions[c.form[this.formPos % c.form.length]];
  }

  _melody() {
    const c = this.cfg;
    const pi = c.form[this.formPos % c.form.length];
    const key = `${this.mood}:${pi}`;
    if (!this.melodies[key]) this.melodies[key] = this._compose(c.progressions[pi], c);
    return this.melodies[key];
  }

  _compose(prog, c) {
    const rng = this.rng;
    const notes = [];
    const scale = this.pentatonic;
    let prev = this._lastMel;
    const nearestIndex = (m) => scale.reduce((best, v, i) => (Math.abs(v - m) < Math.abs(scale[best] - m) ? i : best), 0);
    for (let bar = 0; bar < 4; bar++) {
      const tones = this.chord(prog[bar]);
      const rhythm = bar === 3 ? rng.pick(CADENCE) : rng.pick(RHYTHMS);
      let pos = 0;
      rhythm.forEach((dur, k) => {
        const last = bar === 3 && k === rhythm.length - 1;
        if (!last && !(bar === 0 && k === 0) && rng.chance(c.rest)) { pos += dur; return; }
        let midi;
        if (k === 0 || last) {
          // chord tone nearest the previous note on strong beats / cadence
          const cands = [];
          for (const t of tones) for (let o = -1; o <= 2; o++) cands.push(t + 12 * o);
          const pool = cands.filter((m) => m >= scale[0] && m <= scale[scale.length - 1]);
          const target = last ? tones[0] : null;
          midi = pool.reduce((b, m) => {
            if (target !== null && (m - target) % 12 !== 0) return b;
            return b === null || Math.abs(m - prev) < Math.abs(b - prev) ? m : b;
          }, null) ?? pool[0];
        } else {
          let i = nearestIndex(prev);
          const leap = rng.chance(0.25) ? 2 : 1;
          i += rng.chance(0.5) ? leap : -leap;
          if (i < 1 || i > scale.length - 2) i = nearestIndex(prev) + (i < 1 ? 1 : -1);
          midi = scale[Math.max(0, Math.min(scale.length - 1, i))];
        }
        notes.push({ step: bar * 6 + pos, midi, dur });
        prev = midi;
        pos += dur;
      });
    }
    this._lastMel = prev;
    return notes;
  }

  /** Schedule notes up to `now + lookahead` (call every frame). */
  update(now = this.ae.time, lookahead = 0.3) {
    if (!this.playing || !this.ae.ready) return;
    if (this.nextTime < now - 0.25) this.nextTime = now + 0.05; // resume after a suspension
    while (this.nextTime < now + lookahead) {
      if (this.step === 0) {
        if (this.pendingMood !== this.mood) {
          this.mood = this.pendingMood;
          this.formPos = 0;
        }
      }
      this._scheduleStep(this.step, this.nextTime);
      this.nextTime += this.eighth;
      this.step++;
      if (this.step >= 24) {
        this.step = 0;
        this.formPos++;
        // a fresh set of melodies each time the whole form has played
        if (this.formPos % this.cfg.form.length === 0) this.melodies = {};
      }
    }
  }

  _scheduleStep(step, t) {
    const ae = this.ae;
    const c = this.cfg;
    const L = this.level;
    if (L <= 0.001) return;
    const e8 = this.eighth;
    const bar = Math.floor(step / 6);
    const e = step % 6;
    const tones = this.chord(this._progression()[bar]);
    if (e === 0) {
      const barDur = e8 * 6;
      pad(ae, t, tones.map((m) => midiToFreq(m - 12)), { gain: c.padGain * L, dur: barDur + 1.2, attack: 0.6, release: 1.4, cutoff: c.padCutoff, send: c.send });
      let root = tones[0] - 24;
      while (root < 38) root += 12;
      bass(ae, t, midiToFreq(root), { gain: c.bassGain * L, dur: barDur * 0.95 });
    }
    // harp arpeggio
    const arpTones = [tones[0], tones[1], tones[2], tones[0] + 12];
    const arpPattern = c.arp === 'eighths' ? [0, 1, 2, 3, 2, 1] : [0, -1, 2, -1, 1, -1];
    const ai = arpPattern[e];
    if (ai >= 0) {
      pluck(ae, t, midiToFreq(arpTones[ai]), {
        gain: c.arpGain * L * (e === 0 ? 1.15 : 1), dur: c.arp === 'eighths' ? 1.3 : 2.2,
        bright: c.bright, send: c.send, pan: e % 2 ? 0.25 : -0.2,
      });
    }
    // melody
    for (const n of this._melody()) {
      if (n.step !== step) continue;
      const f = midiToFreq(n.midi);
      if (c.bellMelody) bell(ae, t, f, { gain: c.melGain * L, dur: 1.2 + n.dur * e8 * 1.5, dest: ae.bus.music, send: c.send });
      else pluck(ae, t, f, { gain: c.melGain * L, dur: 0.6 + n.dur * e8 * 1.8, bright: 1.25, send: c.send * 0.8, pan: 0.05 });
    }
  }
}
