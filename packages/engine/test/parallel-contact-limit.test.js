import test from 'node:test';
import assert from 'node:assert/strict';
import { BarrierContact, gapBarrier } from '../src/collision/barrier.js';
import { SweptCandidates } from '../src/collision/swept.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from '../src/collision/distance.js';

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

test('native neighbor exclusions can remove the VT backup for an eligible parallel EE pair', () => {
  // Analytical six-triangle disk, all faces incident on its central vertex.
  // This audits candidate policy, not an admissible complete World trajectory.
  const x = new Float64Array([-1, 0, 0, 1, 0, 0, 2, 0.2, 1,
    -0.5, 0.12, 0, 0.5, 0.12, 0, -2, 0.2, 1, 0, 0, 2]);
  const edges = [], tris = [];
  for (let i = 0; i < 6; i++) { edges.push(i, (i + 1) % 6, 6, i); tris.push(6, i, (i + 1) % 6); }
  const mesh = { nV: 7, nT: 6, nE: 12, edges: Int32Array.from(edges), tris: Int32Array.from(tris),
    vGroup: Int32Array.from({ length: 7 }, (_, i) => i), vSheet: new Int32Array(7), triSheet: new Int32Array(6) };
  const distance = Math.sqrt(edgeEdgeDistanceSquared(x, 0, 1, 3, 4));
  assert.equal(distance, 0.12);
  assert.equal(Math.sqrt(pointTriangleDistanceSquared(x, 3, 6, 0, 1)), distance);
  for (const mode of ['reference', 'bvh']) {
    const C = new SweptCandidates(mesh, new Float64Array(7).fill(0.15), mode);
    C.build(x, x, new Uint8Array(7), new Int32Array(7).fill(-1));
    assert.equal(C.vertexTriangleCount, 0);
    assert.equal(C.edgeEdgeCount, 1);
    assert.deepEqual(Array.from(C.ee.subarray(0, 2)), [0, 6]);
  }
  // Parallel directions make the published EE multiplier zero. With this
  // stricter native filter, its accompanying VT energy is absent as well.
  assert.ok(gapBarrier(distance - 0.1, 0.05, 100) > 0);
  console.log('parallel-coverage-limit: eligible parallel EE=1, geometric VT backup distance=0.12 mm, retained VT=0; mollification coverage gate OPEN');
});
