// Guards the shader injections against three.js upgrades: every feature must
// find its injection point in the stock shaders of the installed version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { patchMaterial, missingInjections } from '../../src/engine/render/MaterialPatch.js';

function compile(material, lib) {
  const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader, uniforms: {} };
  material.onBeforeCompile(shader);
  return shader;
}

test('lit sprite material gets billboard, wind, flip, clouds and cutout', () => {
  const m = patchMaterial(new THREE.MeshLambertMaterial(), { billboard: true, wind: 0.1, clouds: true, cutout: true, flip: true });
  const s = compile(m, THREE.ShaderLib.lambert);
  assert.match(s.vertexShader, /objectNormal = hdBillboard\(objectNormal\)/);
  assert.match(s.vertexShader, /transformed = hdBillboard\(transformed\)/);
  assert.match(s.vertexShader, /HD_WIND_HEIGHT/);
  assert.match(s.vertexShader, /vMapUv\.x = 1\.0 - vMapUv\.x/);
  assert.match(s.vertexShader, /vHdWorld = /);
  assert.match(s.fragmentShader, /hdCutout\(\);/);
  assert.match(s.fragmentShader, /1\.0 - hdCloudShadow\(\)/);
  assert.ok(s.uniforms.uCamYaw && s.uniforms.uCutStrength, 'shared uniforms are wired');
});

test('shadow-pass materials get the same deformation', () => {
  for (const [Mat, lib] of [[THREE.MeshDepthMaterial, THREE.ShaderLib.depth], [THREE.MeshDistanceMaterial, THREE.ShaderLib.distance]]) {
    const m = patchMaterial(new Mat(), { billboard: true, wind: 0.1, flip: true, clouds: true });
    const s = compile(m, lib);
    assert.match(s.vertexShader, /transformed = hdBillboard\(transformed\)/, Mat.name);
    assert.doesNotMatch(s.fragmentShader, /hdCloudShadow/, 'no cloud shading in shadow passes');
  }
});

test('no injection point is missing in this three.js version', () => {
  assert.deepEqual([...missingInjections], []);
});

test('program cache key distinguishes feature sets', () => {
  const a = patchMaterial(new THREE.MeshLambertMaterial(), { billboard: true });
  const b = patchMaterial(new THREE.MeshLambertMaterial(), { billboard: true, wind: 0.2 });
  assert.notEqual(a.customProgramCacheKey(), b.customProgramCacheKey());
});
