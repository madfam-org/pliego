import test from 'node:test';
import assert from 'node:assert/strict';
import { BarrierContact, gapBarrier } from '../src/collision/barrier.js';

test('unmollified parallel EE contact has a cusp, so a selected branch is not a smooth-gradient certificate', () => {
  // Analytical segment element: a longer fixed edge below a shorter free edge.
  // Tilting the upper edge gives d=0.12-|epsilon| while both endpoints project
  // inside the fixed edge. This is not a fabricated native sheet document.
  const x = new Float64Array([-1, 0, 0, 1, 0, 0, -0.5, 0.12, 0, 0.5, 0.12, 0]);
  const w = { mesh: { nV: 4, nT: 0, nE: 2, tris: new Int32Array(), edges: new Int32Array([0, 1, 2, 3]),
    vGroup: new Int32Array([0, 1, 2, 3]), vSheet: new Int32Array([0, 0, 1, 1]), triSheet: new Int32Array() },
    doc: { sheets: [0, 1].map(() => ({ derived: { collision_thickness: 0.1 } })) },
    fixed: new Uint8Array([1, 1, 0, 0]), opts: { ground: false }, contact: { weldSheet: new Int32Array(4).fill(-1) } };
  const p = new BarrierContact(w, { stiffness: 100 }), g = new Float64Array(12), energy = p.evaluate(w, x, g);
  assert.equal(p.count, 1);
  const slope = -g[7] + g[10], derivatives = new Float64Array(2);
  gapBarrier(0.02, 0.05, 100, derivatives);
  assert.ok(Math.abs(slope + derivatives[0]) < 1e-10);
  for (const epsilon of [1e-5, 1e-7]) {
    const a = x.slice(), b = x.slice(); a[7] -= epsilon; a[10] += epsilon; b[7] += epsilon; b[10] -= epsilon;
    const plus = p.evaluate(w, a), minus = p.evaluate(w, b);
    assert.ok(plus > energy && minus > energy); assert.equal(plus, minus);
    assert.ok(Math.abs(plus - gapBarrier(0.02 - epsilon, 0.05, 100)) < 1e-12);
    assert.ok(Math.abs((plus - energy) / epsilon / slope - 1) < 0.001);
  }
  console.log(`parallel-EE-limit: central slope=0; one-sided slopes approach ±${slope} µN; unmollified potential is nonsmooth, regularization gate OPEN`);
});
