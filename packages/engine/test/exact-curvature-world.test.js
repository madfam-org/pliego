import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { DocBuilder } from './helpers/docbuilder.js';
import { assembleElastic, assembleAndFactor } from '../src/xpbd/implicit.js';
import { pcgStep } from '../src/xpbd/pcg.js';
import { BlockCholesky } from '../src/linalg/blockchol.js';
import * as K from '../src/constants.js';

const research = { damping: 0, bendDamping: 0, membraneReference: 'uv-displacement', membraneArithmetic: 'double-double',
  lineSearchArithmetic: 'membrane-inertia-increment', stateCoordinates: 'reference-displacement' };
function patch(curvature, { scale = 1.0001, substeps = 4000, newtonIterations = 4, velocity = 0 } = {}) {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const w = new World(p.doc, { ...p.options, ...research, substeps, newtonIterations, membraneCurvature: curvature });
  w.setInitialReferencePose(w.x.map((v, i) => i % 3 === 0 ? v * scale : v), w.x.map((_, i) => i % 3 === 1 ? 0 : velocity * Math.sin(.37 * i + 1)));
  return w;
}
/** One real triangle (skewed UV, oblique grain), compressed, with weak inertia (h = 1/60 s). */
function triangle(curvature, scale = .8) {
  const b = new DocBuilder('single compressed triangle', { exact: true }), s = b.sheet({ id: 'tri', width: 40, height: 40, grain: 31 });
  b.vertex(s, 0, 0); b.vertex(s, 36, 4); b.vertex(s, 6, 30); b.face([0, 1, 2]);
  const w = new World(b.build(), { meshEdge: 100, physicalMembrane: true, membraneCompression: 1, gravity: false, ground: false, contact: false,
    plasticity: false, membraneModel: 'orthotropic-stvk', membraneNu12: [.293], membranePoissonConvention: 'nu12', membraneProjection: 'none',
    lineSearch: true, ...research, substeps: 1, newtonIterations: 1, membraneCurvature: curvature });
  assert.equal(w.mesh.nT, 1);
  w.setInitialReferencePose(w.x.map(v => v * scale)); return w;
}
const clone = ch => Object.assign(Object.create(BlockCholesky.prototype), structuredClone(ch));
const raw = w => ({ u: w._u.slice(), us: w._us.slice(), ut: w._ut.slice(), x: w.x.slice(), v: w.v.slice(), time: w.time, substeps: w.substepsRun,
  factorL: w.sys.ch.Lx.slice(), factorState: structuredClone(w._factorState), factorCount: w.factorCount, dirty: w.dirty,
  search: structuredClone(w.energySearch.increment), exact: structuredClone(w._exactCurvature) });
/** Record every iteration's receipt, and begin/finish counts, without changing the solve. */
function observe(w) {
  const log = { begin: 0, finish: 0, receipts: [] }, { begin, finish } = w.energySearch;
  w.energySearch.begin = function (world) { log.begin++; return begin.call(this, world); };
  w.energySearch.finish = function (world, g) { log.finish++; log.receipts.push(structuredClone(world._exactCurvature?.last ?? null)); return finish.call(this, world, g); };
  return log;
}

test('admission: exact curvature only in the reference-displacement domain; Gauss–Newton shapes unchanged', () => {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const { stateCoordinates, ...absolute } = research;
  assert.throws(() => new World(p.doc, { ...p.options, ...absolute, membraneCurvature: 'exact-hessian' }), /admitted only in the free planar reference-displacement domain/);
  assert.throws(() => new World(p.doc, { ...p.options, membraneCurvature: 'exact-hessian' }), /admitted only/);
  assert.throws(() => new World(p.doc, { ...p.options, ...research, membraneCurvature: 'exact' }), /explicitly require/);
  const gn = patch('gauss-newton'); gn._substep();
  assert.equal(Object.hasOwn(gn, '_exactCurvature'), false); assert.equal(Object.hasOwn(gn.stats(), 'membraneCurvature'), false);
  assert.deepEqual(Object.keys(gn.snapshot().membrane), ['signature', 'factorCount', 'pcgIterations']);
  assert.equal(Object.hasOwn(gn._factorState, 'curvature'), false); assert.equal(gn.stats().membrane.curvature, 'gauss-newton');
  const exact = patch('exact-hessian'); exact._substep();
  const stats = exact.stats();
  assert.equal(stats.membrane.curvature, 'exact-hessian'); assert.equal(stats.membraneCurvature.requested, 'exact-hessian');
  assert.equal(stats.membraneCurvature.factorCurvature, 'exact-hessian'); assert.equal(stats.factorizations, stats.membraneCurvature.counters.exactFactors);
  for (const mutate of [w => { w.opts.membraneCurvature = 'gauss-newton'; }, w => { w.orthotropicMembrane.configuration.curvaturePolicy.version = 2; }, w => { delete w._exactCurvature; }]) {
    const w = patch('exact-hessian'); mutate(w); const u = w._u.slice(), x = w.x.slice(), substeps = w.substepsRun;
    assert.throws(() => w.step(), /identity changed|prerequisites/);
    assert.deepEqual(w._u, u); assert.deepEqual(w.x, x); assert.equal(w.substepsRun, substeps);
  }
  console.log('exact-curvature-admission: absolute/binary64 and unknown literals refused; GN opts/stats/snapshot/factor shapes unchanged; option/policy/state drift refused before writes');
});

test('compressed single triangle: exact curvature is indefinite, the pivot is rejected and the GN fallback replays GN exactly', () => {
  const exact = triangle('exact-hessian'), gn = triangle('gauss-newton');
  const ch = clone(exact.sys.ch), g = clone(exact.sys.ch);
  assembleElastic(exact, exact._u, ch, false, 'reference-displacement', 'exact-hessian'); assembleElastic(exact, exact._u, g, false, 'reference-displacement');
  // Non-rigid out-of-plane mode (orthogonal to translation), entirely in the omitted-by-GN direction.
  const p = new Float64Array(9); p[1] = 1; p[4] = -1;
  const quotient = c => { const A = (a, b) => { const s = c.slot(a, b); return (r, q) => s >= 0 ? c.Ax[s + 3 * r + q] : c.Ax[-s - 1 + 3 * q + r]; };
    let sum = 0; for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) sum += p[3 * a + r] * A(a, b)(r, q) * p[3 * b + q]; return sum; };
  const exactQ = quotient(ch), gnQ = quotient(g);
  assert.ok(exactQ < 0 && gnQ > 0, `${exactQ} ${gnQ}`);
  const log = observe(exact); exact._substep(); gn._substep();
  const c = exact._exactCurvature.counters, last = exact._exactCurvature.last;
  assert.deepEqual([c.exactFactorAttempts, c.exactFactors, c.finiteNonpositivePivots, c.gnFallbackFactors, c.nonfiniteFailures], [1, 0, 1, 1, 0]);
  assert.equal(exact.factorCount, 1); assert.equal(exact._factorState.curvature, 'gauss-newton');
  assert.equal(last.direction, 'gauss-newton-fallback'); assert.equal(last.fallbackReason, 'finite-nonpositive-pivot');
  assert.equal(last.pivot.component, 1, 'the out-of-plane pivot fails'); assert.ok(Number.isFinite(last.pivot.value) && last.pivot.value <= 0);
  assert.ok(last.descent && last.slope < 0 && Number.isFinite(last.slope));
  assert.deepEqual(exact.authoritativeState(), gn.authoritativeState()); assert.deepEqual(exact.energySearch.increment, gn.energySearch.increment);
  assert.deepEqual(exact.sys.ch.Lx, gn.sys.ch.Lx); assert.equal(log.begin, 1); assert.equal(log.finish, 1);
  console.log(`exact-curvature-fallback: Y-mode Rayleigh exact=${exactQ.toExponential(3)} < 0 < GN+M=${gnQ.toExponential(3)}; pivot component 1 value ${last.pivot.value.toExponential(3)} rejected; GN factor/direction/Armijo decision (${gn.energySearch.increment.last.decision}) identical`);
});

test('exact direct factor, exact PCG with exact preconditioner, one begin/finish per iteration and separate work counts', () => {
  const exact = patch('exact-hessian', { scale: .97 }), gn = patch('gauss-newton', { scale: .97 }), log = observe(exact);
  for (let i = 0; i < 3; i++) { exact._substep(); gn._substep(); }
  const c = exact._exactCurvature.counters, iterations = 3 * exact.opts.newtonIterations;
  assert.equal(log.begin, iterations); assert.equal(log.finish, iterations); assert.equal(c.iterations, iterations);
  assert.deepEqual([log.receipts[0].source, log.receipts[0].direction, log.receipts[0].preconditioner], ['direct', 'exact-hessian', 'exact-hessian']);
  for (const r of log.receipts.slice(1)) assert.deepEqual([r.source, r.direction, r.preconditioner, r.pcg.reason, r.descent], ['pcg', 'exact-hessian', 'exact-hessian', 'converged', true]);
  assert.equal(c.pcgAttempts + c.exactFactorAttempts, iterations); assert.equal(exact.factorCount, c.exactFactors + c.gnFallbackFactors);
  const er = exact.authoritativeResiduals(1e-7).authoritative.residualInfinity, gr = gn.authoritativeResiduals(1e-7).authoritative.residualInfinity;
  assert.ok(er < gr / 10, `${er} vs ${gr}`);
  console.log(`exact-curvature-paths: 1 direct exact factor + ${c.pcgConverged} exact PCG solves (exact preconditioner); ${iterations} begin/finish pairs; 3% compression control after 3 steps residual exact=${er.toExponential(2)} GN=${gr.toExponential(2)} (control only, no acceptance)`);
});

test('zero-RHS stationary and failed PCG fall through to an exact direct factor', () => {
  const rest = patch('exact-hessian', { scale: 1 }), log = observe(rest); rest._substep();
  assert.equal(rest._exactCurvature.counters.zeroRhs, rest.opts.newtonIterations - 1);
  assert.deepEqual(log.receipts.slice(1).map(r => r.pcg.reason), Array(rest.opts.newtonIterations - 1).fill('zero-rhs'));
  assert.equal(rest.energySearch.increment.stationaryNoops, rest.opts.newtonIterations); assert.ok(rest._u.every(v => v === 0));
  const w = patch('exact-hessian', { scale: .7, substeps: 60 }), seen = observe(w);
  for (let i = 0; i < 6; i++) w._substep();
  const stalled = seen.receipts.filter(r => r.pcg && r.pcg.reason !== 'converged');
  assert.ok(stalled.length >= 1 && stalled.every(r => r.source === 'direct'), 'a failed PCG solve is followed by a direct factor in the same iteration');
  const exactAfterStall = stalled.filter(r => r.direction === 'exact-hessian');
  assert.ok(exactAfterStall.length >= 1, JSON.stringify(stalled.map(r => [r.pcg.reason, r.direction])));
  assert.equal(w._exactCurvature.counters.pcgStagnation, stalled.filter(r => r.pcg.reason === 'stagnation').length);
  console.log(`exact-curvature-pcg-failure: rest pose ${rest.opts.newtonIterations - 1} zero-RHS PCG + ${rest.opts.newtonIterations} stationary no-ops; 30% compression: ${stalled.length} failed PCG solve(s) [${stalled.map(r => r.pcg.reason)}] refactored exactly in the same iteration`);
});

test('PCG never writes a rejected direction; GN return shape unchanged; nonfinite arithmetic is refused without fallback', () => {
  // At the compressed pose, with an explicit GN factor as the stale preconditioner.
  const w = triangle('exact-hessian'); assembleAndFactor(w, w._u, 'reference-displacement');
  const x = w._u.slice(), y = new Float64Array(9); y[1] = 1; y[4] = -1;
  const exactResult = pcgStep(w, x, y, K.PCG_MAX_ITER, K.PCG_RTOL, null, true, 'reference-displacement', 'exact-hessian');
  assert.equal(exactResult.converged, false); assert.equal(exactResult.reason, 'nonpositive-curvature'); assert.deepEqual(x, w._u);
  const nan = pcgStep(w, x, y, K.PCG_MAX_ITER, K.PCG_RTOL, (p, out) => { out[0] = NaN; }, true, 'reference-displacement', 'exact-hessian');
  assert.equal(nan.reason, 'nonfinite-product'); assert.deepEqual(x, w._u);
  assert.deepEqual(pcgStep(w, x, new Float64Array(9), K.PCG_MAX_ITER, K.PCG_RTOL, null, true, 'reference-displacement', 'exact-hessian'), { iterations: 0, converged: true, reason: 'zero-rhs', slope: 0 });
  const gn = pcgStep(w, x.slice(), y, K.PCG_MAX_ITER, K.PCG_RTOL, null, true, 'reference-displacement');
  assert.deepEqual(Object.keys(gn), ['iterations', 'converged']); assert.equal(gn.converged, true);
  // Cholesky failures keep their old text and become identifiable; a failed factor cannot be solved with.
  const ch = new BlockCholesky(1, []); ch.Ax.set([1, 0, 0, 0, -2, 0, 0, 0, 1]);
  assert.throws(() => ch.factor(), e => /matrix not positive definite at block 0/.test(e.message) && e.pivotFailure.kind === 'finite-nonpositive' && e.pivotFailure.component === 1 && e.pivotFailure.value === -2);
  assert.throws(() => ch.solve(new Float64Array(3)), /solve before factor/);
  ch.Ax.set([1, 0, 0, 0, NaN, 0, 0, 0, 1]); assert.throws(() => ch.factor(), e => e.pivotFailure.kind === 'nonfinite' && e.pivotFailure.value === null);
  const bad = patch('exact-hessian', { scale: 1.02 }), original = bad.orthotropicMembrane.addExactHessianBlocks;
  bad.orthotropicMembrane.addExactHessianBlocks = function (world, pose, c, coordinates) { original.call(this, world, pose, c, coordinates); c.Ax[0] = NaN; };
  assert.throws(() => bad._substep(), /nonfinite factor arithmetic/);
  const counts = bad._exactCurvature.counters;
  assert.deepEqual([counts.nonfiniteFailures, counts.gnFallbackFactors, counts.exactFactors, bad.factorCount], [1, 0, 0, 0]);
  assert.deepEqual(bad._u, bad._ut, 'the predictor state is untouched: no Newton write after the refused factor');
  console.log('exact-curvature-refusals: indefinite and NaN PCG products stop before any write; zero RHS stays stationary; GN PCG keeps {iterations,converged}; Cholesky old text + pivot identity; nonfinite exact factor refused, no fallback, no write');
});

test('snapshot continuation after an exact factor and after a GN fallback replays bit-exactly; corrupt or cross-curvature metadata refuse atomically', () => {
  for (const [label, make] of [['exact factor', () => patch('exact-hessian', { scale: .97 })], ['GN fallback', () => patch('exact-hessian', { scale: .9, substeps: 60 })]]) {
    const w = make(); w._substep();
    const s = w.snapshot(), factorL = w.sys.ch.Lx.slice();
    assert.equal(s.factor.curvature, label === 'exact factor' ? 'exact-hessian' : 'gauss-newton');
    w._substep(); const end = w.snapshot(); w.restore(s);
    assert.deepEqual(w.sys.ch.Lx, factorL, 'restore rebuilds the saved effective factor, not the current option');
    w._substep(); assert.deepEqual(w.snapshot(), end);
    for (let i = 0; i < w._u.length; i++) assert.ok(Object.is(w.x[i], w.X0[i] + w._u[i]) && Object.is(w.xt[i], w.X0[i] + w._ut[i]));
  }
  const exact = patch('exact-hessian', { scale: .9, substeps: 60 }); exact._substep(); const good = exact.snapshot();
  const gnWorld = patch('gauss-newton', { scale: .9, substeps: 60 }); gnWorld._substep(); const gnSnapshot = gnWorld.snapshot();
  for (const [target, snapshot, pattern] of [[exact, gnSnapshot, /curvature mismatch/], [gnWorld, good, /curvature mismatch/]]) {
    const before = raw(target); assert.throws(() => target.restore(structuredClone(snapshot)), pattern); assert.deepEqual(raw(target), before);
  }
  for (const [mutate, pattern] of [
    [s => { s.factor.curvature = 'bogus'; }, /factor curvature/], [s => { s.factor.curvature = 'exact-hessian'; }, /cannot be rebuilt/],
    [s => { delete s.membrane.exactCurvature; }, /curvature mismatch/], [s => { s.membrane.exactCurvature.counters.exactFactors = -1; }, /counters/],
    [s => { s.membrane.exactCurvature.counters.gnFallbackFactors = 5; }, /counters/], [s => { s.membrane.exactCurvature.last.direction = 'magic'; }, /receipt/],
    [s => { s.membrane.exactCurvature.requested = 'gauss-newton'; }, /curvature mismatch/], [s => { s.membrane.signature = s.membrane.signature.replace('exact-hessian', 'gauss-newton'); }, /mismatch/]]) {
    const bad = structuredClone(good); mutate(bad); const before = raw(exact);
    assert.throws(() => exact.restore(bad), pattern); assert.deepEqual(raw(exact), before);
  }
  const signed = patch('exact-hessian', { scale: 1 }), zero = signed.X0.findIndex((v, i) => i % 3 !== 1 && Object.is(v, +0)), x = signed.x.slice(); x[zero] = -0;
  assert.throws(() => signed.setInitialReferencePose(x), /public bytes|pristine/);
  console.log('exact-curvature-replay: exact and GN-fallback factors restore byte-identical L and replay exactly; latent/public projections exact; 2 cross-curvature + 8 corrupt snapshots refused with no writes');
});
