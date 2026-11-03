/**
 * Tiny synthesiser voices built from Web Audio nodes. Every function
 * schedules one sound at context time `t` and cleans up after itself.
 */

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function out(ae, node, { dest, pan = 0, send = 0 }) {
  const ctx = ae.ctx;
  let last = node;
  if (pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    node.connect(p);
    last = p;
  }
  last.connect(dest);
  if (send > 0) {
    const s = ctx.createGain();
    s.gain.value = send;
    last.connect(s).connect(ae.reverbSend);
  }
}

function envelope(ctx, t, { attack = 0.005, peak = 0.2, dur = 1, hold = 0 }) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  if (hold > 0) g.gain.setValueAtTime(Math.max(0.0002, peak), t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + dur);
  return g;
}

/** Plucked string / harp-like tone. */
export function pluck(ae, t, freq, { gain = 0.15, dur = 1.6, bright = 1, dest = ae.bus.music, send = 0.25, pan = 0 } = {}) {
  const ctx = ae.ctx;
  const o1 = ctx.createOscillator();
  o1.type = 'triangle';
  o1.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = freq * 2.003;
  const g2 = ctx.createGain();
  g2.gain.value = 0.3;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.value = 0.8;
  f.frequency.setValueAtTime(Math.min(12000, freq * 7 * bright), t);
  f.frequency.exponentialRampToValueAtTime(Math.max(180, freq * 1.4), t + dur * 0.5);
  const env = envelope(ctx, t, { attack: 0.004, peak: gain, dur });
  o1.connect(f);
  o2.connect(g2).connect(f);
  f.connect(env);
  out(ae, env, { dest, pan, send });
  const end = t + dur + 0.1;
  o1.start(t); o2.start(t);
  o1.stop(end); o2.stop(end);
}

/** Soft sustained chord (detuned saws through a low-pass). */
export function pad(ae, t, freqs, { gain = 0.04, dur = 4, attack = 1.2, release = 1.6, cutoff = 900, dest = ae.bus.music, send = 0.5 } = {}) {
  const ctx = ae.ctx;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = cutoff;
  f.Q.value = 0.5;
  const env = ctx.createGain();
  env.gain.setValueAtTime(0.0001, t);
  env.gain.linearRampToValueAtTime(gain, t + attack);
  env.gain.setValueAtTime(gain, t + Math.max(attack, dur - release));
  env.gain.linearRampToValueAtTime(0.0001, t + dur);
  f.connect(env);
  out(ae, env, { dest, send });
  for (const fr of freqs) {
    for (const det of [-7, 6]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = fr;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }
}

/** Round bass note. */
export function bass(ae, t, freq, { gain = 0.12, dur = 1.2, dest = ae.bus.music } = {}) {
  const ctx = ae.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = freq;
  const o2 = ctx.createOscillator();
  o2.type = 'triangle';
  o2.frequency.value = freq;
  const g2 = ctx.createGain();
  g2.gain.value = 0.25;
  const env = envelope(ctx, t, { attack: 0.02, peak: gain, dur });
  o.connect(env);
  o2.connect(g2).connect(env);
  out(ae, env, { dest, send: 0.08 });
  o.start(t); o2.start(t);
  o.stop(t + dur + 0.1); o2.stop(t + dur + 0.1);
}

/** Bell / chime with inharmonic partials. */
export function bell(ae, t, freq, { gain = 0.1, dur = 2.4, dest = ae.bus.sfx, send = 0.45, pan = 0 } = {}) {
  const ctx = ae.ctx;
  const partials = [[1, 1], [2.0, 0.45], [2.76, 0.32], [5.4, 0.12], [8.93, 0.05]];
  const mix = ctx.createGain();
  out(ae, mix, { dest, pan, send });
  partials.forEach(([ratio, amp], i) => {
    if (freq * ratio > 15000) return; // inaudible, and beyond the oscillator's nominal range
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq * ratio;
    const env = envelope(ctx, t, { attack: 0.003, peak: gain * amp, dur: dur / (1 + i * 0.6) });
    o.connect(env).connect(mix);
    o.start(t);
    o.stop(t + dur + 0.1);
  });
}

/** Filtered noise burst: footsteps, crackles, splashes, rustles. */
export function noiseHit(ae, t, { type = 'bandpass', freq = 900, q = 1, dur = 0.08, gain = 0.2, attack = 0.002, dest = ae.bus.sfx, pan = 0, send = 0, noise = 'white' } = {}) {
  const ctx = ae.ctx;
  const src = ctx.createBufferSource();
  const buf = ae.noise(noise);
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const env = envelope(ctx, t, { attack, peak: gain, dur });
  src.connect(f).connect(env);
  out(ae, env, { dest, pan, send });
  src.start(t, Math.random() * (buf.duration - dur - 0.1));
  src.stop(t + attack + dur + 0.05);
}

/** Short tonal blip (dialogue voice, UI ticks). */
export function blip(ae, t, freq, { gain = 0.05, dur = 0.05, type = 'triangle', dest = ae.bus.sfx, glide = 1 } = {}) {
  const ctx = ae.ctx;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = Math.min(9000, freq * 4);
  const env = envelope(ctx, t, { attack: 0.003, peak: gain, dur });
  o.connect(f).connect(env);
  out(ae, env, { dest });
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Bird-like chirp: a quick pitch sweep with a little vibrato. */
export function chirp(ae, t, { f0 = 3200, f1 = 4600, dur = 0.12, gain = 0.03, dest = ae.bus.ambience, pan = 0 } = {}) {
  const ctx = ae.ctx;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.6);
  o.frequency.exponentialRampToValueAtTime(f0 * 0.92, t + dur);
  const vib = ctx.createOscillator();
  vib.frequency.value = 38;
  const vg = ctx.createGain();
  vg.gain.value = f0 * 0.03;
  vib.connect(vg).connect(o.frequency);
  const env = envelope(ctx, t, { attack: 0.01, peak: gain, dur });
  o.connect(env);
  out(ae, env, { dest, pan, send: 0.3 });
  o.start(t); vib.start(t);
  o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
}
