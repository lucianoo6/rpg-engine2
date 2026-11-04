// Public API of the HD-2D engine.
export { Engine } from './Engine.js';
export { Input } from './input/Input.js';
export { CameraRig } from './camera/CameraRig.js';
export { PostFX } from './render/PostFX.js';
export { Quality, QUALITY_PRESETS, QUALITY_LEVELS } from './render/Quality.js';
export { runBenchmark } from './render/Benchmark.js';
export { globalUniforms, patchMaterial, makeShadowMaterials } from './render/MaterialPatch.js';
export { worldMaterial } from './render/Materials.js';

export { PixelCanvas, toTexture } from './pixel/PixelCanvas.js';
export * as Palette from './pixel/Palette.js';
export * as SpriteFactory from './pixel/SpriteFactory.js';
export { Textures, PPU } from './pixel/TextureFactory.js';
export { makeCharacterSheet, makeCatSheet } from './pixel/CharacterFactory.js';

export { Billboard, SpriteAnimator, spriteGeometry } from './sprites/Billboard.js';
export { SpriteInstances } from './sprites/SpriteInstances.js';

export { TileMap } from './world/TileMap.js';
export { buildTerrain } from './world/TerrainBuilder.js';
export { World } from './world/World.js';
export { Water, Waterfall } from './world/Water.js';
export { StaticBatch } from './world/StaticBatch.js';
export * as Props from './world/Props.js';

export { DayNightCycle, DEFAULT_KEYFRAMES } from './lighting/DayNightCycle.js';
export { FlickerLight } from './lighting/FlickerLight.js';
export { LightPool } from './lighting/LightPool.js';
export { LightShaft } from './lighting/LightShaft.js';
export { ParticleEmitter, ParticlePresets } from './fx/Particles.js';

export { AudioEngine } from './audio/AudioEngine.js';
export { Music, MUSIC_MOODS } from './audio/Music.js';
export { Ambience } from './audio/Ambience.js';
export { Sfx } from './audio/Sfx.js';
export * as Synth from './audio/Synth.js';

export { GameMap } from './game/GameMap.js';
export { parseMapData, parseTiled, loadMapData, toNative } from './game/MapData.js';
export { buildMap } from './game/MapBuilder.js';
export { PrefabRegistry, defaultPrefabs } from './game/Prefabs.js';
export { EventRunner, parseScript } from './game/Events.js';
export { SaveSystem } from './game/SaveSystem.js';
export { NavGrid } from './world/NavGrid.js';
export { DEFAULT_TILE_TYPES, tileTypes } from './world/TileTypes.js';
export { loadSpriteSheet, sheetFromAseprite, sheetFromGrid, gridSheetToAseprite } from './sprites/SpriteSheet.js';
export { Emote } from './sprites/Emote.js';

export { Character } from './entities/Character.js';
export { Wander, Patrol } from './entities/Behaviours.js';
export { UIRoot, DialogueBox, Banner, WorldPrompt, HUD, TitleCard } from './ui/UI.js';
export * as Random from './core/Random.js';
