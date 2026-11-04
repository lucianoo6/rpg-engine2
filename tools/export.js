// Export procedural sprites (PNG + Aseprite JSON) and the Tiled tileset image.
import { makeCharacterSheet } from '../src/engine/pixel/CharacterFactory.js';
import { gridSheetToAseprite } from '../src/engine/sprites/SpriteSheet.js';
import { Textures } from '../src/engine/pixel/TextureFactory.js';
import { DEFAULT_TILE_TYPES } from '../src/engine/world/TileTypes.js';
import { CAST } from '../src/demo/cast.js';

export const HEIGHT_STEPS = 13; // heights 0, 0.5 … 6

function download(name, href) {
  const a = document.createElement('a');
  a.textContent = name;
  a.download = name;
  a.href = href;
  return a;
}

export function exportCharacter(key) {
  const sheet = makeCharacterSheet(CAST[key].look);
  const canvas = sheet.canvas.toCanvas();
  const json = gridSheetToAseprite(sheet, `${key}.png`);
  return { canvas, png: canvas.toDataURL('image/png'), json };
}

/** Tileset image: one swatch per tile type, then height markers. */
export function exportTileset() {
  const cols = 8;
  const count = DEFAULT_TILE_TYPES.length + HEIGHT_STEPS;
  const rows = Math.ceil(count / cols);
  const c = document.createElement('canvas');
  c.width = cols * 16;
  c.height = rows * 16;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const tiles = [];
  DEFAULT_TILE_TYPES.forEach((t, i) => {
    const img = Textures[t.top]().image;
    ctx.drawImage(img, 0, 0, 16, 16, (i % cols) * 16, Math.floor(i / cols) * 16, 16, 16);
    tiles.push({ id: i, properties: [{ name: 'type', type: 'string', value: t.name }] });
  });
  for (let k = 0; k < HEIGHT_STEPS; k++) {
    const i = DEFAULT_TILE_TYPES.length + k;
    const x = (i % cols) * 16, y = Math.floor(i / cols) * 16;
    const g = Math.round(40 + (k / (HEIGHT_STEPS - 1)) * 200);
    ctx.fillStyle = `rgb(${g},${g},${g})`;
    ctx.fillRect(x, y, 16, 16);
    ctx.fillStyle = g > 140 ? '#000' : '#fff';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(String(k * 0.5), x + 8, y + 11);
    tiles.push({ id: i, properties: [{ name: 'height', type: 'float', value: k * 0.5 }] });
  }
  return { canvas: c, png: c.toDataURL('image/png'), tiles, columns: cols, tilecount: count, width: c.width, height: c.height };
}

function show(row, canvas, links, scale = 3) {
  const fig = document.createElement('figure');
  canvas.style.width = `${canvas.width * scale}px`;
  fig.appendChild(canvas);
  for (const l of links) fig.appendChild(l);
  row.appendChild(fig);
}

const chars = document.getElementById('chars');
for (const key of Object.keys(CAST)) {
  const e = exportCharacter(key);
  const json = URL.createObjectURL(new Blob([JSON.stringify(e.json, null, 1)], { type: 'application/json' }));
  show(chars, e.canvas, [download(`${key}.png`, e.png), download(`${key}.json`, json)], 2);
}
const ts = exportTileset();
const tsj = { columns: ts.columns, image: 'hd2d-tiles.png', imagewidth: ts.width, imageheight: ts.height, margin: 0, name: 'hd2d', spacing: 0, tilecount: ts.tilecount, tilewidth: 16, tileheight: 16, tiles: ts.tiles, type: 'tileset', version: '1.10' };
show(document.getElementById('tiles'), ts.canvas, [download('hd2d-tiles.png', ts.png), download('hd2d-tiles.tsj', URL.createObjectURL(new Blob([JSON.stringify(tsj, null, 1)])))], 4);

// for scripted export (see README)
window.__export = { exportCharacter, exportTileset, tilesetJson: tsj };
