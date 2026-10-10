// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { tissueFlag } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('wind-tissue: 17 g/m² flag pinned along its top edge in 2 m/s wind, 3000 frames', () => {
  const w = new World(tissueFlag(), { meshEdge: 8, contact: false, ground: false, seed: 7 });
  w.setControl('wind', 2);
  const nV = w.mesh.nV;
  const mean = new Float64Array(3 * nV), sq = new Float64Array(3 * nV);
  let samples = 0, finite = true, maxS = 0;
  for (let f = 0; f < 3000; f++) {
    w.step();
    if (f % 100 === 99) { const s = w.stats(); finite = finite && s.finite; maxS = Math.max(maxS, s.maxStrain); if (!finite) break; }
    if (f >= 1000) { for (let i = 0; i < 3 * nV; i++) { mean[i] += w.x[i]; sq[i] += w.x[i] * w.x[i]; } samples++; }
  }
  let rms = 0;
  for (let v = 0; v < nV; v++) {
    let s = 0;
    for (let c = 0; c < 3; c++) { const m = mean[3 * v + c] / samples; s += sq[3 * v + c] / samples - m * m; }
    rms = Math.max(rms, Math.sqrt(Math.max(0, s)));
  }
  const pass = finite && rms > 1;
  proof('wind-tissue', rms, '>1 mm', 'rms displacement >1 mm, stable, no NaN', pass, `3000 frames, max stretch ${(maxS * 100).toFixed(3)}%, seed 7`);
  assert.ok(pass);
});
