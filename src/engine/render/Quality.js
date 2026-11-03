/**
 * Quality presets and an adaptive governor.
 *
 * A preset touches everything that costs GPU time: resolution, MSAA, the
 * depth-of-field sample count, shadow map size, how many point lights the
 * shaders evaluate, point-light shadows, ground-cover density and
 * particle spawn rates. In `auto` mode the governor watches real frame
 * times and steps down a level when the game cannot hold ~40 fps.
 */

export const QUALITY_LEVELS = ['low', 'medium', 'high', 'ultra'];

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, renderScale: 0.75, msaa: 0, dofSamples: 16, shadowMapSize: 1024, shadowRadius: 1.5, lights: 4, pointShadows: false, foliage: 0.45, particles: 0.5 },
  medium: { pixelRatio: 1.25, renderScale: 1, msaa: 2, dofSamples: 24, shadowMapSize: 2048, shadowRadius: 2, lights: 6, pointShadows: false, foliage: 0.75, particles: 0.75 },
  high: { pixelRatio: 1.5, renderScale: 1, msaa: 4, dofSamples: 40, shadowMapSize: 2048, shadowRadius: 2.5, lights: 8, pointShadows: true, foliage: 1, particles: 1 },
  ultra: { pixelRatio: 2, renderScale: 1, msaa: 4, dofSamples: 56, shadowMapSize: 4096, shadowRadius: 3, lights: 10, pointShadows: true, foliage: 1, particles: 1 },
};

export class Quality {
  /**
   * @param {Engine} engine
   * @param {object} o
   *   sun: DirectionalLight whose shadow map size follows the preset
   *   lightPool: LightPool whose size / shadows follow the preset
   *   groundCover: SpriteInstances[] thinned by `foliage`
   *   emitters: ParticleEmitter[] scaled by `particles`
   *   lockPixelRatio: number to keep a fixed pixel ratio cap (e.g. ?dpr=)
   */
  constructor(engine, { sun = null, lightPool = null, groundCover = [], emitters = [], lockPixelRatio = null, minFps = 40 } = {}) {
    this.engine = engine;
    this.sun = sun;
    this.lightPool = lightPool;
    this.groundCover = groundCover;
    this.emitters = emitters;
    this.lockPixelRatio = lockPixelRatio;
    this.minFps = minFps;
    this.level = null;
    this.auto = false;
    this.listeners = [];
    this._settle = 0;
    this._acc = 0;
    this._frames = 0;
  }

  onChange(fn) {
    this.listeners.push(fn);
  }

  /** Apply a preset by name; `auto` keeps the governor running from there. */
  set(level, { auto = this.auto } = {}) {
    this.auto = auto;
    this.apply(level);
  }

  /** @param {string} reason 'manual' or 'auto' (governor step-down), passed to listeners */
  apply(level, reason = 'manual') {
    const p = QUALITY_PRESETS[level];
    if (!p) throw new Error(`Unknown quality level "${level}"`);
    const e = this.engine;
    this.level = level;
    e.maxPixelRatio = this.lockPixelRatio ?? p.pixelRatio;
    e.post.renderScale = p.renderScale;
    e.post.setMsaa(p.msaa);
    e.post.setDofSamples(p.dofSamples);
    if (this.sun) {
      const sh = this.sun.shadow;
      if (sh.mapSize.x !== p.shadowMapSize) {
        sh.mapSize.set(p.shadowMapSize, p.shadowMapSize);
        if (sh.map) { sh.map.dispose(); sh.map = null; }
      }
      sh.radius = p.shadowRadius;
    }
    if (this.lightPool) {
      this.lightPool.setSize(p.lights);
      this.lightPool.setShadows(p.pointShadows);
    }
    for (const g of this.groundCover) g.setDensity(p.foliage);
    for (const em of this.emitters) em.rateScale = p.particles;
    e.resize();
    this._settle = 2.5; // ignore the shader-compile hitch that follows
    this._acc = 0;
    this._frames = 0;
    for (const fn of this.listeners) fn(level, this, reason);
  }

  get preset() {
    return QUALITY_PRESETS[this.level];
  }

  /** Call once per frame with the unclamped frame time in seconds. */
  update(frameSeconds) {
    if (!this.auto || !this.engine.running) return;
    if (frameSeconds > 0.25) return; // tab switches and long hitches are not representative
    if (this._settle > 0) {
      this._settle -= frameSeconds;
      return;
    }
    this._acc += frameSeconds;
    this._frames++;
    if (this._acc < 3) return;
    const fps = this._frames / this._acc;
    this._acc = 0;
    this._frames = 0;
    const i = QUALITY_LEVELS.indexOf(this.level);
    if (fps < this.minFps && i > 0) this.apply(QUALITY_LEVELS[i - 1], 'auto');
  }
}
