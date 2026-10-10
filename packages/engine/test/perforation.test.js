// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** Card with a perforated line across it; the body is held, the stub pulled by a translate mechanism. */
function perforatedCard() {
  const b = new DocBuilder('perforated card');
  const s = b.sheet({ id: 'card', stock: 'cardstock-250', width: 120, height: 50 });
  const v = (/** @type {number} */ u, /** @type {number} */ w) => b.vertex(s, u, w);
  const p0 = v(0, 0), p1 = v(90, 0), p2 = v(120, 0), p3 = v(120, 50), p4 = v(90, 50), p5 = v(0, 50);
  b.face([p0, p1, p4, p5]); b.face([p1, p2, p3, p4]);
  b.assign(p1, p4, 'C', 0, 'perforation');
  b.joins.push({ id: 'hold', type: 'pin', a: { sheet: 'card', along: [[0, 0], [0, 50]] }, world: null });
  b.joins.push({ id: 'grip', type: 'pin', a: { sheet: 'card', along: [[120, 0], [120, 50]] }, world: null, mechanism: 'pull' });
  b.mechanisms.push({ id: 'pull', type: 'translate', control: 'pull', direction: [1, 0, 0], travel: 10 });
  b.control({ id: 'pull', kind: 'distance', min: 0, max: 10, default: 0, unit: 'mm' });
  return b.build();
}

test('perforation: holds under a small pull, tears along the line under a large one', () => {
  const run = (/** @type {number} */ pull) => {
    const w = new World(perforatedCard(), { meshEdge: 5, gravity: false, ground: false });
    w.setControl('pull', pull);
    for (let f = 0; f < 60; f++) w.step();
    return { torn: w.stats().tornWelds, pairs: w.mesh.perfPairs.length / 2, finite: w.stats().finite };
  };
  const small = run(0.05), large = run(10);
  const pass = small.torn === 0 && large.torn === large.pairs && small.finite && large.finite;
  proof('perforation-tear', `small=${small.torn}/${small.pairs} large=${large.torn}/${large.pairs}`, 'small=0, large=all', 'tear only past perf_factor·tear_strain', pass);
  assert.ok(pass);
});
