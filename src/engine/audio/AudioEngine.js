/**
 * Web Audio backbone: buses (music / ambience / sfx), a shared convolution
 * reverb, a safety limiter, noise buffers and simple 2D spatialisation
 * (distance attenuation + stereo pan relative to the camera).
 *
 * Browsers only allow audio after a user gesture, so nothing is created
 * until unlock() runs from a click, key press or tap (autoUnlock() wires
 * that up). Pass an OfflineAudioContext as `context` to render audio
 * offline, e.g. in tests.
 */
export class AudioEngine {
  constructor({ context = null, volumes = {} } = {}) {
    this.ctx = null;
    this.unlocked = false;
    this.muted = false;
    this.volumes = { master: 0.8, music: 0.5, ambience: 0.7, sfx: 0.8, ...volumes };
    this.listener = { x: 0, z: 0, yaw: 0 };
    this._buffers = {};
    this._unlockHandlers = [];
    if (context) this._init(context);
  }

  get ready() {
    return !!this.ctx;
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Create/resume the context. Call from a user gesture. */
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this._init(new AC({ latencyHint: 'interactive' }));
    }
    if (this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume();
    if (!this.unlocked) {
      this.unlocked = true;
      for (const fn of this._unlockListeners || []) fn(this);
    }
    return true;
  }

  onUnlock(fn) {
    (this._unlockListeners ||= []).push(fn);
    if (this.unlocked) fn(this);
  }

  /** Unlock on the first click, key or touch anywhere on `target`. */
  autoUnlock(target = window) {
    const h = () => {
      if (this.unlock()) for (const [ev, fn] of this._unlockHandlers) target.removeEventListener(ev, fn);
    };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) {
      target.addEventListener(ev, h, { passive: true });
      this._unlockHandlers.push([ev, h]);
    }
  }

  _init(ctx) {
    this.ctx = ctx;
    const master = ctx.createGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 8;
    limiter.ratio.value = 8;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    master.connect(limiter).connect(ctx.destination);
    this.master = master;
    this.bus = {};
    for (const name of ['music', 'ambience', 'sfx']) {
      const g = ctx.createGain();
      g.connect(master);
      this.bus[name] = g;
    }
    // shared hall reverb (generated impulse response)
    this.reverbSend = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = makeImpulse(ctx, 3.4, 2.8);
    const ret = ctx.createGain();
    ret.gain.value = 0.55;
    this.reverbSend.connect(conv).connect(ret).connect(master);
    this.duck = 1;
    this._applyVolumes(0);
    if (typeof document !== 'undefined' && !(ctx instanceof OfflineAudioContext)) {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) ctx.suspend();
        else if (this.unlocked) ctx.resume();
      });
    }
  }

  _applyVolumes(ramp = 0.15) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const set = (param, v) => (ramp ? param.setTargetAtTime(v, t, ramp) : param.setValueAtTime(v, t));
    set(this.master.gain, this.muted ? 0 : this.volumes.master);
    set(this.bus.music.gain, this.volumes.music * this.duck);
    set(this.bus.ambience.gain, this.volumes.ambience);
    set(this.bus.sfx.gain, this.volumes.sfx);
  }

  setVolume(name, v) {
    this.volumes[name] = v;
    this._applyVolumes();
  }

  setMuted(m) {
    this.muted = m;
    this._applyVolumes(0.05);
  }

  /** Lower the music (e.g. 0.6 during dialogue); 1 restores it. */
  setDuck(level, ramp = 0.4) {
    if (this.duck === level) return;
    this.duck = level;
    this._applyVolumes(ramp);
  }

  /** White, pink-ish or brown noise buffers, 3 s, generated once. */
  noise(kind = 'white') {
    if (this._buffers[kind]) return this._buffers[kind];
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * 3);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b = 0, p0 = 0, p1 = 0, p2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        b = (b + 0.02 * w) / 1.02;
        d[i] = b * 3.5;
      } else if (kind === 'pink') {
        p0 = 0.99765 * p0 + w * 0.099046;
        p1 = 0.963 * p1 + w * 0.2965164;
        p2 = 0.57 * p2 + w * 1.0526913;
        d[i] = (p0 + p1 + p2 + w * 0.1848) * 0.18;
      } else d[i] = w;
    }
    // crossfade the loop seam
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      d[len - fade + i] = d[len - fade + i] * (1 - k) + d[i] * k;
    }
    this._buffers[kind] = buf;
    return buf;
  }

  /** Distance gain (0..1) and stereo pan (-1..1) of a world point for the listener. */
  spatial(x, z, ref = 3, max = 20) {
    const L = this.listener;
    const dx = x - L.x, dz = z - L.z;
    const d = Math.hypot(dx, dz);
    let g = 1 - Math.max(0, d - ref) / Math.max(0.001, max - ref);
    g = Math.max(0, Math.min(1, g));
    const right = Math.cos(L.yaw) * dx - Math.sin(L.yaw) * dz;
    return { gain: g * g, pan: Math.max(-0.85, Math.min(0.85, right / 9)) };
  }
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // soft onset avoids a click, then an exponential-ish tail
      const env = Math.min(1, i / (ctx.sampleRate * 0.02)) * Math.pow(1 - t, decay);
      d[i] = (Math.random() * 2 - 1) * env;
    }
  }
  return buf;
}
