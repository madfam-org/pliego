import test from 'node:test';
import assert from 'node:assert/strict';
import { makePatch } from '../bench/membrane-patch.mjs';
import { loadStateModalInputs } from '../bench/membrane-state-modal-inputs.mjs';
import { runStateModalTrajectory } from '../bench/membrane-state-modal-audit.mjs';
import { createStateModalWorld, runStateModalContext } from '../bench/membrane-state-modal-runtime.mjs';
import { attachStateModalSolveObserver } from '../bench/membrane-state-modal-solve-observer.mjs';
import { validateStateObservation } from '../bench/membrane-state-modal-validation.mjs';
import { assertStateModalPayloadEqual, compareStateModalReports, stateReplayMigration, commonCurvatureInputs, curvatureChanges, STATE_REPLAY_ARCHIVE_GIT } from '../bench/compare-membrane-state-modal-audit.mjs';
import { hessianTimes } from '../src/xpbd/pcg.js';

const inputs = loadStateModalInputs(), patch = makePatch({ ...inputs.geometry, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
const row = { ...inputs.rows.find(t => t.level === 8 && t.budget === 4 && t.seed === false), steps: 3 };
let toys;
function trajectories() {
  if (toys) return toys;
  toys = { gn: runStateModalTrajectory(patch, inputs.reference, row, { instrument: true }),
    exact: runStateModalTrajectory(patch, inputs.reference, row, { instrument: true, membraneCurvature: 'exact-hessian' }),
    plain: runStateModalTrajectory(patch, inputs.reference, row, { instrument: false, membraneCurvature: 'exact-hessian' }) };
  return toys;
}
const shell = (t, instrument, extra = {}) => ({ recordedAt: 'unit', source: { git: 'unit', dirty: false }, protocol: { instrument, perNewtonLinearDiagnostics: instrument ? 'measured' : 'not measured', ...extra },
  gates: { perNewtonLinearDiagnostics: instrument ? true : 'not measured', actualTimeAccuracyAcceptance: false }, results: [{ trajectories: [t] }] });
const world = curvature => createStateModalWorld(patch, { phi: inputs.reference.mode.phi, omega: inputs.reference.mode.omega, amplitude: row.amplitude,
  substeps: row.substeps, newtonIterations: row.budget, previousPoseStart: row.seed, ...(curvature ? { membraneCurvature: curvature } : {}) });

test('exact capture binds the effective operator per Newton record; GN records keep their historical shape', () => {
  const { gn, exact, plain } = trajectories();
  for (const t of [gn, exact]) {
    assert.ok(t.trace.every(o => o.validation.valid)); assert.ok(t.gates.measurementValid); assert.equal(t.continuation.pass, true);
    assert.equal(t.solveObservation.counts.missing, 0); assert.equal(t.solveObservation.trace.length, row.steps * row.budget);
  }
  for (const r of gn.solveObservation.trace) { assert.equal(Object.hasOwn(r.nominal, 'operator'), false); assert.match(r.nominal.equation, /^actual incremental GN H/); }
  assert.ok(gn.trace.every(o => !Object.hasOwn(o.solver, 'membraneCurvature')));
  for (const r of exact.solveObservation.trace) { assert.equal(r.nominal.operator, 'exact-hessian'); assert.match(r.nominal.equation, /exact-membrane-curvature/); }
  exact.trace.forEach((o, i) => assert.equal(o.solver.membraneCurvatureCounters.iterations, i * row.budget));
  const direct = exact.solveObservation.trace.find(r => r.source === 'direct');
  assert.ok(direct.nominal.relativeResidual < 1e-12, 'a direct exact solve has a near-zero defect under its own operator');
  // Measuring the same direction with the wrong (GN) operator would report a large, false defect.
  const record = exact.solveObservation.snapshots['first-accepted'], w = world('exact-hessian').world, product = new Float64Array(record.gradient.length);
  hessianTimes(w, Float64Array.from(record.startU), Float64Array.from(record.nominal.direction), product, 'reference-displacement');
  const residual = product.map((v, i) => v + record.gradient[i]), relative = Math.hypot(...residual) / Math.hypot(...record.gradient);
  assert.equal(record.membraneCurvature.operator, 'exact-hessian');
  assert.ok(relative > 1e4 * record.nominal.relativeResidual, `${relative} vs ${record.nominal.relativeResidual}`);
  assertStateModalPayloadEqual(shell(plain, false, { membraneCurvature: 'exact-hessian' }), shell(exact, true, { membraneCurvature: 'exact-hessian' }), { observerComparison: true });
  console.log(`exact-capture-binding: ${exact.solveObservation.trace.length} exact records bound to their operator (direct defect ${direct.nominal.relativeResidual.toExponential(1)}; GN-measured ${relative.toExponential(1)} would mislabel it); GN records unchanged; exact observer parity holds`);
});

test('a visible fallback is labelled Gauss–Newton, with the requested exact operator only as a named extra diagnostic', () => {
  const c = createStateModalWorld(patch, { phi: inputs.reference.mode.phi, omega: inputs.reference.mode.omega, amplitude: .5, substeps: 60,
    newtonIterations: 4, previousPoseStart: false, membraneCurvature: 'exact-hessian' });
  const observer = attachStateModalSolveObserver(c, { retain: 'all' });
  try { for (let i = 0; i < 2; i++) assert.equal(c.world.step(c.world.dt), 1); } finally { observer.detach(); }
  assert.equal(observer.counts.missing, 0); assert.ok(c.world._exactCurvature.counters.gnFallbackFactors >= 1);
  const fallback = observer.records.filter(r => r.membraneCurvature.operator === 'gauss-newton');
  assert.equal(fallback.length, c.world._exactCurvature.counters.gnFallbackFactors);
  for (const r of fallback) {
    assert.equal(r.membraneCurvature.receipt.direction, 'gauss-newton-fallback'); assert.equal(r.membraneCurvature.receipt.fallbackReason, 'finite-nonpositive-pivot');
    assert.equal(r.nominal.operator, 'gauss-newton'); assert.match(r.nominal.equation, /^actual incremental GN H/); assert.ok(r.nominal.relativeResidual < 1e-12);
    assert.equal(r.requestedOperatorNominal.operator, 'exact-hessian'); assert.match(r.requestedOperatorNominal.scope, /not the solved-system defect/);
    assert.ok(r.requestedOperatorNominal.relativeResidual > 1e4 * r.nominal.relativeResidual);
  }
  assert.ok(observer.records.filter(r => r !== fallback[0]).every(r => !r.requestedOperatorNominal || r.membraneCurvature.operator === 'gauss-newton'));
  console.log(`exact-capture-fallback: ${fallback.length} fallback record(s) labelled GN (defect ${fallback[0].nominal.relativeResidual.toExponential(1)}); requested-exact diagnostic ${fallback[0].requestedOperatorNominal.relativeResidual.toExponential(1)} kept separate`);
});

test('the validator binds exact receipts to the live World and keeps GN observations free of them', () => {
  const capture = curvature => { const c = world(curvature), seen = []; runStateModalContext(c, { steps: 2, retain: 'initial-final', onObservation: o => seen.push(structuredClone(o)) }); return { c, seen }; };
  const exact = capture('exact-hessian'), gn = capture(null), final = exact.seen.at(-1), previous = exact.seen.at(-2);
  assert.equal(validateStateObservation(final, { context: exact.c, previous }).valid, true);
  for (const [mutate, pattern] of [[o => { o.solver.membraneCurvatureCounters.exactFactors += 1; }, /curvature counters/], [o => { o.solver.membraneCurvatureIdentity.version = 2; }, /curvature identity/],
    [o => { o.solver.factorCurvature = 'magic'; }, /factor curvature/]]) {
    const o = structuredClone(final); mutate(o); const v = validateStateObservation(o, { context: exact.c, previous });
    assert.equal(v.valid, false); assert.ok(v.errors.some(e => pattern.test(e)), v.errors.join('; '));
  }
  const injected = structuredClone(gn.seen.at(-1)); injected.solver.membraneCurvature = 'exact-hessian';
  assert.ok(validateStateObservation(injected, { context: gn.c, previous: gn.seen.at(-2) }).errors.some(e => /unexpected curvature receipts/.test(e)));
  const forged = validateStateObservation(gn.seen.at(-1), { context: { ...gn.c, membraneCurvature: 'exact-hessian' }, previous: gn.seen.at(-2) });
  assert.ok(forged.errors.some(e => /named membrane curvature|membraneCurvature/.test(e)), forged.errors.join('; '));
  console.log('exact-capture-validation: exact receipts accepted; tampered counters/identity/factor operator, GN-injected receipts and a forged context request refused');
});

test('comparison helpers: reviewed source migration lists and separate public/latent curvature changes', () => {
  const old = { git: STATE_REPLAY_ARCHIVE_GIT, dirty: false, files: [{ path: 'a', sha256: '1' }, { path: 'b', sha256: '2' }] };
  const fresh = { git: 'f'.repeat(40), dirty: false, files: [{ path: 'a', sha256: '1' }, { path: 'b', sha256: '3' }, { path: 'c', sha256: '4' }] };
  assert.equal(stateReplayMigration(old, fresh, { changes: ['b'], additions: ['c'] }).allOtherFilesByteIdentical, true);
  assert.throws(() => stateReplayMigration(old, fresh, { changes: [], additions: ['c'] }), /unreviewed source change/);
  assert.throws(() => stateReplayMigration(old, fresh, { changes: ['b'], additions: [] }), /unreviewed source addition/);
  assert.throws(() => stateReplayMigration(old, { ...fresh, files: fresh.files.slice(1) }, { changes: ['b'], additions: ['c'] }), /historical source removed/);
  assert.throws(() => compareStateModalReports({}, {}, { mode: 'state-replay', oldRawSHA256: '0'.repeat(64) }), /closed fixed24 state capture/);
  const { gn, exact } = trajectories(), b = shell(gn, true), c = shell(exact, true, { membraneCurvature: 'exact-hessian' });
  commonCurvatureInputs(b, c);
  const changes = curvatureChanges(b, c), t = changes.trajectories[0];
  for (const kind of ['public', 'authoritative']) assert.equal(changes[kind].gains + changes[kind].losses + changes[kind].unchanged, row.steps);
  assert.equal(t.curvatureEvents.iterations, row.steps * row.budget); assert.ok(t.authoritativeResidual.exactCurvature && t.firstStepAuthoritativeResidual.gaussNewton > 0);
  const drift = structuredClone(c); drift.results[0].trajectories[0].history[0].stateFloat64LE.u = gn.history[0].stateFloat64LE.x;
  assert.throws(() => commonCurvatureInputs(b, drift), /initial bytes/);
  const gnRequest = structuredClone(c); delete gnRequest.protocol.membraneCurvature; assert.throws(() => commonCurvatureInputs(b, gnRequest), /named exact-curvature candidate/);
  console.log(`exact-capture-compare: migration lists exact (change/addition/removal refused); toy GN->exact public ${JSON.stringify({ g: changes.public.gains, l: changes.public.losses })} latent ${JSON.stringify({ g: changes.authoritative.gains, l: changes.authoritative.losses })}; initial-byte drift refused`);
});
