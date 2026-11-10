import test from 'node:test';
import assert from 'node:assert/strict';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld, observeModalWorld, runModalRuntime, runModalContext } from '../bench/membrane-modal-runtime.mjs';
import { gradient } from '../src/xpbd/implicit.js';

function fixture() {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: 0.293 });
  // A normalized synthetic direction suffices for observer verification. This
  // test does not claim an eigenvector/eigenfrequency or validate modal accuracy.
  const phi = patch.vertices.map(([u]) => [(u - 20) / 20, 0]);
  return { patch, parameters: { phi, omega: 1e5, amplitude: 0.004, substeps: 4000, newtonIterations: 4, previousPoseStart: false } };
}
const bits = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

test('modal observer constructs a real free World and initializes once without supplying an inertial target', () => {
  const { patch, parameters } = fixture(), reference = patch.world.X0.slice(), c = createModalWorld(patch, parameters), w = c.world;
  assert.notEqual(w, patch.world); assert.deepEqual(w.X0, reference); assert.deepEqual(patch.world.X0, reference);
  assert.equal(w.opts.damping, 0); assert.equal(w.bendDamp, 0); assert.equal(w.opts.lineSearch, true);
  assert.equal(w.opts.newtonIterations, 4); assert.equal(w.opts.substeps, 4000); assert.equal(w.dt, 1 / (60 * 4000));
  assert.equal(w.sys.nFree, w.mesh.nV); assert.ok(!w.fixed.some(Boolean)); assert.ok(w.v.every(v => v === 0));
  assert.ok(w.xs.every(v => v === 0)); assert.ok(w.xt.every(v => v === 0));
  for (let v = 0; v < w.mesh.nV; v++) {
    assert.equal(w.x[3 * v], patch.vertices[v][0] + parameters.amplitude * parameters.phi[v][0]);
    assert.equal(w.x[3 * v + 1], 0); assert.equal(w.x[3 * v + 2], -patch.vertices[v][1]);
  }
  assert.equal(c.massProof.totalMass, 0.128); assert.equal(c.massProof.verticesConsumed, patch.vertices.length);
  assert.ok(c.massProof.maximumMassScaledDifference <= c.massProof.tolerance);
  const initial = observeModalWorld(c, { step: 0, initial: true });
  assert.equal(initial.measurementValid, true, initial.errors.join('\n'));
  assert.equal(initial.targetValid, false); assert.equal(initial.residual, null); assert.equal(initial.literalForceGate, null);
  assert.equal(initial.inertiaEnergy, null); assert.equal(initial.incrementalEnergy, null);
  assert.ok(initial.elasticEnergy > 0); assert.equal(initial.kineticEnergy, 0);
  assert.equal(initial.nonMembraneEnergy, 0); assert.equal(initial.nonMembraneGradientMaximum, 0);
  for (const changed of [{ substeps: 0 }, { newtonIterations: 0 }, { omega: 0 }, { amplitude: NaN },
    { phi: parameters.phi.map(p => p.map(v => 2 * v)) }, { lineSearch: false }, { sleep: false }]) {
    assert.throws(() => createModalWorld(patch, { ...parameters, ...changed }));
  }
  console.log('membrane-modal-initialization: actual free World, native mass0.128g, immutable reference, one initial displacement/zero velocity; constructor target not mislabeled; unsupported options reject');
});

test('each public modal step exposes the literal full incremental force equation with fixed initial normalization', () => {
  const { patch, parameters } = fixture(), report = runModalRuntime(patch, { ...parameters, steps: 3 });
  assert.equal(report.status, 'completed'); assert.equal(report.observedCount, 4); assert.equal(report.retainedCount, 4);
  assert.equal(report.completedSteps, 3); assert.equal(report.gates.measurementValid, true);
  assert.equal(report.gates.exactActualSubstepCounters, true); assert.equal(report.gates.noSleep, true);
  const forceScale = parameters.amplitude * parameters.omega ** 2 * Math.max(...report.massProof.native.map((m, i) => m * Math.hypot(...parameters.phi[i])));
  let time = 0;
  for (const obs of report.observations.slice(1)) {
    time += obs.h; assert.equal(obs.time, time); assert.equal(obs.framesRun, obs.step); assert.equal(obs.substepsRun, obs.step);
    const expected = obs.elasticGradient.map((g, i) => g + report.massProof.native[Math.floor(i / 3)] / (obs.h * obs.h) * (obs.x[i] - obs.xt[i]));
    // Multiplication by precomputed reciprocal is the actual World arithmetic;
    // an independently grouped division may differ by rounding, so compare raw
    // coordinate residuals on a force-scaled numerical observation tolerance.
    const difference = Math.max(...expected.map((r, i) => Math.abs(r - obs.residual[i])));
    assert.ok(difference <= 1e-14 * Math.max(1, forceScale));
    assert.equal(obs.residualInfinity, Math.max(...obs.residual.map(Math.abs)));
    assert.equal(obs.forceScale, forceScale); assert.equal(obs.forceTolerance, Math.max(1e-7, 1e-10 * forceScale));
    assert.equal(obs.literalForceGate, obs.residualInfinity <= obs.forceTolerance);
    assert.equal(obs.planarExact, true); assert.equal(obs.nonMembraneEnergy, 0); assert.equal(obs.nonMembraneGradientMaximum, 0);
    assert.equal(obs.execution.returnedSubsteps, 1); assert.equal(obs.execution.actualSubstepExecuted, true);
    assert.equal(obs.execution.xtMatchesActualPredictor, true); assert.equal(obs.execution.velocityMatchesActualDifference, true);
    assert.equal(obs.solver.newtonIterations, parameters.newtonIterations);
    assert.equal(obs.solver.linearDirectionResiduals, null); assert.equal(obs.solver.acceptedAlphaHistory, null);
  }
  const c = createModalWorld(patch, parameters); c.world.step(c.world.dt);
  const observation = observeModalWorld(c, { step: 1 }), actual = new Float64Array(c.world.x.length);
  gradient(c.world, c.world.x, actual); assert.deepEqual(observation.elasticGradient, Array.from(actual));
  console.log(`membrane-modal-equation: three actual public step(h) calls, exact counters/predictor/velocity; full gradient plus native M/h² term; fixed force scale=${forceScale} microN, literal threshold=${report.forceTolerance}`);
});

test('observations and streaming retention leave exact actual x/v replay and solver budgets unchanged', () => {
  const { patch, parameters } = fixture(), observed = createModalWorld(patch, parameters), plain = createModalWorld(patch, parameters);
  observeModalWorld(observed, { step: 0, initial: true });
  for (let step = 1; step <= 6; step++) {
    observed.world.step(observed.world.dt); plain.world.step(plain.world.dt);
    const before = observed.world.snapshot(); observeModalWorld(observed, { step });
    assert.deepEqual(observed.world.snapshot(), before);
    for (const key of ['x', 'v', 'xs', 'xt']) assert.deepEqual(bits(observed.world[key]), bits(plain.world[key]));
    assert.deepEqual(observed.world.snapshot(), plain.world.snapshot());
  }
  const all = runModalRuntime(patch, { ...parameters, steps: 6 }), callbacks = [];
  const shared = createModalWorld(patch, parameters), core = runModalContext(shared, { steps: 6 });
  assert.deepEqual(core, all, 'convenience wrapper and caller-owned context must use the same actual stepping loop');
  assert.deepEqual(Array.from(shared.world.x), all.final.x); assert.deepEqual(Array.from(shared.world.v), all.final.v);
  assert.throws(() => runModalContext(shared, { steps: 1 }), /newly initialized, unstepped/);
  const streamed = runModalRuntime(patch, { ...parameters, steps: 6, retain: 'initial-final', onObservation: sample => {
    callbacks.push(sample.step); sample.x[0] = 1e20; // callbacks receive data copies, not live World state.
  } });
  assert.deepEqual(callbacks, [0, 1, 2, 3, 4, 5, 6]); assert.equal(streamed.callbackCount, 7);
  assert.equal(streamed.observedCount, 7); assert.equal(streamed.retainedCount, 2);
  assert.deepEqual(streamed.final, all.final); assert.deepEqual(streamed.initial, all.initial);
  assert.equal(streamed.final.solver.newtonIterations, parameters.newtonIterations);
  console.log('membrane-modal-noninvasive: six observed/unobserved actual Worlds replay bit-exact in x/v/targets/snapshots; streaming selection explicit and callback mutations isolated');
});

test('under-solved actual World force failures remain literal failures, with no hidden Newton repetition', () => {
  const { patch, parameters } = fixture();
  const low = runModalRuntime(patch, { ...parameters, newtonIterations: 1, steps: 3 });
  const more = runModalRuntime(patch, { ...parameters, newtonIterations: 4, steps: 3 });
  assert.equal(low.completedSteps, 3); assert.equal(low.final.solver.newtonIterations, 1);
  assert.equal(low.gates.literalFinalForceEverySubstep, false);
  assert.ok(low.observations.slice(1).some(obs => obs.residualInfinity > obs.forceTolerance));
  assert.equal(low.forceTolerance, more.forceTolerance); assert.equal(low.fixedInitialForceScale, more.fixedInitialForceScale);
  assert.equal(low.gates.measurementValid, true); assert.equal(low.final.framesRun, 3); assert.equal(low.final.substepsRun, 3);
  assert.ok(low.observations.slice(1).every(obs => obs.solver.linearDirectionResiduals === null));
  console.log(`membrane-modal-budget: public Newton1 retains residual failures (last=${low.final.residualInfinity}, threshold=${low.forceTolerance}); public Newton4 is a separate declared run, never a benchmark-side repeated solve`);
});

test('actual sleep is retained as censored incomplete vibration work, without waking or disabling it', () => {
  const { patch, parameters } = fixture();
  const report = runModalRuntime(patch, { ...parameters, amplitude: 0, steps: 35, retain: 'initial-final' });
  assert.equal(report.status, 'sleep-censored'); assert.equal(report.gates.noSleep, false);
  assert.equal(report.completedSteps, 30); assert.equal(report.requestedSteps, 35);
  assert.equal(report.gates.completeRequestedSteps, false); assert.equal(report.final.asleep, true);
  assert.equal(report.observedCount, 31); assert.equal(report.retainedCount, 2);
  assert.equal(report.sleepPolicy.override, 'none; sleep censors this experiment');
  console.log('membrane-modal-sleep: zero-amplitude control sleeps after actual30calls; requested35-step experiment explicitly censored, no forced wake or silent missing solves');
});
