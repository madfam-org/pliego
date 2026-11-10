import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld, observeModalWorld, runModalContext } from '../bench/membrane-modal-runtime.mjs';
import { attachModalSolveObserver } from '../bench/membrane-modal-solve-observer.mjs';
import { validateObservation } from '../bench/membrane-modal-validation.mjs';
import { runModalAudit } from '../bench/membrane-modal-audit.mjs';

const SEARCH = 'membrane-inertia-increment', DD = 'double-double';
const identity = { name: DD, version: 1, productExponentLimit: 450, derivative: 'coherent-difference', displacement: 'two-diff' };
const bench = fileURLToPath(new URL('../bench/', import.meta.url));
function fixture(membraneArithmetic, lineSearchArithmetic = SEARCH) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 45, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  return createModalWorld(patch, { phi: patch.vertices.map(([u]) => [(u - 20) / 20, 0]), omega: 1e5,
    amplitude: .004, substeps: 41667, newtonIterations: 4,
    ...(lineSearchArithmetic === undefined ? {} : { lineSearchArithmetic }), ...(membraneArithmetic === undefined ? {} : { membraneArithmetic }) });
}
function parity(a, b) {
  for (const key of ['x', 'xs', 'xt', 'v', 'g', 'thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK', 'factorDir']) {
    assert.deepEqual(Buffer.from(a[key].buffer, a[key].byteOffset, a[key].byteLength), Buffer.from(b[key].buffer, b[key].byteOffset, b[key].byteLength), key);
  }
  assert.deepEqual(a.snapshot(), b.snapshot()); assert.deepEqual(a.stats(), b.stats());
  assert.deepEqual(a.orthotropicMembrane.work, b.orthotropicMembrane.work); assert.deepEqual(a._pcg, b._pcg);
}

test('omitted and explicit binary64 preserve actual World/selected-law/snapshot/stat/observer shapes', () => {
  for (const search of ['total-energy', SEARCH]) {
    const a = fixture(undefined, search), b = fixture('binary64', search);
    assert.equal(Object.hasOwn(a.options, 'membraneArithmetic'), false); assert.equal(b.options.membraneArithmetic, 'binary64');
    assert.equal(Object.hasOwn(a.world.opts, 'membraneArithmetic'), false); assert.equal(Object.hasOwn(b.world.opts, 'membraneArithmetic'), false);
    assert.equal(Object.hasOwn(a.world.orthotropicMembrane.configuration, 'arithmetic'), false);
    const oa = attachModalSolveObserver(a), ob = attachModalSolveObserver(b);
    for (let i = 0; i < 3; i++) {
      assert.deepEqual(observeModalWorld(a, { step: i, initial: i === 0 }), observeModalWorld(b, { step: i, initial: i === 0 }));
      a.world.step(a.world.dt); b.world.step(b.world.dt); parity(a.world, b.world);
    }
    assert.deepEqual(oa.records, ob.records); assert.ok(oa.records.every(r => !Object.hasOwn(r, 'membraneArithmetic')));
    oa.detach(); ob.detach();
  }
  assert.throws(() => fixture('unknown'), /unsupported membrane arithmetic/);
  assert.throws(() => fixture(DD, 'total-energy'), /requires explicit membrane-inertia-increment/);
  console.log('modal-DD-default: omitted/explicit binary64 remain byte-exact for both search policies, including historical shapes');
});

test('DD observer validates actual native steps, unchanged coefficients, flat scratch replay and literal force policy', () => {
  const a = fixture(DD), b = fixture(DD), observer = attachModalSolveObserver(a);
  assert.deepEqual(a.world.orthotropicMembrane.configuration.arithmetic, identity);
  let previous;
  runModalContext(a, { steps: 3, retain: 'all', onObservation: o => {
    const v = validateObservation(a, o, { world: a.world, previous, referenceMass: a.massProof.independentlyLumpedMass });
    assert.equal(v.valid, true, v.errors.join('; ')); if (!o.initial) assert.equal(v.converged, o.literalForceGate);
    assert.equal(o.solver.membraneArithmetic, DD); assert.deepEqual(o.solver.membraneArithmeticIdentity, identity);
    assert.equal(o.forceTolerance, Math.max(1e-7, 1e-10 * a.forceScale)); previous = o;
  } });
  runModalContext(b, { steps: 3, retain: 'initial-final' }); parity(a.world, b.world);
  assert.equal(observer.records.length, 12); assert.equal(observer.counts.missing, 0);
  for (const record of observer.records) { assert.equal(record.valid, true, record.missing.join('; ')); assert.equal(record.membraneArithmetic, DD); assert.deepEqual(record.membraneArithmeticIdentity, identity); }
  observer.detach();
  const baseline = fixture(), snap = a.world.snapshot(), before = baseline.world.snapshot();
  assert.throws(() => baseline.world.restore(snap), /snapshot.*mismatch/); assert.deepEqual(baseline.world.snapshot(), before);
  const saved = a.world.snapshot(); assert.throws(() => a.world.restore(before), /snapshot.*mismatch/); assert.deepEqual(a.world.snapshot(), saved);
  console.log('modal-DD-live: 12 real Newton observations; exact observer/plain replay, coefficient parity, snapshot identity and unchanged independent force rule');
});

test('observer refuses DD option/operator identity drift before observing physics', () => {
  const c = fixture(DD); c.world.opts.membraneArithmetic = 'binary64';
  assert.throws(() => attachModalSolveObserver(c), /membrane arithmetic identity/);
  c.world.opts.membraneArithmetic = DD;
  const selected = Object.create(c.world.orthotropicMembrane);
  selected.configuration = { ...selected.configuration, arithmetic: { ...identity, derivative: 'rounded-node0' } };
  c.world.orthotropicMembrane = selected;
  assert.throws(() => attachModalSolveObserver(c), /membrane arithmetic identity/);
  console.log('modal-DD-identity: mismatched actual option and derivative identity refused, no new solve');
});

function report(arithmetic) {
  // Metadata/control-projection tests only; these mocks do not certify physics.
  const opts = { lineSearchArithmetic: SEARCH, ...(arithmetic ? { membraneArithmetic: arithmetic } : {}) };
  const o = { step: 0, initial: true, h: 1 / 60, time: 0, x: [0, 0, -0], xs: [0, 0, 0], xt: [0, 0, 0], v: [0, 0, 0], rawSHA256: { x: 'same' },
    displacement: [[0, 0]], velocityUV: [[0, 0]], forceScale: 1, forceTolerance: 1e-7, absoluteForceTolerance: 1e-7, relativeForceTolerance: 1e-10,
    modalMass: 1, initialLinearModalEnergyScale: 1, asleep: false, framesRun: 0, substepsRun: 0, execution: null, targetValid: false, planarExact: true,
    elasticEnergy: arithmetic === DD ? 1e-24 : 0, elasticGradient: [arithmetic === DD ? 1e-7 : 0, 0, 0], metric: { finite: true, ...(arithmetic === DD ? { arithmetic: DD, arithmeticVersion: 1 } : {}) }, rawImplicitEnergy: 0,
    solver: { lineSearchArithmetic: SEARCH, newtonIterations: 1, substeps: 1, previousPoseStart: false, pcgMaxIterations: 12, pcgRelativeTolerance: 1e-3,
      ...(arithmetic === DD ? { membraneArithmetic: DD, membraneArithmeticIdentity: identity } : {}) } };
  const t = { lineSearchArithmetic: SEARCH, ...(arithmetic ? { membraneArithmetic: arithmetic } : {}), level: 1, budget: 1, seed: false, amplitude: .004, substeps: 1, steps: 1, h: 1 / 60, z: .08,
    fixedForceScale: 1, forceTolerance: 1e-7, modalMass: 1, oracleModalMass: 1, modalMassRelativeDifference: 0, oracleModalMassRelativeDifference: 0,
    initialReference: { independent: true }, scales: { modalMass: 1 }, options: opts,
    runtime: { schema: 'runtime', parameters: opts, options: opts, h: 1 / 60, requestedSteps: 1, completedSteps: 1, requestedHorizon: 1 / 60,
      retentionPolicy: 'explicit', massProof: { native: [1] }, fixedInitialForceScale: 1, forceTolerance: 1e-7, modalMass: 1, maximumModeNorm: 1, sleepPolicy: { override: 'none' }, scope: 'actual World' },
    snapshots: { initial: { observation: o, validation: { valid: true }, stateFloat64LE: { x: 'same' } } },
    trace: [{ step: 0, forceTolerance: 1e-7 }, { step: 1, residualInfinity: 2e-7, forceTolerance: 1e-7, literalForceGate: false, validation: { valid: true, converged: false } }],
    failedSteps: 1, firstFailedStep: 1, solveObservation: { enabled: true }, gates: { literalForceEverySubstep: false, timeAccuracyAcceptance: false }, classification: 'force-failure', maxima: { state: .01 } };
  return { schema: 'pliego-membrane-modal-audit/0.1', source: { dirty: false, git: 'a'.repeat(40) }, runtime: { node: 'same' },
    protocol: { lineSearchArithmetic: SEARCH, instrument: true, limits: { force: 1e-10 }, ...(arithmetic ? { membraneArithmetic: arithmetic } : {}) },
    oracleSelfTest: { result: { passed: true } }, referenceCapture: { hash: 'same' },
    gates: { sourceClean: true, oracleValid: true, completeDeclaredMatrix: true, literalForceEverySubstep: false, actualTimeAccuracyAcceptance: false },
    results: [{ geometry: { cells: 2 }, vertices: [[0, 0]], triangles: [[0, 0, 0]], material: { E1: 1 }, mesh: { native: true }, fixtureSHA256: 'same', meshSHA256: 'same',
      referenceCoefficients: { Q: [1] }, reference: { omega: 1 }, scalarResponseProof: { pass: true }, plan: { h: 1 / 60 }, trajectories: [t] }] };
}

test('named membrane comparator binds initial physical state and fixed search while retaining changed evaluations and failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pliego-DD-comparison-'));
  try {
    const a = join(dir, 'a.json'), b = join(dir, 'b.json'); const baseline = report(), dd = report(DD);
    writeFileSync(a, JSON.stringify(baseline)); writeFileSync(b, JSON.stringify(dd));
    const run = flags => spawnSync(process.execPath, [join(bench, 'compare-membrane-modal-audit.mjs'), a, b, ...flags], { encoding: 'utf8' });
    const pass = run(['--membrane-arithmetic-comparison']); assert.equal(pass.status, 0, pass.stderr);
    const proof = JSON.parse(pass.stdout); assert.equal(proof.mode, 'membrane-arithmetic'); assert.equal(proof.commonInputsExactlyEqual, true);
    assert.notEqual(proof.outcomes[0][0].initialEvaluation.elasticEnergy, proof.outcomes[1][0].initialEvaluation.elasticEnergy);
    assert.equal(proof.outcomes[1][0].failedSteps, 1); assert.equal(Object.hasOwn(proof, 'allRequiredFieldsExactlyEqual'), false);
    const mutations = [r => { r.protocol.lineSearchArithmetic = 'total-energy'; }, r => { r.source.git = 'b'.repeat(40); },
      r => { r.results[0].trajectories[0].snapshots.initial.observation.x[0] = 1; }, r => { r.results[0].trajectories[0].snapshots.initial.stateFloat64LE.x = 'changed'; },
      r => { r.results[0].trajectories[0].runtime.massProof.native[0] = 2; }, r => { r.results[0].referenceCoefficients.Q[0] = 2; },
      r => { r.results[0].trajectories[0].snapshots.initial.observation.solver.membraneArithmeticIdentity.version++; },
      r => { r.results[0].trajectories[0].forceTolerance = 1; }, r => { r.results[0].trajectories[0].trace[1].literalForceGate = true; },
      r => { r.results[0].trajectories[0].trace[1].step = 2; }, r => { delete r.results[0].trajectories[0].options.membraneArithmetic; }];
    for (const mutation of mutations) { const bad = structuredClone(dd); mutation(bad); writeFileSync(b, JSON.stringify(bad)); assert.notEqual(run(['--membrane-arithmetic-comparison']).status, 0, mutation.toString()); }
    writeFileSync(b, JSON.stringify(dd)); assert.notEqual(run([]).status, 0, 'whole-report replay cannot waive changed evaluations');
    assert.notEqual(run(['--arithmetic-comparison', '--membrane-arithmetic-comparison']).status, 0);
    console.log('modal-DD-comparison: same physical initial bytes/native mass/coefficients/fixed search/gates bound; changed initial evaluations separately retained; eleven mutations refused');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('CLI/programmatic malformed membrane policies reject before any oracle or simulation', () => {
  for (const value of [[], ['unknown']]) {
    const r = spawnSync(process.execPath, [join(bench, 'membrane-modal-audit.mjs'), '--membrane-arithmetic', ...value], { encoding: 'utf8' });
    assert.notEqual(r.status, 0); assert.match(r.stderr, /needs a supported value/);
  }
  assert.throws(() => runModalAudit({ membraneArithmetic: 'unknown' }), /unknown membrane arithmetic/);
  assert.throws(() => runModalAudit({ membraneArithmetic: DD }), /requires explicit membrane-inertia-increment/);
  console.log('modal-DD-cli: unsupported/missing policy and unsupported search combination rejected before observing physics');
});
