import * as THREE from 'three';
import * as Props from '../world/Props.js';
import { FlickerLight } from '../lighting/FlickerLight.js';
import { LightShaft } from '../lighting/LightShaft.js';
import { ParticleEmitter, ParticlePresets } from '../fx/Particles.js';
import { Billboard } from '../sprites/Billboard.js';
import { Character } from '../entities/Character.js';
import { Wander, Patrol } from '../entities/Behaviours.js';
import { toTexture } from '../pixel/PixelCanvas.js';
import * as SF from '../pixel/SpriteFactory.js';
import { parseScript } from './Events.js';
import { TreeSpecies } from '../world/Trees.js';

/**
 * Prefabs turn map objects ({ type, name, x, z, w, d, props }) into game
 * things. Each prefab is `(obj, ctx) => void | Promise`, where ctx is
 * { map: GameMap, batch: StaticBatch, game, groundAt(x, z), foliage, onFinish(fn) }:
 * `foliage` is the map's tree style (see world/Trees.js) and onFinish(fn)
 * runs fn after every object has been placed.
 *
 * Register your own with registry.register('type', fn); a game-specific
 * registry can extend the defaults below.
 */
export class PrefabRegistry {
  constructor(parent = null) {
    this.parent = parent;
    this.map = new Map();
  }

  register(type, fn) {
    this.map.set(type.toLowerCase(), fn);
    return this;
  }

  get(type) {
    const t = (type || '').toLowerCase();
    return this.map.get(t) || (this.parent && this.parent.get(t)) || null;
  }
}

const FACING = { down: [0, 1], up: [0, -1], left: [-1, 0], right: [1, 0] };
const RY = { down: 0, up: Math.PI, left: -Math.PI / 2, right: Math.PI / 2 };
const num = (v, d) => (v === undefined || v === '' || v === null ? d : Number(v));
const bool = (v, d) => (v === undefined ? d : v === true || v === 'true');
const yOf = (o, ctx) => num(o.props.y, ctx.groundAt(o.x, o.z) + num(o.props.elevation, 0));
const rect = (o, pad = 0) => [o.x - o.w / 2 - pad, o.z - o.d / 2 - pad, o.x + o.w / 2 + pad, o.z + o.d / 2 + pad];

function footprint(ctx, o, w, d, ry) {
  const swap = Math.abs(Math.sin(ry)) > 0.5;
  const hw = (swap ? d : w) / 2, hd = (swap ? w : d) / 2;
  ctx.map.world.addBox(o.x - hw, o.z - hd, o.x + hw, o.z + hd, o.type);
}

function spriteFor(name, seed = 1) {
  const p = {
    tree: () => SF.paintTree({ seed }), pine: () => SF.paintPine({ seed }), bush: () => SF.paintBush({ seed }),
    flowerbush: () => SF.paintBush({ seed, flowers: '#f2a3c4' }), rock: () => SF.paintRock({ seed }),
    flowers: () => SF.paintFlowers({ seed }), tuft: () => SF.paintTuft({ seed }), reeds: () => SF.paintReeds({ seed }),
    sign: () => SF.paintSign(),
  }[name];
  return p ? toTexture(p()) : null;
}

function addFire(o, ctx, pos, { scale = 1, light = true } = {}) {
  const { map } = ctx;
  const flame = new Billboard(toTexture(SF.paintFireFrames()), { frames: [8, 1], lit: false, intensity: 1.2, castShadow: false, receiveShadow: false, alphaTest: 0.4 });
  flame.scale.setScalar(scale);
  flame.position.copy(pos);
  map.root.add(flame);
  map.flames.push({ sprite: flame, fps: 12, offset: Math.random() * 8 });
  if (light) {
    map.lights.push(new FlickerLight(null, pos.clone().add(new THREE.Vector3(0, 0.8 * scale, 0.3)), {
      color: o.props.color || '#ff9a45', intensity: num(o.props.intensity, 9), distance: num(o.props.distance, 10),
      flicker: 0.22, speed: 1.3, nightOnly: false, castShadow: bool(o.props.shadow, true),
    }));
  }
  const embers = new ParticleEmitter({ ...ParticlePresets.embers(), rate: 10 * scale });
  embers.emitter.copy(pos).add(new THREE.Vector3(0, 0.4 * scale, 0));
  map.root.add(embers);
  map.emitters.push(embers);
  map.ambience.push({ kind: 'fire', x: pos.x, z: pos.z, gain: num(o.props.volume, 0.14) });
}

export function defaultPrefabs() {
  const r = new PrefabRegistry();

  // ---- gameplay ----
  r.register('spawn', (o, ctx) => {
    ctx.map.spawns[o.name || 'default'] = { x: o.x, z: o.z, facing: FACING[o.props.facing] || FACING.down };
  });
  r.register('zone', (o, ctx) => {
    const [x0, z0, x1, z1] = rect(o);
    ctx.map.world.addZone(o.props.title || o.name, x0, z0, x1, z1, { subtitle: o.props.subtitle || '' });
  });
  r.register('warp', (o, ctx) => {
    const [x0, z0, x1, z1] = rect(o);
    ctx.map.world.addTrigger(x0, z0, x1, z1, () => ctx.game.warp(o.props.map, o.props.spawn), { name: o.name || 'warp' });
  });
  r.register('trigger', (o, ctx) => {
    const [x0, z0, x1, z1] = rect(o);
    const script = parseScript(o.props.script, ctx.map);
    ctx.map.world.addTrigger(x0, z0, x1, z1, () => ctx.game.runScript(script), { once: bool(o.props.once, true), name: o.name });
  });
  r.register('inspect', (o, ctx) => {
    const script = parseScript(o.props.script ?? o.props.text, ctx.map);
    ctx.map.world.addInteractable({
      name: o.name, label: o.props.label || 'Examine', range: num(o.props.range, 1.6),
      pos: new THREE.Vector3(o.x, yOf(o, ctx), o.z), fn: () => ctx.game.runScript(script),
    });
  });
  r.register('npc', async (o, ctx) => {
    const { map, game } = ctx;
    const p = o.props;
    const sheet = await game.resolveSheet(p.sheet);
    const name = p.name || o.name;
    const c = new Character(map.world, sheet, { name, x: o.x, z: o.z, speed: num(p.speed, 1.8), radius: num(p.radius, 0.3) });
    if (p.facing) c.facing.set(...FACING[p.facing]);
    map.root.add(c.root);
    let behaviour = null;
    if (p.behaviour === 'wander') behaviour = new Wander(c, { radius: num(p.wanderRadius, 2), speed: num(p.walkSpeed, 0.5), nav: map.getNav() });
    else if (p.behaviour === 'patrol' && p.points) behaviour = new Patrol(c, JSON.parse(p.points), { nav: map.getNav() });
    map.npcs.push({
      char: c, name, speaker: p.speaker ?? name, voice: num(p.voice, 1),
      script: parseScript(p.script ?? p.dialogue, map, name), behaviour, idleFacing: p.facing ? FACING[p.facing] : null,
    });
  });

  // ---- lights, effects ----
  r.register('light', (o, ctx) => {
    ctx.map.lights.push(new FlickerLight(null, new THREE.Vector3(o.x, yOf(o, ctx), o.z), {
      color: o.props.color || '#ffb35c', intensity: num(o.props.intensity, 6), distance: num(o.props.distance, 8),
      flicker: num(o.props.flicker, 0.08), nightOnly: bool(o.props.nightOnly, false), castShadow: bool(o.props.shadow, false),
    }));
  });
  r.register('fire', (o, ctx) => addFire(o, ctx, new THREE.Vector3(o.x, yOf(o, ctx), o.z), { scale: num(o.props.scale, 1) }));
  r.register('particles', (o, ctx) => {
    const preset = ParticlePresets[o.props.preset || 'dust'];
    if (!preset) return console.warn(`Unknown particle preset "${o.props.preset}"`);
    const area = [Math.max(0.5, o.w), num(o.props.height, 2), Math.max(0.5, o.d)];
    const e = new ParticleEmitter(preset(area));
    e.emitter.set(o.x, yOf(o, ctx) + area[1] / 2, o.z);
    ctx.map.root.add(e);
    ctx.map.emitters.push(e);
    if (o.props.preset === 'fireflies') ctx.map.fireflies.push(e);
    if (o.props.preset === 'dust') ctx.map.dayEmitters.push(e);
  });
  r.register('shaft', (o, ctx) => {
    const s = new LightShaft({ width: num(o.props.width, Math.max(1, o.w)), length: num(o.props.length, 6), intensity: num(o.props.intensity, 0.2), color: o.props.color || '#ffe6b8', lean: num(o.props.lean, 0.35) });
    s.position.set(o.x, yOf(o, ctx), o.z);
    s.fixedLean = o.props.lean !== undefined;
    ctx.map.root.add(s);
    ctx.map.shafts.push(s);
  });
  // trees follow the map's foliage style (campaign default, map `foliage` property);
  // one TreeSpecies per distinct look, built once every object is placed
  const tree = (o, ctx) => {
    const p = o.props;
    const kind = p.kind || (p.sprite === 'pine' ? 'conifer' : 'broadleaf');
    const opts = { kind, seed: num(p.seed, 1), leaf: p.leaf || undefined, bark: p.bark || undefined, fruit: p.fruit || null, tiers: num(p.tiers, 5) };
    const key = JSON.stringify(opts);
    ctx.trees ??= new Map();
    if (!ctx.trees.has(key)) {
      const sp = new TreeSpecies({ ...opts, style: ctx.foliage, capacity: 128 });
      ctx.trees.set(key, sp);
      ctx.onFinish(() => {
        sp.finalize();
        for (const m of sp.meshes) ctx.map.root.add(m);
      });
    }
    ctx.trees.get(key).add(o.x, yOf(o, ctx), o.z, { scale: num(p.scale, 1), flip: bool(p.flip, false), tint: p.tint || null });
    if (bool(p.solid, true)) ctx.map.world.addCircle(o.x, o.z, num(p.radius, 0.38), 'tree');
  };
  r.register('tree', tree);
  r.register('sprite', (o, ctx) => {
    if (o.props.sprite === 'tree' || o.props.sprite === 'pine') return tree(o, ctx);
    const tex = spriteFor(o.props.sprite || 'bush', num(o.props.seed, 1));
    if (!tex) return console.warn(`Unknown sprite "${o.props.sprite}"`);
    const b = new Billboard(tex, { wind: num(o.props.wind, 0.03) });
    b.scale.setScalar(num(o.props.scale, 1));
    b.position.set(o.x, yOf(o, ctx), o.z);
    ctx.map.root.add(b);
    if (bool(o.props.solid, true)) ctx.map.world.addCircle(o.x, o.z, num(o.props.radius, 0.35));
  });
  r.register('water', (o, ctx) => ctx.map.ambience.push({ kind: 'water', x: o.x, z: o.z, gain: num(o.props.volume, 0.2) }));

  // ---- furniture & props (static, batched) ----
  const furniture = (build, w, d, { solid = 'box' } = {}) => (o, ctx) => {
    const ry = RY[o.props.facing] ?? 0;
    const y = yOf(o, ctx);
    const out = build(ctx.batch, o.x, y, o.z, { ...o.props, ry, w: o.w || num(o.props.w, w), d: o.d || num(o.props.d, d) });
    if (solid === 'box') footprint(ctx, o, o.w || w, o.d || d, ry);
    else if (solid === 'circle') ctx.map.world.addCircle(o.x, o.z, Math.max(w, d) / 2);
    return out;
  };
  r.register('table', furniture((b, x, y, z, p) => Props.buildTable(b, x, y, z, { w: p.w, d: p.d, ry: p.ry }), 1.6, 1));
  r.register('stool', furniture((b, x, y, z) => Props.buildStool(b, x, y, z), 0.5, 0.5, { solid: 'circle' }));
  r.register('counter', furniture((b, x, y, z, p) => Props.buildCounter(b, x, y, z, { w: p.w, d: p.d, ry: p.ry }), 3.5, 0.7));
  r.register('shelf', furniture((b, x, y, z, p) => Props.buildShelf(b, x, y, z, { w: p.w, ry: p.ry }), 1.6, 0.4));
  r.register('bed', furniture((b, x, y, z, p) => Props.buildBed(b, x, y, z, { ry: p.ry }), 1.1, 2.0));
  r.register('barrel', furniture((b, x, y, z) => Props.buildBarrel(b, x, y, z), 0.8, 0.8, { solid: 'circle' }));
  r.register('crate', furniture((b, x, y, z, p) => Props.buildCrate(b, x, y, z, { size: num(p.size, 0.8), ry: p.ry }), 0.8, 0.8, { solid: 'circle' }));
  r.register('bench', furniture((b, x, y, z, p) => Props.buildBench(b, x, y, z, { len: p.w, ry: p.ry }), 1.6, 0.45));
  r.register('rug', furniture((b, x, y, z, p) => Props.buildRug(b, x, y, z, { w: p.w, d: p.d, tex: p.texture || 'rug', ry: p.ry }), 3, 2, { solid: 'none' }));
  r.register('window', (o, ctx) => {
    Props.buildWallWindow(ctx.batch, o.x, num(o.props.y, 1.6), o.z, { ry: RY[o.props.facing] ?? 0, interior: bool(o.props.interior, true) });
  });
  r.register('fireplace', (o, ctx) => {
    const ry = RY[o.props.facing] ?? 0;
    const firePos = Props.buildFireplace(ctx.batch, o.x, yOf(o, ctx), o.z, { ry });
    footprint(ctx, o, 2.4, 0.9, ry);
    addFire(o, ctx, firePos, { scale: 0.8 });
  });
  r.register('lamppost', (o, ctx) => {
    const p = Props.buildLampPost(ctx.batch, o.x, yOf(o, ctx), o.z, { dir: num(o.props.dir, 1) });
    ctx.map.world.addCircle(o.x, o.z, 0.25);
    ctx.map.lights.push(new FlickerLight(null, p, { color: '#ffbf6b', intensity: 7, distance: 9, flicker: 0.06 }));
  });
  return r;
}
