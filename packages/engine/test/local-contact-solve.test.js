import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { LocalContactSolve } from '../src/xpbd/local-contact-solve.js';
import { BlockCholesky } from '../src/linalg/blockchol.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { gradient } from '../src/xpbd/implicit.js';

test('consistent membrane curvature matches longitudinal force differences on either side of the hysteresis threshold', () => {
  const empty = new Float64Array(), k = 12345;
  const w = { opts: { consistentMembraneCurvature: true }, mesh: { nE: 1, nH: 0, edges: [0, 1], edgeLen: [100] },
    kMem: [k], kCompFactor: 0.05, kCompModel: 0.25, edgeComp: [0], edgeK: [0], edgeDir: new Float64Array(3),
    hingeGrad: empty, terms: { count: 0 } };
  for (const L of [99.9, 99.99995, 100.1]) {
    const x = new Float64Array([0, 0, 0, L, 0, 0]), a = x.slice(), b = x.slice(), g = new Float64Array(6), ga = g.slice(), gb = g.slice();
    a[3] += 1e-6; b[3] -= 1e-6;
    gradient(w, a, ga); gradient(w, b, gb); gradient(w, x, g);
    const numerical = (ga[3] - gb[3]) / 2e-6, expected = w.edgeK[0];
    assert.ok(Math.abs(numerical - expected) / expected < 1e-7);
    w.opts.consistentMembraneCurvature = false; const legacy = g.slice(); legacy.fill(0); gradient(w, x, legacy);
    assert.deepEqual(legacy, g, 'changing the radial GN approximation must preserve the force law');
    w.opts.consistentMembraneCurvature = true;
  }
  console.log('membrane-curvature: compressed, near-rest compressed and tensile radial force derivatives agree; force law unchanged');
});

test('direct local contact solves the combined current GN operator without altering the saved elastic preconditioner', () => {
  const b = new DocBuilder('local contact linear reference');
  b.rect({ id: 'lower', width: 2, height: 3, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
  b.rect({ id: 'upper', width: 2, height: 3, placement: { origin: [0.2, 1.115, -0.1], rotation: [0.005, 0, 0.0075, Math.sqrt(1 - 0.005 ** 2 - 0.0075 ** 2)] } });
  for (const v of [0, 3]) b.joins.push({ id: `static-${v}`, type: 'pin', a: { sheet: 'lower', along: [[0, v], [2, v]] }, world: null });
  b.joins.push({ id: 'slack', type: 'string', a: { sheet: 'upper', at: [1, 1] }, b: { world: [1, 2, -1] }, length: 10 });
  const w = new World(b.build(), { meshEdge: 10, barrierContact: true, gravity: false, ground: false, plasticity: false, consistentMembraneCurvature: true });
  for (let i = 0; i < w.x.length; i++) if (!w.fixed[Math.floor(i / 3)]) w.x[i] += 0.0002 * Math.sin(i * 0.7);
  w.xt.set(w.x.map((x, i) => x + 0.001 * Math.cos(i)));
  const c = w.coupledContact; c.evaluate(w); c.refactor(w);
  assert.ok(c.potential.count > 0);
  const old = w.x.slice(), g = w.g.slice(), factor = w.sys.ch.Lx.slice(), matrix = w.sys.ch.Ax.slice(), factorState = structuredClone(w._factorState), factorDir = w.factorDir.slice();
  const solver = new LocalContactSolve(w); assert.ok(solver.solve(w, c.potential));
  const delta = w.x.map((x, i) => x - old[i]), out = new Float64Array(delta.length);
  hessianTimes(w, old, delta, out); c.potential.hessianTimes(delta, out);
  let norm = 0, residual = 0;
  for (let i = 0; i < g.length; i++) if (!w.fixed[Math.floor(i / 3)]) { norm = Math.max(norm, Math.abs(g[i])); residual = Math.max(residual, Math.abs(out[i] + g[i])); }
  assert.ok(residual / norm < 1e-7, `relative linear residual=${residual / norm}`);
  assert.deepEqual(w.sys.ch.Lx, factor); assert.deepEqual(w.sys.ch.Ax, matrix); assert.deepEqual(w._factorState, factorState); assert.deepEqual(w.factorDir, factorDir);
  console.log(`direct-local: native static/free sheets, stencils=${c.potential.count}, relative linear residual=${residual / norm}, elastic factor unchanged`);
});

test('nonlocal free contact is refused before any position or matrix mutation', () => {
  const w = { sys: { ch: new BlockCholesky(2, new Int32Array()), nFree: 2, freeIdx: new Int32Array([0, 1, -1, -1]) }, x: new Float64Array(12) };
  const contact = { count: 1, curvature: [1], stencilIds: [0, 1, 2, 3], stencilGrad: [1, 0, 0, -1, 0, 0, 0, 0, 0, 0, 0, 0] };
  const solver = new LocalContactSolve(w), x = w.x.slice(), a = solver.ch.Ax.slice();
  assert.equal(solver.solve(w, contact), false); assert.deepEqual(w.x, x); assert.deepEqual(solver.ch.Ax, a);
  console.log('direct-local-domain: missing free contact pair returns unsupported before mutation');
});

test('direct and automatic local solves retain active-contact snapshot replay and force balance', () => {
  for (const barrierLinearSolver of ['direct-local', 'auto']) {
    const b = new DocBuilder('direct active contact replay');
    b.rect({ id: 'drop', width: 2, height: 2, placement: { origin: [0, 1, 0], rotation: [0, 0, 0, 1] } });
    const w = new World(b.build(), { meshEdge: 5, substeps: 4, barrierContact: true, barrierIterations: 32,
      barrierTolerance: 1e-6, barrierLinearSolver, consistentMembraneCurvature: true, plasticity: false });
    for (let f = 0; f < 4; f++) w.step();
    assert.ok(w.stats().coupledContact.last.grounded > 0); assert.equal(w.stats().asleep, false);
    const saved = w.snapshot(); for (let f = 0; f < 4; f++) w.step();
    const x = w.x.slice(), stats = w.stats().coupledContact;
    w.restore(saved); for (let f = 0; f < 4; f++) w.step();
    assert.deepEqual(w.x, x); assert.deepEqual(w.stats().coupledContact, stats);
    for (let f = 0; f < 92; f++) w.step();
    assert.ok(w.stats().coupledContact.last.residual <= 1e-6); assert.ok(w.stats().coupledContact.directSolves > 0);
    assert.equal(w.stats().coupledContact.nonlocalFallbacks, 0); assert.equal(w.stats().coupledContact.cgTotal, 0);
  }
  console.log('direct-local-replay: direct/auto active ground contact bit-exact; final force tolerance <=1e-6 µN');
});

test('automatic solver visibly falls back for nonlocal free-sheet contacts, while direct-local refuses them', () => {
  const b = new DocBuilder('nonlocal free contact');
  for (const [id, y] of [['lower', 1], ['upper', 1.12]]) b.rect({ id, width: 2, height: 3,
    placement: { origin: [0, y, 0], rotation: [0, 0, 0, 1] } });
  for (const barrierLinearSolver of ['auto', 'direct-local']) {
    const w = new World(b.build(), { meshEdge: 10, barrierContact: true, barrierLinearSolver, ground: false, gravity: false });
    const c = w.coupledContact; c.evaluate(w); const before = w.x.slice();
    assert.ok(c.potential.count > 0);
    if (barrierLinearSolver === 'direct-local') {
      assert.throws(() => c.direction(w), /nonlocal contact/); assert.deepEqual(w.x, before);
    } else {
      c.direction(w); assert.equal(c.nonlocalFallbacks, 1); assert.equal(c.directSolves, 0);
      assert.ok(c.cgTotal > 0); assert.ok(w.x.every(Number.isFinite)); assert.notDeepEqual(w.x, before);
    }
  }
  console.log('direct-local-fallback: free/free nonlocal sheets use counted PCG in auto mode; strict mode refuses before pose mutation');
});
