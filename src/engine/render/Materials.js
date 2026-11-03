import * as THREE from 'three';
import { Textures } from '../pixel/TextureFactory.js';
import { patchMaterial } from './MaterialPatch.js';

/**
 * Shared lit materials keyed by texture recipe name. All world geometry
 * goes through here so it receives cloud shadows and shares programs.
 */
const cache = new Map();

export function worldMaterial(textureName, { vertexColors = false, color = 0xffffff, emissiveMap = null, emissive = 0x000000, side = THREE.FrontSide, key = '' } = {}) {
  const k = `${textureName}|${vertexColors}|${color}|${key}`;
  if (cache.has(k)) return cache.get(k);
  const map = Textures[textureName]();
  const m = new THREE.MeshLambertMaterial({ map, vertexColors, color, side });
  if (emissiveMap) {
    m.emissiveMap = emissiveMap;
    m.emissive = new THREE.Color(emissive);
  }
  patchMaterial(m, { clouds: true, cutout: true });
  m.name = textureName;
  cache.set(k, m);
  return m;
}

export function clearMaterialCache() {
  cache.clear();
}
