import * as THREE from 'three';
import GUI from 'lil-gui';
import { Engine } from '../engine/Engine.js';
import { Input } from '../engine/input/Input.js';
import { CameraRig } from '../engine/camera/CameraRig.js';
import { DayNightCycle } from '../engine/lighting/DayNightCycle.js';
import { LightPool } from '../engine/lighting/LightPool.js';
import { Quality, QUALITY_LEVELS } from '../engine/render/Quality.js';
import { runBenchmark } from '../engine/render/Benchmark.js';
import { AudioEngine } from '../engine/audio/AudioEngine.js';
import { Music } from '../engine/audio/Music.js';
import { Ambience } from '../engine/audio/Ambience.js';
import { Sfx } from '../engine/audio/Sfx.js';
import { Character } from '../engine/entities/Character.js';
import { makeCharacterSheet, makeCatSheet } from '../engine/pixel/CharacterFactory.js';
import { loadSpriteSheet } from '../engine/sprites/SpriteSheet.js';
import { Emote } from '../engine/sprites/Emote.js';
import { UIRoot, DialogueBox, Banner, WorldPrompt, HUD, TitleCard } from '../engine/ui/UI.js';
import { globalUniforms } from '../engine/render/MaterialPatch.js';
import { propMaterials } from '../engine/world/Props.js';
import { loadMapData } from '../engine/game/MapData.js';
import { buildMap } from '../engine/game/MapBuilder.js';
import { defaultPrefabs } from '../engine/game/Prefabs.js';
import { EventRunner } from '../engine/game/Events.js';
import { SaveSystem } from '../engine/game/SaveSystem.js';
import { damp } from '../engine/core/Random.js';
import { buildVillage } from './maps/village.js';
import { CAST } from './cast.js';
import { CAMPAIGN } from './campaign.js';
import { resolveFoliage } from '../engine/world/Trees.js';

const TIME_PRESETS = [
  ['Dawn', 6.4], ['Morning', 9], ['Noon', 13], ['Golden Hour', 16.5], ['Dusk', 18.6], ['Night', 22],
];

// dialogue "voice" pitch per speaker ('' = narration)
const VOICES = { '': 0.7, Wren: 1, 'Elder Osric': 0.68, Tilda: 1.25, Bram: 0.78, Pip: 1.55, Fenna: 1.12, 'Sister Ilse': 1.05, Biscuit: 1.9, Marta: 1.2, Rook: 0.85 };

const BASE = import.meta.env.BASE_URL;

/**
 * Hollowbrook: the demo game. Owns everything that survives a map change
 * (engine, player, camera, audio, UI, story flags, saves) and loads maps on
 * demand: the village is built in code, the inn comes from a Tiled file.
 */
export class HollowbrookGame {
  constructor(container) {
    const params = new URLSearchParams(location.search);
    this.params = params;
    this.container = container;
    const engine = new Engine({ container });
    this.engine = engine;
    const { scene, camera, post } = engine;
    this.input = new Input(engine.renderer.domElement);
    this.saves = new SaveSystem('hollowbrook');
    this.persist = !params.has('nosave');
    this.flags = new Set();

    // ---- lighting shared by all maps ----
    const sun = new THREE.DirectionalLight('#ffffff', 3);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    sun.shadow.radius = 2.5;
    scene.add(sun, sun.target);
    const hemi = new THREE.HemisphereLight('#c6defc', '#6a6348', 1.2);
    scene.add(hemi);
    this.sun = sun;
    this.cycle = new DayNightCycle({ scene, sun, hemi, post, time: Number(params.get('time') || 16.5) });
    this.lightPool = new LightPool(scene, { size: 8 });

    // ---- maps: code-built or data files ----
    this.campaign = CAMPAIGN;
    this.prefabs = defaultPrefabs();
    this.mapDefs = {
      village: () => buildVillage(this),
      inn: () => this.loadDataMap('inn', `${BASE}maps/inn.tmj`),
    };
    this.maps = {};
    this.map = null;

    // ---- audio (procedural; starts on the first click / key / tap) ----
    this.audio = new AudioEngine();
    this.music = new Music(this.audio);
    this.ambience = new Ambience(this.audio);
    this.sfx = new Sfx(this.audio);
    this.audio.onUnlock(() => {
      this.music.setMood(this.cycle.state.night > 0.5 ? 'night' : 'day');
      this.music.start();
      this.ambience.start();
    });
    this.audio.autoUnlock();

    // ---- camera ----
    this.rig = new CameraRig(camera, { distance: Number(params.get('dist') || 23), pitch: 33, yaw: Number(params.get('yaw') || 0) });

    // ---- UI ----
    this.ui = new UIRoot(container);
    this.dialogue = new DialogueBox(this.ui);
    this._hookDialogue(this.dialogue);
    this.banner = new Banner(this.ui);
    this.prompt = new WorldPrompt(this.ui);
    this.hud = new HUD(this.ui);
    this.events = new EventRunner(this);
    this.emotes = [];
    this.timers = [];
    this.zone = null;
    this.letterbox = 0;
    this.fade = 0;
    this.photoMode = false;
    this.busy = false;
    this.occlusionCutout = true;
    this.statsTimer = 0;
    this._v = new THREE.Vector3();

    // ---- quality ----
    this.quality = new Quality(engine, { sun, lightPool: this.lightPool, lockPixelRatio: params.has('dpr') ? Number(params.get('dpr')) : null });
    this.quality.onChange((level, q, reason) => {
      if (reason === 'auto') this.banner.show('Quality', `Auto-adjusted to ${level}`, 1800);
      this._saveSettings();
    });
    this._applySettings();
    this._sheetCache = {};
  }

  /** Load the first map and show the title. Resolves when the game can run. */
  async init() {
    const p = this.params;
    const firstMap = p.get('map') || 'village';
    const at = p.get('at') ? p.get('at').split(',').map(Number) : null;
    const map = await this.getMap(firstMap);
    const sp = at ? { x: at[0], z: at[1], facing: [0, -1] } : map.spawn('start');
    this.player = new Character(map.world, this.castSheet('hero'), { name: CAST.hero.name, x: sp.x, z: sp.z, speed: 3.4, runSpeed: 6.2 });
    this.engine.scene.add(this.player.root);
    this.player.onStep = (c) => this.sfx.footstep(this.map.surfaceAt(c.position.x, c.position.z), { gain: c.running ? 1.15 : 0.85 });
    await this.enterMap(firstMap, null, sp);
    if (p.has('mute')) this.audio.setMuted(true);

    this.savedGame = this.persist ? this.saves.load() : null;
    if (!p.has('notitle')) {
      this.title = new TitleCard(this.ui, {
        title: 'Hollowbrook', subtitle: 'A tiny HD-2D diorama, painted entirely in code',
        options: this.savedGame ? ['Continue', 'New Journey'] : [],
      });
      this.title.onMove = () => this.sfx.uiMove();
      this.title.el.addEventListener('click', () => { this._clicked = true; });
      this.ui.root.classList.add('has-title');
    } else {
      this._begin(false);
    }
    this._setupGUI();
    if (p.has('stats')) this._toggleStats(true);
    if (p.has('bench')) setTimeout(() => this.runBenchmark(), 500);
    this.engine.addSystem((dt, t, raw) => this.update(dt, t, raw));
  }

  start() {
    this.engine.start();
  }

  /* ------------------------------ maps ------------------------------ */

  /**
   * Tree style for a map: engine default, then the campaign, then the map's
   * own `foliage` (object or JSON string), then debug URL parameters
   * (?canopy=, ?pines=, ?trunks=).
   */
  foliageFor(mapFoliage = null) {
    const p = new URLSearchParams(location.search);
    const debug = { broadleaf: p.get('canopy'), conifer: p.get('pines'), trunks: p.get('trunks') };
    return resolveFoliage(this.campaign.foliage, mapFoliage, debug);
  }

  async loadDataMap(id, url) {
    const data = await loadMapData(url);
    return buildMap(id, data, { prefabs: this.prefabs, game: this });
  }

  async getMap(id) {
    if (!this.mapDefs[id]) throw new Error(`Unknown map "${id}"`);
    if (!this.maps[id]) this.maps[id] = await this.mapDefs[id]();
    return this.maps[id];
  }

  /** Switch maps instantly (use warp() for a faded transition). */
  async enterMap(id, spawnName, at = null) {
    const map = await this.getMap(id);
    if (this.map && this.map !== map) this.map.deactivate(this.lightPool);
    if (this.map !== map) map.activate(this.engine.scene, this.lightPool);
    this.map = map;
    const sp = at || map.spawn(spawnName);
    this.player.setWorld(map.world, sp.x, sp.z);
    if (sp.facing) this.player.facing.set(sp.facing[0], sp.facing[1]);
    const cam = map.env.camera;
    this.rig.follow = this.player;
    this.rig.bounds = cam.bounds;
    this.rig.distanceTarget = Number(this.params.get('dist')) || cam.distance;
    this.rig.pitchTarget = THREE.MathUtils.degToRad(cam.pitch);
    this.rig.snap();
    this.cycle.setIndoor(map.env.indoor);
    this.ambience.outdoor = map.env.indoor ? 0 : 1;
    this.ambience.setSources(map.ambience);
    this.quality.setTargets({ groundCover: map.groundCover, emitters: map.emitters });
    // triggers the player is standing in when arriving don't fire until re-entered
    const px = sp.x, pz = sp.z;
    for (const t of map.world.triggers) {
      t.inside = px >= t.minX && px <= t.maxX && pz >= t.minZ && pz <= t.maxZ && !t.once;
      if (t.once && this.flags.has(this._triggerFlag(t))) t.fired = true;
    }
    this.zone = map.world.zoneAt(px, pz);
    if (map.onEnter) map.onEnter(this);
    return map;
  }

  /** Fade out, change map, autosave, fade in. */
  async warp(id, spawnName) {
    if (this._warping) return;
    this._warping = true;
    this.busy = true;
    this.player.intent.set(0, 0);
    await this.fadeTo(1, 0.45);
    await this.enterMap(id, spawnName);
    this.save();
    await this.wait(0.15);
    await this.fadeTo(0, 0.5);
    const e = this.map.env;
    this.banner.show(e.title, e.subtitle, 2600);
    this.sfx.zone();
    this.busy = false;
    this._warping = false;
  }

  /* ---------------------------- sprites ---------------------------- */

  /** Procedural sheets for the cast (cached). 'cat' gives the cat sheet. */
  castSheet(key) {
    if (!this._sheetCache[key]) this._sheetCache[key] = key === 'cat' ? makeCatSheet() : makeCharacterSheet(CAST[key].look);
    return this._sheetCache[key];
  }

  /** Sheet spec from map data: "cast:<key>" (generated) or a file path (PNG grid or Aseprite JSON). */
  async resolveSheet(spec = 'cast:traveler') {
    if (spec.startsWith('cast:')) return this.castSheet(spec.slice(5));
    if (!this._sheetCache[spec]) this._sheetCache[spec] = await loadSpriteSheet(/^(https?:)?\//.test(spec) ? spec : `${BASE}${spec}`);
    return this._sheetCache[spec];
  }

  /* ------------------------- events & helpers ------------------------- */

  runScript(script, ctx = {}) {
    return this.events.run(script, ctx);
  }

  findScript(name) {
    return (this.map && this.map.scripts[name]) || null;
  }

  /** Resolve an actor name for event scripts. */
  actor(name, ctx = {}, quiet = false) {
    if (name === 'player') return this.player;
    if (name === 'self') return ctx.self || null;
    const npc = this.map.findNpc(name);
    if (!npc && !quiet) console.warn(`Event: no actor "${name}"`);
    return npc ? npc.char : null;
  }

  /** Resolve a point: [x, z], an actor name, or a spawn name. */
  point(spec, ctx = {}) {
    if (Array.isArray(spec)) return spec;
    const a = this.actor(spec, ctx, true);
    if (a) return [a.position.x, a.position.z];
    const sp = this.map.spawns[spec];
    if (sp) return [sp.x, sp.z];
    console.warn(`Event: unknown point "${spec}"`);
    return [this.player.position.x, this.player.position.z];
  }

  nav() {
    return this.map.getNav();
  }

  /** Promise that resolves after `s` seconds of game time. */
  wait(s) {
    return new Promise((resolve) => this.timers.push({ t: s, resolve }));
  }

  emote(char, icon = '!', s = 1.2) {
    if (!char) return Promise.resolve();
    return new Promise((resolve) => {
      const e = new Emote(this.engine.scene, char, icon, { duration: s, height: char === this.player ? 2.0 : 2.1 });
      e.resolve = resolve;
      this.emotes.push(e);
      this.sfx.uiOpen();
    });
  }

  cameraReset() {
    this.rig.follow = this.player;
    this.rig.distanceTarget = this.map.env.camera.distance;
  }

  fadeTo(to, seconds) {
    return new Promise((resolve) => {
      if (this._fadeTween) this._fadeTween.resolve();
      this._fadeTween = { from: this.fade, to, t: 0, dur: seconds, resolve };
    });
  }

  async rest(hour) {
    this.busy = true;
    this._resting = true;
    this.sfx.rest();
    await this.fadeTo(0.75, 0.8);
    this.cycle.transitionTo(hour, 3.2);
    await this.wait(3.3);
    await this.fadeTo(0, 1.0);
    this._resting = false;
    this.busy = false;
    this.banner.show(this.cycle.state.name, `${this.cycle.hourLabel}`, 2600);
  }

  _triggerFlag(t) {
    return `seen:${this.map.id}:${t.name}`;
  }

  /* --------------------------- saving --------------------------- */

  save() {
    if (!this.persist || !this.player) return false;
    const p = this.player;
    return this.saves.save({
      map: this.map.id, x: p.position.x, z: p.position.z, fx: p.facing.x, fz: p.facing.y,
      time: this.cycle.time, flags: [...this.flags],
    });
  }

  async loadSave(s) {
    this.flags = new Set(s.flags || []);
    this.cycle.time = s.time ?? this.cycle.time;
    await this.enterMap(s.map, null, { x: s.x, z: s.z, facing: [s.fx ?? 0, s.fz ?? 1] });
  }

  _saveSettings() {
    if (!this.persist || this._loadingSettings) return;
    this.saves.saveSettings({
      quality: this.quality.auto ? 'auto' : this.quality.level,
      volumes: this.audio.volumes, muted: this.audio.muted,
    });
  }

  _applySettings() {
    this._loadingSettings = true;
    const s = this.persist ? this.saves.loadSettings() : {};
    const qParam = this.params.get('quality');
    const q = QUALITY_LEVELS.includes(qParam) ? qParam : s.quality || 'auto';
    this.quality.set(q === 'auto' ? 'high' : q, { auto: q === 'auto' });
    if (s.volumes) for (const [k, v] of Object.entries(s.volumes)) this.audio.volumes[k] = v;
    if (s.muted) this.audio.muted = true;
    this._loadingSettings = false;
  }

  /* ---------------------------- start ---------------------------- */

  async _startFromTitle(choice) {
    this.title.dismiss();
    this.title = null;
    this.ui.root.classList.remove('has-title');
    this.audio.unlock();
    this.sfx.uiConfirm();
    if (this.savedGame && choice === 0) {
      this.busy = true;
      await this.fadeTo(1, 0.4);
      await this.loadSave(this.savedGame);
      await this.fadeTo(0, 0.6);
      this.busy = false;
      this.banner.show(this.map.env.title, this.map.env.subtitle, 3200);
      return;
    }
    this.flags.clear();
    this._begin(true);
  }

  _begin(intro = true) {
    if (intro) this.rig.intro({ duration: 5 });
    const e = this.map.env;
    setTimeout(() => this.banner.show(e.title, e.subtitle, 4200), intro ? 1800 : 300);
  }

  _hookDialogue(dlg) {
    let chars = 0;
    this._voice = 1;
    dlg.onLine = (line) => {
      this.sfx.uiOpen();
      chars = 0;
      const npc = this.map && this.map.findNpc(line.speaker);
      this._voice = VOICES[line.speaker || ''] ?? (npc && npc.voice) ?? 1;
    };
    dlg.onChar = (ch) => { if (!/\s/.test(ch) && chars++ % 2 === 0) this.sfx.voice(this._voice); };
    dlg.onMove = () => this.sfx.uiMove();
    dlg.onPick = () => this.sfx.uiConfirm();
  }

  /* ------------------------------ GUI ------------------------------ */

  _setupGUI() {
    const gui = new GUI({ title: 'HD-2D Engine' });
    this.gui = gui;
    const post = this.engine.post;
    const cyc = this.cycle;

    const pf = gui.addFolder('Performance');
    const q = this.quality;
    const perf = {
      get preset() { return q.auto ? 'auto' : q.level; },
      set preset(v) { if (v === 'auto') q.set('high', { auto: true }); else q.set(v, { auto: false }); },
      stats: false,
      benchmark: () => this.runBenchmark(),
    };
    pf.add(perf, 'preset', ['auto', ...QUALITY_LEVELS]).name('quality').listen();
    pf.add(q, 'level').name('active level').disable().listen();
    this._statsCtl = pf.add(perf, 'stats').name('show stats (I)').onChange((v) => this._toggleStats(v));
    pf.add(perf, 'benchmark').name('run benchmark');

    const wf = gui.addFolder('World');
    const world = {
      get map() { return this._g.map ? this._g.map.id : ''; },
      set map(v) { this._g.warp(v, v === 'village' ? 'innDoor' : 'entrance'); },
      _g: this,
      saveNow: () => this.banner.show(this.save() ? 'Saved' : 'Saving unavailable', '', 1200),
      deleteSave: () => { this.saves.clear(); this.banner.show('Save deleted', '', 1200); },
    };
    wf.add(world, 'map', Object.keys(this.mapDefs)).name('go to map').listen();
    wf.add(world, 'saveNow').name('save now');
    wf.add(world, 'deleteSave').name('delete save');

    const tf = gui.addFolder('Time of day');
    tf.add(cyc, 'time', 0, 24, 0.01).name('hour').listen();
    tf.add(cyc, 'speed', 0, 2, 0.01).name('hours / second');
    const presets = {};
    for (const [name, h] of TIME_PRESETS) presets[name] = () => cyc.transitionTo(h, 2.5);
    for (const [name] of TIME_PRESETS) tf.add(presets, name);

    const af = gui.addFolder('Audio');
    const au = this.audio;
    const vol = (name) => ({ get v() { return au.volumes[name]; }, set v(x) { au.setVolume(name, x); } });
    for (const name of ['master', 'music', 'ambience', 'sfx']) af.add(vol(name), 'v', 0, 1, 0.01).name(name).onFinishChange(() => this._saveSettings());
    af.add({ get muted() { return au.muted; }, set muted(m) { au.unlock(); au.setMuted(m); } }, 'muted').name('mute (M)').listen().onChange(() => this._saveSettings());

    const cf = gui.addFolder('Camera');
    const rig = this.rig;
    const camProxy = {
      get distance() { return rig.distanceTarget; }, set distance(v) { rig.distanceTarget = v; },
      get pitch() { return THREE.MathUtils.radToDeg(rig.pitchTarget); }, set pitch(v) { rig.pitchTarget = THREE.MathUtils.degToRad(v); },
      get yaw() { return THREE.MathUtils.radToDeg(rig.yawTarget); }, set yaw(v) { rig.yawTarget = THREE.MathUtils.degToRad(v); },
      get fov() { return rig.camera.fov; }, set fov(v) { rig.camera.fov = v; rig.camera.updateProjectionMatrix(); },
    };
    cf.add(camProxy, 'distance', 12, 40, 0.1).listen();
    cf.add(camProxy, 'pitch', 15, 70, 0.5);
    cf.add(camProxy, 'yaw', -90, 90, 0.5).listen();
    cf.add(camProxy, 'fov', 15, 60, 0.5);

    const df = gui.addFolder('Depth of field / tilt-shift');
    df.add(post.dof, 'enabled');
    df.add(post.dof, 'maxBlur', 0, 0.03, 0.001).name('max blur');
    df.add(post.dof, 'focusRange', 0, 8, 0.1).name('in-focus range');
    df.add(post.dof, 'nearRange', 0.5, 15, 0.1).name('near falloff');
    df.add(post.dof, 'farRange', 0.5, 30, 0.1).name('far falloff');
    df.add(post.dof, 'tiltStrength', 0, 1, 0.01).name('tilt-shift');
    df.add(post.dof, 'tiltWidth', 0, 0.5, 0.01).name('tilt band');

    const bf = gui.addFolder('Bloom');
    bf.add(post.bloom, 'enabled');
    bf.add(post.bloom, 'strengthBias', 0, 3, 0.01).name('strength');
    bf.add(post.bloom, 'radius', 0, 1, 0.01);
    bf.add(post.bloom, 'threshold', 0, 2, 0.01);

    const gf = gui.addFolder('Colour grade');
    gf.add(post.grade, 'enabled');
    gf.add(post.grade, 'exposureBias', 0.3, 2.5, 0.01).name('exposure');
    gf.add(post.grade, 'saturationBias', 0, 2, 0.01).name('saturation');
    gf.add(post.grade, 'vignette', 0, 1, 0.01);
    gf.add(post.grade, 'liftAmount', 0, 0.2, 0.005).name('shadow tint');
    gf.add(post.grade, 'chroma', 0, 3, 0.01).name('chromatic');
    gf.add(post.grade, 'grain', 0, 0.15, 0.001);

    const rf = gui.addFolder('Rendering');
    rf.add(post, 'renderScale', 0.25, 1, 0.05).name('render scale').listen().onChange((v) => { post.setRenderScale(v, post.pixelate); this.engine.resize(); });
    rf.add(post, 'pixelate').name('nearest upscale').onChange((v) => { post.setRenderScale(post.renderScale, v); this.engine.resize(); });
    rf.add(this.sun, 'castShadow').name('sun shadows');
    rf.add(globalUniforms.uWindStrength, 'value', 0, 4, 0.01).name('wind');
    rf.add(post, 'enabled').name('post-processing');
    rf.add(this, 'occlusionCutout').name('see-through occluders');

    for (const f of [pf, wf, af, cf, df, bf, gf, rf]) f.close();
    gui.close();
    this._guiHidden = this.params.has('nogui');
    if (this._guiHidden) gui.hide();
  }

  _toggleStats(on) {
    this.hud.showStats(on);
    this.statsTimer = 0;
    if (this._statsCtl && this._statsCtl.getValue() !== on) this._statsCtl.setValue(on);
  }

  /**
   * Fly the player along a fixed village route at dusk (lamps on, god rays
   * on) and time every quality preset on the same frames.
   */
  async runBenchmark() {
    if (this._benchmarking) return;
    this._benchmarking = true;
    if (this.title && this.title.open) { this.title.dismiss(); this.title = null; this.ui.root.classList.remove('has-title'); }
    if (this.map.id !== 'village') await this.warp('village', 'start');
    this.busy = true;
    const saved = { time: this.cycle.time, speed: this.cycle.speed, pos: this.player.position.clone() };
    this.gui.close();
    const route = this.map.benchmarkRoute;
    const lens = route.slice(1).map((p, i) => Math.hypot(p[0] - route[i][0], p[1] - route[i][1]));
    const total = lens.reduce((a, b) => a + b, 0);
    const box = document.createElement('div');
    box.className = 'hd-bench';
    this.ui.root.appendChild(box);
    const results = await runBenchmark(this.engine, this.quality, {
      warmup: 1.5,
      duration: 5,
      drive: (t) => {
        this.cycle.time = 19.0;
        this.cycle.speed = 0;
        let dist = (Math.max(0, t - 1.5) / 5) * total;
        let i = 0;
        while (i < lens.length - 1 && dist > lens[i]) { dist -= lens[i]; i++; }
        const a = route[i], b = route[i + 1], f = Math.min(1, dist / lens[i]);
        const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f;
        this.player.position.set(x, this.map.world.groundAt(x, z), z);
        this.player.facing.set(b[0] - a[0], b[1] - a[1]).normalize();
        if (t < 0.05) this.rig.snap();
      },
      onProgress: (text) => { if (text) box.innerHTML = `<h3>Benchmark</h3><p>${text}</p>`; },
    });
    this.cycle.time = saved.time;
    this.cycle.speed = saved.speed;
    this.player.position.copy(saved.pos);
    this.rig.snap();
    this.busy = false;
    this._benchmarking = false;
    this.benchmarkResults = results;
    console.table(results);
    const rows = results.map((r) => `<tr><td>${r.level}</td><td>${r.fps}</td><td>${r.low1}</td><td>${r.frameMs}</td><td>${r.cpuMs}</td><td>${r.drawCalls}</td></tr>`).join('');
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    box.innerHTML = `<h3>Benchmark results</h3>
      <p>${innerWidth}×${innerHeight} at up to ${pr}× pixel ratio · 5 s per preset at dusk</p>
      <table><tr><th>preset</th><th>avg fps</th><th>1% low</th><th>frame ms</th><th>cpu ms</th><th>draw calls</th></tr>${rows}</table>
      <button type="button">Close</button>`;
    box.querySelector('button').addEventListener('click', () => box.remove());
    return results;
  }

  /* ----------------------------- frame ----------------------------- */

  _findTarget() {
    const p = this.player.position;
    const f = this.player.facing;
    let best = null, bestScore = Infinity;
    const consider = (obj, pos, range, label) => {
      const dx = pos.x - p.x, dz = pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range) return;
      const facing = d > 1e-3 ? (dx * f.x + dz * f.y) / d : 1;
      if (facing < -0.1 && d > 1.0) return;
      const score = d - facing * 0.6;
      if (score < bestScore) { bestScore = score; best = { obj, pos, label }; }
    };
    for (const n of this.map.npcs) consider(n, n.char.position, 1.7, 'Talk');
    for (const it of this.map.world.interactables) consider(it, it.pos, it.range, it.label);
    return best;
  }

  async _interact(target) {
    this.busy = true;
    this.prompt.hide();
    this.ui.root.classList.add('is-talking');
    const o = target.obj;
    try {
      if (o.char) {
        const c = o.char;
        if (o.behaviour) o.behaviour.enabled = false;
        c.cancelPath();
        c.faceToward(this.player.position.x, this.player.position.z);
        this.player.faceToward(c.position.x, c.position.z);
        if (o.script) await this.runScript(o.script, { self: c, npc: o });
        else if (o.talk) await o.talk(o);
        else await this.dialogue.say(o.lines.map((text) => ({ speaker: o.speaker ?? o.name, text })));
        if (o.behaviour) o.behaviour.enabled = true;
        if (o.idleFacing) c.facing.set(o.idleFacing[0], o.idleFacing[1]);
      } else {
        this.player.faceToward(o.pos.x, o.pos.z);
        await o.fn();
      }
    } finally {
      this.ui.root.classList.remove('is-talking');
      this.busy = false;
    }
  }

  _checkTriggers() {
    const p = this.player.position;
    for (const t of this.map.world.triggers) {
      const inside = p.x >= t.minX && p.x <= t.maxX && p.z >= t.minZ && p.z <= t.maxZ;
      const entered = inside && !t.inside;
      const fire = t.once ? inside && !t.fired : entered;
      t.inside = inside;
      if (!fire) continue;
      t.fired = true;
      if (t.once) this.flags.add(this._triggerFlag(t));
      this.player.intent.set(0, 0);
      t.fire(t);
      return; // one trigger per frame
    }
  }

  update(dt, t, rawDt) {
    const input = this.input;
    const post = this.engine.post;
    const map = this.map;

    if (this.title && this.title.open) {
      const pick = this.title.update(input, this._clicked);
      if (pick >= 0) this._startFromTitle(pick);
    }
    this._clicked = false;

    // timers (event waits) run on game time
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) { this.timers.splice(i, 1); tm.resolve(); }
    }

    // ---- player control ----
    const titleOpen = !!(this.title && this.title.open);
    const locked = this.dialogue.active || this.busy || this.events.busy || titleOpen;
    const p = this.player;
    if (!locked) {
      const a = input.axis();
      const yaw = this.rig.yaw;
      const mx = a.x, mz = -a.y;
      p.intent.set(Math.cos(yaw) * mx + Math.sin(yaw) * mz, -Math.sin(yaw) * mx + Math.cos(yaw) * mz);
      p.running = input.isDown('ShiftLeft', 'ShiftRight') || Math.hypot(input.touchVec.x, input.touchVec.y) > 0.92;
      const target = this._findTarget();
      if (target) {
        const pos = target.obj.char ? target.obj.char.position : target.pos;
        this._v.copy(pos).setY(pos.y + (target.obj.char ? 2.0 : 1.6));
        this.prompt.show(target.label, this._v, this.engine.camera, this.engine.renderer);
        if (input.pressed('Space', 'Enter', 'KeyF', 'Tap')) this._interact(target);
      } else {
        this.prompt.hide();
      }
    } else if (!p.walking) {
      p.intent.set(0, 0);
      this.prompt.hide();
    } else {
      this.prompt.hide();
    }
    this.dialogue.update(rawDt, input);
    // the speaker's mouth moves while their line is being typed out
    const dl = this.dialogue;
    const speaking = dl.active && dl._line && dl._shown < dl._full.length ? dl._line.speaker : null;
    p.talking = !!speaking && speaking === p.name;
    for (const n of map.npcs) n.char.talking = !!speaking && speaking === n.name;
    this.ui.root.classList.toggle('is-cutscene', this.events.busy);

    // ---- camera & global toggles ----
    if (input.pressed('KeyQ')) this.rig.orbit(-30);
    if (input.pressed('KeyE')) this.rig.orbit(30);
    if (input.pressed('KeyR')) this.rig.yawTarget = 0;
    const wheel = input.consumeWheel();
    if (wheel) this.rig.zoom(wheel);
    if (input.pressed('KeyT') && !locked) {
      const idx = TIME_PRESETS.findIndex(([, h]) => h > this.cycle.time + 0.05);
      const [name, h] = TIME_PRESETS[idx < 0 ? 0 : idx];
      this.cycle.transitionTo(h, 2.5);
      this.banner.show(name, '', 1800);
    }
    if (input.pressed('KeyP')) {
      this.photoMode = !this.photoMode;
      this.ui.root.classList.toggle('is-hidden', this.photoMode);
      this.gui.domElement.style.display = this.photoMode ? 'none' : '';
    }
    if (input.pressed('KeyG')) {
      this._guiHidden = !this._guiHidden;
      this.gui.show(!this._guiHidden);
    }
    if (input.pressed('KeyI')) this._toggleStats(!this.hud.statsVisible);
    if (input.pressed('KeyM')) {
      this.audio.unlock();
      this.audio.setMuted(!this.audio.muted);
      this.banner.show(this.audio.muted ? 'Sound off' : 'Sound on', '', 1200);
      this._saveSettings();
    }
    this.quality.update(this.engine.frameTime / 1000);

    // ---- simulation ----
    for (const n of map.npcs) {
      if (n.behaviour && !locked) n.behaviour.update(dt);
      n.char.update(dt, this.rig.yaw);
    }
    p.update(dt, this.rig.yaw);
    for (let i = this.emotes.length - 1; i >= 0; i--) {
      if (!this.emotes[i].update(rawDt)) { this.emotes[i].resolve(); this.emotes.splice(i, 1); }
    }
    if (!locked && !this.rig.scripted && !this.dialogue.active) this._checkTriggers();
    const v = p.velocity;
    this.rig.lookAhead.x = damp(this.rig.lookAhead.x, v.x * 0.35, 2.5, dt);
    this.rig.lookAhead.z = damp(this.rig.lookAhead.z, v.z * 0.35, 2.5, dt);
    this.rig.update(rawDt);

    this.cycle.focus.copy(p.position);
    this.cycle.update(dt);
    const s = this.cycle.state;
    this.lightPool.focus.copy(p.position);
    map.update(dt, t, s, { yaw: this.rig.yaw, player: p, camera: this.engine.camera });
    this.lightPool.update(dt);
    // shared glowing materials follow the clock
    const night = s.night;
    const lantern = propMaterials.lantern;
    lantern.color.copy(lantern.userData.baseColor).multiplyScalar(0.35 + 1.5 * Math.min(1, night * 1.6));
    propMaterials.window.emissiveIntensity = 2.4 * Math.min(1, night * 1.4);
    propMaterials.windowDay.emissiveIntensity = 1.4 * Math.max(0.05, 1 - night * 1.2);

    // ---- autofocus + tilt band follow the player ----
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    const focusOn = this.rig.follow || p;
    this._v.copy(focusOn.position).setY(focusOn.position.y + 0.8).applyMatrix4(cam.matrixWorldInverse);
    post.dof.focusDistance = -this._v.z;
    this._v.copy(p.position).setY(p.position.y + 0.8).project(cam);
    post.dof.tiltCenter = damp(post.dof.tiltCenter, this._v.y * 0.5 + 0.5, 4, rawDt);
    const cu = globalUniforms;
    cu.uCutCenter.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
    cu.uCutDist.value = cam.position.distanceTo(this._v.copy(p.position).setY(p.position.y + 0.8));
    cu.uCutY.value = p.position.y;
    cu.uCutStrength.value = this.occlusionCutout ? 1 : 0;

    // ---- cinematic letterbox & fades ----
    this.letterbox = damp(this.letterbox, this.dialogue.active || this.events.busy ? 0.075 : 0, 6, rawDt);
    post.grade.letterbox = this.letterbox;
    if (this._fadeTween) {
      const f = this._fadeTween;
      f.t = Math.min(1, f.t + rawDt / f.dur);
      this.fade = f.from + (f.to - f.from) * f.t;
      if (f.t >= 1) { this._fadeTween = null; f.resolve(); }
    }
    post.grade.fade = titleOpen ? 0 : this.fade;

    // ---- zone banners ----
    if (!titleOpen && !this._warping) {
      const z = map.world.zoneAt(p.position.x, p.position.z);
      if (z && z !== this.zone && !this.dialogue.active) {
        this.banner.show(z.name, z.subtitle);
        this.sfx.zone();
      }
      this.zone = z;
    }

    // ---- audio ----
    const L = this.audio.listener;
    L.x = p.position.x;
    L.z = p.position.z;
    L.yaw = this.rig.yaw;
    if (s.night > 0.55) this.music.setMood('night');
    else if (s.night < 0.35) this.music.setMood('day');
    this.audio.setDuck(this._resting ? 0.3 : this.dialogue.active ? 0.6 : map.env.indoor ? 0.8 : 1);
    this.ambience.windBase = p.position.y > 2 ? 0.09 : 0.05;
    this.music.update();
    this.ambience.update(dt, { night: s.night });

    // ---- HUD ----
    this.hud.setTime(this.cycle.hourLabel, s.name, s.night);
    this.hud.setFps(this.engine.fps);
    this.statsTimer -= rawDt;
    if (this.hud.statsVisible && this.statsTimer <= 0) {
      this.statsTimer = 0.25;
      const e = this.engine, st = e.stats, post2 = e.post;
      this.hud.setStats([
        `${e.fps} fps · ${e.frameTime.toFixed(1)} ms`,
        `cpu ${st.cpuMs.toFixed(1)} ms`,
        `draw calls ${st.calls} · tris ${(st.triangles / 1000).toFixed(0)}k`,
        `point lights ${this.lightPool.activeCount}/${this.lightPool.size + 1}`,
        `${post2.internalWidth}×${post2.internalHeight} · ${this.quality.level}${this.quality.auto ? ' (auto)' : ''}`,
        `map ${map.id}`,
      ]);
    }

    input.endFrame();
  }
}
