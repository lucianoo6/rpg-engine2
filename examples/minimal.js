// The smallest useful HD-2D scene: stepped terrain, a walking hero, a tree,
// sun + bounce light with a day/night cycle, and the full post pipeline.
import * as THREE from 'three';
import '../src/engine/ui/ui.css';
import {
  Engine, Input, CameraRig, TileMap, buildTerrain, World, Character, makeCharacterSheet,
  DayNightCycle, SpriteInstances, SpriteFactory, toTexture,
} from '../src/engine/index.js';

const engine = new Engine({ container: document.getElementById('app') });
const { scene, camera, post } = engine;

// 1. Terrain: tile types pick a top texture and a side (cliff) texture.
const map = new TileMap(24, 24, [
  { name: 'grass', top: 'grass', side: 'earthSide' },
  { name: 'path', top: 'dirt', side: 'dirtSide' },
  { name: 'stone', top: 'slab', side: 'brick' },
]);
map.fillRect(0, 0, 23, 23, 0, 'grass');
map.fillRect(11, 0, 12, 23, 0, 'path');
map.fillRect(4, 4, 9, 9, 0.5, 'stone'); // a raised platform...
map.fillRect(5, 5, 8, 8, 1.0, 'stone'); // ...with a second step
scene.add(buildTerrain(map));
const world = new World(map);

// 2. Sprites: a procedurally painted hero and a few instanced trees.
const hero = new Character(world, makeCharacterSheet({ hair: '#2f2a3a', tunic: '#a8423a', scarf: '#e2b94f' }), { x: 12, z: 16 });
scene.add(hero.root);
const trees = new SpriteInstances(toTexture(SpriteFactory.paintTree({ seed: 4 })), { capacity: 16, wind: 0.08 });
for (const [x, z] of [[16, 8], [18, 14], [7, 15], [17, 19]]) {
  trees.add(x, 0, z);
  world.addCircle(x, z, 0.4);
}
scene.add(trees.finalize());

// 3. Lighting driven by the time-of-day keyframes.
const sun = new THREE.DirectionalLight();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.normalBias = 0.03;
const hemi = new THREE.HemisphereLight();
scene.add(sun, sun.target, hemi);
const cycle = new DayNightCycle({ scene, sun, hemi, post, time: 16.5 });

// 4. Camera + input, then the per-frame system.
const rig = new CameraRig(camera, { distance: 20 });
rig.follow = hero;
rig.snap();
const input = new Input(engine.renderer.domElement);
const v = new THREE.Vector3();
engine.addSystem((dt, t, rawDt) => {
  const a = input.axis();
  const c = Math.cos(rig.yaw), s = Math.sin(rig.yaw);
  hero.intent.set(c * a.x - s * a.y, -s * a.x - c * a.y); // screen axis -> world
  hero.running = input.isDown('ShiftLeft', 'ShiftRight');
  if (input.pressed('KeyT')) cycle.transitionTo((cycle.time + 6) % 24, 2);
  hero.update(dt, rig.yaw);
  rig.update(rawDt);
  cycle.focus.copy(hero.position);
  cycle.update(dt);
  // focus the depth of field on the hero
  v.copy(hero.position).setY(hero.position.y + 0.8).applyMatrix4(camera.matrixWorldInverse);
  post.dof.focusDistance = -v.z;
  input.endFrame();
});
if (!new URLSearchParams(location.search).has('manual')) engine.start();
window.hd2d = { engine };
