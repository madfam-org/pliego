import test from 'node:test';
import assert from 'node:assert/strict';
import { BarrierContact, gapBarrier } from '../src/collision/barrier.js';
import { edgeEdgeMollifier } from '../src/collision/edge-mollifier.js';
import { surfacePair, centerFan } from './helpers/contact-surfaces.js';
import { World } from '../src/index.js';
import { mulberry32 } from '../src/geom.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { LocalContactSolve } from '../src/xpbd/local-contact-solve.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from '../src/collision/distance.js';

test('native multiplier has a C1 clamp, declared zero-threshold branch and correct scaling/duplicate-role derivatives', () => {
  const ids = new Int32Array([0, 1, 2, 3]), values = new Float64Array(3), g = new Float64Array(12), J = new Float64Array(36);
  const x = new Float64Array([-1, 0, 0, 1, 0, 0, -0.5, 0.12, -0.001, 0.5, 0.12, 0.001]);
  edgeEdgeMollifier(x, ids, 0.004, values, g, J); const base = values[0], baseGradient = g.slice();
  for (const scale of [0.001, 1, 1000]) {
    edgeEdgeMollifier(x.map(z => scale * z), ids, 0.004 * scale ** 4, values, g, J);
    assert.ok(Math.abs(values[0] - base) < 1e-15);
    for (let i = 0; i < g.length; i++) assert.ok(Math.abs(scale * g[i] - baseGradient[i]) < 1e-12);
  }
  edgeEdgeMollifier(x, ids, 1, values); const clamp = values[2];
  edgeEdgeMollifier(x, ids, clamp, values, g, J); assert.equal(values[0], 1); assert.ok(g.every(z => z === 0));
  for (const delta of [1e-3, 1e-5]) {
    edgeEdgeMollifier(x, ids, clamp / (1 - delta), values, g, J);
    assert.ok(Math.abs(values[0] - (1 - delta ** 2)) < 1e-15);
    assert.ok(Math.max(...g.map(Math.abs)) < 5e3 * delta);
  }
  const parallel = x.slice(); parallel[8] = parallel[11] = 0;
  edgeEdgeMollifier(parallel, ids, 0, values, g, J); assert.equal(values[0], 1); assert.ok(g.every(z => z === 0));
  const repeated = new Int32Array([0, 1, 1, 2]), y = new Float64Array([0, 0, 0, 1, 0, 0, 2, 0.001, 0]);
  edgeEdgeMollifier(y, repeated, 0.001, values, g, J);
  const summed = new Float64Array(9); for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++) summed[3 * repeated[i] + k] += g[3 * i + k];
  for (let i = 0; i < y.length; i++) {
    const a = y.slice(), b = y.slice(), h = 1e-7; a[i] += h; b[i] -= h;
    edgeEdgeMollifier(a, repeated, 0.001, values); const plus = values[0];
    edgeEdgeMollifier(b, repeated, 0.001, values);
    assert.ok(Math.abs((plus - values[0]) / (2 * h) - summed[i]) < 1e-7);
  }
  assert.throws(() => edgeEdgeMollifier(x, ids, -1, values), /nonnegative/);
  assert.throws(() => edgeEdgeMollifier(x, ids, 0.004, values, g), /scratch buffer/);
  console.log('native-mollifier: C1 clamp, zero threshold, three scales and repeated-endpoint role derivatives checked');
});

test('surface admission follows current topology, fixed/weld flags and sufficient VT caliper', () => {
  const w = surfacePair(), P = new BarrierContact(w), S = P.surface;
  w.fixed.fill(1, 0, 3);
  assert.equal(S.covers(w, 0, 3, 0.1), true);
  w.contact.weldSheet[0] = 1; assert.equal(S.covers(w, 0, 3, 0.1), false); w.contact.weldSheet[0] = -1;
  w.mesh.vGroup[0] = 3; assert.equal(S.covers(w, 0, 3, 0.1), false); w.mesh.vGroup[0] = 0;
  w.fixed.fill(1); assert.equal(S.covers(w, 0, 3, 0.1), false); w.fixed.fill(0, 3);
  const tc = P.thickness; tc[0] = 0.05; tc[1] = 0.15;
  assert.equal(S.covers(w, 0, 3, 0.125), false, 'a smaller VT offset cannot back up the larger EE offset');
  tc[5] = 0.2; assert.equal(S.covers(w, 0, 3, 0.125), true, 'a larger retained VT offset is sufficient');
  const fan = centerFan(), Q = new BarrierContact(fan);
  assert.equal(Q.surface.covers(fan, 0, 6, 0.1), false);
  console.log('mollifier-coverage: live group/weld/fixed and VT-offset admission checked; central-fan counterexample refused');
});

test('admitted parallel surface pairs retain an actual geometric VT backup through spatial rotations and refits', () => {
  const w = surfacePair(), P = new BarrierContact(w), C = P.candidates, random = mulberry32(375);
  w.fixed.fill(1, 0, 3); let checks = 0;
  for (let sample = 0; sample < 96; sample++) {
    const theta = 6 * random(), phi = 6 * random(), n = [Math.cos(theta) * Math.cos(phi), Math.sin(theta), Math.cos(theta) * Math.sin(phi)];
    const u = [-Math.sin(phi), 0, Math.cos(phi)], z = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]];
    const shift = random() - 0.5, half = 0.2 + 0.6 * random(), separation = 0.101 + 0.048 * random(), origin = Array.from({ length: 3 }, () => 1e4 * (random() - 0.5));
    const uv = [[-1, 0, 0], [1, 0, 0], [0, 0, -2], [shift - half, separation, 0], [shift + half, separation, 0], [shift, separation, 2]];
    const x = Float64Array.from({ length: 18 }, (_, i) => origin[i % 3] + uv[Math.floor(i / 3)][0] * u[i % 3] + uv[Math.floor(i / 3)][1] * n[i % 3] + uv[Math.floor(i / 3)][2] * z[i % 3]);
    C.build(x, x, w.fixed, w.contact.weldSheet); assert.equal(P.surface.covers(w, 0, 3, 0.1), true);
    const distance = Math.sqrt(edgeEdgeDistanceSquared(x, 0, 1, 3, 4));
    let backup = Infinity;
    for (let pair = 0; pair < C.vertexTriangleCount; pair++) {
      const v = C.vt[2 * pair], t = C.vt[2 * pair + 1];
      backup = Math.min(backup, Math.sqrt(pointTriangleDistanceSquared(x, v, w.mesh.tris[3 * t], w.mesh.tris[3 * t + 1], w.mesh.tris[3 * t + 2])));
    }
    assert.ok(backup <= distance + 1e-9); checks++;
  }
  console.log(`mollifier-spatial-coverage: admitted parallel pairs=${checks}, retained VT distance <= EE through rotated/translated refits`);
});

test('mollification preserves uncovered fan energy/force and rejects infeasible covered pairs even at m=0', () => {
  const w = centerFan(), P = new BarrierContact(w), g = new Float64Array(w.x.length), E = P.evaluate(w, w.x, g);
  w.opts.edgeEdgeMollification = 'off'; const Q = new BarrierContact(w), h = new Float64Array(w.x.length);
  assert.equal(Q.evaluate(w, w.x, h), E); assert.deepEqual(h, g);
  assert.equal(P.uncoveredEdges, 1); assert.equal(P.smoothedEdges, 0); assert.equal(P.pairCount, 1);
  assert.ok(E > 0);
  const a = surfacePair(), R = new BarrierContact(a), ids = new Int32Array([0, 1, 3, 4]);
  assert.equal(R.surface.covers(a, 0, 3, 0.1), true);
  const bad = a.x.slice(); bad[10] = bad[13] = 0.099;
  assert.equal(R.smoothedStencil(a, bad, ids, 0.1, 0, 3), Infinity);
  const v = new Float64Array(3); edgeEdgeMollifier(bad, ids, 0.004, v); assert.equal(v[0], 0);
  console.log('mollifier-domain: uncovered energy/force identical; m=0 never masks an infeasible geometric gap');
});

test('complete covered mB gradient matches energy finite differences, force/torque balance and PSD symmetry', () => {
  const w = surfacePair(), P = new BarrierContact(w, { stiffness: 100 });
  let checked = 0, maximum = 0;
  for (const tilt of [0, 1e-6, 0.002, 0.008, 0.017]) {
    const x = w.x.slice(); x[10] -= tilt; x[13] += tilt;
    const g = new Float64Array(x.length), E = P.evaluate(w, x, g);
    assert.ok(Number.isFinite(E) && E > 0); assert.ok(P.smoothedEdges > 0 || tilt === 0.017);
    assert.equal(P.uncoveredEdges, 0);
    const d = Float64Array.from(x, (_, i) => Math.sin(i + 0.2)), q = Float64Array.from(x, (_, i) => Math.cos(i + 0.4));
    const Hd = new Float64Array(x.length), Hq = new Float64Array(x.length);
    P.hessianTimes(d, Hd); P.hessianTimes(q, Hq);
    assert.ok(d.reduce((s, z, i) => s + z * Hd[i], 0) >= -1e-8);
    assert.ok(Math.abs(d.reduce((s, z, i) => s + z * Hq[i] - q[i] * Hd[i], 0)) < 1e-7);
    for (let i = 0; i < x.length; i++) {
      const plus = x.slice(), minus = x.slice(), step = 1e-8; plus[i] += step; minus[i] -= step;
      const fd = (P.evaluate(w, plus) - P.evaluate(w, minus)) / (2 * step);
      const error = Math.abs(fd - g[i]) / Math.max(1, Math.abs(g[i])); maximum = Math.max(maximum, error);
      assert.ok(error < 3e-5, `tilt=${tilt} coordinate=${i} error=${error}`); checked++;
    }
    for (let k = 0; k < 3; k++) {
      let force = 0, torque = 0;
      for (let v = 0; v < x.length / 3; v++) {
        force += g[3 * v + k]; torque += x[3 * v + (k + 1) % 3] * g[3 * v + (k + 2) % 3] - x[3 * v + (k + 2) % 3] * g[3 * v + (k + 1) % 3];
      }
      assert.ok(Math.abs(force) < 1e-10); assert.ok(Math.abs(torque) < 1e-10);
    }
  }
  console.log(`mollified-full-energy: Cartesian FD checks=${checked}, max normalized error=${maximum}; force/torque and PSD symmetry pass`);
});

test('covered parallel mB removes the cusp and retains finite nonzero limiting angular curvature', () => {
  const w = surfacePair(), P = new BarrierContact(w, { stiffness: 100 }), ids = new Int32Array([0, 1, 3, 4]);
  const g = new Float64Array(w.x.length);
  assert.equal(P.smoothedStencil(w, w.x, ids, 0.1, 0, 3, g), 0); assert.ok(g.every(v => v === 0));
  assert.equal(P.pairCount, 1); assert.equal(P.count, 3);
  const d = new Float64Array(w.x.length); d[10] = -1; d[13] = 1;
  const Hd = new Float64Array(d.length); P.hessianTimes(d, Hd);
  // c=16 epsilon², E=(32 B/threshold) epsilon²+O(|epsilon|³).
  const exact = 64 / 0.004 * gapBarrier(0.02, 0.05, 100);
  assert.ok(Math.abs(d.reduce((s, z, i) => s + z * Hd[i], 0) - exact) / exact < 1e-12);
  for (const epsilon of [1e-5, 1e-7]) {
    const a = w.x.map((x, i) => x + epsilon * d[i]), b = w.x.map((x, i) => x - epsilon * d[i]);
    const plus = P.smoothedStencil(w, a, ids, 0.1, 0, 3), minus = P.smoothedStencil(w, b, ids, 0.1, 0, 3);
    assert.equal(plus, minus); assert.ok(plus > 0);
    assert.ok(Math.abs((plus + minus) / epsilon ** 2 / exact - 1) < 0.002);
  }
  console.log(`mollified-parallel-limit: E=0, gradient=0, finite positive tilt curvature=${exact}; opposite one-sided slopes tend to zero`);
});

test('native smoothed contact uses the same assembled/matrix-free operator and replays full diagnostics bit-exactly', () => {
  const b = new DocBuilder('mollified native contact');
  for (const [id, y] of [['lower', 1], ['upper', 1.12]]) b.rect({ id, width: 2, height: 3, placement: { origin: [id === 'upper' ? 0.2 : 0, y, 0], rotation: [0, 0, 0, 1] } });
  for (const v of [0, 3]) b.joins.push({ id: `static-${v}`, type: 'pin', a: { sheet: 'lower', along: [[0, v], [2, v]] }, world: null });
  const options = { meshEdge: 10, substeps: 2, barrierContact: true, barrierIterations: 16, barrierLinearSolver: 'direct-local',
    consistentMembraneCurvature: true, edgeEdgeMollification: 'surface-guarded', contactBroadPhase: 'bvh', gravity: false, ground: false, plasticity: false };
  const w = new World(b.build(), options), c = w.coupledContact;
  w.xt.set(w.x);
  c.evaluate(w); c.refactor(w);
  assert.ok(c.potential.smoothedEdges > 0); assert.equal(c.potential.uncoveredEdges, 0);
  assert.ok(c.potential.count > c.potential.pairCount); assert.equal(c.last.contacts, c.potential.pairCount);
  const old = w.x.slice(), g = w.g.slice(), linear = new LocalContactSolve(w);
  assert.equal(linear.solve(w, c.potential), true);
  const delta = w.x.map((x, i) => x - old[i]), Hd = new Float64Array(delta.length);
  hessianTimes(w, old, delta, Hd); c.potential.hessianTimes(delta, Hd);
  let norm = 0, residual = 0;
  for (let i = 0; i < g.length; i++) if (!w.fixed[Math.floor(i / 3)]) { norm = Math.max(norm, Math.abs(g[i])); residual = Math.max(residual, Math.abs(Hd[i] + g[i])); }
  assert.ok(residual / norm < 1e-7); w.x.set(old);
  for (let i = 0; i < 2; i++) w.step();
  const state = w.snapshot(); for (let i = 0; i < 3; i++) w.step();
  const x = w.x.slice(), velocity = w.v.slice(), stats = w.stats().coupledContact;
  w.restore(state); for (let i = 0; i < 3; i++) w.step();
  assert.deepEqual(w.x, x); assert.deepEqual(w.v, velocity); assert.deepEqual(w.stats().coupledContact, stats);
  assert.equal(stats.configuration.edgeEdgeMollification, 'surface-guarded');
  assert.throws(() => new World(b.build(), { edgeEdgeMollification: 'bad' }), /invalid edgeEdgeMollification/);
  assert.throws(() => new World(b.build(), { edgeEdgeMollification: 'surface-guarded' }), /requires barrierContact/);
  console.log(`mollified-native: linear relative residual=${residual / norm}; positions, velocity and force/coverage/CCD diagnostics replay bit-exactly`);
});
