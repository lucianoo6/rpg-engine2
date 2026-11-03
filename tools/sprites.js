// Sprite gallery: renders every procedural sprite at 4x for inspection.
import { makeCharacterSheet, makeCatSheet } from '../src/engine/pixel/CharacterFactory.js';
import * as SF from '../src/engine/pixel/SpriteFactory.js';
import * as TF from '../src/engine/pixel/TextureFactory.js';
import { CAST } from '../src/demo/cast.js';

const SCALE = Number(new URLSearchParams(location.search).get('scale') || 4);

function section(title) {
  const h = document.createElement('h2');
  h.textContent = title;
  document.body.appendChild(h);
  const row = document.createElement('div');
  row.className = 'row';
  document.body.appendChild(row);
  return row;
}

function show(row, pc, label, scale = SCALE) {
  const fig = document.createElement('figure');
  const c = pc.toCanvas();
  c.style.width = `${pc.w * scale}px`;
  c.style.height = `${pc.h * scale}px`;
  fig.appendChild(c);
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  fig.appendChild(cap);
  row.appendChild(fig);
}

const chars = section('Characters');
for (const [key, c] of Object.entries(CAST)) show(chars, makeCharacterSheet(c.look).canvas, c.name, 3);
show(chars, makeCatSheet().canvas, 'Cat', 3);

const flora = section('Foliage');
show(flora, SF.paintTree({ seed: 3 }), 'tree');
show(flora, SF.paintTree({ seed: 7, leaf: '#c9773a', bark: '#5d4030' }), 'autumn tree');
show(flora, SF.paintTree({ seed: 11, leaf: '#5d9a45', fruit: '#d83a3a' }), 'apple tree');
show(flora, SF.paintPine({ seed: 5 }), 'pine');
show(flora, SF.paintBush({ seed: 2 }), 'bush');
show(flora, SF.paintBush({ seed: 4, flowers: '#f2a3c4' }), 'flower bush');
show(flora, SF.paintTuft({ seed: 1 }), 'tuft');
show(flora, SF.paintFlowers({ seed: 2 }), 'flowers');
show(flora, SF.paintFlowers({ seed: 3, color: '#e98fb0' }), 'flowers');
show(flora, SF.paintReeds({ seed: 1 }), 'reeds');
show(flora, SF.paintRock({ seed: 1 }), 'rock');
show(flora, SF.paintLilyPad({ seed: 1, flower: true }), 'lily');
show(flora, SF.paintSign(), 'sign');
show(flora, SF.paintFireFrames(), 'fire', 3);

const tex = section('Tiles & materials');
const recipes = ['paintGrass', 'paintDirt', 'paintCobble', 'paintSand', 'paintSlab', 'paintFarmland', 'paintCliff', 'paintEarthSide', 'paintBrick', 'paintPlanks', 'paintPlaster', 'paintRoof', 'paintWindow', 'paintDoor', 'paintCrate', 'paintBarrel'];
for (const r of recipes) show(tex, TF[r](), r.replace('paint', ''), 3);
