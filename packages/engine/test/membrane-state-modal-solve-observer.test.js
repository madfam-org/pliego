import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld } from '../bench/membrane-modal-runtime.mjs';
import { attachStateModalSolveObserver } from '../bench/membrane-state-modal-solve-observer.mjs';
import { EnergySearch } from '../src/xpbd/energy-search.js';
import { hessianTimes } from '../src/xpbd/pcg.js';

function fixture({ cells = 2, grain = 0, amplitude = .004, substeps = 4000, newtonIterations = 4, previousPoseStart = false, nonlinear = false } = {}) {
  const patch = makePatch({ cells, pattern: 'forward', grain, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  // Hand-authored instrumentation directions, not an independently solved mode.
  const scale = Math.hypot(1, .02);
  const phi = patch.vertices.map(([u, v], i) => nonlinear ? [(u - 20) / 20 * Math.cos(v / 10) / scale, .02 / scale] : [Math.sin(i + .2), Math.cos(i + .2)]);
  const parameters = { phi, omega: 1e5, amplitude, substeps, newtonIterations, previousPoseStart,
    lineSearchArithmetic: 'membrane-inertia-increment', membraneArithmetic: 'double-double', membraneReference: 'uv-displacement' };
  const baseline = createModalWorld(patch, parameters), options = { ...baseline.options, stateCoordinates: 'reference-displacement' }, world = new World(patch.doc, options);
  // Zero amplitude uses the actual constructor pose. The old factory's -0 at
  // a +0 origin must not be silently normalized to obtain state admission.
  if (amplitude !== 0) world.setInitialReferencePose(baseline.world.x, baseline.world.v);
  return { ...baseline, world, options };
}
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);
function parity(a, b) {
  for (const key of ['_u', '_us', '_ut', 'x', 'v', 'xs', 'xt', 'g', 'thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK', 'factorDir']) assert.deepEqual(bytes(a[key]), bytes(b[key]), key);
  assert.deepEqual(a.orthotropicMembrane.work, b.orthotropicMembrane.work);
  assert.deepEqual(a.orthotropicMembrane.block, b.orthotropicMembrane.block);
  assert.deepEqual(a.sys.ch.Ax, b.sys.ch.Ax); assert.deepEqual(a.sys.ch.Lx, b.sys.ch.Lx); assert.deepEqual(a.sys.rhs, b.sys.rhs);
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.stats(), b.stats()); assert.deepEqual(a._pcg, b._pcg);
  assert.deepEqual(a.opts, b.opts); assert.equal(a.factorCount, b.factorCount); assert.equal(a.pcgIterations, b.pcgIterations);
  assert.deepEqual(a.energySearch.start, b.energySearch.start); assert.deepEqual(a.energySearch.delta, b.energySearch.delta);
  assert.equal(a.energySearch.energy, b.energySearch.energy);
}
function shadow(w) {
  const s = Object.create(w), m = Object.create(w.orthotropicMembrane);
  s.hingeGrad = w.hingeGrad.slice(); m.work = structuredClone(w.orthotropicMembrane.work); m.block = w.orthotropicMembrane.block.slice(); s.orthotropicMembrane = m;
  return s;
}
const step = c => assert.equal(c.world.step(c.world.dt), 1);
const decode = b => { const bytes = Buffer.from(b, 'base64'); return Array.from({ length: bytes.length / 8 }, (_, i) => bytes.readDoubleLE(8 * i)); };

test('state solve observation preserves actual replay, native caches, public budgets and boundary snapshot continuation', () => {
  let events = 0, direct = 0, pcg = 0;
  for (const newtonIterations of [1, 4, 16]) for (const previousPoseStart of [false, true]) {
    const parameters = { newtonIterations, previousPoseStart }, observed = fixture(parameters), plain = fixture(parameters);
    const o = attachStateModalSolveObserver(observed, { onIteration: r => { if (r.startU) r.startU[0] = 1e30; } });
    assert.throws(() => attachStateModalSolveObserver(observed), /already attached/);
    for (let i = 0; i < 3; i++) { step(observed); step(plain); parity(observed.world, plain.world); }
    assert.equal(o.counts.begins, 3 * newtonIterations); assert.equal(o.counts.finishes, o.counts.begins);
    assert.equal(o.counts.observed, o.counts.begins); assert.equal(o.counts.missing, 0); assert.equal(o.counts.callbackErrors, 0);
    for (const r of o.records) {
      assert.equal(r.valid, true, r.missing.join('; ')); assert.notEqual(r.startU[0], 1e30);
      assert.equal(r.forceScale, observed.forceScale); assert.equal(r.forceTolerance, observed.forceTolerance);
      direct += r.source === 'direct'; pcg += r.source === 'pcg';
      assert.ok(r.nominal && r.realized); assert.deepEqual(r.packedDirection, r.nominal.direction); assert.deepEqual(r.candidatePublicBeforeFinish, r.startX);
      assert.deepEqual(r.realized.direction, r.candidateU.map((u, i) => u - r.startU[i]));
      assert.deepEqual(r.acceptedRealizedDirection, r.afterU.map((u, i) => u - r.startU[i]));
      assert.ok(r.afterX.every((x, i) => Object.is(x, r.x0[i] + r.afterU[i])));
    }
    const observedSnapshot = observed.world.snapshot(), plainSnapshot = plain.world.snapshot();
    step(observed); step(plain); const end = observed.world.snapshot(); parity(observed.world, plain.world);
    observed.world.restore(observedSnapshot); plain.world.restore(plainSnapshot); step(observed); step(plain);
    assert.deepEqual(observed.world.snapshot(), end); parity(observed.world, plain.world);
    events += o.records.length; o.detach(); o.detach();
    assert.equal(Object.hasOwn(observed.world.energySearch, 'begin'), false); assert.equal(Object.hasOwn(observed.world.energySearch, 'finish'), false);
    const n = o.counts.observed; step(observed); step(plain); parity(observed.world, plain.world); assert.equal(o.counts.observed, n);
  }
  assert.ok(direct > 0 && pcg > 0);
  console.log(`state-modal-solve-parity: ${events} actual events across budgets1/4/16 and both starts; direct=${direct}, PCG=${pcg}; all latent/public/cache/snapshot bytes exact, fixed force policy retained`);
});

test('nominal and realized latent directions use actual H(startU) and every native/public input is losslessly bound', () => {
  const c = fixture(), w = c.world; let products = 0;
  const o = attachStateModalSolveObserver(c, { onIteration: r => {
    assert.equal(r.valid, true, r.missing.join('; '));
    assert.throws(() => w.authoritativeState(), /boundary/);
    for (const kind of ['nominal', 'realized']) {
      const measured = r[kind], out = new Float64Array(w.x.length);
      hessianTimes(shadow(w), Float64Array.from(r.startU), Float64Array.from(measured.direction), out, 'reference-displacement');
      assert.deepEqual(measured.product, Array.from(out)); assert.deepEqual(measured.residual, Array.from(out, (v, i) => v + r.gradient[i]));
      assert.equal(measured.residualInfinity, Math.max(...measured.residual.map(Math.abs))); products++;
    }
    assert.equal(r.stateCoordinates, 'reference-displacement'); assert.equal(r.stateIdentity.version, 1);
    for (const [key, encoded] of Object.entries(r.stateFloat64LE)) {
      const values = key === 'h' ? [r.h] : key === 'nominalDirection' ? r.nominal.direction : key === 'realizedDirection' ? r.realized.direction : r[key];
      assert.deepEqual(decode(encoded), values, key); assert.equal(createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('hex'), r.stateSHA256[key]);
    }
    for (const [key, encoded] of Object.entries(r.incrementTrial.stateFloat64LE)) assert.deepEqual(decode(encoded), key === 'h' ? [r.incrementTrial.h] : r.incrementTrial[key]);
  } });
  for (let i = 0; i < 2; i++) step(c);
  assert.equal(o.counts.missing, 0); assert.equal(o.counts.callbackErrors, 0); assert.equal(products, 16); o.detach();
  console.log('state-modal-solve-operator:16 actual latent GN products re-read independently; public raw stale view distinguished from candidate projection; all LE/SHA bindings checked');
});

test('genuine failed PCG uses the direct fallback buffer, never the failed tentative direction', () => {
  // Large smooth distortion is solely an instrumentation path control. It does
  // not widen the amplitude/geometry of the declared accuracy campaign.
  const params = { cells: 3, grain: 23, amplitude: 10, substeps: 4, newtonIterations: 16, nonlinear: true };
  const observed = fixture(params), plain = fixture(params), o = attachStateModalSolveObserver(observed);
  for (let i = 0; i < 3; i++) { step(observed); step(plain); parity(observed.world, plain.world); }
  const fallbacks = o.records.filter(r => r.source === 'direct-after-pcg-failure');
  assert.ok(fallbacks.length > 0); assert.equal(o.counts.missing, 0);
  for (const r of fallbacks) {
    assert.equal(r.factorDelta, 1); assert.equal(r.pcgAttempted, true); assert.equal(r.pcgFailAfterSolve, 4);
    assert.ok(r.pcgIterations > 0 && r.pcgIterations <= 12); assert.ok(r.nominal.relativeResidual < 1e-10);
    assert.ok(r.candidateU.every((u, i) => Object.is(u, r.startU[i] + r.nominal.direction[i])));
  }
  o.detach(); console.log(`state-modal-solve-fallback:${fallbacks.length} real failed-PCG/direct fallback events with exact unobserved replay`);
});

test('stationary and precision-limited decisions remain distinct and preserve original counters', () => {
  const rest = fixture({ amplitude: 0, newtonIterations: 4 }), noop = attachStateModalSolveObserver(rest); step(rest);
  assert.equal(noop.counts.missing, 0); assert.equal(noop.records.length, 4);
  assert.ok(noop.records.every(r => r.lineSearch.stationaryNoop && !r.lineSearch.accepted && !r.lineSearch.rejected && r.acceptedAlpha === null));
  assert.ok(noop.records.some(r => r.source === 'pcg' && r.pcgIterations === 0 && r.nominalUpdateApplied === false)); noop.detach();
  const c = fixture({ substeps: 179378, newtonIterations: 16 }), o = attachStateModalSolveObserver(c); step(c);
  assert.equal(o.counts.missing, 0); const limited = o.records.filter(r => r.lineSearch.precisionLimited);
  assert.ok(limited.length > 0);
  for (const r of limited) { assert.equal(r.lineSearch.accepted, false); assert.equal(r.lineSearch.rejected, true); assert.equal(r.acceptedAlpha, 0); assert.deepEqual(r.afterU, r.startU); }
  assert.equal(c.world.energySearch.increment.precisionLimited, limited.length); o.detach();
  console.log(`state-modal-solve-decisions:4 actual stationary no-ops and${limited.length} actual precision-limited rejected updates; no green convergence substituted`);
});

test('rejected/invalid synthetic proposals retain the last evaluated u separately from restored u and originals still execute', () => {
  const c = fixture({ amplitude: 0 }), w = c.world, o = attachStateModalSolveObserver(c), start = w._u.slice();
  // These deliberately have no intervening Newton solve. They test observation
  // failure/counter retention, not admissible actual solver-event evidence.
  w._ut.set(w._u); w.xt.set(w.x); w.energySearch.begin(w); w._u.set(w.X0.map(v => -v));
  w.energySearch.finish(w, new Float64Array(w.x.length));
  let r = o.records.at(-1); assert.equal(r.valid, false); assert.match(r.missing.join('; '), /one-substep public Newton/);
  assert.equal(r.lineSearch.decision, 'rejected'); assert.ok(r.lineSearch.invalidTrials >= 1);
  assert.deepEqual(r.afterU, Array.from(start)); assert.notDeepEqual(r.lastTrialU, r.afterU);
  assert.equal(r.incrementTrial.runtime.decision, 'rejected'); assert.deepEqual(r.incrementTrial.trialU, r.lastTrialU);
  assert.ok(r.lastTrialX.every((x, i) => Object.is(x, r.x0[i] + r.lastTrialU[i])));
  // Preserve an invalid candidate word even though JSON cannot represent NaN.
  w.energySearch.begin(w); const view = new DataView(w._u.buffer); view.setBigUint64(0, 0x7ff8000000000123n, true);
  const expected = Buffer.from(w._u.buffer).subarray(0, 8).toString('hex');
  w.energySearch.finish(w, new Float64Array(w.x.length)); r = o.records.at(-1);
  assert.equal(r.valid, false); assert.equal(r.lineSearch.invalidTrials, 21); assert.equal(r.lineSearch.decision, 'rejected');
  assert.equal(Buffer.from(r.stateFloat64LE.candidateU, 'base64').subarray(0, 8).toString('hex'), expected);
  assert.ok(r.nonfiniteFields.includes('candidateU')); assert.deepEqual(w._u, start); assert.equal(o.counts.finishes, 2); o.detach();
  console.log('state-modal-solve-rejection: original search rejects finite-collapse/21invalid-NaN trials, exact candidate raw words retained, last evaluated trial never relabelled restored endpoint');
});

test('stream callbacks are copied and synchronous; callback errors never suppress physics', () => {
  const observed = fixture(), plain = fixture(), delivered = [], o = attachStateModalSolveObserver(observed, { retain: 'none', onIteration: r => {
    delivered.push(r.iteration); r.startU.fill(1e30); r.nominal.direction.fill(1e30); throw new Error('deliberate callback failure');
  } });
  for (let i = 0; i < 2; i++) { step(observed); step(plain); parity(observed.world, plain.world); }
  assert.deepEqual(delivered, [1,2,3,4,5,6,7,8]); assert.equal(o.records.length, 0); assert.equal(o.counts.retained, 0);
  assert.equal(o.counts.missing, 0); assert.equal(o.counts.callbackErrors, 8); assert.ok(o.callbackErrors.every(e => e.message === 'deliberate callback failure')); o.detach();
  const c = fixture(), thenable = attachStateModalSolveObserver(c, { onIteration: () => ({ then() {} }) }); step(c);
  assert.equal(thenable.counts.callbackErrors, 4); assert.equal(thenable.counts.missing, 0); thenable.detach();
  const rejected = fixture(), discarded = attachStateModalSolveObserver(rejected, { onIteration: () => Promise.reject(new Error('discarded asynchronous callback')) }); step(rejected);
  assert.equal(discarded.counts.callbackErrors, 4); assert.equal(discarded.counts.missing, 0); discarded.detach();
  assert.throws(() => attachStateModalSolveObserver(fixture(), { onIteration: async () => {} }), /synchronous/);
  console.log('state-modal-solve-callbacks:8 copied streaming events/errors with exact replay; thenables reported separately and async callbacks refused');
});

test('method descriptors, unsafe attachment/detach and incomplete/original-error paths are explicit', () => {
  const c = fixture(), search = c.world.energySearch;
  const begin = { value: EnergySearch.prototype.begin, writable: true, configurable: true, enumerable: false };
  const finish = { value: EnergySearch.prototype.finish, writable: true, configurable: true, enumerable: false };
  Object.defineProperty(search, 'begin', begin); Object.defineProperty(search, 'finish', finish);
  const o = attachStateModalSolveObserver(c), wrappedFinish = search.finish, wrappedBegin = search.begin;
  search.finish = () => {}; assert.throws(() => o.detach(), /refusing to overwrite/); assert.equal(search.begin, wrappedBegin);
  search.finish = wrappedFinish; o.detach(); assert.deepEqual(Object.getOwnPropertyDescriptor(search, 'begin'), begin); assert.deepEqual(Object.getOwnPropertyDescriptor(search, 'finish'), finish);
  const readonly = fixture(), rs = readonly.world.energySearch;
  Object.defineProperty(rs, 'finish', { value: EnergySearch.prototype.finish, writable: false, configurable: true });
  assert.throws(() => attachStateModalSolveObserver(readonly), /safely wrapped/); assert.equal(Object.hasOwn(rs, 'begin'), false);
  const sealed = fixture(); Object.preventExtensions(sealed.world.energySearch); assert.throws(() => attachStateModalSolveObserver(sealed), /safely wrapped/);
  const incomplete = fixture(), pending = attachStateModalSolveObserver(incomplete); incomplete.world.energySearch.begin(incomplete.world); pending.detach();
  assert.equal(pending.counts.missing, 1); assert.equal(pending.records[0].incomplete, true);
  incomplete.world.energySearch.finish(incomplete.world, new Float64Array(incomplete.world.x.length));
  const failed = fixture(), errorObserver = attachStateModalSolveObserver(failed); failed.world.userForce[0] = 1;
  assert.throws(() => failed.world.energySearch.begin(failed.world), /external forces/); assert.equal(errorObserver.counts.begins, 1); assert.equal(errorObserver.counts.observed, 1); errorObserver.detach();
  const finishFailure = fixture(), fw = finishFailure.world, f = attachStateModalSolveObserver(finishFailure); fw.energySearch.begin(fw); fw.dt *= 2;
  assert.throws(() => fw.energySearch.finish(fw, new Float64Array(fw.x.length)), /immutable origin\/mass\/timestep/);
  assert.equal(f.counts.finishes, 1); assert.equal(f.records[0].valid, false); assert.equal(f.records[0].incrementTrial, null); f.detach();
  const invalid = fixture(); invalid.forceTolerance *= 2; assert.throws(() => attachStateModalSolveObserver(invalid), /fixed initial force/);
  assert.throws(() => attachStateModalSolveObserver(fixture(), { retain: 'some' }), /retention/);
  console.log('state-modal-solve-safety: descriptor restoration atomic preflight, replaced wrappers protected, incomplete/original exceptions retained and propagated, fixed tau/options checked');
});

test('each original begin/finish executes exactly once even when nominal observation is unavailable', () => {
  const originalBegin = Object.getOwnPropertyDescriptor(EnergySearch.prototype, 'begin'), originalFinish = Object.getOwnPropertyDescriptor(EnergySearch.prototype, 'finish');
  let begins = 0, finishes = 0, observer;
  Object.defineProperty(EnergySearch.prototype, 'begin', { ...originalBegin, value: function(w) { begins++; return originalBegin.value.call(this, w); } });
  Object.defineProperty(EnergySearch.prototype, 'finish', { ...originalFinish, value: function(w, g) { finishes++; return originalFinish.value.call(this, w, g); } });
  try {
    const c = fixture(), w = c.world; observer = attachStateModalSolveObserver(c); step(c);
    assert.equal(begins, 4); assert.equal(finishes, 4);
    // Synthetic no-solve association is explicitly invalid, while real search
    // still runs once and records the actual stationary decision.
    w.energySearch.begin(w); w.energySearch.finish(w, new Float64Array(w.x.length));
    assert.equal(begins, 5); assert.equal(finishes, 5); assert.equal(observer.records.at(-1).valid, false);
    assert.equal(observer.records.at(-1).lineSearch.stationaryNoop, true);
    assert.equal(observer.counts.begins, 5); assert.equal(observer.counts.finishes, 5); observer.detach();
  } finally {
    try { observer?.detach(); } finally {
      Object.defineProperty(EnergySearch.prototype, 'begin', originalBegin); Object.defineProperty(EnergySearch.prototype, 'finish', originalFinish);
    }
  }
  console.log('state-modal-solve-originals:4 actual events plus1 explicit diagnostic failure each invoke the real begin/finish once, and prototype descriptors are restored');
});
