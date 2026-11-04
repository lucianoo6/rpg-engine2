import * as THREE from 'three';
import { NavGrid } from '../world/NavGrid.js';

/**
 * One loaded level: its scene graph, collision world, characters, lights,
 * particles and gameplay hooks. Maps stay alive when you leave them
 * (deactivate) so NPCs, particles and state are where you left them.
 *
 * Built either in code (see the village demo) or from data by buildMap().
 */
export class GameMap {
  constructor(id) {
    this.id = id;
    this.root = new THREE.Group();
    this.root.name = `map:${id}`;
    this.tileMap = null;
    this.world = null;
    this.npcs = []; // { char, name, lines?, talk?, script?, behaviour?, idleFacing?, speaker?, voice? }
    this.lights = []; // FlickerLight sources (registered in the LightPool while active)
    this.emitters = [];
    this.fireflies = [];
    this.dayEmitters = [];
    this.groundCover = [];
    this.shafts = [];
    this.flames = [];
    this.water = [];
    this.spawns = {};
    this.scripts = {};
    this.ambience = []; // positional sound sources for Ambience.setSources
    this.env = {
      title: id, subtitle: '', indoor: null,
      camera: { distance: 23, pitch: 33, bounds: null },
    };
    this.onUpdate = null; // (dt, t, state, { yaw, player, camera }) => void
    this.onEnter = null; // (game) => void, after activation
    this.nav = null;
    this.active = false;
    this._order = [];
  }

  getNav() {
    if (!this.nav) this.nav = new NavGrid(this.world).build();
    return this.nav;
  }

  spawn(name) {
    return this.spawns[name] || Object.values(this.spawns)[0] || { x: this.tileMap.width / 2, z: this.tileMap.depth / 2, facing: [0, 1] };
  }

  findNpc(name) {
    return this.npcs.find((n) => n.name === name) || null;
  }

  surfaceAt(x, z) {
    const m = this.tileMap;
    const i = Math.floor(x), j = Math.floor(z);
    if (!m.inBounds(i, j)) return 'grass';
    if (!Number.isNaN(m.deck[m.idx(i, j)])) return 'wood';
    return m.typeAt(i, j).surface || 'grass';
  }

  activate(scene, lightPool) {
    scene.add(this.root);
    for (const l of this.lights) lightPool.add(l);
    lightPool.snap();
    this._order = this.lights.slice();
    this.active = true;
  }

  deactivate(lightPool) {
    this.root.removeFromParent();
    for (const l of this.lights) lightPool.remove(l);
    for (const n of this.npcs) n.char.cancelPath();
    this.active = false;
  }

  /** Per-frame environment animation shared by all maps. */
  update(dt, t, state, ctx) {
    const { yaw, player } = ctx;
    const night = state.night;
    for (const l of this.lights) l.update(t, night);

    // water receives sky/sun and the nearest lamp reflections
    if (this.water.length) {
      const amb = (this._amb ||= new THREE.Color());
      amb.copy(state.sky).multiplyScalar(state.hemiIntensity * 0.55);
      amb.r += state.ground.r * 0.2; amb.g += state.ground.g * 0.2; amb.b += state.ground.b * 0.2;
      const sunCol = (this._sun ||= new THREE.Color()).copy(state.sunColor).multiplyScalar(state.sunIntensity * 0.35);
      const pp = player.position;
      this._order.sort((a, b) => a.position.distanceToSquared(pp) - b.position.distanceToSquared(pp));
      for (const w of this.water) {
        w.setEnvironment({ sunColor: sunCol, sunDir: state.sunDir, ambient: amb, sky: state.fog });
        w.setReflectedLights(this._order);
      }
    }

    // god rays lean with the sun and fade at night (indoors: window light by day)
    const right = (this._right ||= new THREE.Vector3()).set(Math.cos(yaw), 0, -Math.sin(yaw));
    const lean = THREE.MathUtils.clamp(-state.sunDir.dot(right) * 0.9, -0.6, 0.6);
    const shaftLevel = this.env.indoor ? Math.max(0, 1 - night * 1.4) * 0.8 : state.shafts;
    for (const sh of this.shafts) {
      if (!sh.fixedLean) sh.mesh.rotation.z = lean;
      sh.update(yaw, shaftLevel);
    }
    for (const e of this.fireflies) e.level = THREE.MathUtils.smoothstep(night, 0.35, 0.8);
    for (const e of this.dayEmitters) e.level = shaftLevel;
    for (const e of this.emitters) e.update(dt, t);
    for (const f of this.flames) f.sprite.setFrame(Math.floor(t * f.fps + f.offset) % 8, 0);
    if (this.onUpdate) this.onUpdate(dt, t, state, ctx);
  }
}
