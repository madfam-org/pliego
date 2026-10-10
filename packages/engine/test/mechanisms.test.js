// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('translate: a driven pin pulls a sheet edge by control/max × travel', () => {
  const b = new DocBuilder('pull');
  b.rect({ id: 'sheet', width: 60, height: 30, placement: { origin: [0, 10, 0], rotation: [0, 0, 0, 1] } });
  b.mechanisms.push({ id: 'pull', type: 'translate', control: 'pull', direction: [1, 0, 0], travel: 20 });
  b.joins.push({ id: 'grip', type: 'pin', a: { sheet: 'sheet', along: [[60, 0], [60, 30]] }, world: null, mechanism: 'pull' });
  b.control({ id: 'pull', kind: 'distance', min: 0, max: 10, default: 0, unit: 'mm' });
  const w = new World(b.build(), { meshEdge: 6, gravity: false, ground: false });
  const grip = [];
  for (let v = 0; v < w.mesh.nV; v++) if (Math.abs(w.mesh.uv[2 * v] - 60) < 1e-9) grip.push(v);
  const x0 = w.x[3 * grip[0]];
  w.setControl('pull', 5); // half of max → 10 mm along +x
  for (let f = 0; f < 60; f++) w.step();
  const dx = w.x[3 * grip[0]] - x0;
  const pass = Math.abs(dx - 10) < 1e-9 && w.stats().finite && w.stats().maxStrain < 0.005;
  proof('translate-pin', dx, 10, '±1e-9 mm, stretch <0.5%', pass, `the gripped edge drags the free sheet; max stretch ${(w.stats().maxStrain * 100).toFixed(3)}%`);
  assert.ok(pass);
});
