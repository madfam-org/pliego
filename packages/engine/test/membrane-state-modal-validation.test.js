import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createStateModalWorld, observeStateModalWorld, runStateModalContext } from '../bench/membrane-state-modal-runtime.mjs';
import { validateStateObservation } from '../bench/membrane-state-modal-validation.mjs';

function fixture(previousPoseStart = false, newtonIterations = 1) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const phi = patch.vertices.map((_v, i) => [Math.sin(i + .2), Math.cos(i + .2)]);
  const context = createStateModalWorld(patch, { phi, omega: 1e5, amplitude: .004, substeps: 41667, newtonIterations, previousPoseStart });
  return { patch, context };
}
const validate = (context, o, previous = null, world = context.world) => validateStateObservation(o, { context, previous, world });
const scratch = w => ({ snapshot: w.snapshot(), work: structuredClone(w.orthotropicMembrane.work), block: w.orthotropicMembrane.block.slice(),
  thetaPred: w.thetaPred.slice(), hingeGrad: w.hingeGrad.slice(), edgeDir: w.edgeDir.slice(), edgeComp: w.edgeComp.slice(), edgeK: w.edgeK.slice(), g: w.g.slice() });
const sha = b => createHash('sha256').update(b).digest('hex');

function boundForce(o, key, values) {
  const raw = Buffer.alloc(8 * values.length); values.forEach((v, i) => raw.writeDoubleLE(v, 8 * i));
  o.forceFloat64LE[key] = raw.toString('base64'); o.forceSHA256[key] = sha(raw);
}

function bound(o, key, values) {
  const raw = Buffer.alloc(8 * values.length); values.forEach((v, i) => raw.writeDoubleLE(v, 8 * i));
  o.stateFloat64LE[key] = raw.toString('base64'); o.stateSHA256[key] = sha(raw);
  if (['x', 'xs', 'xt', 'v'].includes(key)) o.rawSHA256[key] = o.stateSHA256[key];
  if (Object.hasOwn(o.authoritative.rawSHA256, key)) o.authoritative.rawSHA256[key] = o.stateSHA256[key];
}

test('state validator independently checks multiple actual public steps for both start policies without changing caches', () => {
  let failedPublic = 0, diagnosticDifferences = 0, checked = 0;
  for (const start of [false, true]) {
    const { context } = fixture(start); let previous = null;
    const runtime = runStateModalContext(context, { steps: 3, onStep(o) {
      const before = scratch(context.world), proof = validate(context, o, previous);
      assert.equal(proof.valid, true, proof.errors.join('\n')); assert.equal(proof.actualGradientChecked, true);
      assert.equal(proof.losslessBindingsVerified, true); assert.equal(proof.forceBindingsVerified, true); assert.deepEqual(scratch(context.world), before);
      if (o.initial) {
        assert.equal(proof.boundaryCertified, false); assert.equal(proof.computedPublicConverged, null);
        assert.equal(proof.computedAuthoritativeConverged, null); assert.equal(proof.converged, false);
      } else {
        assert.equal(proof.boundaryCertified, true); assert.equal(proof.publicConverged, o.literalForceGate);
        assert.equal(proof.authoritativeConverged, o.authoritative.converged);
        if (!proof.publicConverged) failedPublic++;
        if (!o.execution.velocityMatchesActualDifference || !o.execution.xtMatchesActualPredictor) diagnosticDifferences++;
      }
      checked++; previous = o;
    } });
    assert.equal(runtime.completedSteps, 3); assert.equal(runtime.status, 'completed');
  }
  assert.ok(failedPublic > 0); assert.ok(diagnosticDifferences > 0);
  console.log(`state-modal-validation-positive: ${checked} initial/actual boundaries, both starts; live force/authority equations and scratch transparency; old public-difference diagnostics may legitimately fail`);
});

test('coordinated native-state, predictor, velocity, gate, binding and physics forgeries are refused', () => {
  const { context } = fixture(); let previous = null, final;
  runStateModalContext(context, { steps: 1, onStep(o) { if (o.initial) previous = o; else final = o; } });
  assert.equal(validate(context, final, previous).valid, true);
  const mutations = [
    o => { o.schema = 'legacy'; }, o => { o.solver.stateIdentity.version++; }, o => { o.solver.membraneArithmeticIdentity.version++; },
    o => { o.targetValid = false; }, o => { o.authoritative.targetValid = false; }, o => { o.authoritative.identity.version++; },
    o => { o.authoritative.u[0] += 1e-9; }, o => { o.authoritative.us[0] += 1e-9; }, o => { o.authoritative.ut[0] += 1e-9; },
    o => { o.authoritative.v[0] += 1; }, o => { o.authoritative.x0[0] += 1e-9; },
    o => { o.authoritative.initialX[0] += 1e-9; }, o => { o.authoritative.initialU[0] += 1e-9; }, o => { o.authoritative.initialV[0] = 1; },
    o => { o.x[0] += 1e-9; }, o => { o.xs[0] += 1e-9; }, o => { o.xt[0] += 1e-9; }, o => { o.v[0] += 1; },
    o => { o.h *= 2; }, o => { o.forceScale *= 2; }, o => { o.forceTolerance *= 2; }, o => { o.absoluteForceTolerance = 1; },
    o => { o.relativeForceTolerance = 1e-6; }, o => { o.time += o.h; }, o => { o.framesRun++; }, o => { o.substepsRun++; },
    o => { o.execution.returnedSubsteps = 2; }, o => { o.execution.usMatchesPreviousU = false; },
    o => { o.execution.utMatchesActualDisplacementPredictor = false; }, o => { o.execution.velocityMatchesActualDisplacementDifference = false; },
    o => { o.execution.xProjectionMatchesAuthority = false; }, o => { o.execution.xsProjectionMatchesAuthority = false; }, o => { o.execution.xtProjectionMatchesAuthority = false; },
    o => { o.execution.exception = { name: 'Error', message: 'reported incomplete step' }; },
    o => { o.authoritative.converged = !o.authoritative.converged; }, o => { o.literalForceGate = !o.literalForceGate; },
    o => { o.authoritative.elasticGradient[0] += 1; }, o => { o.elasticGradient[0] += 1; },
    o => { o.authoritative.inertiaGradient[0] += 1; }, o => { o.authoritative.residual[0] += 1; }, o => { o.residual[0] += 1; },
    o => { o.authoritative.residualInfinity = 0; }, o => { o.authoritative.elasticEnergy += 1; },
    o => { o.authoritative.inertiaEnergy += 1; }, o => { o.authoritative.incrementalEnergy += 1; },
    o => { o.rawImplicitEnergy += 1; }, o => { o.rawInertiaEnergy += 1; }, o => { o.authoritative.rawImplicitEnergy += 1; }, o => { o.authoritative.rawInertiaEnergy += 1; }, o => { o.normalizedResidual += 1; }, o => { o.authoritative.metric = null; }, o => { o.metric.minimumStretch *= 2; },
    o => { o.authoritative.kineticEnergy += 1; }, o => { o.authoritative.mechanicalEnergy += 1; },
    o => { o.authoritative.displacement[0][0] += 1; }, o => { o.authoritative.velocityUV[0][0] += 1; },
    o => { o.authoritative.modalCoordinate += 1; }, o => { o.authoritative.modalLeakageMassNorm += 1; },
    o => { o.authoritative.nonMembraneGradientMaximum = 1e-30; }, o => { o.authoritative.planarExact = false; },
    o => { o.solver.newtonIterations++; }, o => { o.solver.pcgRelativeTolerance = .1; },
    o => { o.forceSHA256.publicResidual = '0'.repeat(64); }, o => { delete o.forceFloat64LE.authoritativeResidual; },
    o => { o.stateSHA256.u = '0'.repeat(64); }, o => { delete o.stateFloat64LE.reference; },
    o => { o.stateFloat64LE.extra = ''; o.stateSHA256.extra = sha(Buffer.alloc(0)); },
  ];
  for (const mutate of mutations) {
    const fake = structuredClone(final); mutate(fake); const proof = validate(context, fake, previous);
    assert.equal(proof.valid, false, mutate.toString()); assert.equal(proof.converged, false); assert.equal(proof.authoritativeConverged, false);
  }
  const forged = structuredClone(final); forged.authoritative.u[0] += 1e-9; bound(forged, 'u', forged.authoritative.u);
  assert.equal(validate(context, forged, previous).valid, false, 'coordinated raw hash cannot hide wrong actual World or projection');
  const gradientForgery = structuredClone(final);
  gradientForgery.elasticGradient = gradientForgery.inertiaGradient.map(v => -v); gradientForgery.residual.fill(0); gradientForgery.residualInfinity = 0; gradientForgery.literalForceGate = true;
  boundForce(gradientForgery, 'publicElasticGradient', gradientForgery.elasticGradient); boundForce(gradientForgery, 'publicResidual', gradientForgery.residual);
  context.world.g.set(gradientForgery.elasticGradient);
  const proof = validate(context, gradientForgery, previous); assert.equal(proof.valid, false); assert.ok(proof.errors.some(e => e.includes('actual selected/full gradient')));
  console.log(`state-modal-validation-negative: ${mutations.length + 2} wrong ABI/force/boundary/raw/metadata cases refused; coordinated World.g and self-hashes do not certify physics`);
});

test('invalid target receipts never certify a solve and offline algebra is not a live physics certificate', () => {
  const { context } = fixture(), initial = observeStateModalWorld(context); assert.equal(validate(context, initial).valid, true);
  const fake = structuredClone(initial); fake.authoritative.converged = fake.literalForceGate = true;
  assert.equal(validate(context, fake).valid, false);
  let previous = null, final;
  runStateModalContext(context, { steps: 1, onStep(o) { if (o.initial) previous = o; else final = o; } });
  const serialized = JSON.parse(JSON.stringify(final));
  const jsonContext = { ...context, referenceWords: JSON.parse(JSON.stringify(context.referenceWords)) };
  assert.equal(validate(jsonContext, serialized, previous).valid, true, 'lossless LE must survive JSON signed-zero loss in numeric reference views');
  const offline = validate(context, final, previous, null); assert.equal(offline.valid, true, offline.errors.join('\n'));
  assert.equal(offline.actualGradientChecked, false); assert.equal(offline.authoritativeConverged, false); assert.equal(offline.publicConverged, false);
  const receiptless = observeStateModalWorld(context, { step: 1, initial: false });
  assert.equal(receiptless.targetValid, false); assert.equal(receiptless.literalForceGate, null); assert.equal(receiptless.authoritative.converged, null);
  const p = validate(context, receiptless, previous); assert.equal(p.valid, false); assert.equal(p.boundaryCertified, false);
  console.log('state-modal-validation-certification: initial/receiptless targets null, forged gates refused, offline checks remain algebra-only');
});

test('initial conversion refusal and signed-zero raw words remain explicit', () => {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const phi = patch.vertices.map(([u]) => [(u - 20) / 20, 0]);
  assert.throws(() => createStateModalWorld(patch, { phi, omega: 1e5, amplitude: .004, substeps: 41667, newtonIterations: 1 }), /projection changes public bytes/);
  const { context } = fixture(), initial = observeStateModalWorld(context);
  assert.equal(validate(context, initial).valid, true);
  const fake = structuredClone(initial), raw = Buffer.from(fake.stateFloat64LE.x0, 'base64');
  const i = fake.authoritative.x0.findIndex(v => Object.is(v, +0)); assert.ok(i >= 0);
  raw.writeDoubleLE(-0, 8 * i); fake.stateFloat64LE.x0 = raw.toString('base64'); fake.stateSHA256.x0 = sha(raw); fake.authoritative.rawSHA256.x0 = sha(raw);
  const proof = validate(context, fake); assert.equal(proof.valid, false); assert.ok(proof.errors.some(e => e.includes('initial immutable binding changed: x0')));
  console.log('state-modal-validation-initial: unrepresentable signed-zero old initialization refused; coordinated source-word sign drift remains visible');
});


test('independent masses, original context inputs, predecessor and hidden live work remain mandatory', () => {
  const { context } = fixture(); let previous = null, final;
  runStateModalContext(context, { steps: 1, onStep(o) { if (o.initial) previous = o; else final = o; } });
  assert.equal(validate(context, final, previous).valid, true);
  assert.equal(validate(context, final, null).valid, false);
  const badPrevious = structuredClone(previous); badPrevious.authoritative.u[0] += 1e-8; bound(badPrevious, 'u', badPrevious.authoritative.u);
  assert.equal(validate(context, final, badPrevious).valid, false);
  const wrongMass = { ...context, referenceMass: context.masses.map(m => m * 1.001) };
  assert.equal(validate(wrongMass, final, previous).valid, false);
  const wrongOptions = { ...context, options: { ...context.options, damping: .1 } };
  assert.equal(validate(wrongOptions, final, previous).valid, false);
  const changedInitial = { ...context, initialBinding: structuredClone(context.initialBinding) };
  changedInitial.initialBinding.stateSHA256.initialX = '0'.repeat(64);
  assert.equal(validate(changedInitial, final, previous).valid, false);
  context.world.userForce[0] = 1;
  const work = structuredClone(context.world.orthotropicMembrane.work), block = context.world.orthotropicMembrane.block.slice();
  const force = context.world.userForce.slice(), proof = validate(context, final, previous);
  assert.equal(proof.valid, false); assert.equal(proof.actualGradientChecked, false);
  assert.deepEqual(context.world.userForce, force); assert.deepEqual(context.world.orthotropicMembrane.work, work); assert.deepEqual(context.world.orthotropicMembrane.block, block);
  assert.ok(proof.errors.some(e => e.includes('external forces')));
  console.log('state-modal-validation-domain: independent area/oracle masses, initial bindings, predecessor and zero-work domain checked; rejected hidden work leaves caches and user force untouched');
});

test('reported solver policy cannot conceal different live iteration, start or substep options', () => {
  // Regression for the durable pre-fix live-budget-failure witness. The runner
  // now independently refuses pre-step drift, so change live options after a
  // genuine completed receipt and explicitly forge the producer metadata.
  for (const key of ['newtonIterations', 'previousPoseStart', 'substeps']) {
    const { context } = fixture(false, 4), declared = context.options[key];
    const runtime = runStateModalContext(context, { steps: 1 });
    context.world.opts[key] = key === 'newtonIterations' ? 1 : key === 'previousPoseStart' ? true : 2 * declared;
    const fake = observeStateModalWorld(context, { step: 1, initial: false, execution: runtime.final.execution });
    assert.equal(runtime.completedSteps, 1);
    assert.notEqual(fake.solver[key], declared);
    assert.equal(fake.measurementValid, false, 'producer independently rejects live policy drift');
    fake.solver[key] = declared;
    // Forging producer flags must not bypass the independent live association.
    fake.measurementValid = true; fake.errors = [];
    const before = scratch(context.world), proof = validate(context, fake, runtime.initial);
    assert.equal(proof.valid, false, key); assert.equal(proof.boundaryCertified, false, key);
    assert.equal(proof.publicConverged, false); assert.equal(proof.authoritativeConverged, false);
    assert.ok(proof.errors.includes('live solver configuration differs: ' + key), proof.errors.join('\n'));
    if (key === 'substeps') assert.ok(proof.errors.includes('live timestep/substeps association differs'));
    assert.deepEqual(scratch(context.world), before, key + ' rejection must preserve live state/caches');
  }
  console.log('state-modal-validation-live-policy: three deliberate post-receipt native option/report mismatches refused independently; no budget or start-policy certificate inferred from reported metadata');
});

test('actual single-step receipts cannot be relabelled as later trajectory steps', () => {
  const { context } = fixture(), runtime = runStateModalContext(context, { steps: 1 });
  assert.equal(validate(context, runtime.final, runtime.initial).valid, true);
  const before = scratch(context.world);
  const fake = structuredClone(runtime.final), previous = structuredClone(runtime.initial);
  fake.step = 100; previous.step = 99;
  const proof = validate(context, fake, previous);
  assert.equal(proof.valid, false); assert.equal(proof.boundaryCertified, false);
  assert.ok(proof.errors.includes('step identity differs from one-substep public counters'));
  assert.ok(proof.errors.includes('previous step/initial/clock/counter identity differs'));
  for (const mutate of [p => { p.initial = false; }, p => { p.framesRun = 1; }, p => { p.substepsRun = 1; }, p => { p.h *= 2; }]) {
    const forgedPrevious = structuredClone(runtime.initial); mutate(forgedPrevious);
    const result = validate(context, runtime.final, forgedPrevious);
    assert.equal(result.valid, false, mutate.toString()); assert.equal(result.boundaryCertified, false);
    assert.ok(result.errors.includes('previous step/initial/clock/counter identity differs'));
  }
  assert.deepEqual(scratch(context.world), before);
  console.log('state-modal-validation-step-identity: one real completed step cannot masquerade as step100; predecessor initial/counter/h metadata is independently bound without changing live state');
});

test('all fourteen native initial bindings remain anchored despite forged producer validity and JSON zero-sign loss', () => {
  const baseline = fixture().context, initial = observeStateModalWorld(baseline);
  assert.equal(validate(baseline, JSON.parse(JSON.stringify(initial))).valid, true, 'JSON numeric zero-sign loss must not alter authoritative LE words');
  const names = ['x', 'xs', 'xt', 'v', 'u', 'us', 'ut', 'x0', 'mass', 'h', 'initialX', 'initialU', 'initialV', 'reference'];
  assert.deepEqual(Object.keys(initial.stateSHA256).sort(), [...names].sort());
  for (const key of names) {
    const wrongContext = { ...baseline, initialBinding: structuredClone(baseline.initialBinding) };
    wrongContext.initialBinding.stateSHA256[key] = '0'.repeat(64);
    const proof = validate(wrongContext, initial);
    assert.equal(proof.valid, false, key); assert.ok(proof.errors.includes('initial native binding changed: ' + key));
  }
  for (const key of ['v', 'us', 'ut']) {
    const { context } = fixture(), native = key === 'v' ? context.world.v : context.world['_' + key];
    assert.ok(Object.is(native[1], +0)); native[1] = -0;
    const forged = observeStateModalWorld(context);
    assert.notEqual(forged.stateSHA256[key], context.initialBinding.stateSHA256[key]);
    assert.equal(forged.measurementValid, false, 'producer independently rejects original-word drift');
    forged.measurementValid = true; forged.errors = [];
    const before = scratch(context.world);
    for (const report of [forged, JSON.parse(JSON.stringify(forged))]) {
      const proof = validate(context, report);
      assert.equal(proof.valid, false, key); assert.equal(proof.boundaryCertified, false);
      assert.ok(proof.errors.includes('initial native binding changed: ' + key), proof.errors.join('\n'));
    }
    assert.deepEqual(scratch(context.world), before); assert.ok(Object.is(native[1], -0));
    assert.equal(context.world.framesRun, 0); assert.equal(context.world.substepsRun, 0); assert.equal(context.world.factorCount, 0);
  }
  console.log('state-modal-validation-initial-words: all14 native initial hashes independently anchored; actual v/us/ut +0-to-minus0 drift refused despite forged flags and JSON numeric views; no step or solver call');
});
