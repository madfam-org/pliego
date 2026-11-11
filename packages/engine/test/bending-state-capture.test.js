import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadBendingStateInputs, verifyBendingStateInputs, BENDING_REFERENCE_PROGRAM, BENDING_STATE_INPUT_PATH } from '../bench/bending-state-inputs.mjs';
import { createBendingStateWorld, runBendingStateContext, BENDING_STATE_IDENTITY, bendingIdentityMatches } from '../bench/bending-state-runtime.mjs';
import { bendingComparatorSetup, advanceBackwardEuler, measureBendingState } from '../bench/bending-state-metrics.mjs';
import { REFERENCE_BENDING_IDENTITY } from '../src/xpbd/reference-bending.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const candidate = { membraneCurvature: 'exact-hessian', pcgStop: 'half-force-tolerance' };
const shortRow = (inputs, budget, steps = 3) => ({ ...inputs.rows.find(r => r.level === 1 && r.budget === budget && !r.seed), steps });

test('bending fixture: the committed reference is reproduced by the independent program', () => {
  const inputs = loadBendingStateInputs(), summary = verifyBendingStateInputs(JSON.parse(readFileSync(new URL('../../../' + BENDING_STATE_INPUT_PATH, import.meta.url))));
  assert.deepEqual(summary, { trajectories: 24, poststeps: 7200, newtonEvents: 50400, S0: 72, N0: 80, omega: inputs.reference.mode.omegaBinary64 });
  const rerun = JSON.parse(execFileSync('python3', ['-I', root + BENDING_REFERENCE_PROGRAM], { input: JSON.stringify(inputs.referenceInput), encoding: 'utf8' }));
  assert.deepEqual(rerun, JSON.parse(JSON.stringify(inputs.reference)), 'reference output must be deterministic and match the fixture');
  const r = inputs.reference;
  assert.equal(r.checks.rigidNullVectors.length, 3); assert.ok(r.maximumEngineStiffnessRelativeDifference <= 1e-14);
  assert.ok(r.mode.nextLambdaRatio > 2, 'selected mode is well separated');
  console.log(`bending-fixture: omega ${r.mode.omegaBinary64} rad/s (${r.mode.frequencyHz.toFixed(2)} Hz), S0 ${r.plan.S0}, N0 ${r.plan.N0}, F0 ${r.forceScale.binary64.toExponential(6)} microN; engine k within ${r.maximumEngineStiffnessRelativeDifference.toExponential(1)} of the independent law; rigid motions exact null vectors`);
});

test('bending runtime: one exact conversion, bending identity, valid observations and summation-order energy agreement', () => {
  const inputs = loadBendingStateInputs(), context = createBendingStateWorld(inputs, shortRow(inputs, 4), candidate);
  assert.equal(bendingIdentityMatches(context.world), true);
  assert.deepEqual(context.world._referenceIdentity, { ...BENDING_STATE_IDENTITY, bending: { ...REFERENCE_BENDING_IDENTITY } });
  assert.equal(context.forceTolerance, 1e-7, 'tau sits on its absolute floor for this amplitude');
  assert.ok(Math.abs(context.forceScale - inputs.reference.forceScale.binary64) <= 1e-13 * context.forceScale);
  assert.equal(context.world.opts.pcgAbsoluteTolerance, 5e-8);
  const run = runBendingStateContext(context, { steps: 3, retain: 'all' });
  assert.equal(run.status, 'completed');
  for (const o of run.observations) {
    assert.equal(o.measurementValid, true, o.errors.join('; '));
    const w = o.authoritative.omittedWork;
    assert.ok(Math.abs(w.energyDifference) <= w.energyBound && w.gradientDifference <= w.gradientBound);
    if (!o.initial) assert.ok(o.authoritative.converged === true && o.authoritative.residualInfinity <= 1e-7, `latent residual ${o.authoritative.residualInfinity}`);
  }
  assert.throws(() => createBendingStateWorld(inputs, shortRow(inputs, 4), { membraneCurvature: 'exact', pcgStop: undefined }), /named membraneCurvature/);
  assert.throws(() => createBendingStateWorld(inputs, shortRow(inputs, 4), { retry: true }), /unknown options/);
  const tampered = createBendingStateWorld(inputs, shortRow(inputs, 4), candidate);
  tampered.world.opts.referenceBending = undefined;
  assert.equal(runBendingStateContext(tampered, { steps: 1 }).status, 'invalid-initial-observation', 'a dropped bending identity is a measurement error');
  console.log(`bending-runtime: 3 budget-4 steps valid; latent residuals ${run.observations.slice(1).map(o => o.authoritative.residualInfinity.toExponential(1)).join(', ')} microN <= tau 1e-7; public ${run.observations.slice(1).map(o => o.residualInfinity.toExponential(1)).join(', ')}`);
});

test('bending comparator: backward Euler matches its closed form; continuous starts at the actual field', () => {
  const inputs = loadBendingStateInputs(), context = createBendingStateWorld(inputs, shortRow(inputs, 16), candidate);
  const u = Array.from(context.world._u), v = Array.from(context.world.v);
  const setup = bendingComparatorSetup(context, inputs.reference.spectrum, { u, v }), selected = setup.modes.find(m => !m.rigid && m.omega === context.omega);
  assert.ok(Math.abs(selected.c - context.amplitude) <= 1e-12 * context.amplitude, 'the initial field is the selected mode at amplitude A');
  assert.ok(setup.modes.filter(m => m !== selected).every(m => Math.abs(m.c) <= 1e-12 * context.amplitude), 'other modal coordinates are rounding only');
  const atStart = measureBendingState(context, setup, { u, v, elasticEnergy: null, bendingEnergy: null, time: 0 });
  for (const scope of ['outOfPlane', 'full']) assert.ok(atStart.errors.continuous[scope].displacement <= 1e-12 && atStart.errors.backwardEuler[scope].displacement <= 1e-12);
  const h = context.world.dt, z = context.omega * h, k = setup.modes.indexOf(selected);
  let q = selected.c, p = 0;
  for (let n = 0; n < 5; n++) { advanceBackwardEuler(setup, h); const next = (q + h * p) / (1 + z * z); p = (next - q) / h; q = next; }
  assert.ok(Math.abs(setup.discrete[k].q - q) <= 1e-15 * Math.abs(q) && Math.abs(setup.discrete[k].p - p) <= 1e-12 * Math.abs(p));
  // Backward Euler loses energy each step by 1/(1+z^2) in the modal energy of an undamped mode.
  const energy = (qq, pp) => .5 * selected.modalMass * (selected.omega ** 2 * qq * qq + pp * pp);
  assert.ok(energy(q, p) < energy(selected.c, 0));
  console.log(`bending-comparator: z = omega h = ${z.toFixed(4)} at level 1; backward-Euler mode recurrence exact; modal energy after 5 steps ${(energy(q, p) / energy(selected.c, 0)).toFixed(4)} of the start`);
});
