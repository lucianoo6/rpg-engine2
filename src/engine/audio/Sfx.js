import { noiseHit, blip, bell, pluck, midiToFreq } from './Synth.js';

/**
 * One-shot sound effects. Every call is a no-op until the AudioEngine is
 * unlocked, so game code can trigger sounds freely.
 */
export class Sfx {
  constructor(ae) {
    this.ae = ae;
  }

  get ok() {
    return this.ae.ready && (this.ae.unlocked || this.ae.ctx instanceof OfflineAudioContext);
  }

  /** surface: grass | dirt | sand | stone | wood */
  footstep(surface = 'grass', { gain = 1, pan = 0 } = {}) {
    if (!this.ok) return;
    const ae = this.ae;
    const t = ae.time + 0.005;
    const v = 0.85 + Math.random() * 0.3;
    const g = gain * v;
    switch (surface) {
      case 'stone':
        noiseHit(ae, t, { type: 'bandpass', freq: 1900 * v, q: 2.2, dur: 0.035, gain: 0.9 * g, pan });
        noiseHit(ae, t, { type: 'lowpass', freq: 500, q: 0.7, dur: 0.05, gain: 0.3 * g, pan });
        break;
      case 'wood':
        noiseHit(ae, t, { type: 'bandpass', freq: 320 * v, q: 3, dur: 0.11, gain: 0.75 * g, pan });
        blip(ae, t, 150 * v, { gain: 0.16 * g, dur: 0.08, type: 'sine' });
        break;
      case 'dirt':
      case 'sand':
        noiseHit(ae, t, { type: 'bandpass', freq: (surface === 'sand' ? 1200 : 650) * v, q: 1.1, dur: 0.07, gain: 0.9 * g, pan, noise: 'pink' });
        break;
      default: // grass: soft thud plus a little rustle
        noiseHit(ae, t, { type: 'lowpass', freq: 700 * v, q: 0.8, dur: 0.08, gain: 0.45 * g, pan, noise: 'pink' });
        noiseHit(ae, t + 0.01, { type: 'highpass', freq: 3500, q: 0.6, dur: 0.05, gain: 0.1 * g, pan });
    }
  }

  /** Dialogue "voice" tick; pitch identifies the speaker. */
  voice(pitch = 1) {
    if (!this.ok) return;
    blip(this.ae, this.ae.time, 330 * pitch * (0.95 + Math.random() * 0.1), { gain: 0.22, dur: 0.045, type: 'triangle' });
  }

  uiMove() {
    if (!this.ok) return;
    blip(this.ae, this.ae.time, 1320, { gain: 0.08, dur: 0.035, type: 'sine' });
  }

  uiConfirm() {
    if (!this.ok) return;
    const t = this.ae.time;
    blip(this.ae, t, 880, { gain: 0.09, dur: 0.06, type: 'sine' });
    blip(this.ae, t + 0.06, 1318.5, { gain: 0.09, dur: 0.09, type: 'sine' });
  }

  uiOpen() {
    if (!this.ok) return;
    blip(this.ae, this.ae.time, 660, { gain: 0.06, dur: 0.12, type: 'sine', glide: 1.5 });
  }

  /** Crystal touch: a rising bell arpeggio with shimmer. */
  crystal() {
    if (!this.ok) return;
    const ae = this.ae;
    const t = ae.time + 0.02;
    [86, 90, 93, 98, 102].forEach((m, i) => bell(ae, t + i * 0.11, midiToFreq(m), { gain: 0.07, dur: 2.6, send: 0.6, pan: (i - 2) * 0.15 }));
    noiseHit(ae, t, { type: 'highpass', freq: 6000, dur: 1.2, attack: 0.3, gain: 0.03, send: 0.6 });
  }

  /** A short lullaby when resting by the fire. */
  rest() {
    if (!this.ok) return;
    const ae = this.ae;
    const t = ae.time + 0.05;
    [[74, 0], [78, 0.45], [81, 0.9], [79, 1.5], [74, 2.1]].forEach(([m, dt]) => pluck(ae, t + dt, midiToFreq(m), { gain: 0.09, dur: 2.2, dest: ae.bus.sfx, send: 0.5 }));
  }

  /** Gentle chime when a location banner appears. */
  zone() {
    if (!this.ok) return;
    const t = this.ae.time + 0.02;
    bell(this.ae, t, midiToFreq(81), { gain: 0.035, dur: 2.2, send: 0.6 });
    bell(this.ae, t + 0.18, midiToFreq(86), { gain: 0.03, dur: 2.6, send: 0.6 });
  }
}
