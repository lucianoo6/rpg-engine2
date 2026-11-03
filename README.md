# HD-2D Engine for three.js

A small engine for **HD-2D style games**: crisp pixel-art sprites standing in a lit, stepped 3D diorama, finished with depth of field, tilt-shift, bloom and a filmic colour grade. It comes with **Hollowbrook**, a playable demo village that shows off every feature.

![Golden hour in Hollowbrook square](docs/golden-hour.jpg)

| Night by the campfire | The shrine on the plateau | Dusk on the lake |
| --- | --- | --- |
| ![Night](docs/night.jpg) | ![Shrine](docs/shrine.jpg) | ![Lake at dusk](docs/lake-dusk.jpg) |

Code paints every texture, sprite and character at startup, so the project ships no image assets and contains no art from existing games.

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open the URL Vite prints. Other pages:

- `/` — the Hollowbrook demo
- `/minimal.html` — the smallest useful scene (about 70 lines, see [`examples/minimal.js`](examples/minimal.js))
- `/sprites.html` — a gallery of every procedural sprite, character sheet and tile texture

`npm run build` writes a static site to `dist/`. It uses relative paths, so you can host it anywhere, GitHub Pages included.

## Demo controls

| Input | Action |
| --- | --- |
| `WASD` / arrows | Move (relative to the camera) |
| `Shift` | Run |
| `Space` / `Enter` | Talk, examine, confirm |
| `Q` / `E` / `R` | Orbit the camera / reset |
| Mouse wheel | Zoom |
| `T` | Jump to the next time of day |
| `P` | Photo mode (hide UI) |
| `G` | Toggle the settings panel |
| Touch | Drag to move, tap to interact |

Things to try:

- Rest at the campfire to time-lapse the day.
- Touch the crystal in the square.
- Walk behind the cottage to see the occlusion cut-out.
- Take the stone stairs up to the shrine.
- Cross the bridge.
- Talk to everyone, the cat included.

The settings panel (`G`) exposes live controls for time of day, the camera, depth of field, bloom, colour grade, render scale and pixelated upscaling, wind, and shadows.

URL parameters, handy for screenshots and debugging:

| Parameter | Effect |
| --- | --- |
| `notitle` | Skip the title card |
| `nogui` | Start with the settings panel hidden |
| `time=21.5` | Start at a given hour |
| `at=31,16.5` | Spawn the player at tile coordinates `x,z` |
| `yaw=-20` | Start with the camera orbited |
| `dist=30` | Start with a different camera distance |
| `dpr=2` | Raise the device pixel ratio cap |
| `manual` | Don't start the loop; call `hd2d.engine.step(dt)` yourself (for deterministic captures) |

## How the HD-2D look is built

```
scene ─► HDR target (half-float colour + depth, 4× MSAA)
      ─► bokeh depth of field: half-res gather, circle of confusion from depth
         around the player, merged with a screen-space tilt-shift band
      ─► composite sharp / blurred
      ─► bloom (lanterns, fire, water glints, crystal)
      ─► grade: ACES tone map → sRGB → saturation, contrast, tint,
         cool shadow lift, vignette, chromatic fringe, grain, letterbox, fade
```

- **Sprites in 3D.** Billboards turn to face the camera around the vertical axis only, so they stay upright. The rotation happens in the vertex shader, so shadow passes agree with what you see. Sprite normals lean back toward the sky, which lets sun and lamps light the pixel art the way painted HD-2D sprites are lit. Alpha-tested sprites cast real shadows.
- **Stepped diorama terrain.** A tile map with heights in steps of 0.5 becomes merged block geometry with one mesh per texture. Tops use world-space UVs. Side textures are anchored to the top edge, so grassy lips line up on every step. Vertex colours bake voxel ambient occlusion plus per-tile tint variation.
- **Pixel-art shading everywhere.** Painters light shapes with fake normals, quantise them onto hue-shifted ramps (shadows drift blue, highlights warm) with ordered dithering, then add selective outlines. Water and the waterfall snap to the same 16 texels-per-unit grid.
- **Mood through time.** Each day/night keyframe holds sun and moon, bounce light, fog, exposure, grade, god-ray strength and cloud shadows. Lanterns, windows, fireflies and water reflections follow the night level.
- **Readable at any angle.** When geometry or foliage sits between the camera and the player, a dithered see-through hole opens in it.

## Engine overview

```
src/engine/
  Engine.js                 renderer, scene, camera, main loop, systems
  render/PostFX.js          DoF + tilt-shift, bloom, tone map and grade
  render/MaterialPatch.js   shader injection: billboarding, wind, cloud shadows,
                            occlusion cut-out, per-instance flip; global uniforms
  render/Materials.js       shared lit world materials
  pixel/PixelCanvas.js      tiny RGBA canvas for authoring pixel art in code
  pixel/Palette.js          hue-shifted colour ramps
  pixel/TextureFactory.js   tileable ground, cliff, brick, roof, wood, window... textures
  pixel/SpriteFactory.js    trees, pines, bushes, grass, flowers, reeds, rocks, fire, lily pads
  pixel/CharacterFactory.js paper-doll 4-direction character sheets (+ a cat)
  sprites/Billboard.js      animated camera-facing sprites + SpriteAnimator
  sprites/SpriteInstances.js thousands of static sprites in one draw call
  world/TileMap.js          heights, tile types, solids, bridge decks
  world/TerrainBuilder.js   tile map → merged block meshes with baked AO
  world/World.js            ground queries, step-limited walkability, colliders, zones
  world/Water.js            pixel water (shore foam, glints, lamp reflections) and waterfall
  world/Props.js            houses with gable roofs, fences, lamps, well, decks, stall...
  world/StaticBatch.js      merges static props per material
  lighting/DayNightCycle.js keyframed time of day + stable shadow frustum
  lighting/FlickerLight.js  lamps and fires that switch on at night
  lighting/LightShaft.js    additive god rays that lean with the sun
  fx/Particles.js           embers, smoke, fireflies, dust, mist, leaves, petals, sparkles
  camera/CameraRig.js       long-lens follow camera, orbit, zoom, intro fly-in
  entities/Character.js     walking sprite with collision, steps and facing
  entities/Behaviours.js    Wander and Patrol AI
  input/Input.js            keyboard, wheel, touch stick
  ui/UI.js, ui/ui.css       dialogue with choices, banners, prompts, HUD, title card
src/demo/                   Hollowbrook: map layout, decoration, cast, gameplay
examples/minimal.js         a minimal scene using the public API
```

Everything is exported from `src/engine/index.js`. A minimal scene looks like this:

```js
import * as THREE from 'three';
import { Engine, TileMap, buildTerrain, World, Character, makeCharacterSheet,
         DayNightCycle, CameraRig, Input } from './src/engine/index.js';

const engine = new Engine({ container: document.body });
const map = new TileMap(24, 24, [{ name: 'grass', top: 'grass', side: 'earthSide' }]);
map.fillRect(0, 0, 23, 23, 0, 'grass');
engine.scene.add(buildTerrain(map));

const world = new World(map);
const hero = new Character(world, makeCharacterSheet({ tunic: '#a8423a' }), { x: 12, z: 16 });
engine.scene.add(hero.root);

const sun = new THREE.DirectionalLight(); sun.castShadow = true;
const hemi = new THREE.HemisphereLight();
engine.scene.add(sun, sun.target, hemi);
const cycle = new DayNightCycle({ scene: engine.scene, sun, hemi, post: engine.post, time: 16.5 });

const rig = new CameraRig(engine.camera); rig.follow = hero; rig.snap();
const input = new Input(engine.renderer.domElement);
engine.addSystem((dt) => {
  const a = input.axis();
  hero.intent.set(a.x, -a.y);          // camera yaw 0: screen up = -z
  hero.update(dt, rig.yaw);
  rig.update(dt);
  cycle.focus.copy(hero.position);
  cycle.update(dt);
  input.endFrame();
});
engine.start();
```

## Performance notes

- The post pipeline renders at `devicePixelRatio`, capped at 1.5. Lower **Rendering → render scale** in the settings panel for weaker GPUs. Turning on **nearest upscale** as well gives chunkier pixels.
- Foliage is instanced, and static props are merged per material. The demo draws a few dozen draw calls plus shadow passes.
- The demo has 13 point lights. Only the campfire casts point-light shadows.

## Credits

- Built on [three.js](https://threejs.org) (`0.186.1`) and [lil-gui](https://lil-gui.georgealways.com), with [Vite](https://vite.dev) for development.
- UI fonts are Cinzel and Spectral, loaded from Google Fonts. If they can't load, the UI falls back to system serif fonts.
- The visual style takes its cue from the "HD-2D" look in general. The village, characters and all artwork are original and generated procedurally.
