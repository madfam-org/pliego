import test from 'node:test';
import assert from 'node:assert/strict';
import { SweptCandidates } from '../src/collision/swept.js';
import { MotionGuard } from '../src/collision/motion-guard.js';
import { mulberry32 } from '../src/geom.js';
import { World } from '../src/index.js';
import { pageLeaf } from './helpers/docbuilder.js';

function mesh(nV, triangles, edges) {
  return { nV, nT: triangles.length / 3, nE: edges.length / 2, tris: Int32Array.from(triangles), edges: Int32Array.from(edges),
    vGroup: Int32Array.from({ length: nV }, (_, i) => i), vSheet: new Int32Array(nV), triSheet: new Int32Array(triangles.length / 3) };
}
const pairs = (buffer, count, unordered = false) => Array.from({ length: count }, (_, i) => {
  const a = buffer[2 * i], b = buffer[2 * i + 1]; return unordered && a > b ? `${b}:${a}` : `${a}:${b}`;
}).sort();
function box(x, y, ids, thickness) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  const radius = Math.max(...ids.map(v => thickness[v])) / 2;
  for (const v of ids) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], x[3 * v + k] - radius, y[3 * v + k] - radius);
    hi[k] = Math.max(hi[k], x[3 * v + k] + radius, y[3 * v + k] + radius);
  }
  return [lo, hi];
}
const overlaps = (a, b) => a[0].every((v, k) => v <= b[1][k] && b[0][k] <= a[1][k]);

test('swept candidates match brute-force bounds with no duplicates across moving/deforming meshes', () => {
  const m = mesh(24, Array.from({ length: 24 }, (_, i) => i), Array.from({ length: 24 }, (_, i) => i));
  const random = mulberry32(24), tc = Float64Array.from({ length: 24 }, () => 0.05 + random());
  const C = new SweptCandidates(m, tc), indexed = new SweptCandidates(m, tc, 'bvh'), fixed = new Uint8Array(24), weld = new Int32Array(24).fill(-1);
  let checks = 0;
  for (let trial = 0; trial < 24; trial++) {
    const from = Float64Array.from({ length: 72 }, () => 10 * random() - 5), to = from.map(v => v + 200 * random() - 100);
    C.build(from, to, fixed, weld);
    const vt = [], ee = [], adjacent = (a, b) => a === b || (a ^ 1) === b;
    for (let v = 0; v < 24; v++) for (let t = 0; t < m.nT; t++) {
      const ids = [...m.tris.slice(3 * t, 3 * t + 3)]; checks++;
      if (!ids.some(a => adjacent(v, a)) && overlaps(box(from, to, [v], tc), box(from, to, ids, tc))) vt.push(`${v}:${t}`);
    }
    for (let e = 0; e < m.nE; e++) for (let f = e + 1; f < m.nE; f++) {
      const a = [...m.edges.slice(2 * e, 2 * e + 2)], b = [...m.edges.slice(2 * f, 2 * f + 2)]; checks++;
      if (overlaps(box(from, to, a, tc), box(from, to, b, tc))) ee.push(`${e}:${f}`);
    }
    const actualVT = pairs(C.vt, C.vertexTriangleCount), actualEE = pairs(C.ee, C.edgeEdgeCount, true);
    assert.deepEqual(actualVT, vt.sort()); assert.deepEqual(actualEE, ee.sort());
    indexed.build(from, to, fixed, weld);
    assert.deepEqual(pairs(indexed.vt, indexed.vertexTriangleCount), vt.sort());
    assert.deepEqual(pairs(indexed.ee, indexed.edgeEdgeCount, true), ee.sort());
    assert.equal(new Set(actualVT).size, actualVT.length); assert.equal(new Set(actualEE).size, actualEE.length);
    C.build(from, to, fixed, weld); assert.deepEqual(pairs(C.vt, C.vertexTriangleCount), actualVT);
    assert.deepEqual(pairs(C.ee, C.edgeEdgeCount, true), actualEE);
  }
  console.log(`swept-bounds: random meshes=24 brute-force pair checks=${checks} per implementation; reference/BVH, >50 mm motion, deterministic and duplicate-free`);
});

test('swept filters retain moving prescribed crossings and exclude stationary/topological/welded pairs', () => {
  const m = mesh(4, [1, 2, 3], [1, 2, 2, 3, 3, 1]); m.vSheet[0] = 1;
  const C = new SweptCandidates(m, new Float64Array(4).fill(0.1));
  const x = new Float64Array([0.25, 0.3, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]), y = x.slice(); y[1] = -100;
  const fixed = new Uint8Array(4).fill(1), weld = new Int32Array(4).fill(-1);
  C.build(x, y, fixed, weld); assert.deepEqual(pairs(C.vt, C.vertexTriangleCount), ['0:0']);
  C.build(x, x, fixed, weld); assert.equal(C.vertexTriangleCount, 0);
  fixed[0] = 0; weld[0] = 0; C.build(x, y, fixed, weld); assert.equal(C.vertexTriangleCount, 0);
  weld[0] = -1; m.vGroup[0] = m.vGroup[1]; C.build(x, y, fixed, weld); assert.equal(C.vertexTriangleCount, 0);
  assert.throws(() => C.build(x.slice(1), y, fixed, weld), RangeError);
  console.log('swept-exclusions: moving prescribed crossing retained; stationary, shared-group and welded contacts excluded explicitly');
});

test('dense swept bounds retain all eligible pairs while growing reusable typed buffers', () => {
  const ids = Array.from({ length: 120 }, (_, i) => i), m = mesh(120, ids, ids);
  const C = new SweptCandidates(m, new Float64Array(120).fill(0.1)), x = new Float64Array(360);
  C.build(x, x, new Uint8Array(120), new Int32Array(120).fill(-1));
  let expectedVT = 0;
  for (let v = 0; v < 120; v++) for (let t = 0; t < 40; t++) {
    if (![3 * t, 3 * t + 1, 3 * t + 2].some(a => a === v || (a ^ 1) === v)) expectedVT++;
  }
  assert.equal(C.vertexTriangleCount, expectedVT); assert.equal(C.edgeEdgeCount, 60 * 59 / 2);
  assert.ok(C.vt.length > 2048 && C.ee.length > 2048);
  console.log(`swept-dense: VT=${expectedVT} EE=${C.edgeEdgeCount}; no capacity truncation`);
});

function toy(kind) {
  const m = kind === 'vertex-triangle' ? mesh(4, [1, 2, 3], [1, 2, 2, 3, 3, 1]) : mesh(4, [], [0, 1, 2, 3]);
  return { mesh: m, doc: { sheets: [{ derived: { collision_thickness: 0.1 } }] },
    fixed: kind === 'vertex-triangle' ? new Uint8Array([0, 1, 1, 1]) : new Uint8Array(4),
    contact: { weldSheet: new Int32Array(4).fill(-1) }, dirty: false };
}

test('whole-mesh bound prevents free vertex–triangle and edge–edge tunneling, with replayable diagnostics', () => {
  for (const contactBroadPhase of ['reference', 'bvh']) {
  for (const kind of ['vertex-triangle', 'edge-edge']) {
    const w = toy(kind); w.opts = { contactBroadPhase }; const guard = new MotionGuard(w);
    assert.equal(guard.candidates.mode, contactBroadPhase);
    const x = kind === 'vertex-triangle'
      ? new Float64Array([0.25, 0.3, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1])
      : new Float64Array([-1, 0, 0, 1, 0, 0, 0, 0.3, -1, 0, 0.3, 1]);
    const y = x.slice(); if (kind === 'vertex-triangle') y[1] = -0.3; else { y[7] = -0.3; y[10] = -0.3; }
    const s = guard.snapshot(); guard.apply(w, x, y); const result = guard.snapshot();
    assert.ok(result.last.time > 0 && result.last.time < 1 / 3); assert.equal(result.limited, 1); assert.equal(w.dirty, true);
    const replay = x.slice();
    if (kind === 'vertex-triangle') replay[1] = -0.3; else { replay[7] = -0.3; replay[10] = -0.3; }
    guard.restore(s); guard.apply(w, x, replay); assert.deepEqual(replay, y); assert.deepEqual(guard.snapshot(), result);
  }
  }
  console.log('motion-guard: reference/BVH eligible VT and EE crossings bounded; positions and diagnostics replay exactly');
});

test('whole-mesh bound refuses initially infeasible inputs and unsupported prescribed collision', () => {
  const w = toy('vertex-triangle'), guard = new MotionGuard(w);
  const x = new Float64Array([0.25, 0.3, 0.25, 0, 0, 0, 1, 0, 0, 0, 0, 1]), y = x.slice(); y[1] = -0.3;
  w.fixed.fill(1);
  assert.throws(() => guard.apply(w, x, y), /prescribed motion/); assert.deepEqual(y, x);
  w.fixed[0] = 0; x[1] = 0.05; y[1] = 0.3;
  assert.throws(() => guard.apply(w, x, y), /initially infeasible/); assert.deepEqual(y, x);
  assert.equal(guard.initialOverlaps, 1);
  console.log('motion-guard-failure: initial overlap and limited prescribed motion fail explicitly; positions restored, caller must restore full World before reuse');
});

test('continuous-contact World is opt-in and replays its motion/diagnostic state', () => {
  const doc = pageLeaf({ width: 40, height: 60 }), opts = { meshEdge: 12, gravity: false, ground: false, plasticity: false };
  const original = new World(doc, opts), disabled = new World(doc, { ...opts, continuousContact: false });
  const w = new World(doc, { ...opts, continuousContact: true });
  for (const world of [original, disabled, w]) world.setControl('turn', 45);
  for (let f = 0; f < 5; f++) { original.step(); disabled.step(); w.step(); }
  assert.deepEqual(original.x, disabled.x); assert.equal(original.motionGuard, null);
  const s = w.snapshot(); for (let f = 0; f < 5; f++) w.step();
  const x = w.x.slice(), diagnostics = w.stats().continuousContact;
  w.restore(s); for (let f = 0; f < 5; f++) w.step();
  assert.deepEqual(w.x, x); assert.deepEqual(w.stats().continuousContact, diagnostics);
  assert.throws(() => new World(doc, { continuousContact: true, contact: false }), /requires contact/);
  console.log(`motion-guard-world: default trajectory unchanged; native leaf steps=${diagnostics.steps}, snapshot replay bit-exact`);
});
