import * as THREE from 'three';
import { buildTerrain } from '../engine/world/TerrainBuilder.js';
import { Water, Waterfall } from '../engine/world/Water.js';
import { StaticBatch } from '../engine/world/StaticBatch.js';
import * as Props from '../engine/world/Props.js';
import { SpriteInstances } from '../engine/sprites/SpriteInstances.js';
import { Billboard } from '../engine/sprites/Billboard.js';
import { toTexture } from '../engine/pixel/PixelCanvas.js';
import * as SF from '../engine/pixel/SpriteFactory.js';
import { Textures } from '../engine/pixel/TextureFactory.js';
import { FlickerLight } from '../engine/lighting/FlickerLight.js';
import { LightShaft } from '../engine/lighting/LightShaft.js';
import { ParticleEmitter, ParticlePresets } from '../engine/fx/Particles.js';
import { RNG, valueNoise } from '../engine/core/Random.js';
import { patchMaterial } from '../engine/render/MaterialPatch.js';
import { worldMaterial } from '../engine/render/Materials.js';
import { POI, W, D, distToPolyline } from './VillageMap.js';

/**
 * Dresses the Hollowbrook tile map: terrain mesh, water, buildings and
 * props, thousands of instanced foliage sprites, lights, particles and
 * light shafts. Returns handles the game loop animates.
 */
export function decorateVillage(scene, map, world, { lightParent = scene } = {}) {
  const rng = new RNG(1234);
  const out = {
    lights: [], emitters: [], shafts: [], flames: [], fireflies: [], dayEmitters: [],
    chimneys: [], flowerBoxes: [], water: null, waterfall: null, crystal: null, campfire: null, well: null, sign: null, statics: [],
  };
  const groundAt = (x, z) => world.groundAt(x, z);

  /* ------------------------------ terrain ------------------------------ */
  const terrain = buildTerrain(map);
  scene.add(terrain);
  // ground that continues beyond the map edges (a frame, so the lake stays open)
  const outerTex = Textures.forest().clone();
  outerTex.needsUpdate = true;
  outerTex.repeat.set(30, 30);
  const outerMat = patchMaterial(new THREE.MeshLambertMaterial({ map: outerTex, color: '#a9b99a' }), { clouds: true });
  const R = 120;
  for (const [x0, z0, x1, z1] of [[-R, -R, W + R, 0], [-R, D, W + R, D + R], [-R, 0, 0, D], [W, 0, W + R, D]]) {
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * (x1 - x0) / 120, uv.getY(k) * (z1 - z0) / 120);
    const m = new THREE.Mesh(g, outerMat);
    m.position.set((x0 + x1) / 2, -0.02, (z0 + z1) / 2);
    m.receiveShadow = true;
    scene.add(m);
  }

  /* ------------------------------- water ------------------------------- */
  const water = new Water(map, { x0: 24, z0: 9, x1: 50, z1: D, level: map.waterLevel });
  scene.add(water);
  const river = new Water(map, { x0: POI.waterfall.x0, z0: 0, x1: POI.waterfall.x1, z1: POI.waterfall.z, level: 2.72, deep: '#2c6c8a', shallow: '#5bb8c2' });
  scene.add(river);
  out.water = [water, river];
  const fallW = POI.waterfall.x1 - POI.waterfall.x0;
  const waterfall = new Waterfall({ width: fallW, height: 2.72 - map.waterLevel + 0.02 });
  waterfall.position.set(POI.waterfall.x0 + fallW / 2, map.waterLevel, POI.waterfall.z + 0.04);
  scene.add(waterfall);
  out.waterfall = waterfall;

  // lily pads floating on the lake
  const lilyTex = [toTexture(SF.paintLilyPad({ seed: 1 })), toTexture(SF.paintLilyPad({ seed: 2, flower: true }))];
  for (let k = 0; k < 26; k++) {
    const x = POI.lake.x + rng.range(-7, 7);
    const z = POI.lake.z + rng.range(-3.5, 5);
    if (!map.isWaterTile(Math.floor(x), Math.floor(z)) || (x > POI.pier.x0 - 1 && x < POI.pier.x1 + 1)) continue;
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      patchMaterial(new THREE.MeshLambertMaterial({ map: rng.pick(lilyTex), alphaTest: 0.5 }), { clouds: true }),
    );
    m.position.set(x, map.waterLevel + 0.015, z);
    m.rotation.y = rng.range(0, Math.PI * 2);
    m.receiveShadow = true;
    scene.add(m);
  }

  /* ---------------------------- structures ---------------------------- */
  const batch = new StaticBatch();
  const noDecor = new Uint8Array(W * D);
  const mark = (x0, z0, x1, z1) => {
    for (let j = Math.floor(z0); j <= Math.floor(z1); j++) for (let i = Math.floor(x0); i <= Math.floor(x1); i++) if (map.inBounds(i, j)) noDecor[map.idx(i, j)] = 1;
  };
  const spots = []; // circles kept clear of big foliage
  const keepClear = (x, z, r) => spots.push({ x, z, r });

  for (const h of POI.houses) {
    const info = Props.buildHouse(batch, h.x, groundAt(h.x, h.z), h.z, h);
    const f = info.footprint;
    world.addBox(f.minX, f.minZ, f.maxX, f.maxZ, h.name);
    mark(f.minX, f.minZ, f.maxX, f.maxZ);
    keepClear(info.door.x, info.door.z, 1.4);
    for (const p of info.lights) {
      out.lights.push(new FlickerLight(lightParent, p, { color: '#ffb35c', intensity: 5, distance: 7, flicker: 0.08, dayLevel: 0 }));
    }
    for (const c of info.chimneys) {
      const smoke = new ParticleEmitter(ParticlePresets.smoke());
      smoke.emitter.copy(c);
      scene.add(smoke);
      out.emitters.push(smoke);
      out.chimneys.push(smoke);
    }
    out.flowerBoxes.push(...info.flowerBoxes);
    h.info = info;
  }

  // square furniture
  const sq = POI.square;
  const sqY = 0.5;
  const [wx, wz] = POI.well;
  Props.buildWell(batch, wx, sqY, wz);
  world.addCircle(wx, wz, 1.1, 'well');
  keepClear(wx, wz, 1.5);
  out.well = new THREE.Vector3(wx, sqY + 1, wz);

  const [stx, stz] = POI.stall;
  const stall = Props.buildStall(batch, stx, sqY, stz, { w: 2.8, d: 1.4 });
  world.addBox(stx - 1.5, stz - 0.8, stx + 1.5, stz + 0.75, 'stall');
  keepClear(stx, stz, 2.2);
  Props.buildCrate(batch, stx + 1.9, sqY, stz - 0.3, { size: 0.7, ry: 0.3 });
  Props.buildBarrel(batch, stx - 1.95, sqY, stz - 0.2);
  world.addCircle(stx + 1.9, stz - 0.3, 0.45);
  world.addCircle(stx - 1.95, stz - 0.2, 0.4);
  out.stallCounter = stall.counterTop;

  // benches around the crystal
  Props.buildBench(batch, sq.x - 2.6, sqY, sq.z + 2.2, { ry: 0.5 });
  Props.buildBench(batch, sq.x + 2.6, sqY, sq.z + 2.2, { ry: -0.5 });
  world.addCircle(sq.x - 2.6, sq.z + 2.2, 0.55);
  world.addCircle(sq.x + 2.6, sq.z + 2.2, 0.55);

  // crystal pedestal
  const [cx, cz] = POI.crystal;
  const ped = new THREE.CylinderGeometry(0.7, 0.85, 0.4, 8);
  batch.add(ped, worldMaterial('slab'), new THREE.Matrix4().makeTranslation(cx, sqY + 0.2, cz));
  const ped2 = new THREE.CylinderGeometry(0.45, 0.55, 0.3, 8);
  batch.add(ped2, worldMaterial('brick'), new THREE.Matrix4().makeTranslation(cx, sqY + 0.55, cz));
  world.addCircle(cx, cz, 0.85, 'crystal');
  keepClear(cx, cz, 2.6);

  // lamp posts
  const lampSpots = [[19.4, 19.6, 1], [26.9, 20.9, -1], [24.2, 31.6, -1], [40.4, 31.0, 1], [29.6, 19.6, 1]];
  for (const [lx, lz, dir] of lampSpots) {
    const p = Props.buildLampPost(batch, lx, groundAt(lx, lz), lz, { dir });
    world.addCircle(lx, lz, 0.25);
    keepClear(lx, lz, 1.2);
    out.lights.push(new FlickerLight(lightParent, p, { color: '#ffbf6b', intensity: 7, distance: 9, flicker: 0.06, dayLevel: 0 }));
  }

  // campfire with log seats
  const [fx, fz] = POI.campfire;
  const fy = groundAt(fx, fz);
  Props.buildCampfireBase(batch, fx, fy, fz);
  world.addCircle(fx, fz, 0.8, 'campfire');
  keepClear(fx, fz, 4.5);
  for (const [ox, oz, ry] of [[-1.9, 0.4, 1.2], [1.8, 0.9, -1.0], [0.2, -1.9, 0]]) {
    Props.buildBench(batch, fx + ox, fy - 0.12, fz + oz, { len: 1.4, ry });
    world.addCircle(fx + ox, fz + oz, 0.5);
  }
  const fireTex = toTexture(SF.paintFireFrames());
  const flame = new Billboard(fireTex, { frames: [8, 1], lit: false, intensity: 1.2, castShadow: false, receiveShadow: false, alphaTest: 0.4 });
  flame.position.set(fx, fy + 0.05, fz);
  scene.add(flame);
  out.flames.push({ sprite: flame, fps: 12, offset: 0 });
  const fireLight = new FlickerLight(lightParent, new THREE.Vector3(fx, fy + 0.9, fz), { color: '#ff9a45', intensity: 9, distance: 11, flicker: 0.22, speed: 1.3, nightOnly: true, dayLevel: 0.35, castShadow: true });
  out.lights.push(fireLight);
  out.campfire = new THREE.Vector3(fx, fy, fz);
  const embers = new ParticleEmitter(ParticlePresets.embers());
  embers.emitter.set(fx, fy + 0.5, fz);
  scene.add(embers);
  const fireSmoke = new ParticleEmitter({ ...ParticlePresets.smoke(), rate: 4, opacity: 0.22 });
  fireSmoke.emitter.set(fx, fy + 1.2, fz);
  scene.add(fireSmoke);
  out.emitters.push(embers, fireSmoke);

  // pier & bridge
  const P = POI.pier;
  Props.buildDeck(batch, P.x0, P.z0, P.x1, P.z1, P.y, { rails: false, postDepth: 1.6 });
  Props.buildCrate(batch, P.x0 + 0.5, P.y, P.z1 - 1.2, { size: 0.6, ry: 0.2 });
  // a lantern at the end of the pier, hanging over open water so it reflects at night
  const pierLamp = Props.buildLampPost(batch, P.x0 + 0.15, P.y, P.z0 + 0.25, { height: 1.9, dir: -1 });
  world.addCircle(P.x0 + 0.15, P.z0 + 0.25, 0.2);
  out.lights.push(new FlickerLight(lightParent, pierLamp, { color: '#ffbf6b', intensity: 5, distance: 7, flicker: 0.07, dayLevel: 0 }));
  world.addCircle(P.x0 + 0.5, P.z1 - 1.2, 0.35);
  const B = POI.bridge;
  Props.buildDeck(batch, B.x0, B.z0, B.x1, B.z1, B.y, { rails: true, postDepth: 1.2 });
  world.addBox(B.x0 + 0.6, B.z0 - 0.3, B.x1 - 0.6, B.z0 + 0.12);
  world.addBox(B.x0 + 0.6, B.z1 - 0.12, B.x1 - 0.6, B.z1 + 0.3);
  mark(B.x0, B.z0, B.x1, B.z1);
  mark(P.x0, P.z0, P.x1, P.z1);

  // farm: fence, scarecrow-free crops, barrels and crates by the houses
  const F = POI.farm;
  const fencePts = [[F.x0 - 0.1, F.z0 - 0.1], [F.x1 + 1.1, F.z0 - 0.1], [F.x1 + 1.1, F.z1 + 1.1], [F.x0 + 3, F.z1 + 1.1]];
  Props.buildFence(batch, fencePts, groundAt);
  addFenceColliders(world, fencePts);
  mark(F.x0, F.z0, F.x1, F.z1);
  for (const [x, z] of [[14.6, 22.3], [15.3, 22.6], [36.6, 27.6]]) {
    Props.buildBarrel(batch, x, groundAt(x, z), z);
    world.addCircle(x, z, 0.4);
  }
  for (const [x, z, s] of [[7.3, 22.4, 0.8], [8.15, 22.5, 0.6], [31.8, 27.6, 0.7]]) {
    Props.buildCrate(batch, x, groundAt(x, z), z, { size: s, ry: rng.range(-0.3, 0.3) });
    world.addCircle(x, z, s * 0.6);
  }
  // fence along the lake shore by the cottage
  const lakeFence = [[36.5, 22.3], [40.5, 22.8], [41.6, 25.5]];
  Props.buildFence(batch, lakeFence, groundAt);
  addFenceColliders(world, lakeFence);

  // shrine on the plateau
  const [shx, shz] = POI.shrine;
  const shrine = Props.buildShrine(batch, shx, 3, shz);
  world.addBox(shx - 1.7, shz - 0.85, shx - 0.9, shz + 0.05);
  world.addBox(shx + 0.9, shz - 0.85, shx + 1.7, shz + 0.05);
  world.addBox(shx - 0.5, shz - 0.8, shx + 0.5, shz - 0.0);
  mark(shx - 2.2, shz - 1.8, shx + 2.2, shz + 1.8);
  for (const t of shrine.torches) {
    const fl = new Billboard(fireTex, { frames: [8, 1], lit: false, intensity: 1.15, castShadow: false, receiveShadow: false, alphaTest: 0.4 });
    fl.scale.setScalar(0.55);
    fl.position.copy(t);
    scene.add(fl);
    out.flames.push({ sprite: fl, fps: 11, offset: rng.range(0, 8) });
  }
  out.lights.push(new FlickerLight(lightParent, new THREE.Vector3(shx, 3 + 2.6, shz + 0.6), { color: '#ffa04f', intensity: 7, distance: 9, flicker: 0.18, dayLevel: 0.2 }));
  out.shrine = shrine.altar;

  // signpost at the village entrance
  const signTex = toTexture(SF.paintSign());
  const sign = new Billboard(signTex, {});
  sign.position.set(20.3, groundAt(20.3, 41.5), 41.5);
  scene.add(sign);
  world.addCircle(20.3, 41.5, 0.3);
  out.sign = sign.position.clone();

  const statics = batch.build({ name: 'village' });
  scene.add(statics);

  /* ------------------------------ crystal ------------------------------ */
  const crystalMat = new THREE.MeshStandardMaterial({
    color: '#9eeaff', emissive: '#2fa8ff', emissiveIntensity: 1.4, roughness: 0.25, metalness: 0.1,
    flatShading: true, transparent: true, opacity: 0.88,
  });
  const crystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), crystalMat);
  crystal.scale.set(0.75, 1.5, 0.75);
  crystal.position.set(cx, sqY + 1.75, cz);
  crystal.castShadow = true;
  scene.add(crystal);
  const glowTex = new THREE.CanvasTexture(SF.softCircleCanvas(64, 0, 1, '120,220,255'));
  const glow = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.55 }),
  );
  glow.position.set(cx, sqY + 0.03, cz);
  scene.add(glow);
  const crystalLight = new FlickerLight(lightParent, new THREE.Vector3(cx, sqY + 1.8, cz), { color: '#7fd8ff', intensity: 5, distance: 8, flicker: 0.05, speed: 0.4, nightOnly: false });
  out.lights.push(crystalLight);
  const sparkles = new ParticleEmitter(ParticlePresets.sparkles());
  sparkles.emitter.set(cx, sqY + 1.4, cz);
  scene.add(sparkles);
  const heal = new ParticleEmitter(ParticlePresets.heal());
  scene.add(heal);
  out.emitters.push(sparkles, heal);
  out.crystal = { mesh: crystal, glow, light: crystalLight, heal, baseY: crystal.position.y };

  /* --------------------------- waterfall mist --------------------------- */
  const mist = new ParticleEmitter(ParticlePresets.mist());
  mist.emitter.set(POI.waterfall.x0 + fallW / 2, map.waterLevel + 0.1, POI.waterfall.z + 0.4);
  scene.add(mist);
  out.emitters.push(mist);

  /* ------------------------------ foliage ------------------------------ */
  buildFoliage(scene, map, world, rng, { noDecor, spots, out });

  /* ------------------------- light shafts & motes ------------------------ */
  const shaftSpots = [
    [15.4, 3, 6.8, 1.6, 9], [18.6, 3, 4.2, 1.2, 8], [20.4, 3, 7.4, 1.8, 10],
    [5.5, 0, 21, 1.6, 10], [6.5, 0, 26.5, 1.2, 9],
    [36.5, -0.1, 13.5, 2.2, 12], [27.5, 0, 12.2, 1.4, 9],
    [20.2, 0.5, 23.2, 1.6, 10], [24.6, 0.5, 27.4, 1.3, 9],
    [49.5, 0, 33, 1.8, 10],
  ];
  for (const [x, y, z, w, len] of shaftSpots) {
    const s = new LightShaft({ width: w, length: len, intensity: 0.16 + rng.range(0, 0.08), seed: rng.range(0, 20) });
    s.position.set(x, y, z);
    scene.add(s);
    out.shafts.push(s);
  }
  for (const [x, y, z, sx, sz] of [[17.6, 4.5, 5.5, 8, 6], [6, 1.5, 23.5, 6, 8], [22, 2, 25, 9, 8], [35, 1.2, 14, 10, 7]]) {
    const dust = new ParticleEmitter(ParticlePresets.dust([sx, 3, sz]));
    dust.emitter.set(x, y, z);
    scene.add(dust);
    out.dayEmitters.push(dust);
    out.emitters.push(dust);
  }
  for (const [x, y, z, sx, sz] of [[16, 1.2, 37.5, 16, 9], [34, 0.8, 21.5, 16, 5], [17.6, 4.2, 5.5, 10, 6], [46, 1, 36, 10, 14]]) {
    const ff = new ParticleEmitter(ParticlePresets.fireflies([sx, 1.6, sz]));
    ff.emitter.set(x, y, z);
    scene.add(ff);
    out.fireflies.push(ff);
    out.emitters.push(ff);
  }
  for (const [x, z] of [[8, 14], [48, 24]]) {
    const leaves = new ParticleEmitter(ParticlePresets.leaves([10, 2, 10]));
    leaves.emitter.set(x, 5.5, z);
    scene.add(leaves);
    out.emitters.push(leaves);
  }
  const petals = new ParticleEmitter(ParticlePresets.petals([16, 2, 10]));
  petals.emitter.set(12, 4, 38);
  scene.add(petals);
  out.emitters.push(petals);

  return out;
}

function addFenceColliders(world, pts) {
  for (let s = 0; s < pts.length - 1; s++) {
    const [x0, z0] = pts[s], [x1, z1] = pts[s + 1];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.4);
    for (let k = 0; k <= n; k++) world.addCircle(x0 + ((x1 - x0) * k) / n, z0 + ((z1 - z0) * k) / n, 0.18);
  }
}

/* ======================================================================= */

function buildFoliage(scene, map, world, rng, { noDecor, spots, out }) {
  const tex = (pc) => toTexture(pc);
  const trees = [
    new SpriteInstances(tex(SF.paintTree({ seed: 3 })), { capacity: 160, wind: 0.08 }),
    new SpriteInstances(tex(SF.paintTree({ seed: 17, leaf: '#5a9440' })), { capacity: 160, wind: 0.08 }),
    new SpriteInstances(tex(SF.paintTree({ seed: 11, leaf: '#5d9a45', fruit: '#d83a3a' })), { capacity: 40, wind: 0.08 }),
    new SpriteInstances(tex(SF.paintTree({ seed: 7, leaf: '#c9773a', bark: '#5d4030' })), { capacity: 40, wind: 0.08 }),
  ];
  const pines = [
    new SpriteInstances(tex(SF.paintPine({ seed: 5 })), { capacity: 200, wind: 0.05 }),
    new SpriteInstances(tex(SF.paintPine({ seed: 9, leaf: '#3a7350', tiers: 6 })), { capacity: 200, wind: 0.05 }),
  ];
  const bushes = [
    new SpriteInstances(tex(SF.paintBush({ seed: 2 })), { capacity: 120, wind: 0.04 }),
    new SpriteInstances(tex(SF.paintBush({ seed: 4, flowers: '#f2a3c4' })), { capacity: 60, wind: 0.04 }),
    new SpriteInstances(tex(SF.paintBush({ seed: 6, leaf: '#3f7d45', flowers: '#f5f0dc' })), { capacity: 60, wind: 0.04 }),
  ];
  const tufts = [
    new SpriteInstances(tex(SF.paintTuft({ seed: 1 })), { capacity: 2600, wind: 0.07, castShadow: false }),
    new SpriteInstances(tex(SF.paintTuft({ seed: 2, base: '#79ad45', blades: 6 })), { capacity: 2000, wind: 0.07, castShadow: false }),
    new SpriteInstances(tex(SF.paintTuft({ seed: 3, base: '#477f3a', blades: 9, h: 14 })), { capacity: 1600, wind: 0.07, castShadow: false }),
  ];
  const flowers = [
    new SpriteInstances(tex(SF.paintFlowers({ seed: 2 })), { capacity: 500, wind: 0.06, castShadow: false }),
    new SpriteInstances(tex(SF.paintFlowers({ seed: 3, color: '#e98fb0' })), { capacity: 500, wind: 0.06, castShadow: false }),
    new SpriteInstances(tex(SF.paintFlowers({ seed: 4, color: '#f6f3ea' })), { capacity: 400, wind: 0.06, castShadow: false }),
    new SpriteInstances(tex(SF.paintFlowers({ seed: 5, color: '#8fb3f0' })), { capacity: 300, wind: 0.06, castShadow: false }),
  ];
  const reeds = new SpriteInstances(tex(SF.paintReeds({ seed: 1 })), { capacity: 300, wind: 0.09, castShadow: false });
  const wheat = new SpriteInstances(tex(SF.paintTuft({ seed: 8, base: '#c9b04f', blades: 11, h: 18 })), { capacity: 400, wind: 0.08, castShadow: true });
  const rocks = [
    new SpriteInstances(tex(SF.paintRock({ seed: 1 })), { capacity: 60, tilt: 0.8 }),
    new SpriteInstances(tex(SF.paintRock({ seed: 4, w: 16, h: 12 })), { capacity: 80, tilt: 0.8 }),
  ];
  const all = [...trees, ...pines, ...bushes, ...tufts, ...flowers, reeds, wheat, ...rocks];

  const typeName = (i, j) => (map.inBounds(i, j) ? map.typeAt(i, j).name : 'none');
  const nearPath = (x, z, m) => POI.paths.some((p) => distToPolyline(x, z, p.pts) < p.w + m);
  const nearSpot = (x, z, m = 0) => spots.some((s) => Math.hypot(x - s.x, z - s.z) < s.r + m);
  const trunks = [];
  const farFromTrunks = (x, z, d) => trunks.every((t) => Math.hypot(x - t.x, z - t.z) > d);
  const tints = ['#ffffff', '#f3ffe6', '#fff4df', '#eef6ff', '#ffffff'];
  const sq = POI.square;

  const placeTree = (x, z, kind) => {
    const y = world.groundAt(x, z);
    const s = rng.range(0.85, 1.15);
    const flip = rng.chance(0.5);
    const tint = rng.pick(tints);
    if (kind === 'pine') rng.pick(pines).add(x, y, z, { scale: s, flip, tint });
    else {
      const r = rng.next();
      const set = r < 0.42 ? trees[0] : r < 0.84 ? trees[1] : r < 0.92 ? trees[2] : trees[3];
      set.add(x, y, z, { scale: s, flip, tint });
    }
    trunks.push({ x, z });
    world.addCircle(x, z, 0.38, 'tree');
  };

  // trees on a jittered grid
  for (let gz = 0.8; gz < D; gz += 1.7) {
    for (let gx = 0.8; gx < W; gx += 1.7) {
      const x = gx + rng.range(-0.6, 0.6);
      const z = gz + rng.range(-0.6, 0.6);
      const i = Math.floor(x), j = Math.floor(z);
      if (!map.inBounds(i, j) || noDecor[map.idx(i, j)]) continue;
      const t = typeName(i, j);
      if (['path', 'cobble', 'slab', 'lakebed', 'sand', 'farm'].includes(t)) continue;
      const t0 = typeName(i, j);
      const village = t0 !== 'forest' && t0 !== 'highland' && t0 !== 'plateau';
      if (nearPath(x, z, village ? 2.0 : 1.2) || nearSpot(x, z, village ? 2.0 : 0.8)) continue;
      if (Math.hypot(x - sq.x, (z - sq.z) * 1.1) < sq.r + 2.5) continue;
      if (village && POI.houses.some((h) => Math.abs(x - h.x) < h.w / 2 + 2 && z > h.z - h.d / 2 - 2.5 && z < h.z + h.d / 2 + 3)) continue;
      // keep the waterfall and the stairs readable
      if (x > POI.waterfall.x0 - 2 && x < POI.waterfall.x1 + 2 && z < 12) continue;
      if (x > POI.stairs.x0 - 1.5 && x < POI.stairs.x1 + 2.5 && z > 2 && z < 16) continue;
      const h = map.h(i, j);
      let p = 0;
      let kind = 'tree';
      if (t === 'highland') { p = 0.75; kind = 'pine'; }
      else if (t === 'plateau') { p = 0.42; kind = rng.chance(0.75) ? 'pine' : 'tree'; }
      else if (t === 'forest') { p = 0.8; kind = rng.chance(0.3) ? 'pine' : 'tree'; }
      else if (t === 'meadow') p = 0.05;
      else p = 0.05 + (valueNoise(x * 0.12, z * 0.12, 4) > 0.64 ? 0.3 : 0);
      if (h > 0.6 && h < 2.9) p *= 0.3;
      if (!rng.chance(p)) continue;
      if (!farFromTrunks(x, z, kind === 'pine' ? 1.3 : 1.6)) continue;
      placeTree(x, z, kind);
    }
  }

  // bushes hugging houses and the square
  for (const h of POI.houses) {
    const f = h.info.footprint;
    for (let k = 0; k < 4; k++) {
      const side = k % 2 ? f.minX - 0.4 : f.maxX + 0.4;
      const z = rng.range(f.minZ + 0.6, f.maxZ - 0.3);
      if (nearPath(side, z, 0.3) || nearSpot(side, z)) continue;
      rng.pick(bushes).add(side, world.groundAt(side, z), z, { scale: rng.range(0.8, 1.05), flip: rng.chance(0.5) });
      world.addCircle(side, z, 0.4);
    }
  }
  for (let k = 0; k < 40; k++) {
    const x = rng.range(3, W - 3), z = rng.range(10, D - 3);
    const i = Math.floor(x), j = Math.floor(z);
    const t = typeName(i, j);
    if (!['grass', 'meadow', 'forest'].includes(t) || noDecor[map.idx(i, j)] || nearPath(x, z, 0.6) || nearSpot(x, z, 0.5)) continue;
    if (Math.hypot(x - sq.x, (z - sq.z) * 1.1) < sq.r + 0.8) continue;
    rng.pick(bushes).add(x, world.groundAt(x, z), z, { scale: rng.range(0.75, 1.1), flip: rng.chance(0.5), tint: rng.pick(tints) });
    world.addCircle(x, z, 0.4);
  }

  // window flower boxes
  for (const fb of out.flowerBoxes) {
    for (let k = -1; k <= 1; k++) rng.pick(flowers).add(fb.x + k * 0.28, fb.y, fb.z, { scale: 0.7, flip: rng.chance(0.5) });
  }

  // ground cover: tufts and flowers per tile
  for (let j = 0; j < D; j++) {
    for (let i = 0; i < W; i++) {
      const t = typeName(i, j);
      const k = map.idx(i, j);
      if (noDecor[k]) continue;
      const y = map.height[k];
      const n = valueNoise(i * 0.22, j * 0.22, 6);
      if (t === 'grass' || t === 'meadow' || t === 'forest' || t === 'plateau' || t === 'highland') {
        const count = Math.round(n * (t === 'meadow' ? 3.2 : 2.6));
        for (let c = 0; c < count; c++) {
          const x = i + rng.range(0.1, 0.9), z = j + rng.range(0.1, 0.9);
          if (nearPath(x, z, 0.2)) continue;
          const set = t === 'meadow' ? tufts[1] : t === 'forest' || t === 'highland' ? tufts[2] : tufts[rng.chance(0.7) ? 0 : 1];
          set.add(x, y, z, { scale: rng.range(0.8, 1.2), flip: rng.chance(0.5), tint: rng.pick(tints) });
        }
        const fp = t === 'meadow' ? 0.55 : t === 'grass' ? 0.1 * (n > 0.6 ? 3 : 1) : t === 'plateau' ? 0.08 : 0.02;
        if (rng.chance(fp)) {
          const x = i + rng.range(0.15, 0.85), z = j + rng.range(0.15, 0.85);
          if (!nearPath(x, z, 0.3)) {
            const cluster = rng.int(1, 3);
            const set = rng.pick(flowers);
            for (let c = 0; c < cluster; c++) set.add(x + rng.range(-0.3, 0.3), y, z + rng.range(-0.3, 0.3), { scale: rng.range(0.8, 1.1), flip: rng.chance(0.5) });
          }
        }
      } else if (t === 'sand') {
        let waterNear = false;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if (map.isWaterTile(i + di, j + dj)) waterNear = true;
        if (waterNear && rng.chance(0.55) && !nearPath(i + 0.5, j + 0.5, 0.4)) {
          for (let c = 0; c < rng.int(1, 3); c++) reeds.add(i + rng.range(0.1, 0.9), y, j + rng.range(0.1, 0.9), { scale: rng.range(0.8, 1.15), flip: rng.chance(0.5) });
        }
      }
    }
  }

  // crops in the farm
  const F = POI.farm;
  for (let z = F.z0 + 0.5; z <= F.z1 + 0.6; z += 0.5) {
    for (let x = F.x0 + 0.3; x <= F.x1 + 0.8; x += 0.42) {
      wheat.add(x + rng.range(-0.05, 0.05), world.groundAt(x, z), z, { scale: rng.range(0.85, 1.1), flip: rng.chance(0.5) });
    }
  }

  // rocks
  for (let k = 0; k < 70; k++) {
    const x = rng.range(1, W - 1), z = rng.range(1, D - 1);
    const i = Math.floor(x), j = Math.floor(z);
    const t = typeName(i, j);
    if (['path', 'cobble', 'slab', 'lakebed', 'farm'].includes(t) || noDecor[map.idx(i, j)] || nearPath(x, z, 0.5) || nearSpot(x, z, 0.3)) continue;
    const big = rng.chance(0.35);
    (big ? rocks[0] : rocks[1]).add(x, map.h(i, j), z, { scale: rng.range(0.8, 1.2), flip: rng.chance(0.5), tint: rng.pick(tints) });
    if (big) world.addCircle(x, z, 0.4);
  }
  for (const [x, z] of [[29.2, 10.6], [33.8, 10.8], [29.6, 11.6]]) rocks[0].add(x, world.groundAt(x, z), z, { scale: 1.2 });

  const groundCover = [...tufts, ...flowers, reeds];
  for (const s of all) {
    s.finalize({ shuffle: groundCover.includes(s) });
    s.frustumCulled = false;
    if (s.count > 0) scene.add(s);
  }
  out.foliage = all;
  out.groundCover = groundCover;
}
