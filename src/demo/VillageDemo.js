import * as THREE from 'three';
import GUI from 'lil-gui';
import { Engine } from '../engine/Engine.js';
import { Input } from '../engine/input/Input.js';
import { CameraRig } from '../engine/camera/CameraRig.js';
import { DayNightCycle } from '../engine/lighting/DayNightCycle.js';
import { Character } from '../engine/entities/Character.js';
import { Wander, Patrol } from '../engine/entities/Behaviours.js';
import { makeCharacterSheet, makeCatSheet } from '../engine/pixel/CharacterFactory.js';
import { World } from '../engine/world/World.js';
import { UIRoot, DialogueBox, Banner, WorldPrompt, HUD, TitleCard } from '../engine/ui/UI.js';
import { globalUniforms } from '../engine/render/MaterialPatch.js';
import { damp } from '../engine/core/Random.js';
import { createVillageMap, POI } from './VillageMap.js';
import { decorateVillage } from './VillageDecor.js';
import { CAST } from './cast.js';

const TIME_PRESETS = [
  ['Dawn', 6.4], ['Morning', 9], ['Noon', 13], ['Golden Hour', 16.5], ['Dusk', 18.6], ['Night', 22],
];

const ZONES = [
  ['The Old Shrine', 'Where the pines keep their silence', 8, 0, 27, 9.6],
  ['Mirrormere', 'A lake that remembers the sky', 26, 9.6, 48, 23.5],
  ['Hollowbrook Square', 'Heart of the village', 15.5, 18.5, 28.5, 31.5],
  ['Ember Hollow', 'A fire that never quite goes out', 24, 32.5, 31.5, 40],
  ['Southern Meadow', 'Wildflowers as far as the fence', 1, 32.5, 20, 46],
  ['Eastern Fields', 'Beyond the old bridge', 45.5, 18, 56, 46],
];

/**
 * The demo game: Hollowbrook village. Wires the engine together and adds
 * the bits of gameplay that show it off — NPC chatter, a save crystal,
 * resting at a campfire to time-lapse the day, location banners.
 */
export class VillageDemo {
  constructor(container) {
    const params = new URLSearchParams(location.search);
    this.params = params;
    const engine = new Engine({ container, maxPixelRatio: Number(params.get('dpr') || 1.5) });
    this.engine = engine;
    const { scene, camera, post } = engine;
    this.input = new Input(engine.renderer.domElement);

    // ---- world ----
    this.map = createVillageMap();
    this.world = new World(this.map);

    // ---- lighting ----
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

    this.decor = decorateVillage(scene, this.map, this.world);

    // ---- characters ----
    const start = params.get('at') ? params.get('at').split(',').map(Number) : POI.start;
    this.player = new Character(this.world, makeCharacterSheet(CAST.hero.look), { name: CAST.hero.name, x: start[0], z: start[1], speed: 3.4, runSpeed: 6.2 });
    this.player.facing.set(0, -1);
    scene.add(this.player.root);
    this.npcs = [];
    this._spawnNPCs();

    // ---- camera ----
    this.rig = new CameraRig(camera, { distance: Number(params.get('dist') || 23), pitch: 33, yaw: Number(params.get('yaw') || 0) });
    this.rig.follow = this.player;
    this.rig.bounds = { minX: 13, maxX: 43, minZ: 9.5, maxZ: 36 };
    this.rig.snap();

    // ---- UI ----
    this.ui = new UIRoot(container);
    this.dialogue = new DialogueBox(this.ui);
    this.banner = new Banner(this.ui);
    this.prompt = new WorldPrompt(this.ui);
    this.hud = new HUD(this.ui);
    this.title = params.has('notitle') ? null : new TitleCard(this.ui, { title: 'Hollowbrook', subtitle: 'A tiny HD-2D diorama, painted entirely in code' });
    if (this.title) {
      this.title.el.addEventListener('click', () => { this._clicked = true; });
      this.ui.root.classList.add('has-title');
    }
    for (const [name, sub, x0, z0, x1, z1] of ZONES) this.world.addZone(name, x0, z0, x1, z1, { subtitle: sub });
    this.zone = null;
    this.letterbox = 0;
    this.fade = 0;
    this.photoMode = false;
    this.busy = false;
    this.occlusionCutout = true;
    this._v = new THREE.Vector3();

    this._setupInteractables();
    this._setupGUI();

    engine.addSystem((dt, t, raw) => this.update(dt, t, raw));
    if (!this.title) this._begin(false);
  }

  start() {
    this.engine.start();
  }

  /* ------------------------------------------------------------------ */

  _spawnNPCs() {
    const add = (key, x, z, o = {}) => {
      const def = CAST[key];
      const c = new Character(this.world, makeCharacterSheet(def.look), { name: def.name, x, z, speed: o.speed || 1.8 });
      if (o.facing) c.facing.set(o.facing[0], o.facing[1]);
      this.engine.scene.add(c.root);
      const npc = { char: c, name: def.name, lines: o.lines, talk: o.talk, behaviour: o.behaviour ? o.behaviour(c) : null, idleFacing: o.facing || null };
      this.npcs.push(npc);
      return npc;
    };
    add('elder', 20.2, 23.4, {
      behaviour: (c) => new Wander(c, { radius: 1.4, speed: 0.5, pause: [3, 7] }),
      lines: [
        'Ah, a traveller. Welcome to Hollowbrook.',
        'That crystal has stood in our square longer than the oldest roof. Lay a hand on it and it will remember you.',
        'Stay until the sun goes down. The lanterns wake one by one, and the lake turns to gold.',
      ],
    });
    add('merchant', POI.stall[0], POI.stall[1] - 0.15, {
      facing: [0, 1],
      talk: async (npc) => {
        const pick = await this.dialogue.choose(npc.name, 'Fresh from the orchard! What will it be?', ['A red apple', 'Honey bread', 'Just looking']);
        const replies = [
          'One apple, polished on my apron. No charge for first visitors!',
          "Still warm from the oven. Mind the crumbs on that scarf of yours.",
          'Look all you like. The light is lovely on the cobbles this time of day.',
        ];
        await this.dialogue.say({ speaker: npc.name, text: replies[pick] });
      },
    });
    add('guard', 21.2, 40.6, {
      behaviour: (c) => new Patrol(c, [[19.6, 40.6], [24.4, 40.6]], { speed: 0.55, pause: 2.5 }),
      lines: [
        'Halt! State your business... ha, only teasing. The roads have been quiet for weeks.',
        'Heading north? Take the stone stairs by the inn. The shrine is something else when the light falls through the pines.',
      ],
    });
    add('child', 25.5, 30.2, {
      speed: 2.6,
      behaviour: (c) => new Wander(c, { radius: 3.5, speed: 0.9, pause: [0.5, 2] }),
      lines: [
        "Bet you can't catch me!",
        "...Okay, you can't catch me because I'm taking a break. Did you know the waterfall never stops? I counted all the way to ninety.",
      ],
    });
    add('fisher', 31.0, 14.3, {
      facing: [0, -1],
      lines: [
        'Shh. The fish are listening.',
        'At dusk the whole lake turns to copper. At night the lamps lay little golden roads across it. You should see it.',
      ],
    });
    add('pilgrim', 15.6, 6.8, {
      behaviour: (c) => new Wander(c, { radius: 1.2, speed: 0.4, pause: [4, 8] }),
      lines: [
        'Listen. Even the pines are breathing up here.',
        'If you want to watch the hours turn, rest by the campfire in the hollow below the square.',
      ],
    });
    // the village cat
    const catSheet = makeCatSheet();
    const cat = new Character(this.world, catSheet, { name: 'Biscuit', x: 36.5, z: 29.6, speed: 1.4, radius: 0.22 });
    this.engine.scene.add(cat.root);
    this.npcs.push({
      char: cat, name: 'Biscuit', behaviour: new Wander(cat, { radius: 2.8, speed: 0.6, pause: [2, 6] }),
      lines: ['Mrrp.', 'The cat regards you with deep, unblinking judgement.'], speaker: '',
    });
  }

  _setupInteractables() {
    const d = this.decor;
    const it = (name, pos, label, fn, range = 1.9) => this.world.addInteractable({ name, pos, label, fn, range });
    it('crystal', new THREE.Vector3(POI.crystal[0], 0.5, POI.crystal[1]), 'Touch', async () => {
      const c = d.crystal;
      c.heal.emitter.copy(c.mesh.position).setY(0.6);
      c.heal.burst(80);
      c.flash = 1;
      await this.dialogue.say([
        { speaker: '', text: 'The crystal hums, cool and bright beneath your palm.' },
        { speaker: '', text: 'Your journey has been recorded.' },
      ]);
    }, 2.1);
    it('campfire', d.campfire, 'Rest', async () => {
      const pick = await this.dialogue.choose('', 'The fire crackles warmly. Rest a while?', ['Rest until morning', 'Rest until golden hour', 'Rest until nightfall', 'Stay a moment longer']);
      const hours = [7.5, 16.5, 21.8];
      if (pick < 3) await this._rest(hours[pick]);
    }, 2.2);
    it('well', d.well, 'Examine', () => this.dialogue.say({ speaker: '', text: 'Far below, the water catches a sliver of sky. Something glints at the bottom... just a copper coin.' }), 1.9);
    it('sign', d.sign, 'Read', () => this.dialogue.say({ speaker: '', text: 'HOLLOWBROOK\nNorth: the Old Shrine  ·  East: Mirrormere Bridge' }), 1.4);
    it('shrine', d.shrine, 'Pray', () => this.dialogue.say({ speaker: '', text: 'You bow your head. Somewhere above, a bird answers.' }), 1.8);
  }

  async _rest(hour) {
    this.busy = true;
    await this._tweenFade(0.75, 0.8);
    this.cycle.transitionTo(hour, 3.2);
    await new Promise((r) => setTimeout(r, 3300));
    await this._tweenFade(0, 1.0);
    this.busy = false;
    this.banner.show(this.cycle.state.name, `${this.cycle.hourLabel}`, 2600);
  }

  _tweenFade(to, seconds) {
    return new Promise((resolve) => {
      this._fadeTween = { from: this.fade, to, t: 0, dur: seconds, resolve };
    });
  }

  _begin(intro = true) {
    if (intro) this.rig.intro({ duration: 5 });
    setTimeout(() => this.banner.show('Hollowbrook', 'A quiet village at the edge of the wood', 4200), intro ? 1800 : 300);
    this.zone = this.world.zoneAt(this.player.position.x, this.player.position.z);
  }

  /* ------------------------------------------------------------------ */

  _setupGUI() {
    const gui = new GUI({ title: 'HD-2D Engine' });
    this.gui = gui;
    const post = this.engine.post;
    const cyc = this.cycle;
    const tf = gui.addFolder('Time of day');
    tf.add(cyc, 'time', 0, 24, 0.01).name('hour').listen();
    tf.add(cyc, 'speed', 0, 2, 0.01).name('hours / second');
    const presets = {};
    for (const [name, h] of TIME_PRESETS) presets[name] = () => cyc.transitionTo(h, 2.5);
    for (const [name] of TIME_PRESETS) tf.add(presets, name);

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
    const r = { renderScale: post.renderScale, pixelate: post.pixelate, shadows: true, cloudShadows: 1, wind: 1, postFX: true };
    rf.add(r, 'renderScale', 0.25, 1, 0.05).name('render scale').onChange((v) => { post.setRenderScale(v, r.pixelate); this.engine.resize(); });
    rf.add(r, 'pixelate').name('nearest upscale').onChange((v) => { post.setRenderScale(r.renderScale, v); this.engine.resize(); });
    rf.add(r, 'shadows').onChange((v) => { this.sun.castShadow = v; });
    rf.add(globalUniforms.uWindStrength, 'value', 0, 4, 0.01).name('wind');
    rf.add(post, 'enabled').name('post-processing');
    rf.add(this, 'occlusionCutout').name('see-through occluders');

    for (const f of [cf, df, bf, gf, rf]) f.close();
    gui.close();
    this._guiHidden = this.params.has('nogui');
    if (this._guiHidden) gui.hide();
  }

  /* ------------------------------------------------------------------ */

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
    for (const n of this.npcs) consider(n, n.char.position, 1.7, 'Talk');
    for (const it of this.world.interactables) consider(it, it.pos, it.range, it.label);
    return best;
  }

  async _interact(target) {
    this.busy = true;
    this.prompt.hide();
    this.ui.root.classList.add('is-talking');
    const o = target.obj;
    if (o.char) {
      const c = o.char;
      if (o.behaviour) o.behaviour.enabled = false;
      c.intent.set(0, 0);
      c.faceToward(this.player.position.x, this.player.position.z);
      this.player.faceToward(c.position.x, c.position.z);
      if (o.talk) await o.talk(o);
      else await this.dialogue.say(o.lines.map((text) => ({ speaker: o.speaker ?? o.name, text })));
      if (o.behaviour) o.behaviour.enabled = true;
      if (o.idleFacing) c.facing.set(o.idleFacing[0], o.idleFacing[1]);
    } else {
      this.player.faceToward(o.pos.x, o.pos.z);
      await o.fn();
    }
    this.ui.root.classList.remove('is-talking');
    this.busy = false;
  }

  update(dt, t, rawDt) {
    const input = this.input;
    const post = this.engine.post;

    if (this.title && this.title.open) {
      if (input.pressed('Enter', 'Space', 'Tap', 'KeyE') || this._clicked) {
        this.title.dismiss();
        this.ui.root.classList.remove('has-title');
        this._begin(true);
      }
    }
    this._clicked = false;

    // ---- player control ----
    const talking = this.dialogue.active || this.busy || (this.title && this.title.open);
    const p = this.player;
    if (!talking) {
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
    } else {
      p.intent.set(0, 0);
      this.prompt.hide();
    }
    this.dialogue.update(rawDt, input);

    // ---- camera & global toggles ----
    if (input.pressed('KeyQ')) this.rig.orbit(-30);
    if (input.pressed('KeyE')) this.rig.orbit(30);
    if (input.pressed('KeyR')) this.rig.yawTarget = 0;
    const wheel = input.consumeWheel();
    if (wheel) this.rig.zoom(wheel);
    if (input.pressed('KeyT') && !talking) {
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

    // ---- simulation ----
    for (const n of this.npcs) {
      if (n.behaviour && !talking) n.behaviour.update(dt);
      else if (n.behaviour && this.busy) n.char.intent.set(0, 0);
      n.char.update(dt, this.rig.yaw);
    }
    p.update(dt, this.rig.yaw);
    const v = p.velocity;
    this.rig.lookAhead.x = damp(this.rig.lookAhead.x, v.x * 0.35, 2.5, dt);
    this.rig.lookAhead.z = damp(this.rig.lookAhead.z, v.z * 0.35, 2.5, dt);
    this.rig.update(rawDt);

    this.cycle.focus.copy(p.position);
    this.cycle.update(dt);
    this._updateEnvironment(dt, t);

    // ---- autofocus + tilt band follow the player ----
    const cam = this.engine.camera;
    cam.updateMatrixWorld();
    this._v.copy(p.position).setY(p.position.y + 0.8).applyMatrix4(cam.matrixWorldInverse);
    post.dof.focusDistance = -this._v.z;
    this._v.copy(p.position).setY(p.position.y + 0.8).project(cam);
    post.dof.tiltCenter = damp(post.dof.tiltCenter, this._v.y * 0.5 + 0.5, 4, rawDt);
    const cu = globalUniforms;
    cu.uCutCenter.value.set(this._v.x * 0.5 + 0.5, this._v.y * 0.5 + 0.5);
    cu.uCutDist.value = cam.position.distanceTo(this._v.copy(p.position).setY(p.position.y + 0.8));
    cu.uCutY.value = p.position.y;
    cu.uCutStrength.value = this.occlusionCutout ? 1 : 0;

    // ---- cinematic letterbox & fades ----
    this.letterbox = damp(this.letterbox, this.dialogue.active ? 0.075 : 0, 6, rawDt);
    post.grade.letterbox = this.letterbox;
    if (this._fadeTween) {
      const f = this._fadeTween;
      f.t = Math.min(1, f.t + rawDt / f.dur);
      this.fade = f.from + (f.to - f.from) * f.t;
      if (f.t >= 1) { this._fadeTween = null; f.resolve(); }
    }
    post.grade.fade = this.title && this.title.open ? 0 : this.fade;

    // ---- zone banners ----
    if (!this.title || !this.title.open) {
      const z = this.world.zoneAt(p.position.x, p.position.z);
      if (z && z !== this.zone && !this.dialogue.active) this.banner.show(z.name, z.subtitle);
      this.zone = z;
    }

    // ---- HUD ----
    const s = this.cycle.state;
    this.hud.setTime(this.cycle.hourLabel, s.name, s.night);
    this.hud.setFps(this.engine.fps);

    input.endFrame();
  }

  _updateEnvironment(dt, t) {
    const d = this.decor;
    const s = this.cycle.state;
    const night = s.night;
    for (const l of d.lights) l.update(t, night);
    // window glow and lantern glass follow the night
    const lanternOn = 0.35 + 1.5 * Math.min(1, night * 1.6);
    if (this._lanternMat === undefined) {
      this._lanternMat = null;
      this._windowMat = null;
      this.engine.scene.traverse((o) => {
        if (o.material && o.material.name === 'lanternGlass') this._lanternMat = o.material;
        if (o.material && o.material.name === 'windowGlass') this._windowMat = o.material;
      });
    }
    if (this._lanternMat) this._lanternMat.color.copy(this._lanternMat.userData.baseColor).multiplyScalar(lanternOn);
    if (this._windowMat) this._windowMat.emissiveIntensity = 2.4 * Math.min(1, night * 1.4);

    // water receives sky/sun and nearby lamp reflections
    const ambient = s.sky.clone().multiplyScalar(s.hemiIntensity * 0.55).add(s.ground.clone().multiplyScalar(0.2));
    const pp = this.player.position;
    const nearLights = d.lights.slice().sort((a, b) => a.position.distanceToSquared(pp) - b.position.distanceToSquared(pp));
    for (const w of d.water) {
      w.setEnvironment({ sunColor: s.sunColor.clone().multiplyScalar(s.sunIntensity * 0.35), sunDir: s.sunDir, ambient, sky: s.fog });
      w.setReflectedLights(nearLights);
    }
    const fallLight = ambient.clone().multiplyScalar(1.5).add(s.sunColor.clone().multiplyScalar(s.sunIntensity * 0.22 * Math.max(0, s.sunDir.y)));
    d.waterfall.setTint(new THREE.Color(Math.min(1.1, fallLight.r), Math.min(1.1, fallLight.g), Math.min(1.1, fallLight.b)));

    // god rays lean with the sun and fade at night
    const yaw = this.rig.yaw;
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const lean = THREE.MathUtils.clamp(-s.sunDir.dot(right) * 0.9, -0.6, 0.6);
    for (const sh of d.shafts) {
      sh.mesh.rotation.z = lean;
      sh.update(yaw, s.shafts);
    }
    for (const e of d.fireflies) e.level = THREE.MathUtils.smoothstep(night, 0.35, 0.8);
    for (const e of d.dayEmitters) e.level = s.shafts;
    for (const e of d.emitters) e.update(dt, t);

    for (const f of d.flames) f.sprite.setFrame(Math.floor(t * f.fps + f.offset) % 8, 0);

    const c = d.crystal;
    c.mesh.rotation.y += dt * 0.6;
    c.mesh.position.y = c.baseY + Math.sin(t * 1.4) * 0.12;
    c.flash = Math.max(0, (c.flash || 0) - dt * 0.8);
    c.mesh.material.emissiveIntensity = 1.3 + Math.sin(t * 2.1) * 0.25 + c.flash * 4;
    c.light.base = 5 + c.flash * 14;
    c.glow.material.opacity = 0.45 + Math.sin(t * 2.1) * 0.1 + c.flash * 0.4;
  }
}
