import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadBendingStateInputs } from '../bench/bending-state-inputs.mjs';
import { createBendingStateWorld, runBendingStateContext } from '../bench/bending-state-runtime.mjs';
import { encodeStateModalVectors } from '../bench/membrane-state-modal-runtime.mjs';
import { buildBendingStateProbes } from '../bench/bending-state-probes.mjs';
import { addBendingGradient } from '../src/xpbd/reference-bending.js';

const python = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const oracle = fileURLToPath(new URL('../bench/bending-state-precision.py', import.meta.url));
const sha = text => createHash('sha256').update(text).digest('hex');
// Engine bending is binary64 (dihedral on once-rounded latent differences, then k*theta*grad);
// expected error is a few ulps relative (~1e-15). 1e-12 leaves ~1000x margin yet any wrong
// branch, sign, missing hinge or wrong coordinates is O(1) relative.
const BENDING_RELATIVE = 1e-12;
// Residual components: binary64 sums of membrane+bending+inertia forces of size <= F0; allowing
// 1e-12*F0 (~500 ulps of F0) still sits 4 orders below tau, so the truth gate verdict cannot flip.
const RESIDUAL_RELATIVE_TO_FORCE_SCALE = 1e-12;
// The planar represented-energy gate (membrane-state-precision.md), reused for the membrane part.
const MEMBRANE_ENERGY_NJ = 1e-12;
const ROW = { level: 1, budget: 4, seed: false, amplitude: .004, substeps: 72, steps: 3, h: 1 / (60 * 72) };

let memo = null;
/** A small report-like object shaped like bending-state-audit.mjs, from one real short run. */
function capture() {
  if (memo) return memo;
  const inputs = loadBendingStateInputs();
  const context = createBendingStateWorld(inputs, ROW, { membraneCurvature: 'exact-hessian', pcgStop: 'half-force-tolerance' }), w = context.world;
  const engine = new Map();
  const runtime = runBendingStateContext(context, { steps: ROW.steps, retain: 'all', onObservation: o => {
    // Bending-only engine force at the same boundary, read-only (no state is written).
    const pure = (x, coordinates) => { const g = new Float64Array(x.length); return { energy: addBendingGradient(w, x, g, coordinates), gradient: Array.from(g) }; };
    engine.set(o.step, { authoritative: pure(w._u, 'reference-displacement'), public: pure(w.x, 'absolute-position') });
  } });
  assert.equal(runtime.status, 'completed'); assert.equal(runtime.completedSteps, ROW.steps);
  const snapshots = {}, record = o => ({ observation: structuredClone(o), validation: null, metrics: null, publicMetrics: null, metricsError: null });
  for (const o of runtime.observations) snapshots[o.initial ? 'initial' : 'checkpoint-' + o.step] = record(o);
  snapshots.final = record(runtime.final);
  const trajectory = { ...ROW, fixedForceScale: context.forceScale, forceTolerance: context.forceTolerance, referenceCoefficients: structuredClone(context.referenceCoefficients),
    referenceWords: encodeStateModalVectors({ reference: context.referenceWords, hingeK: context.hingeKWords }), runtime: { completedSteps: runtime.completedSteps }, snapshots };
  const report = { schema: 'pliego-bending-state-audit/1', source: { git: 'test-capture', dirty: false, files: [] }, protocol: { trajectories: 1, poststeps: ROW.steps },
    results: [{ geometry: inputs.geometry, vertices: inputs.vertices, triangles: inputs.triangles, material: inputs.material, mesh: inputs.mesh,
      reference: inputs.reference, plan: inputs.plan, trajectories: [trajectory] }] };
  const text = JSON.stringify(report);
  memo = { report: JSON.parse(text), reportSHA256: sha(text), engine, context };
  return memo;
}
function probes() { const c = capture(); return buildBendingStateProbes(structuredClone(c.report), c.reportSHA256); }
function precise(value, digits = 80) {
  const input = JSON.stringify(value);
  const r = JSON.parse(execFileSync(python, ['-I', oracle, '--digits', String(digits)], { input, encoding: 'utf8', maxBuffer: 1 << 26 }));
  assert.equal(r.inputSHA256, sha(input)); assert.deepEqual(r.precisionFields, ['cases[].decimalDigits']); return r;
}
function parity(value) {
  const a = precise(value), b = precise(value, 100);
  a.cases.forEach((p, i) => { assert.equal(p.decimalDigits, 80); assert.equal(b.cases[i].decimalDigits, 100); delete p.decimalDigits; delete b.cases[i].decimalDigits; });
  assert.deepEqual(a, b, '80- and 100-digit outputs differ outside declared precision fields'); return a.cases;
}
function reject(value, pattern) {
  const result = spawnSync(python, ['-I', oracle], { input: JSON.stringify(value), encoding: 'utf8' });
  assert.equal(result.status, 1, result.stderr); assert.equal(result.stdout, ''); assert.match(JSON.parse(result.stderr).error, pattern);
}
const reencode = (c, key, values) => { const b = Buffer.alloc(8 * values.length); values.forEach((x, i) => b.writeDoubleLE(x, 8 * i)); c.stateFloat64LE[key] = b.toString('base64'); c.stateSHA256[key] = sha(b); };
const normwise = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]))) / Math.max(...b.map(Math.abs));

test('bending oracle self-controls are deterministic', () => {
  const a = execFileSync(python, ['-I', oracle, '--self-test'], { encoding: 'utf8' });
  assert.equal(a, execFileSync(python, ['-I', oracle, '--self-test'], { encoding: 'utf8' }));
  assert.equal(JSON.parse(a).passed, true); assert.equal(JSON.parse(a).testCases, 4);
  console.log('bending-oracle-analytic: Machin pi, atan2 quadrants/libm, valley-positive 2atan(t) fold, rational central differences; no World execution');
});

test('exporter selects every completed role once, lists the constructor, and checks the captured descriptor against the bound words', () => {
  const p = probes(), { context, report, reportSHA256 } = capture(), coefficients = JSON.parse(JSON.stringify(context.referenceCoefficients));
  assert.equal(p.schema, 'pliego-bending-state-probes/1'); assert.equal(p.cases.length, ROW.steps);
  assert.deepEqual(p.cases.map(c => c.selection.roles), [['checkpoint-1'], ['checkpoint-2'], ['checkpoint-3', 'final']]);
  assert.deepEqual(p.skipped.map(s => [s.step, s.role]), [[0, 'initial']]);
  assert.deepEqual(p.coverage, { cases: 3, trajectories: 1, declaredTrajectories: 1, declaredRequestedPoststeps: 3, capturedCompletedPoststeps: 3, allPoststepsEvaluated: false, allNewtonArmijoEvaluated: false });
  for (const c of p.cases) {
    assert.deepEqual(c.referenceCoefficients, coefficients);
    assert.equal(c.bending.hinges.length, 8); assert.ok(c.bending.restTheta.every(t => t === 0));
    assert.equal(c.bending.theta.length, 8); assert.ok(c.stateSHA256.theta && c.stateFloat64LE.theta, 'bound continuation words copied');
  }
  const forged = structuredClone(report); forged.results[0].trajectories[0].referenceCoefficients.elements[3].Q[1] *= 1 + 2 ** -50;
  assert.throws(() => buildBendingStateProbes(forged, reportSHA256), /captured descriptor differs from the bound 22-word reference/);
  console.log('bending-probes: 3 completed endpoints (final deduplicated), constructor role listed; captured descriptor equals the bound reference words, a 1-ulp-scale edit refuses');
});

test('latent and public bending, elastic and residual words agree with independent truth; 80/100 parity', () => {
  const p = probes(), { engine, context } = capture(), proofs = parity(p);
  const worst = { authoritative: {}, public: {} }, bump = (o, k, v) => { o[k] = Math.max(o[k] ?? 0, v); };
  proofs.forEach((proof, i) => {
    const step = p.cases[i].selection.step;
    assert.equal(proof.membranePlanar.initialization.exactRealInitialStatePreserved, true); assert.equal(proof.membranePlanar.projection.publicObjectIsVerified, true);
    assert.ok(proof.continuation.branchTurns.authoritative.every(t => t === 0) && proof.continuation.branchTurns.public.every(t => t === 0));
    assert.ok(proof.continuation.minimumBranchMarginRad > 3, 'all |theta| << pi/2 in this capture');
    const thetaScale = Math.max(...proof.continuation.continuationAnglesRad.map(Math.abs));
    assert.ok(proof.continuation.maximumPublicTruthMinusContinuationRad <= BENDING_RELATIVE * thetaScale, 'World theta is the public dihedral');
    for (const label of ['authoritative', 'public']) {
      const t = proof.truth[label], mine = engine.get(step)[label], w = worst[label];
      assert.ok(t.bending.energyError.relative <= BENDING_RELATIVE); assert.ok(t.bending.impliedGradientError.normwiseRelative <= BENDING_RELATIVE);
      assert.ok(t.elastic.energyError.relative <= BENDING_RELATIVE); assert.ok(t.elastic.gradientError.normwiseRelative <= BENDING_RELATIVE);
      assert.ok(t.membrane.impliedObservedEnergyError.absoluteNJ <= MEMBRANE_ENERGY_NJ);
      // Bending-only engine force (not in the captured words) against the oracle's rounded truth.
      assert.equal(mine.energy, label === 'public' ? p.cases[i].runtime.public.bendingEnergy : p.cases[i].runtime.authoritative.bendingEnergy);
      const pure = normwise(mine.gradient, t.bending.gradient); assert.ok(pure <= BENDING_RELATIVE);
      for (const coefficient of ['nativeCoefficient', 'realMass']) assert.ok(t[coefficient].residualError.maximumComponentMicroN <= RESIDUAL_RELATIVE_TO_FORCE_SCALE * context.forceScale);
      assert.equal(t.nativeCoefficient.agreesWithNativeGate, true);
      assert.ok(Math.abs(t.nativeCoefficient.residualInfinityOverTolerance - 1) > 1e-3, 'truth verdict is not marginal');
      bump(w, 'bendingEnergyRelative', t.bending.energyError.relative); bump(w, 'bendingEnergyAbsoluteNJ', t.bending.energyError.absoluteNJ);
      bump(w, 'bendingGradientImpliedNormwise', t.bending.impliedGradientError.normwiseRelative); bump(w, 'bendingGradientImpliedAbsoluteMicroN', t.bending.impliedGradientError.maximumComponentMicroN);
      bump(w, 'bendingGradientPureNormwise', pure); bump(w, 'elasticGradientNormwise', t.elastic.gradientError.normwiseRelative);
      bump(w, 'residualAbsoluteMicroN', t.nativeCoefficient.residualError.maximumComponentMicroN); bump(w, 'truthResidualOverTau', t.nativeCoefficient.residualInfinityOverTolerance);
    }
    assert.equal(proof.truth.authoritative.native.converged, true); assert.equal(proof.truth.authoritative.nativeCoefficient.passesUnchangedForceTolerance, true);
  });
  console.log('bending-oracle-agreement: ' + JSON.stringify(worst));
});

test('the oracle follows the continuation branch and refuses corrupted bending words visibly', () => {
  const p = probes(), base = p.cases[0];
  const shifted = structuredClone(base); shifted.bending.theta[2] += 2 * Math.PI; reencode(shifted, 'theta', shifted.bending.theta);
  const moved = precise(shifted).cases[0];
  assert.equal(moved.continuation.branchTurns.authoritative[2], -1); assert.ok(moved.truth.authoritative.bending.energyError.absoluteNJ > 1e3 * moved.truth.authoritative.bending.observedEnergyNJ,
    'captured words were formed on the captured branch, so a forged branch must show as an O(1) disagreement');
  const forged = structuredClone(base); forged.bending.hingeK[0] *= 2; reject(forged, /state words differ/);
  const bent = structuredClone(base); bent.bending.restTheta[0] = .1; reencode(bent, 'restTheta', bent.bending.restTheta); reject(bent, /flat rest angles/);
  const identity = structuredClone(base); identity.state.bending = { ...identity.state.bending, version: 3 }; reject(identity, /panel-bending identity/);
  const hinge = structuredClone(base); hinge.bending.hinges[0] = [1, 1, 0, 5]; reject(hinge, /quadruples/);
  const lost = structuredClone(base); lost.bending.theta[0] += 1e-9; reject(lost, /state words differ/);
  console.log('bending-oracle-refusal: forged continuation branch shows as O(1) error; hingeK/restTheta/identity/hinge/continuation corruption refuses');
});
