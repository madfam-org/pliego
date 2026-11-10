import test from 'node:test';
import assert from 'node:assert/strict';
import { makePatch } from '../bench/membrane-patch.mjs';
import { makeBoundary, solveStatic } from '../bench/plane-stress-runtime.mjs';
import { validateRuntime } from '../bench/plane-stress-validation.mjs';

const solver = { maxIterations: 100, maxBacktracks: 30, armijo: 1e-4, relativePivotTolerance: 1e-14 };
function fixture(mode = 'energy-difference', overrides = {}) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: 0.293 });
  const bc = makeBoundary(patch, 1e-4);
  const runtime = solveStatic(patch, { ...bc, ...solver, lineSearchMode: mode, ...overrides });
  return { patch, bc, runtime, options: { solver: { ...solver, ...overrides }, lineSearchMode: mode } };
}

test('independent acceptance checks actual selected-law solve and retain legitimate finite nonconvergence', () => {
  for (const mode of ['energy-difference', 'total-potential']) {
    const { patch, bc, runtime, options } = fixture(mode);
    const proof = validateRuntime(patch, bc, runtime, options);
    assert.equal(proof.valid, true, proof.errors.join('\n'));
    assert.equal(proof.converged, mode === 'energy-difference');
    assert.equal(proof.computedResidualInfinity, runtime.residualInfinity);
    assert.equal(proof.computedForceTolerance, runtime.forceTolerance);
  }
  const exhausted = fixture('energy-difference', { maxIterations: 0 });
  const proof = validateRuntime(exhausted.patch, exhausted.bc, exhausted.runtime, exhausted.options);
  assert.equal(proof.valid, true, proof.errors.join('\n')); assert.equal(proof.converged, false);
  console.log('plane-stress-validation-positive: actual converged solve, cancellation-stalled control and exhausted finite solve independently classified; failures preserved');
});

test('independent acceptance rejects changed fields, false convergence, masks, support and Armijo metadata', () => {
  const { patch, bc, runtime, options } = fixture();
  const free = bc.freeDofs[0], fixed = bc.fixedDofs[0];
  const mutations = [
    r => { r.converged = false; r.status = 'iteration-limit'; },
    r => { r.residualInfinity = 0; },
    r => { r.gradient[Math.floor(free / 2)][free % 2] += 1; },
    r => { r.residual[free] += 1; },
    r => { r.forceTolerance *= 2; },
    r => { r.forceScale *= 2; },
    r => { r.absoluteForceTolerance = 1e-3; },
    r => { r.relativeForceTolerance = 1e-6; },
    r => { r.fixedDofs = r.fixedDofs.slice(1); },
    r => { r.freeDofs = r.freeDofs.slice(1); },
    r => { r.displacement[Math.floor(fixed / 2)][fixed % 2] = 1e-9; },
    r => { r.reaction[Math.floor(free / 2)][free % 2] = 1; },
    r => { r.reaction[Math.floor(fixed / 2)][fixed % 2] += 1; },
    r => { r.displacement[Math.floor(free / 2)][free % 2] += 1e-9; },
    r => { r.planarExact = false; },
    r => { r.nonMembraneEnergy = 1e-20; },
    r => { r.loadWork += 1; },
    r => { r.energy = NaN; },
    r => { r.maxIterations = 200; },
    r => { r.initialPose = 'oracle displacement'; },
    r => { r.steps = 1; },
    r => { r.trace[0].accepted = false; },
    r => { r.trace[0].acceptanceBasis = 'total-potential'; },
    r => { r.trace[0].actualStepSlope = 0; },
    r => { r.trace[0].zeroActualStep = true; },
    r => { r.trace[0].stablePotentialDifference = 1; },
    r => { r.trace[0].incrementRoundoffAllowance = 1; r.trace[0].armijoRoundoffAllowance = 1; },
    r => { r.trace[0].relativeLinearResidual = 1; },
    r => { r.trace[0].alpha *= 0.5; },
    r => { r.rejections = 99; },
    r => { r.trace.at(-1).freeResidualAfter = 0; },
  ];
  for (const change of mutations) {
    const corrupted = structuredClone(runtime); change(corrupted);
    const proof = validateRuntime(patch, bc, corrupted, options);
    assert.equal(proof.valid, false); assert.equal(proof.converged, false); assert.ok(proof.errors.length > 0);
  }
  const stalled = fixture('total-potential');
  stalled.runtime.converged = true; stalled.runtime.status = 'converged';
  const falseFlag = validateRuntime(stalled.patch, stalled.bc, stalled.runtime, stalled.options);
  assert.equal(falseFlag.valid, false); assert.equal(falseFlag.converged, false);
  for (const i of stalled.bc.freeDofs) {
    stalled.runtime.gradient[Math.floor(i / 2)][i % 2] = stalled.bc.forces[Math.floor(i / 2)][i % 2];
    stalled.runtime.residual[i] = 0;
  }
  stalled.runtime.residualInfinity = 0; stalled.runtime.relativeFreeResidual = 0;
  const disguised = validateRuntime(stalled.patch, stalled.bc, stalled.runtime, stalled.options);
  assert.equal(disguised.valid, false); assert.equal(disguised.converged, false);
  assert.ok(disguised.errors.some(error => error.includes('actual selected-law gradient')));
  console.log(`plane-stress-validation-negative: ${mutations.length + 2} actual-field/policy mutations refused, including coordinated false gradient/convergence and free residual disguised as support`);
});
