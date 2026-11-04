import * as THREE from 'three';
import { GameMap } from '../../engine/game/GameMap.js';
import { World } from '../../engine/world/World.js';
import { Character } from '../../engine/entities/Character.js';
import { Wander, Patrol } from '../../engine/entities/Behaviours.js';
import { createVillageMap, POI } from '../VillageMap.js';
import { decorateVillage } from '../VillageDecor.js';
import { CAST } from '../cast.js';

/**
 * Hollowbrook village, built in code (procedural layout + decoration).
 * Compare with public/maps/inn.tmj, which is pure data authored for Tiled:
 * both end up as the same kind of GameMap.
 */

const ZONES = [
  ['The Old Shrine', 'Where the pines keep their silence', 8, 0, 27, 9.6],
  ['Mirrormere', 'A lake that remembers the sky', 26, 9.6, 48, 23.5],
  ['Hollowbrook Square', 'Heart of the village', 15.5, 18.5, 28.5, 31.5],
  ['Ember Hollow', 'A fire that never quite goes out', 24, 32.5, 31.5, 40],
  ['Southern Meadow', 'Wildflowers as far as the fence', 1, 32.5, 20, 46],
  ['Eastern Fields', 'Beyond the old bridge', 45.5, 18, 56, 46],
];

// Opening cutscene, in the same JSON command format a Tiled map uses.
const PIP_GREETING = [
  { do: 'wait', s: 0.4 },
  { do: 'emote', who: 'Pip', icon: '!' },
  { do: 'walk', who: 'Pip', to: 'player', run: true },
  { do: 'face', who: 'player', to: 'Pip' },
  { do: 'say', who: 'Pip', text: 'A visitor! Nobody ever visits Hollowbrook. Are you lost? Are you a knight?' },
  { do: 'emote', who: 'player', icon: '…' },
  { do: 'say', who: 'Pip', text: "...You don't talk much. That's fine! The inn is up past the well, and the Elder is by the crystal." },
  { do: 'emote', who: 'Pip', icon: '♪', wait: false },
  { do: 'walk', who: 'Pip', to: [25.5, 30.2], run: true, wait: false },
  { do: 'flag', set: 'metPip' },
];

export async function buildVillage(game) {
  const map = new GameMap('village');
  map.tileMap = createVillageMap();
  map.world = new World(map.tileMap);
  const d = decorateVillage(map.root, map.tileMap, map.world, { lightParent: null });
  map.decor = d;
  Object.assign(map, {
    lights: d.lights, emitters: d.emitters, fireflies: d.fireflies, dayEmitters: d.dayEmitters,
    groundCover: d.groundCover, shafts: d.shafts, flames: d.flames, water: d.water,
  });
  const wf = POI.waterfall;
  map.ambience = [
    { kind: 'water', x: (wf.x0 + wf.x1) / 2, z: wf.z + 0.6, gain: 0.3, ref: 3, max: 24 },
    { kind: 'water', x: 44.5, z: 29.5, gain: 0.08, ref: 2, max: 10, cutoff: 1800 },
    { kind: 'fire', x: POI.campfire[0], z: POI.campfire[1], gain: 0.14 },
  ];
  map.env = {
    title: 'Hollowbrook', subtitle: 'A quiet village at the edge of the wood', indoor: null,
    camera: { distance: 23, pitch: 33, bounds: { minX: 13, maxX: 43, minZ: 9.5, maxZ: 36 } },
  };
  const inn = POI.houses.find((h) => h.name === 'inn');
  map.spawns = {
    start: { x: POI.start[0], z: POI.start[1], facing: [0, -1] },
    innDoor: { x: inn.info.door.x, z: inn.info.door.z + 0.3, facing: [0, 1] },
  };
  for (const [name, sub, x0, z0, x1, z1] of ZONES) map.world.addZone(name, x0, z0, x1, z1, { subtitle: sub });

  spawnVillagers(map, game);
  addInteractables(map, game, d, inn);
  map.world.addTrigger(19, 31.2, 25, 34.5, () => game.runScript(PIP_GREETING), { once: true, name: 'pipGreeting' });

  map.onUpdate = (dt, t, state) => {
    const c = d.crystal;
    c.mesh.rotation.y += dt * 0.6;
    c.mesh.position.y = c.baseY + Math.sin(t * 1.4) * 0.12;
    c.flash = Math.max(0, (c.flash || 0) - dt * 0.8);
    c.mesh.material.emissiveIntensity = 1.3 + Math.sin(t * 2.1) * 0.25 + c.flash * 4;
    c.light.base = 5 + c.flash * 14;
    c.glow.material.opacity = 0.45 + Math.sin(t * 2.1) * 0.1 + c.flash * 0.4;
    // the waterfall is lit by sky and sun
    const amb = state.sky, k = state.hemiIntensity * 0.55 * 1.5, sk = state.sunIntensity * 0.22 * Math.max(0, state.sunDir.y);
    const tint = (map._fall ||= new THREE.Color());
    tint.setRGB(
      Math.min(1.1, amb.r * k + state.ground.r * 0.3 + state.sunColor.r * sk),
      Math.min(1.1, amb.g * k + state.ground.g * 0.3 + state.sunColor.g * sk),
      Math.min(1.1, amb.b * k + state.ground.b * 0.3 + state.sunColor.b * sk),
    );
    d.waterfall.setTint(tint);
  };
  map.benchmarkRoute = [[22, 33.2], [26.5, 30.5], [31, 21.5], [31, 15.5], [26, 20.5], [17.5, 16.5], [17.5, 7.5], [22, 12], [22, 33.2]];
  return map;
}

function spawnVillagers(map, game) {
  const nav = map.getNav();
  const add = (key, x, z, o = {}) => {
    const def = CAST[key];
    const c = new Character(map.world, game.castSheet(key), { name: def.name, x, z, speed: o.speed || 1.8 });
    if (o.facing) c.facing.set(o.facing[0], o.facing[1]);
    map.root.add(c.root);
    map.npcs.push({ char: c, name: def.name, lines: o.lines, talk: o.talk, behaviour: o.behaviour ? o.behaviour(c) : null, idleFacing: o.facing || null });
  };
  add('elder', 20.2, 23.4, {
    behaviour: (c) => new Wander(c, { radius: 1.4, speed: 0.5, pause: [3, 7], nav }),
    lines: [
      'Ah, a traveller. Welcome to Hollowbrook.',
      'That crystal has stood in our square longer than the oldest roof. Lay a hand on it and it will remember you.',
      'Stay until the sun goes down. The lanterns wake one by one, and the lake turns to gold.',
    ],
  });
  add('merchant', POI.stall[0], POI.stall[1] - 0.15, {
    facing: [0, 1],
    talk: async (npc) => {
      const pick = await game.dialogue.choose(npc.name, 'Fresh from the orchard! What will it be?', ['A red apple', 'Honey bread', 'Just looking']);
      const replies = [
        'One apple, polished on my apron. No charge for first visitors!',
        'Still warm from the oven. Mind the crumbs on that scarf of yours.',
        'Look all you like. The light is lovely on the cobbles this time of day.',
      ];
      await game.dialogue.say({ speaker: npc.name, text: replies[pick] });
    },
  });
  add('guard', 21.2, 40.6, {
    behaviour: (c) => new Patrol(c, [[19.6, 40.6], [24.4, 40.6]], { speed: 0.55, pause: 2.5, nav }),
    lines: [
      'Halt! State your business... ha, only teasing. The roads have been quiet for weeks.',
      'Heading north? Take the stone stairs by the inn. The shrine is something else when the light falls through the pines.',
    ],
  });
  add('child', 25.5, 30.2, {
    speed: 2.6,
    behaviour: (c) => new Wander(c, { radius: 3.5, speed: 0.9, pause: [0.5, 2], nav }),
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
    behaviour: (c) => new Wander(c, { radius: 1.2, speed: 0.4, pause: [4, 8], nav }),
    lines: [
      'Listen. Even the pines are breathing up here.',
      'If you want to watch the hours turn, rest by the campfire in the hollow below the square.',
    ],
  });
  const cat = new Character(map.world, game.castSheet('cat'), { name: 'Biscuit', x: 36.5, z: 29.6, speed: 1.4, radius: 0.22 });
  map.root.add(cat.root);
  map.npcs.push({
    char: cat, name: 'Biscuit', speaker: '', behaviour: new Wander(cat, { radius: 2.8, speed: 0.6, pause: [2, 6], nav }),
    lines: ['Mrrp.', 'The cat regards you with deep, unblinking judgement.'],
  });
}

function addInteractables(map, game, d, inn) {
  const it = (name, pos, label, fn, range = 1.9) => map.world.addInteractable({ name, pos, label, fn, range });
  it('crystal', new THREE.Vector3(POI.crystal[0], 0.5, POI.crystal[1]), 'Touch', async () => {
    const c = d.crystal;
    c.heal.emitter.copy(c.mesh.position).setY(0.6);
    c.heal.burst(80);
    c.flash = 1;
    game.sfx.crystal();
    const ok = game.save();
    await game.dialogue.say([
      { speaker: '', text: 'The crystal hums, cool and bright beneath your palm.' },
      { speaker: '', text: ok ? 'Your journey has been recorded.' : 'The crystal flickers... it cannot hold your memories here (saving is unavailable).' },
    ]);
  }, 2.1);
  it('campfire', d.campfire, 'Rest', async () => {
    const pick = await game.dialogue.choose('', 'The fire crackles warmly. Rest a while?', ['Rest until morning', 'Rest until golden hour', 'Rest until nightfall', 'Stay a moment longer']);
    const hours = [7.5, 16.5, 21.8];
    if (pick < 3) await game.rest(hours[pick]);
  }, 2.2);
  it('well', d.well, 'Examine', () => game.dialogue.say({ speaker: '', text: 'Far below, the water catches a sliver of sky. Something glints at the bottom... just a copper coin.' }), 1.9);
  it('sign', d.sign, 'Read', () => game.dialogue.say({ speaker: '', text: 'HOLLOWBROOK\nNorth: the Old Shrine  ·  East: Mirrormere Bridge' }), 1.4);
  it('shrine', d.shrine, 'Pray', () => game.dialogue.say({ speaker: '', text: 'You bow your head. Somewhere above, a bird answers.' }), 1.8);
  // the inn can be entered; other doors are politely locked
  const door = inn.info.door;
  it('innDoor', new THREE.Vector3(door.x, 0.6, door.z - 0.6), 'Enter', () => game.warp('inn', 'entrance'), 1.5);
  const locked = {
    cottage: 'Locked. Someone inside is humming along to a kettle.',
    farmhouse: 'Locked. A note on the door reads: "Gone to the fields. Do NOT feed the cat."',
    hut: 'The door is stuck fast with old paint.',
  };
  for (const h of POI.houses) {
    if (!locked[h.name]) continue;
    const p = h.info.door;
    it(`${h.name}Door`, new THREE.Vector3(p.x, 0.6, p.z - 0.6), 'Knock', () => game.dialogue.say({ speaker: '', text: locked[h.name] }), 1.5);
  }
}
