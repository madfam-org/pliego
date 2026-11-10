import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SweptCandidates } from '../src/collision/swept.js';
import { World } from '../src/index.js';
import { mulberry32 } from '../src/geom.js';
import { pageLeaf } from './helpers/docbuilder.js';
import { readingBook, readingPose } from '../../../apps/web/studio/src/book-layout.js';

const result = c => ({ vt: c.vt.slice(0, 2 * c.vertexTriangleCount), ee: c.ee.slice(0, 2 * c.edgeEdgeCount) });
function mesh(nV) {
  return { nV, nT: nV / 3, nE: nV / 2, tris: Int32Array.from({ length: nV }, (_, i) => i), edges: Int32Array.from({ length: nV }, (_, i) => i),
    vGroup: Int32Array.from({ length: nV }, (_, i) => i), vSheet: Int32Array.from({ length: nV }, (_, i) => Math.floor(i / 3) % 3),
    triSheet: Int32Array.from({ length: nV / 3 }, (_, i) => i % 3) };
}

test('BVH retains ordered reference pairs through dense ties, large refits and changing exclusions', () => {
  let pairs = 0, builds = 0;
  for (const size of [0, 6, 24, 120]) {
    const m = mesh(size), random = mulberry32(734 + size), tc = Float64Array.from({ length: size }, () => random() * 2);
    const reference = new SweptCandidates(m, tc), indexed = new SweptCandidates(m, tc, 'bvh');
    const fixed = new Uint8Array(size), weld = new Int32Array(size).fill(-1);
    let topology;
    for (let sample = 0; sample < 48; sample++) {
      // Periodic dense coincident bounds stress min-X ties and output growth.
      // Otherwise independently deform both endpoints well beyond the old50mm cap.
      const from = Float64Array.from({ length: 3 * size }, () => sample % 8 ? 400 * random() - 200 : -0);
      const to = from.map(x => sample % 8 ? x + 1000 * random() - 500 : 0);
      for (let v = 0; v < size; v++) {
        fixed[v] = sample === 0 ? v % 6 < 3 ? 1 : 0 : sample % 3 ? random() > 0.4 ? 1 : 0 : 1;
        weld[v] = sample % 5 ? random() > 0.8 ? Math.floor(3 * random()) : -1 : -1;
        // Some prescribed vertices are moving, some exactly stationary.
        if (sample % 4 === 0 || (fixed[v] && random() > 0.5)) for (let k = 0; k < 3; k++) to[3 * v + k] = from[3 * v + k];
      }
      reference.build(from, to, fixed, weld); indexed.build(from, to, fixed, weld);
      assert.deepEqual(result(indexed), result(reference), `ordered pairs, size=${size} sample=${sample}`);
      assert.deepEqual(indexed.vertexBoxes, reference.vertexBoxes); assert.deepEqual(indexed.triangleBoxes, reference.triangleBoxes); assert.deepEqual(indexed.edgeBoxes, reference.edgeBoxes);
      const current = [indexed.triangleTree.primitive.slice(), indexed.edgeTree.primitive.slice()];
      if (topology) assert.deepEqual(current, topology, 'refit must preserve the existing tree topology'); else topology = current;
      pairs += indexed.vertexTriangleCount + indexed.edgeEdgeCount; builds++;
    }
  }
  assert.ok(pairs > 10000);
  assert.throws(() => new SweptCandidates(mesh(0), new Float64Array(), 'invalid'), /broad phase/);
  console.log(`swept-BVH-order: builds=${builds}, emitted pairs compared=${pairs}; reference order/bounds exact across refits and exclusions`);
});

test('BVH keeps moving prescribed crossings and prunes only exact stationary/stationary nodes', () => {
  const m = { nV: 4, nT: 1, nE: 3, tris: new Int32Array([1, 2, 3]), edges: new Int32Array([1, 2, 2, 3, 3, 1]),
    vGroup: new Int32Array([0, 1, 2, 3]), vSheet: new Int32Array([1, 0, 0, 0]), triSheet: new Int32Array([0]) };
  const c = new SweptCandidates(m, new Float64Array(4).fill(0.1), 'bvh');
  const x = new Float64Array([0.25, 0.3, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]), y = x.slice(); y[1] = -100;
  const fixed = new Uint8Array(4).fill(1), weld = new Int32Array(4).fill(-1);
  c.build(x, y, fixed, weld); assert.deepEqual(result(c).vt, new Int32Array([0, 0]));
  c.build(x, x, fixed, weld); assert.equal(c.vertexTriangleCount, 0); assert.equal(c.triangleTree.nodeTests, 0);
  fixed[0] = 0; c.build(x, y, fixed, weld); assert.equal(c.vertexTriangleCount, 1);
  weld[0] = 0; c.build(x, y, fixed, weld); assert.equal(c.vertexTriangleCount, 0);
  console.log('swept-BVH-prescribed: moving fixed crossing retained; fully stationary nodes pruned; changed weld/free state refitted');
});

test('BVH exact-pose reuse invalidates on every live collision input and preserves ordered bounds/pairs', () => {
  const m = mesh(24), tc = new Float64Array(24).fill(0.1), x = new Float64Array(72);
  const fixed = new Uint8Array(24), weld = new Int32Array(24).fill(-1);
  const reference = new SweptCandidates(m, tc), c = new SweptCandidates(m, tc, 'bvh');
  let checks = 0;
  const check = () => {
    reference.build(x, x, fixed, weld); c.build(x, x, fixed, weld);
    assert.equal(c.reusedLastBuild, false);
    assert.deepEqual(result(c), result(reference));
    for (const key of ['vertexBoxes', 'triangleBoxes', 'edgeBoxes']) assert.deepEqual(c[key], reference[key]);
    c.build(x.slice(), x.slice(), fixed, weld); assert.equal(c.reusedLastBuild, false, 'sweep inputs are not cached');
    c.build(x, x, fixed, weld); assert.equal(c.reusedLastBuild, false);
    const copy = x.slice(); c.build(copy, copy, fixed.slice(), weld.slice());
    assert.equal(c.reusedLastBuild, true, 'equal contents in new arrays reuse');
    assert.equal(c.triangleTree.nodeTests + c.edgeTree.nodeTests, 0);
    assert.deepEqual(result(c), result(reference)); checks++;
  };
  check();
  for (const change of [() => { x[0] = -0; }, () => { x[1] = 1; }, () => { fixed[0] = 1; },
    () => { weld[0] = 0; }, () => { tc[0] = 0.2; }, () => { m.vGroup[0] = 9; },
    () => { m.vSheet[0] = 2; }, () => { m.triSheet[0] = 2; }]) { change(); check(); }
  c.build(x, x, fixed, weld, false); assert.equal(c.reusedLastBuild, false, 'forced rebuild control');
  x[2] = NaN; assert.throws(() => c.build(x, x, fixed, weld), /non-finite/);
  x[2] = 0; check();
  console.log(`swept-BVH-reuse: ${checks} input states; exact ordered pairs/bounds, signed zero, live filters, swept bypass and nonfinite recovery`);
});

test('BVH native leaf matches reference pose/forces/CCD diagnostics and restores exactly', () => {
  const options = { meshEdge: 12, substeps: 4, barrierContact: true, barrierIterations: 8, barrierLinearSolver: 'direct-local',
    consistentMembraneCurvature: true, gravity: false, ground: false, plasticity: false };
  const a = new World(pageLeaf({ width: 30, height: 40 }), options), b = new World(pageLeaf({ width: 30, height: 40 }), { ...options, contactBroadPhase: 'bvh' });
  assert.equal(b.coupledContact.potential.candidates.mode, 'bvh'); assert.equal(b.coupledContact.guard.candidates.mode, 'bvh');
  for (const w of [a, b]) w.setControl('turn', 45);
  for (let f = 0; f < 12; f++) {
    a.step(); b.step(); assert.deepEqual(a.x, b.x); assert.deepEqual(a.v, b.v); assert.deepEqual(a.stats().coupledContact, b.stats().coupledContact);
  }
  const snapshot = b.snapshot(); for (let f = 0; f < 4; f++) b.step();
  const x = b.x.slice(), diagnostics = b.stats().coupledContact;
  b.restore(snapshot); for (let f = 0; f < 4; f++) b.step();
  assert.deepEqual(b.x, x); assert.deepEqual(b.stats().coupledContact, diagnostics);
  console.log('swept-BVH-world: 12 native frames match reference exactly; indexed pose and diagnostic replay exact');
});

test('BVH matches the retained late-turn gradient, local direction and backtracked search', () => {
  const types = { Float64Array, Float32Array, Int32Array, Uint32Array, Uint8Array };
  const capture = JSON.parse(readFileSync(new URL('../../../docs/research/evidence/paper-2026-11-09/late-turn-objective.json', import.meta.url)),
    (_key, value) => value?.typed && types[value.typed] ? new types[value.typed](value.data) : value);
  const s = capture.state, states = [];
  for (const contactBroadPhase of ['reference', 'bvh']) {
    const w = new World(readingPose(s.json, readingBook(s.json), s.active), { ...s.options, contactBroadPhase });
    w.restore(s.snapshot); w.dt = s.dt; w.xs.set(s.xs); w.xt.set(s.xt);
    const c = w.coupledContact, before = c.evaluate(w), g = w.g.slice();
    assert.equal(before, s.last.incrementalEnergy); assert.equal(c.last.residual, s.last.residual);
    c.start.set(w.x); c.direction(w); const direction = w.x.slice();
    assert.ok(c.search(w, before)); assert.ok(c.backtracks > 0);
    states.push({ g, direction, accepted: w.x.slice(), diagnostics: c.snapshot() });
  }
  assert.deepEqual(states[0], states[1]);
  console.log('swept-BVH-late-contact: 1592-stencil native objective, direction, accepted pose and full diagnostic state equal reference');
});
