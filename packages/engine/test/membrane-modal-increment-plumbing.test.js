import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld, observeModalWorld, runModalContext } from '../bench/membrane-modal-runtime.mjs';
import { attachModalSolveObserver } from '../bench/membrane-modal-solve-observer.mjs';
import { validateObservation } from '../bench/membrane-modal-validation.mjs';
import { runModalAudit } from '../bench/membrane-modal-audit.mjs';

const mode = 'membrane-inertia-increment', bench = fileURLToPath(new URL('../bench/', import.meta.url));
function fixture(arithmetic, amplitude = .004, newtonIterations = 4) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  return createModalWorld(patch, { phi: patch.vertices.map(([u]) => [(u - 20) / 20, 0]), omega: 1e5, amplitude,
    substeps: 41667, newtonIterations, ...(arithmetic === undefined ? {} : { lineSearchArithmetic: arithmetic }) });
}
function parity(a, b) {
  for (const key of ['x', 'xs', 'xt', 'v', 'g', 'thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK', 'factorDir']) {
    assert.deepEqual(Buffer.from(a[key].buffer, a[key].byteOffset, a[key].byteLength), Buffer.from(b[key].buffer, b[key].byteOffset, b[key].byteLength), key);
  }
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.stats(), b.stats());
  assert.deepEqual(a.orthotropicMembrane.work, b.orthotropicMembrane.work); assert.deepEqual(a._pcg, b._pcg);
}
function verifyTrial(t) {
  for (const [key, value] of Object.entries({ before: t.before, after: t.after, xt: t.xt, mass: t.mass, h: [t.h], gradient: t.gradient })) {
    const bytes = Buffer.from(t.stateFloat64LE[key], 'base64');
    assert.equal(bytes.length, 8 * value.length); assert.equal(createHash('sha256').update(bytes).digest('hex'), t.stateSHA256[key]);
    for (let i = 0; i < value.length; i++) assert.ok(Object.is(bytes.readDoubleLE(8 * i), value[i]), key + ' exact f64');
  }
}

test('omitted and explicit total-energy retain old World, observation and search shapes exactly', () => {
  const a = fixture(), b = fixture('total-energy');
  assert.equal(Object.hasOwn(a.options, 'lineSearchArithmetic'), false);
  assert.equal(b.options.lineSearchArithmetic, 'total-energy');
  assert.equal(Object.hasOwn(a.world.opts, 'lineSearchArithmetic'), false);
  assert.equal(Object.hasOwn(b.world.opts, 'lineSearchArithmetic'), false);
  const oa = attachModalSolveObserver(a), ob = attachModalSolveObserver(b);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(observeModalWorld(a, { step: i, initial: i === 0 }), observeModalWorld(b, { step: i, initial: i === 0 }));
    a.world.step(a.world.dt); b.world.step(b.world.dt); parity(a.world, b.world);
  }
  assert.deepEqual(oa.records, ob.records); assert.ok(oa.records.every(r => !Object.hasOwn(r, 'increment') && !Object.hasOwn(r, 'incrementTrial')));
  assert.equal(Object.hasOwn(observeModalWorld(a).solver, 'increment'), false);
  oa.detach(); ob.detach();
  assert.throws(() => fixture('unknown'), /unsupported line-search arithmetic/);
  console.log('modal-increment-default: omitted/explicit total-energy x/v/raw observations/search records/snapshots/caches exact; old shapes retained');
});

test('increment observer retains actual trial inputs and decisions while exact World replay and force gates remain independent', () => {
  const observed = fixture(mode, .004, 16), plain = fixture(mode, .004, 16), records = [];
  const observer = attachModalSolveObserver(observed, { onIteration: r => { records.push(r); } });
  let previous;
  const runtime = runModalContext(observed, { steps: 4, retain: 'all', onObservation: o => {
    const proof = validateObservation(observed, o, { world: observed.world, previous, referenceMass: observed.massProof.independentlyLumpedMass });
    assert.equal(proof.valid, true, proof.errors.join('; '));
    if (!o.initial) assert.equal(proof.converged, o.literalForceGate);
    assert.equal(o.forceTolerance, Math.max(1e-7, 1e-10 * observed.forceScale));
    assert.equal(o.solver.lineSearchArithmetic, mode); assert.deepEqual(o.solver.increment, observed.world.energySearch.increment);
    previous = o;
  } });
  runModalContext(plain, { steps: 4, retain: 'initial-final' }); parity(observed.world, plain.world);
  assert.equal(runtime.completedSteps, 4); assert.equal(records.length, 64); assert.equal(observer.counts.missing, 0);
  assert.ok(records.some(r => r.lineSearch.accepted));
  for (const r of records) {
    assert.equal(r.valid, true, r.missing.join('; ')); verifyTrial(r.incrementTrial);
    const last = r.increment.last, t = r.incrementTrial;
    assert.equal(r.lineSearch.rejectedTrialCount, last.trials - Number(['accepted', 'stationary-noop'].includes(last.decision)));
    assert.deepEqual(t.before, r.start); assert.deepEqual(t.gradient, r.gradient); assert.equal(t.runtime.c1, 1e-4);
    assert.deepEqual(t.after, last.trials === 1 ? r.candidate : r.start.map((x, i) => x + last.alpha * (r.candidate[i] - x)));
    if (last.decision === 'accepted') {
      assert.equal(r.lineSearch.accepted, true); assert.equal(r.acceptedAlpha, last.alpha); assert.deepEqual(r.after, t.after);
      assert.ok(last.slope < 0 && last.delta <= last.armijoRhs, 'strict actual Armijo, no heuristic allowance');
    } else {
      assert.equal(r.lineSearch.accepted, false);
      if (last.decision === 'stationary-noop') assert.equal(r.acceptedAlpha, null);
      else assert.equal(r.acceptedAlpha, 0);
    }
  }
  observer.detach();
  console.log('modal-increment-live: 64 actual Newton records with lossless last-trial inputs, copied decisions, transparent replay and unchanged independent endpoint-force gates');
});

test('true stationary increment no-op is an evaluated zero trial, never alpha1 accepted descent', () => {
  const c = fixture(mode, 0), observer = attachModalSolveObserver(c);
  c.world.step(c.world.dt);
  assert.equal(observer.counts.missing, 0); assert.equal(observer.records.length, 4);
  assert.equal(c.world.energySearch.increment.accepted, 0); assert.equal(c.world.energySearch.increment.stationaryNoops, 4);
  for (const r of observer.records) {
    assert.equal(r.lineSearch.decision, 'stationary-noop'); assert.equal(r.lineSearch.stationaryNoop, true);
    assert.equal(r.lineSearch.accepted, false); assert.equal(r.lineSearch.rejected, false); assert.equal(r.acceptedAlpha, null);
    assert.equal(r.increment.last.trials, 1); assert.equal(r.increment.last.alpha, 1);
    assert.deepEqual(r.after, r.start); assert.deepEqual(r.incrementTrial.after, r.start); verifyTrial(r.incrementTrial);
  }
  observer.detach();
  console.log('modal-increment-noop: four true zero-gradient/zero-step evaluated trials distinctly stationary, zero accepted updates');
});

test('increment observer rejects corrupted alpha/trial and accepted-backtrack diagnostics', () => {
  for (const corruption of ['alpha', 'backtracks']) {
    const c = fixture(mode, .004, 1), search = c.world.energySearch, plain = fixture(mode, .004, 1);
    let last = null;
    // Explicit diagnostic corruption control. The native gradient/direction/search
    // execute normally; only reported last-alpha or the counter is falsified.
    Object.defineProperty(search.increment, 'last', { enumerable: true, configurable: true,
      get() { return corruption === 'alpha' && last ? { ...last, alpha: last.alpha / 2 } : last; },
      set(value) { last = value; if (corruption === 'backtracks' && value?.decision === 'accepted') search.backtracks++; } });
    const observer = attachModalSolveObserver(c);
    c.world.step(c.world.dt); plain.world.step(plain.world.dt);
    assert.deepEqual(c.world.x, plain.world.x); assert.deepEqual(c.world.v, plain.world.v);
    assert.equal(observer.records.length, 1); assert.equal(observer.records[0].valid, false);
    assert.match(observer.records[0].missing.join('; '), /accepted increment backtrack\/alpha mismatch|alpha\/trial count mismatch/);
    observer.detach();
  }
  console.log('modal-increment-decision-mutations: false alpha/trial and accepted-backtrack metadata refused without changing actual x/v');
});

function mockReport(arithmetic) {
  // Metadata/exclusion fixtures only, never numerical-accuracy evidence.
  const initial = { observation: { initial: true, x: [0, 0, -0], solver: {} }, validation: { valid: true }, metrics: { state: 0 }, stateFloat64LE: { x: 'exact' } };
  if (arithmetic === mode) Object.assign(initial.observation.solver, { lineSearchArithmetic: mode, increment: { accepted: 0 } });
  const opts = { substeps: 1, newtonIterations: 1, ...(arithmetic ? { lineSearchArithmetic: arithmetic } : {}) };
  const t = { ...(arithmetic ? { lineSearchArithmetic: arithmetic } : {}), level: 1, budget: 1, seed: false, amplitude: .004, substeps: 1, steps: 1, h: 1 / 60, z: .08,
    fixedForceScale: 1, forceTolerance: 1e-7, modalMass: 1, oracleModalMass: 1, modalMassRelativeDifference: 0, oracleModalMassRelativeDifference: 0,
    initialReference: { basis: 'independent' }, scales: { mass: 1 }, options: opts, snapshots: { initial },
    runtime: { schema: 'runtime', parameters: opts, options: opts, h: 1 / 60, requestedSteps: 1, completedSteps: 1, requestedHorizon: 1 / 60,
      retentionPolicy: 'explicit', massProof: { native: [1] }, fixedInitialForceScale: 1, forceTolerance: 1e-7, modalMass: 1, maximumModeNorm: 1, sleepPolicy: { override: 'none' }, scope: 'actual World' },
    trace: [{ step: 0, forceTolerance: 1e-7 }, { step: 1, residualInfinity: 2e-7, forceTolerance: 1e-7, validation: { valid: true, converged: false }, literalForceGate: false }], failedSteps: 1, firstFailedStep: 1,
    solveObservation: { enabled: true }, gates: { literalForceEverySubstep: false, timeAccuracyAcceptance: false }, classification: 'force-failure', maxima: { state: .01 } };
  return { schema: 'pliego-membrane-modal-audit/0.1', recordedAt: 'first', source: { dirty: false, git: 'a'.repeat(40) }, runtime: { node: 'same' },
    protocol: { instrument: true, limits: { force: 1e-10 }, ...(arithmetic ? { lineSearchArithmetic: arithmetic } : {}) },
    referenceCapture: { sha: 'same' }, oracleSelfTest: { result: { passed: true } },
    gates: { sourceClean: true, oracleValid: true, completeDeclaredMatrix: true, actualTimeAccuracyAcceptance: false },
    results: [{ geometry: { cells: 2 }, vertices: [[0, 0]], triangles: [[0, 0, 0]], material: { E: 1 }, mesh: { native: true },
      fixtureSHA256: 'same', meshSHA256: 'same', referenceCoefficients: { Q: 1 }, reference: { omega: 1 }, scalarResponseProof: { pass: true }, plan: { horizon: 1 / 60 }, trajectories: [t] }] };
}

test('named arithmetic comparator binds exact common inputs while retaining changed force outcomes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pliego-modal-increment-compare-'));
  try {
    const a = join(dir, 'a.json'), b = join(dir, 'b.json'), out = join(dir, 'proof.json');
    const first = mockReport(), second = mockReport(mode), row = second.results[0].trajectories[0];
    row.trace[1].residualInfinity = 0; row.trace[1].validation.converged = true; row.trace[1].literalForceGate = true; row.failedSteps = 0; row.firstFailedStep = null; row.gates.literalForceEverySubstep = true;
    writeFileSync(a, JSON.stringify(first)); writeFileSync(b, JSON.stringify(second));
    const run = () => spawnSync(process.execPath, [join(bench, 'compare-membrane-modal-audit.mjs'), '--arithmetic-comparison', a, b, '--out', out], { encoding: 'utf8' });
    const pass = run(); assert.equal(pass.status, 0, pass.stderr);
    const proof = JSON.parse(readFileSync(out)); assert.equal(proof.commonInputsExactlyEqual, true); assert.equal(Object.hasOwn(proof, 'allRequiredFieldsExactlyEqual'), false);
    assert.equal(statSync(out).mode & 0o777, 0o600);
    assert.equal(proof.outcomes[0][0].failedSteps, 1); assert.equal(proof.outcomes[1][0].failedSteps, 0);
    const changes = [r => { r.source.git = 'b'.repeat(40); }, r => { r.protocol.limits.force = 1e-6; },
      r => { r.results[0].material.E = 2; }, r => { r.results[0].reference.omega = 2; },
      r => { r.results[0].trajectories[0].forceTolerance *= 2; }, r => { r.results[0].trajectories[0].runtime.massProof.native[0] = 2; },
      r => { r.results[0].trajectories[0].budget = 2; }, r => { r.results[0].trajectories[0].snapshots.initial.observation.x[0] = 1; },
      r => { r.results[0].trajectories[0].failedSteps = 1; }, r => { r.gates.actualTimeAccuracyAcceptance = true; },
      r => { delete r.source; }, r => { delete r.results[0].material; }, r => { delete r.results[0].trajectories[0].runtime.massProof; },
      r => { delete r.results[0].trajectories[0].h; }, r => { delete r.results[0].trajectories[0].forceTolerance; },
      r => { delete r.referenceCapture; }, r => { r.results[0].trajectories[0].options.lineSearchArithmetic = 'total-energy'; },
      r => { delete r.results[0].trajectories[0].snapshots.initial.observation.solver.lineSearchArithmetic; },
      r => { r.results[0].trajectories[0].trace[1].residualInfinity = 2e-7; },
      r => { delete r.results[0].trajectories[0].trace[1].residualInfinity; },
      r => { r.results[0].trajectories[0].trace[1].forceTolerance = 1; },
      r => { r.results[0].trajectories[0].runtime.forceTolerance = 1; },
      r => { const t = r.results[0].trajectories[0]; t.forceTolerance = t.runtime.forceTolerance = 1; t.trace.forEach(o => { o.forceTolerance = 1; }); },
      r => { r.results[0].trajectories[0].trace[1].step = 2; },
      r => { r.results[0].trajectories[0].trace.push(structuredClone(r.results[0].trajectories[0].trace[1])); },
      r => { r.results[0].trajectories[0].trace.splice(1, 1); },
      r => { r.results[0].trajectories[0].runtime.completedSteps = 0; },
      r => { r.results[0].trajectories[0].firstFailedStep = 1; }];
    for (const change of changes) { const bad = structuredClone(second); change(bad); writeFileSync(b, JSON.stringify(bad)); assert.notEqual(run().status, 0, change.toString()); }
    assert.throws(() => runModalAudit({ lineSearchArithmetic: 'unknown' }), /unknown line-search arithmetic/);
    writeFileSync(b, JSON.stringify(second)); const exists = run(); assert.notEqual(exists.status, 0); assert.match(exists.stderr, /EEXIST/);
    console.log('modal-increment-comparison: exact common inputs plus numeric residual/tolerance/status/step binding; changed outcomes separately retained; twenty-eight mutations refused');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('audit CLI refuses missing and unknown arithmetic selectors before running physics', () => {
  for (const values of [[], ['unknown']]) {
    const r = spawnSync(process.execPath, [join(bench, 'membrane-modal-audit.mjs'), '--line-search-arithmetic', ...values], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /needs a supported value/);
  }
  console.log('modal-increment-cli: missing/unknown arithmetic protocol rejected without any simulation');
});
