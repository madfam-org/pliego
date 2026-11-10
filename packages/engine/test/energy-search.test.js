import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { pageLeaf } from './helpers/docbuilder.js';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy, EnergySearch } from '../src/xpbd/energy-search.js';

function world() {
  return new World(pageLeaf({ width: 40, height: 60 }), {
    meshEdge: 12, substeps: 8, lineSearch: true, gravity: false, ground: false, contact: false, plasticity: false,
  });
}

test('implicit objective agrees with the solver gradient by independent finite differences', () => {
  const w = world(); w.step(); w.xt.set(w.x);
  const d = new Float64Array(w.x.length);
  for (let v = 0; v < w.mesh.nV; v++) if (w.invMass[v]) for (let c = 0; c < 3; c++) {
    w.x[3 * v + c] += 0.03 * Math.sin(v * 0.7 + c); d[3 * v + c] = Math.cos(v * 0.3 - c);
  }
  const g = new Float64Array(w.x.length); gradient(w, w.x, g);
  let slope = 0;
  for (let v = 0; v < w.mesh.nV; v++) if (w.invMass[v]) for (let c = 0; c < 3; c++) {
    const i = 3 * v + c; g[i] += w.mass[v] / w.dt ** 2 * (w.x[i] - w.xt[i]); slope += g[i] * d[i];
  }
  const h = 1e-6, a = w.x.map((v, i) => v + h * d[i]), b = w.x.map((v, i) => v - h * d[i]);
  const fd = (implicitEnergy(w, a) - implicitEnergy(w, b)) / (2 * h);
  const error = Math.abs(fd - slope) / Math.max(1, Math.abs(fd), Math.abs(slope));
  assert.ok(error < 1e-5, `directional derivative error=${error}`);
  console.log(`implicit-energy: finite-difference relative error=${error}; inertia/membrane/bending/drive objective`);
});

test('energy search backtracks an excessive descent direction and exposes rejected updates', () => {
  const w = world(); w.step(); w.xt.set(w.x);
  for (let v = 0; v < w.mesh.nV; v++) if (w.invMass[v]) w.x[3 * v] += 0.1;
  const g = new Float64Array(w.x.length); gradient(w, w.x, g);
  for (let v = 0; v < w.mesh.nV; v++) if (w.invMass[v]) for (let c = 0; c < 3; c++) g[3 * v + c] += w.mass[v] / w.dt ** 2 * (w.x[3 * v + c] - w.xt[3 * v + c]);
  const search = new EnergySearch(w.x.length); search.begin(w);
  const before = implicitEnergy(w, w.x);
  for (let i = 0; i < w.x.length; i++) if (w.invMass[Math.floor(i / 3)]) w.x[i] -= g[i] * 0.001;
  search.finish(w, g);
  assert.ok(implicitEnergy(w, w.x) <= before * (1 + 1e-12));
  assert.ok(search.backtracks > 0, 'deliberately excessive gradient step must backtrack');
  search.begin(w); const old = w.x.slice();
  w.x.findIndex((_, i) => { if (w.invMass[Math.floor(i / 3)]) { w.x[i] = NaN; return true; } return false; });
  search.finish(w, g);
  assert.deepEqual(w.x, old); assert.equal(search.rejected, 1);
  console.log(`implicit-energy: oversized descent backtracks=${search.backtracks}; non-finite proposal rejected and restored`);
});

test('line-search physics replays bit-exactly through snapshot and restore', () => {
  const w = world(); w.setControl('turn', 90);
  for (let i = 0; i < 10; i++) w.step();
  const s = w.snapshot();
  for (let i = 0; i < 10; i++) w.step();
  const x = w.x.slice(), stats = w.stats(); w.restore(s);
  for (let i = 0; i < 10; i++) w.step();
  assert.deepEqual(w.x, x);
  assert.equal(w.stats().lineSearchBacktracks, stats.lineSearchBacktracks);
  assert.equal(w.stats().lineSearchRejected, stats.lineSearchRejected);
  console.log('implicit-energy: native leaf replay and search diagnostics identical after restore');
});
