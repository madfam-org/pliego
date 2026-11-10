import test from 'node:test';
import assert from 'node:assert/strict';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld } from '../bench/membrane-modal-runtime.mjs';
import { attachModalSolveObserver } from '../bench/membrane-modal-solve-observer.mjs';
import { EnergySearch } from '../src/xpbd/energy-search.js';
import { hessianTimes } from '../src/xpbd/pcg.js';

function fixture({ cells = 2, grain = 0, amplitude = 0.004, substeps = 4000, newtonIterations = 4, previousPoseStart = false, nonlinear = false } = {}) {
  const patch = makePatch({ cells, pattern: 'forward', grain, membraneModel: 'orthotropic-stvk', membraneNu12: 0.293 });
  const phi = patch.vertices.map(([u, v]) => [(u - 20) / 20 * (nonlinear ? Math.cos(v / 10) : 1), 0]);
  return createModalWorld(patch, { phi, omega: 1e5, amplitude, substeps, newtonIterations, previousPoseStart });
}
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function parity(a, b) {
  for (const key of ['x', 'v', 'xs', 'xt', 'g', 'thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK', 'factorDir']) assert.deepEqual(bytes(a[key]), bytes(b[key]), key);
  assert.deepEqual(a.orthotropicMembrane.work, b.orthotropicMembrane.work, 'selected-law scratch must also remain exact');
  assert.deepEqual(a.orthotropicMembrane.block, b.orthotropicMembrane.block);
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.stats(), b.stats());
  assert.deepEqual(a.opts, b.opts); assert.equal(a.factorCount, b.factorCount); assert.equal(a.pcgIterations, b.pcgIterations);
  assert.deepEqual(a.energySearch.start, b.energySearch.start); assert.deepEqual(a.energySearch.delta, b.energySearch.delta);
  assert.equal(a.energySearch.energy, b.energySearch.energy);
  assert.deepEqual(a._pcg, b._pcg, 'observer cannot overwrite actual PCG work or direction');
}
function shadow(w) {
  const s = Object.create(w), m = Object.create(w.orthotropicMembrane);
  s.hingeGrad = w.hingeGrad.slice();
  m.work = structuredClone(w.orthotropicMembrane.work); m.block = w.orthotropicMembrane.block.slice(); s.orthotropicMembrane = m;
  return s;
}

test('solve observation preserves exact actual World replay, snapshots, caches and public budgets', () => {
  let records = 0, direct = 0, pcg = 0, rejected = 0, backtracked = 0;
  for (const newtonIterations of [1, 4, 16]) for (const previousPoseStart of [false, true]) {
    const parameters = { newtonIterations, previousPoseStart }, observed = fixture(parameters), plain = fixture(parameters);
    const o = attachModalSolveObserver(observed, { onIteration: record => { record.start[0] = 1e30; } });
    assert.throws(() => attachModalSolveObserver(observed), /already attached/);
    parity(observed.world, plain.world);
    for (let step = 0; step < 4; step++) {
      assert.equal(observed.world.step(observed.world.dt), 1); assert.equal(plain.world.step(plain.world.dt), 1);
      parity(observed.world, plain.world);
    }
    assert.equal(o.counts.begins, 4 * newtonIterations); assert.equal(o.counts.finishes, o.counts.begins);
    assert.equal(o.counts.observed, o.counts.begins); assert.equal(o.counts.missing, 0); assert.equal(o.counts.callbackErrors, 0);
    for (const r of o.records) {
      assert.equal(r.valid, true, r.missing.join('; ')); assert.notEqual(r.start[0], 1e30);
      assert.ok(r.source === 'direct' || r.source === 'pcg');
      direct += r.source === 'direct'; pcg += r.source === 'pcg'; rejected += r.lineSearch.rejected;
      backtracked += r.lineSearch.acceptedBacktracks > 0;
      assert.equal(r.acceptedAlpha, r.lineSearch.rejected ? 0 : 2 ** -r.lineSearch.acceptedBacktracks);
      assert.equal(r.lineSearch.rejectedTrialCount, null);
      assert.deepEqual(r.acceptedRoundedDirection, r.after.map((x, i) => x - r.start[i]));
      assert.ok(r.nominal.relativeResidual <= (r.source === 'pcg' ? 0.001000001 : 1e-11));
    }
    records += o.records.length;
    o.detach(); o.detach();
    assert.equal(observed.world.energySearch.begin, EnergySearch.prototype.begin);
    assert.equal(observed.world.energySearch.finish, EnergySearch.prototype.finish);
    assert.equal(Object.hasOwn(observed.world.energySearch, 'begin'), false);
    observed.world.step(observed.world.dt); plain.world.step(plain.world.dt); parity(observed.world, plain.world);
    assert.equal(o.counts.observed, 4 * newtonIterations, 'detached observer cannot collect more records');
  }
  assert.ok(direct > 0 && pcg > 0 && backtracked > 0);
  console.log(`membrane-modal-solve-parity: ${records} actual Newton events across public budgets1/4/16 and both seeds; direct=${direct}, PCG=${pcg}, backtracked=${backtracked}, rejected=${rejected}; x/v/targets/full snapshots/diagnostics/caches exact, detached methods restored`);
});

test('observed nominal and rounded directions use the actual Hessian operator at the actual Newton start', () => {
  const c = fixture({ newtonIterations: 4 }), w = c.world;
  let products = 0, roundedWorse = 0, maxDirect = 0;
  const o = attachModalSolveObserver(c, { onIteration: r => {
    assert.equal(r.valid, true);
    for (const kind of ['nominal', 'rounded']) {
      const measured = r[kind], p = Float64Array.from(measured.direction), out = new Float64Array(w.x.length);
      hessianTimes(shadow(w), Float64Array.from(r.start), p, out);
      assert.deepEqual(measured.product, Array.from(out));
      assert.deepEqual(measured.residual, Array.from(out, (v, i) => v + r.gradient[i]));
      assert.equal(measured.residualInfinity, Math.max(...measured.residual.map(Math.abs)));
      assert.deepEqual(r.rounded.direction, r.candidate.map((x, i) => x - r.start[i]));
      assert.ok(r.candidate.every((x, i) => x === r.start[i] + r.nominal.direction[i])); products++;
    }
    if (r.source === 'direct') maxDirect = Math.max(maxDirect, r.nominal.relativeResidual);
    if (r.rounded.residualInfinity > r.nominal.residualInfinity) roundedWorse++;
  } });
  for (let i = 0; i < 3; i++) w.step(w.dt);
  assert.equal(o.counts.missing, 0); assert.equal(products, 24); assert.ok(maxDirect < 1e-12); assert.ok(roundedWorse > 0);
  o.detach();
  console.log(`membrane-modal-solve-operator: ${products} actual H(start) products independently re-read, direct nominal relative residual max=${maxDirect}; actual rounded direction has larger residual in ${roundedWorse} events; no final-force acceptance substituted`);
});

test('actual failed PCG falls back to the direct rhs, never the failed tentative PCG direction', () => {
  // Deliberately large nonlinear distortion is an instrumentation-path control,
  // not a small-amplitude modal-accuracy claim. All updates still use World.step.
  const parameters = { cells: 3, grain: 23, amplitude: 10, substeps: 4, newtonIterations: 16, nonlinear: true };
  const c = fixture(parameters), plain = fixture(parameters), o = attachModalSolveObserver(c);
  for (let i = 0; i < 3; i++) { c.world.step(c.world.dt); plain.world.step(plain.world.dt); parity(c.world, plain.world); }
  const failures = o.records.filter(r => r.source === 'direct-after-pcg-failure');
  assert.ok(failures.length > 0); assert.equal(o.counts.missing, 0);
  for (const r of failures) {
    assert.equal(r.factorDelta, 1); assert.equal(r.pcgAttempted, true); assert.equal(r.pcgFailBefore, 0);
    assert.equal(r.pcgFailAfterSolve, 4); assert.ok(r.pcgIterations > 0 && r.pcgIterations <= 12);
    assert.ok(r.nominal.relativeResidual < 1e-11); assert.ok(r.candidate.every((x, i) => x === r.start[i] + r.nominal.direction[i]));
  }
  o.detach();
  console.log(`membrane-modal-solve-fallback: ${failures.length} real failed-PCG/direct fallback events observed; direct sys.rhs reconstructs candidate, failed PCG work never mislabeled; full replay remains exact`);
});

test('zero RHS and unsafe nominal sources are reported without inventing a direction or skipping the original search', () => {
  const zero = fixture({ amplitude: 0, newtonIterations: 4 }), o = attachModalSolveObserver(zero);
  zero.world.step(zero.world.dt);
  assert.equal(o.counts.missing, 0); assert.equal(o.records.length, 4);
  assert.ok(o.records.every(r => r.nominal.zeroDirection && r.rounded.zeroDirection && r.nominal.residualInfinity === 0 && r.acceptedAlpha === 1));
  assert.ok(o.records.some(r => r.source === 'pcg' && r.pcgIterations === 0)); o.detach();
  const c = fixture(), w = c.world, missing = attachModalSolveObserver(c), before = w.x.slice();
  // Explicit synthetic association failure: no Newton/linear solve between
  // begin/finish. This tests missing-data handling, not an actual solver event.
  w.energySearch.begin(w); w.energySearch.finish(w, new Float64Array(w.x.length));
  assert.equal(missing.counts.finishes, 1); assert.equal(missing.records[0].valid, false);
  assert.equal(missing.records[0].nominal, null); assert.match(missing.records[0].missing.join('; '), /one-substep public call/);
  assert.equal(missing.records[0].acceptedAlpha, 1); assert.deepEqual(w.x, before);
  // Another explicitly synthetic invalid-source control: an uphill candidate
  // is rejected by the ORIGINAL search and cannot be labeled solver convergence.
  w.energySearch.begin(w); w.x[0] += 1;
  const uphill = new Float64Array(w.x.length); uphill[0] = 1; w.energySearch.finish(w, uphill);
  assert.equal(missing.records.at(-1).valid, false); assert.equal(missing.records.at(-1).acceptedAlpha, 0);
  assert.equal(missing.records.at(-1).lineSearch.rejected, true); assert.deepEqual(w.x, before);
  w.energySearch.begin(w); missing.detach();
  assert.equal(missing.records.at(-1).incomplete, true); assert.equal(missing.counts.missing, 3);
  const invalid = fixture(); invalid.world.userForce[0] = 1;
  assert.throws(() => attachModalSolveObserver(invalid), /outside domain/);
  assert.throws(() => attachModalSolveObserver(fixture(), { onIteration: async () => {} }), /synchronous/);
  console.log('membrane-modal-solve-missing: genuine zero-RHS directions retained; unsafe no-solve association and unmatched begin remain explicit missing records; originals still run and detach restores methods');
});

test('streamed solve observations isolate callback mutation and report callback failure without altering World', () => {
  const c = fixture(), plain = fixture(), callbacks = [], o = attachModalSolveObserver(c, { retain: 'none', onIteration: r => {
    callbacks.push(r.iteration); r.nominal.direction.fill(1e30); throw new Error('deliberate callback failure');
  } });
  for (let i = 0; i < 2; i++) { c.world.step(c.world.dt); plain.world.step(plain.world.dt); parity(c.world, plain.world); }
  assert.equal(o.records.length, 0); assert.equal(o.counts.retained, 0); assert.equal(o.counts.observed, 8);
  assert.deepEqual(callbacks, [1, 2, 3, 4, 5, 6, 7, 8]); assert.equal(o.counts.callbackErrors, 8); assert.equal(o.counts.missing, 0);
  assert.ok(o.callbackErrors.every(e => e.message === 'deliberate callback failure')); o.detach();
  console.log('membrane-modal-solve-streaming: all8 copied events delivered, retention explicitly none, callback failures reported independently while actual World replay remains exact');
});
