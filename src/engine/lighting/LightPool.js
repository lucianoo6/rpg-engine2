import * as THREE from 'three';

/**
 * Forward renderers pay for every point light in every lit fragment, and
 * changing the light count recompiles shaders. The pool keeps a small,
 * fixed set of real PointLights and hands them to the light sources that
 * matter most around `focus` (usually the player) each frame. Sources that
 * gain or lose a slot fade in and out, so the hand-over is invisible.
 *
 * One optional extra light casts point shadows; it is given to the best
 * shadow-casting source nearby and stops rendering its cube shadow map
 * when nobody needs it.
 */
export class LightPool {
  constructor(scene, { size = 8, shadows = true, shadowMapSize = 512, fadeSpeed = 6, shadowInterval = 1 } = {}) {
    this.isLightPool = true;
    this.scene = scene;
    this.sources = [];
    this.slots = [];
    this.focus = new THREE.Vector3();
    this.fadeSpeed = fadeSpeed;
    // re-render the point shadow cube every N frames (6 extra scene passes each time)
    this.shadowInterval = shadowInterval;
    this._shadowFrame = 0;
    this.shadowLight = new THREE.PointLight(0xffffff, 0, 10, 2);
    const sh = this.shadowLight.shadow;
    sh.mapSize.set(shadowMapSize, shadowMapSize);
    sh.bias = -0.002;
    sh.normalBias = 0.03;
    sh.radius = 3;
    sh.camera.near = 0.1;
    this.shadowLight.castShadow = shadows;
    this.shadowLight.name = 'pool:shadow';
    scene.add(this.shadowLight);
    this.shadowOwner = null;
    this._ranked = [];
    this._snap = true; // first update jumps straight to the target weights
    this.setSize(size);
  }

  add(source) {
    source.poolWeight = 0;
    source.shadowWeight = 0;
    this.sources.push(source);
    return source;
  }

  /** Change the number of pooled lights (recompiles lit shaders once). */
  setSize(n) {
    while (this.slots.length < n) {
      const l = new THREE.PointLight(0xffffff, 0, 8, 2);
      l.name = `pool:${this.slots.length}`;
      this.scene.add(l);
      this.slots.push(l);
    }
    while (this.slots.length > n) this.slots.pop().removeFromParent();
    this.size = n;
  }

  /** Toggle point-light shadows (recompiles lit shaders once). */
  setShadows(on) {
    this.shadowLight.castShadow = on;
  }

  _score(s) {
    if (s.intensity <= 0.001) return -Infinity;
    // closer and longer-reaching lights matter more
    return s.distance * 0.75 - s.position.distanceTo(this.focus);
  }

  update(dt) {
    const k = this._snap ? 1 : 1 - Math.exp(-this.fadeSpeed * dt);
    this._snap = false;
    const shadowsOn = this.shadowLight.castShadow;

    // pick the shadow owner: best-scoring shadow caster that is reasonably close
    let owner = null, bestShadow = -Infinity;
    if (shadowsOn) {
      for (const s of this.sources) {
        if (!s.castShadow) continue;
        const sc = this._score(s);
        if (sc > bestShadow && sc > -12) { bestShadow = sc; owner = s; }
      }
    }
    for (const s of this.sources) s.shadowWeight += ((s === owner ? 1 : 0) - s.shadowWeight) * k;

    // everyone else competes for the regular slots
    const ranked = this._ranked;
    ranked.length = 0;
    for (const s of this.sources) {
      s.poolScore = s === owner ? -Infinity : this._score(s);
      ranked.push(s);
    }
    ranked.sort((a, b) => b.poolScore - a.poolScore);
    for (let i = 0; i < ranked.length; i++) {
      const s = ranked[i];
      const want = i < this.size && s.poolScore > -Infinity ? 1 : 0;
      s.poolWeight += (want - s.poolWeight) * k;
      if (want === 0 && s.poolWeight < 0.01) s.poolWeight = 0;
    }
    // fill slots with the heaviest sources (fading-out ones keep a slot while space allows)
    ranked.sort((a, b) => b.poolWeight - a.poolWeight);
    for (let i = 0; i < this.slots.length; i++) {
      const l = this.slots[i];
      const s = ranked[i];
      if (s && s.poolWeight > 0) {
        l.position.copy(s.position);
        l.color.copy(s.color);
        l.distance = s.distance;
        l.decay = s.decay;
        l.intensity = s.current * s.poolWeight;
      } else {
        l.intensity = 0;
      }
    }

    // shadowed light
    const L = this.shadowLight;
    const src = owner || this.shadowOwner;
    if (src && shadowsOn) {
      L.position.copy(src.position);
      L.color.copy(src.color);
      L.distance = src.distance;
      L.decay = src.decay;
      L.intensity = src.current * src.shadowWeight;
      L.shadow.autoUpdate = false;
      this._shadowFrame = (this._shadowFrame + 1) % Math.max(1, this.shadowInterval);
      if (L.intensity > 0.01 && (this._shadowFrame === 0 || src !== this._lastShadowSrc)) L.shadow.needsUpdate = true;
      this._lastShadowSrc = src;
    } else {
      L.intensity = 0;
      L.shadow.autoUpdate = false;
    }
    if (owner) this.shadowOwner = owner;
    else if (this.shadowOwner && this.shadowOwner.shadowWeight < 0.01) this.shadowOwner = null;
  }

  /** How many real lights carry a visible amount of light this frame. */
  get activeCount() {
    let n = this.shadowLight.intensity > 0.01 ? 1 : 0;
    for (const l of this.slots) if (l.intensity > 0.01) n++;
    return n;
  }
}
