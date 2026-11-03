import * as THREE from 'three';
import { PostFX } from './render/PostFX.js';
import { globalUniforms } from './render/MaterialPatch.js';

/**
 * Owns the renderer, scene, camera, post pipeline and the main loop.
 * Game code registers systems: anything with update(dt, time) or a function.
 */
export class Engine {
  constructor({ container = document.body, maxPixelRatio = 1.5, samples = 4, fov = 30 } = {}) {
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor(0x000000, 1);
    renderer.info.autoReset = false; // count every pass of a frame, reset in step()
    container.appendChild(renderer.domElement);
    renderer.domElement.classList.add('hd-canvas');
    this.renderer = renderer;
    this.container = container;
    this.maxPixelRatio = maxPixelRatio;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#c7dcef');
    this.scene.fog = new THREE.Fog('#c7dcef', 34, 85);

    this.camera = new THREE.PerspectiveCamera(fov, 1, 0.5, 180);
    this.post = new PostFX(renderer, this.scene, this.camera, { samples });

    this.systems = [];
    this.time = 0;
    this.timeScale = 1;
    this.paused = false;
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._last = 0;
    this._running = false;
    this.frameTime = 16.7; // unclamped ms between the last two frames
    this.stats = { cpuMs: 0, calls: 0, triangles: 0, points: 0, programs: 0, textures: 0, geometries: 0 };

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  get uniforms() {
    return globalUniforms;
  }

  get running() {
    return this._running;
  }

  addSystem(system) {
    this.systems.push(system);
    return system;
  }

  removeSystem(system) {
    const i = this.systems.indexOf(system);
    if (i >= 0) this.systems.splice(i, 1);
  }

  resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.setSize(w, h, pr);
    this._updatePointScale();
  }

  _updatePointScale() {
    const h = this.post.internalHeight || this.renderer.domElement.height;
    globalUniforms.uPointScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2));
    globalUniforms.uResolution.value.set(this.post.internalWidth || 1, h);
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    const loop = (now) => {
      if (!this._running) return;
      requestAnimationFrame(loop);
      const ms = now - this._last;
      this._last = now;
      this.step(Math.min(0.05, ms / 1000), ms);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this._running = false;
  }

  /** Advance one frame (also usable for deterministic stepping in tests). */
  step(rawDt, frameMs = rawDt * 1000) {
    const t0 = performance.now();
    this.frameTime = frameMs;
    this.renderer.info.reset();
    const dt = this.paused ? 0 : rawDt * this.timeScale;
    this.time += dt;
    globalUniforms.uTime.value = this.time;
    for (const s of this.systems) {
      if (typeof s === 'function') s(dt, this.time, rawDt);
      else s.update(dt, this.time, rawDt);
    }
    this._updatePointScale();
    this.post.render(dt);
    const info = this.renderer.info;
    const st = this.stats;
    st.cpuMs = performance.now() - t0;
    st.calls = info.render.calls;
    st.triangles = info.render.triangles;
    st.points = info.render.points;
    st.programs = info.programs ? info.programs.length : 0;
    st.textures = info.memory.textures;
    st.geometries = info.memory.geometries;
    this._fpsAcc += rawDt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fps = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }
  }
}
