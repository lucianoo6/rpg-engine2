import { noiseHit, chirp } from './Synth.js';

/**
 * Environmental sound bed, all synthesised:
 *  - wind: band-passed noise drifting in pitch and level
 *  - positional loops: water (waterfall, river) and fire rumbles that fade
 *    and pan with the listener, plus random fire crackles
 *  - birds by day, crickets by night (levels follow the day/night cycle)
 */
export class Ambience {
  constructor(ae) {
    this.ae = ae;
    this.started = false;
    this.loops = [];
    this.fires = [];
    this.day = 1;
    this.night = 0;
    this.windBase = 0.05;
    this._nextBird = 0;
    this._nextWind = 0;
    this._crickets = [];
  }

  _loop(kind, filters, dest) {
    const ctx = this.ae.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.ae.noise(kind);
    src.loop = true;
    let node = src;
    const fs = [];
    for (const f of filters) {
      const b = ctx.createBiquadFilter();
      b.type = f.type;
      b.frequency.value = f.freq;
      b.Q.value = f.q ?? 0.7;
      node.connect(b);
      node = b;
      fs.push(b);
    }
    const gain = ctx.createGain();
    gain.gain.value = 0;
    node.connect(gain);
    let pan = null;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      gain.connect(pan).connect(dest);
    } else gain.connect(dest);
    src.start(this.ae.time, Math.random() * 2);
    return { src, filters: fs, gain, pan };
  }

  /** Looping water noise at a world position. */
  addWater(x, z, { gain = 0.25, ref = 3, max = 22, cutoff = 2600 } = {}) {
    this.loops.push({ x, z, gain, ref, max, kind: 'pink', filters: [{ type: 'highpass', freq: 220 }, { type: 'lowpass', freq: cutoff }], node: null });
  }

  /** Campfire: low rumble loop plus crackles. */
  addFire(x, z, { gain = 0.12, ref = 1.5, max = 12 } = {}) {
    const loop = { x, z, gain, ref, max, kind: 'brown', filters: [{ type: 'lowpass', freq: 380 }], node: null };
    this.loops.push(loop);
    this.fires.push({ x, z, ref, max, next: 0 });
  }

  start() {
    if (this.started || !this.ae.ready) return;
    this.started = true;
    const ae = this.ae;
    const ctx = ae.ctx;
    this.wind = this._loop('pink', [{ type: 'bandpass', freq: 500, q: 0.6 }], ae.bus.ambience);
    for (const l of this.loops) l.node = this._loop(l.kind, l.filters, ae.bus.ambience);
    // two crickets with slightly different pitch and rhythm
    for (const [freq, pan, period] of [[4350, -0.55, 0.62], [4720, 0.6, 0.81]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = freq;
      const fm = ctx.createOscillator();
      fm.frequency.value = 55;
      const fmg = ctx.createGain();
      fmg.gain.value = 90;
      fm.connect(fmg).connect(o.frequency);
      const gate = ctx.createGain();
      gate.gain.value = 0;
      o.connect(gate);
      let last = gate;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        gate.connect(p);
        last = p;
      }
      last.connect(ae.bus.ambience);
      o.start(); fm.start();
      this._crickets.push({ gate, period, next: ae.time + Math.random() });
    }
  }

  update(dt, { night = 0 } = {}) {
    if (!this.started) return;
    const ae = this.ae;
    const t = ae.time;
    this.night = night;
    this.day = 1 - night;

    // wind drifts every few seconds
    if (t > this._nextWind) {
      this._nextWind = t + 2 + Math.random() * 3;
      const level = this.windBase * (0.6 + Math.random() * 0.8);
      this.wind.gain.gain.setTargetAtTime(level, t, 1.5);
      this.wind.filters[0].frequency.setTargetAtTime(280 + Math.random() * 600, t, 2);
    }

    for (const l of this.loops) {
      if (!l.node) continue;
      const s = ae.spatial(l.x, l.z, l.ref, l.max);
      l.node.gain.gain.setTargetAtTime(l.gain * s.gain, t, 0.15);
      if (l.node.pan) l.node.pan.pan.setTargetAtTime(s.pan, t, 0.15);
    }

    for (const f of this.fires) {
      const s = ae.spatial(f.x, f.z, f.ref, f.max);
      if (s.gain < 0.02 || t < f.next) continue;
      const burst = Math.random() < 0.25 ? 3 : 1;
      for (let k = 0; k < burst; k++) {
        noiseHit(ae, t + 0.02 + k * 0.03 * Math.random(), {
          type: 'highpass', freq: 1500 + Math.random() * 3000, q: 0.7,
          dur: 0.006 + Math.random() * 0.025, gain: (0.05 + Math.random() * 0.12) * s.gain,
          dest: ae.bus.ambience, pan: s.pan,
        });
      }
      f.next = t + 0.04 + Math.random() * Math.random() * 0.5;
    }

    // birds during the day
    if (t > this._nextBird) {
      this._nextBird = t + 1.2 + Math.random() * 4;
      if (this.day > 0.3) {
        const n = 2 + Math.floor(Math.random() * 4);
        const base = 2400 + Math.random() * 1800;
        const pan = Math.random() * 1.6 - 0.8;
        for (let k = 0; k < n; k++) {
          const up = Math.random() < 0.6;
          chirp(ae, t + 0.05 + k * (0.11 + Math.random() * 0.06), {
            f0: base * (up ? 1 : 1.25), f1: base * (up ? 1.35 : 0.85), dur: 0.07 + Math.random() * 0.07,
            gain: 0.016 * this.day, pan,
          });
        }
      }
    }

    // crickets at night: three quick pulses per chirp
    for (const c of this._crickets) {
      if (t + 0.3 < c.next) continue;
      const level = 0.012 * Math.max(0, (night - 0.3) / 0.7);
      if (level > 0.0005) {
        for (let k = 0; k < 3; k++) {
          const on = c.next + k * 0.075;
          c.gate.gain.setTargetAtTime(level, on, 0.004);
          c.gate.gain.setTargetAtTime(0, on + 0.04, 0.006);
        }
      }
      c.next += c.period * (0.85 + Math.random() * 0.3);
      if (c.next < t) c.next = t + 0.1;
    }
  }
}
