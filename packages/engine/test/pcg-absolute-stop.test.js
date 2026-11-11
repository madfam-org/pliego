import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { assembleAndFactor, gradient } from '../src/xpbd/implicit.js';
import { pcgStep, hessianTimes } from '../src/xpbd/pcg.js';
import * as K from '../src/constants.js';
import { loadStateModalInputs } from '../bench/membrane-state-modal-inputs.mjs';
import { runStateModalTrajectory, STATE_MODAL_PCG_STOPS } from '../bench/membrane-state-modal-audit.mjs';
import { createStateModalWorld, runStateModalContext } from '../bench/membrane-state-modal-runtime.mjs';
import { validateStateObservation } from '../bench/membrane-state-modal-validation.mjs';
import { commonStoppingInputs, curvatureChanges } from '../bench/compare-membrane-state-modal-audit.mjs';

const research = { damping: 0, bendDamping: 0, membraneReference: 'uv-displacement', membraneArithmetic: 'double-double',
  lineSearchArithmetic: 'membrane-inertia-increment', stateCoordinates: 'reference-displacement' };
function patch(extra = {}, scale = .97) {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const w = new World(p.doc, { ...p.options, ...research, substeps: 4000, newtonIterations: 1, ...extra });
  w.setInitialReferencePose(w.x.map((v, i) => i % 3 === 0 ? v * scale : v)); return w;
}
/** Latent Newton gradient (elastic + native inertia) at the solver point, as the Newton loops form it. */
function newtonGradient(w) {
  const g = new Float64Array(w.x.length), idt2 = 1 / (w.dt * w.dt);
  gradient(w, w._u, g, 'reference-displacement');
  for (let i = 0; i < w.mesh.nV; i++) for (let c = 0; c < 3; c++) g[3 * i + c] += w.mass[i] * idt2 * (w._u[3 * i + c] - w._ut[3 * i + c]);
  return g;
}

test('admission: the absolute PCG stop is a positive finite microN option of the reference-displacement domain only', () => {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const { stateCoordinates, ...absolute } = research;
  assert.throws(() => new World(p.doc, { ...p.options, ...absolute, pcgAbsoluteTolerance: 1e-5 }), /admitted only with reference-displacement/);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => patch({ pcgAbsoluteTolerance: bad }), /positive finite/);
  assert.equal(Object.hasOwn(patch().opts, 'pcgAbsoluteTolerance'), false);
  assert.equal(patch({ pcgAbsoluteTolerance: 4e-5 }).opts.pcgAbsoluteTolerance, 4e-5);
  console.log('pcg-stop-admission: absolute/binary64 and nonpositive/nonfinite values refused; omission keeps historical opts');
});

test('a converged absolute stop meets its bound on the applied direction; an unreachable bound writes nothing', () => {
  for (const curvature of ['gauss-newton', 'exact-hessian']) {
    const w = patch({ membraneCurvature: curvature }); w._substep(); // a factor now exists; the next solve uses the stale preconditioner
    const g = newtonGradient(w), tol = 1e-3, x = w._u.slice();
    const r = pcgStep(w, x, g, K.PCG_MAX_ITER, K.PCG_RTOL, null, true, 'reference-displacement', curvature, tol);
    assert.equal(r.converged, true);
    const d = x.map((v, i) => v - w._u[i]), Hd = new Float64Array(d.length);
    hessianTimes(w, w._u, d, Hd, 'reference-displacement', curvature);
    const residual = Math.max(...Hd.map((v, i) => Math.abs(v + g[i])));
    assert.ok(residual <= 1.01 * tol, `${curvature}: ${residual} > ${tol}`);
    const y = w._u.slice(), unreachable = pcgStep(w, y, g, K.PCG_MAX_ITER, K.PCG_RTOL, null, true, 'reference-displacement', curvature, Number.MIN_VALUE);
    assert.equal(unreachable.converged, false); assert.deepEqual(y, w._u, 'an unconverged solve writes no direction');
    if (curvature === 'gauss-newton') assert.deepEqual(Object.keys(r), ['iterations', 'converged']);
    else assert.ok(['stagnation', 'iteration-limit'].includes(unreachable.reason));
  }
  const w = patch(); assembleAndFactor(w, w._u, 'reference-displacement');
  assert.throws(() => pcgStep(w, w._u.slice(), newtonGradient(w), 12, 1e-3, null, true, 'reference-displacement', 'gauss-newton', 0), /positive and finite/);
  console.log('pcg-stop-bound: GN and exact converged directions satisfy the infinity-norm bound under their own operator; unreachable bounds leave the state untouched; GN return shape unchanged');
});

test('capture plumbing: the named stop is bound in options, observations and the stopping comparison', () => {
  assert.deepEqual(Object.keys(STATE_MODAL_PCG_STOPS), ['half-force-tolerance']);
  const inputs = loadStateModalInputs(), p = makePatch({ ...inputs.geometry, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const row = { ...inputs.rows.find(t => t.level === 8 && t.budget === 1 && t.seed === false), steps: 3 };
  const relative = runStateModalTrajectory(p, inputs.reference, row, { membraneCurvature: 'exact-hessian' });
  const absolute = runStateModalTrajectory(p, inputs.reference, row, { membraneCurvature: 'exact-hessian', pcgStop: 'half-force-tolerance' });
  assert.ok(Object.is(absolute.options.pcgAbsoluteTolerance, .5 * row.forceTolerance)); assert.equal(Object.hasOwn(relative.options, 'pcgAbsoluteTolerance'), false);
  for (const t of [relative, absolute]) { assert.ok(t.trace.every(o => o.validation.valid)); assert.equal(t.continuation.pass, true); assert.equal(t.solveObservation.counts.missing, 0); }
  assert.ok(absolute.trace.slice(1).every(o => Object.is(o.solver.pcgAbsoluteTolerance, .5 * row.forceTolerance)));
  const shell = (t, extra) => ({ source: { git: 'unit' }, protocol: { instrument: true, membraneCurvature: 'exact-hessian', ...extra }, results: [{ trajectories: [t] }] });
  const b = shell(relative), c = shell(absolute, { pcgStop: { name: 'half-force-tolerance', ...STATE_MODAL_PCG_STOPS['half-force-tolerance'] } });
  commonStoppingInputs(b, c);
  const changes = curvatureChanges(b, c, { labels: ['relativeStop', 'absoluteStop'] });
  assert.equal(changes.authoritative.gains + changes.authoritative.losses + changes.authoritative.unchanged, row.steps);
  assert.ok(changes.trajectories[0].authoritativeResidual.absoluteStop && changes.baselineCurvatureEvents);
  const wrong = structuredClone(c); wrong.results[0].trajectories[0].options.pcgAbsoluteTolerance *= 2;
  assert.throws(() => commonStoppingInputs(b, wrong), /declared absolute stop value|deepStrictEqual|Expected/);
  const c2 = createStateModalWorld(p, { phi: inputs.reference.mode.phi, omega: inputs.reference.mode.omega, amplitude: row.amplitude, substeps: row.substeps,
    newtonIterations: 1, previousPoseStart: false, membraneCurvature: 'exact-hessian', pcgAbsoluteTolerance: .5 * row.forceTolerance });
  const seen = []; runStateModalContext(c2, { steps: 2, retain: 'initial-final', onObservation: o => seen.push(structuredClone(o)) });
  assert.equal(validateStateObservation(seen.at(-1), { context: c2, previous: seen.at(-2) }).valid, true);
  const forged = structuredClone(seen.at(-1)); forged.solver.pcgAbsoluteTolerance *= 2;
  assert.ok(validateStateObservation(forged, { context: c2, previous: seen.at(-2) }).errors.some(e => /absolute PCG stop/.test(e)));
  console.log(`pcg-stop-capture: half-force-tolerance bound per row; toy latent gains ${changes.authoritative.gains}/${row.steps}; forged reported stop and mismatched candidate value refused`);
});
