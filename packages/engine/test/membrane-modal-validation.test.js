import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { makePatch } from '../bench/membrane-patch.mjs';
import { createModalWorld, observeModalWorld } from '../bench/membrane-modal-runtime.mjs';
import { binary64Spacing, validateObservation } from '../bench/membrane-modal-validation.mjs';

function fixture(amplitude = .004, previousPoseStart = false) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const phi = patch.vertices.map(([u]) => [(u - 20) / 20, 0]);
  const context = createModalWorld(patch, { phi, omega: 1e5, amplitude, substeps: 41667, newtonIterations: 1, previousPoseStart });
  // Reference mass is independently area-lumped from authored UV and density,
  // never copied from World or the producer's own massProof.
  const referenceMass = Array(phi.length).fill(0);
  for (const [a, b, c] of patch.triangles) {
    const p = patch.vertices[a], q = patch.vertices[b], r = patch.vertices[c];
    const area = ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
    for (const v of [a, b, c]) referenceMass[v] += area * 80e-6 / 3;
  }
  const initial = observeModalWorld(context);
  return { context, referenceMass, initial };
}

function next(context, previous) {
  const w = context.world, returned = w.step(w.dt);
  const execution = { returnedSubsteps: returned, actualSubstepExecuted: w.substepsRun === previous.substepsRun + 1,
    framesAdvancedExactlyOne: w.framesRun === previous.framesRun + 1, accumulatedTimeExact: w.time === previous.time + w.dt,
    xsMatchesPreviousX: w.xs.every((x, i) => x === previous.x[i]),
    xtMatchesActualPredictor: w.xt.every((x, i) => x === previous.x[i] + (w.dt * previous.v[i] + w.dt * w.dt * w.invMass[Math.floor(i / 3)] * w.fext[i])),
    velocityMatchesActualDifference: w.v.every((v, i) => v === (w.x[i] - w.xs[i]) / w.dt), exception: null };
  return observeModalWorld(context, { step: previous.step + 1, initial: false, execution });
}

const validate = (f, o, previous, extra = {}) => validateObservation(f.context, o, { world: f.context.world, previous, referenceMass: f.referenceMass, ...extra });

test('modal acceptance independently binds actual initial/stepped World and keeps honest force failure', () => {
  let failures = 0;
  for (const start of [false, true]) {
    const f = fixture(.004, start), first = validate(f, f.initial);
    assert.equal(first.valid, true, first.errors.join('\n')); assert.equal(first.converged, false);
    assert.equal(first.computedConverged, null); assert.equal(first.actualGradientChecked, true);
    const o = next(f.context, f.initial), proof = validate(f, o, f.initial);
    assert.equal(proof.valid, true, proof.errors.join('\n'));
    assert.equal(proof.computedResidualInfinity, o.residualInfinity);
    assert.equal(proof.computedForceTolerance, o.forceTolerance);
    assert.equal(proof.converged, o.literalForceGate);
    if (!proof.converged) failures++;
  }
  assert.ok(failures > 0, 'one-iteration physical response must retain its actual force failure');
  const rest = fixture(0), o = next(rest.context, rest.initial), proof = validate(rest, o, rest.initial);
  assert.equal(proof.valid, true, proof.errors.join('\n')); assert.equal(proof.converged, true);
  assert.equal(proof.computedResidualInfinity, 0);
  console.log('modal-validation-positive: initial, both actual start policies, literal force failure and exact zero-force rest independently classified');
});

test('modal acceptance refuses field, force-policy, clock, energy, momentum and metadata mutations', () => {
  const f = fixture(), o = next(f.context, f.initial);
  const mutations = [
    a => { a.h *= 2; }, a => { a.step++; }, a => { a.initial = true; }, a => { a.targetValid = false; },
    a => { a.x[0] += 1e-9; }, a => { a.xs[0] += 1e-9; }, a => { a.xt[0] += 1e-9; }, a => { a.v[0] += 1; },
    a => { a.x[1] = 1e-30; }, a => { a.elasticGradient[0] += 1; }, a => { a.inertiaGradient[0] += 1; },
    a => { a.residual[0] += 1; }, a => { a.residualInfinity = 0; }, a => { a.residualMaximumNodal = 0; },
    a => { a.massDualResidualNorm = 0; }, a => { a.normalizedResidual = 0; }, a => { a.literalForceGate = !a.literalForceGate; },
    a => { a.forceScale *= 2; }, a => { a.forceTolerance *= 2; }, a => { a.relativeForceTolerance = 1e-6; },
    a => { a.absoluteForceTolerance = 1; }, a => { a.forceTolerance += 1e6 * binary64Spacing(a.x[0]); },
    a => { a.time += a.h; }, a => { a.framesRun++; }, a => { a.substepsRun++; },
    a => { a.execution.returnedSubsteps = 2; }, a => { a.execution.xsMatchesPreviousX = false; },
    a => { a.execution.xtMatchesActualPredictor = false; }, a => { a.execution.exception = { name: 'Error' }; },
    a => { a.kineticEnergy += 1; }, a => { a.mechanicalEnergy += 1; }, a => { a.elasticEnergy += 1; },
    a => { a.inertiaEnergy += 1; }, a => { a.rawImplicitEnergy += 1; }, a => { a.incrementalEnergy += 1; },
    a => { a.linearMomentum[0] += 1; }, a => { a.centerOfMass[0] += 1; }, a => { a.angularMomentumAboutWorldOrigin[1] += 1; },
    a => { a.modalMass *= 2; }, a => { a.modalCoordinate += 1; }, a => { a.modalVelocity += 1; },
    a => { a.modalLeakageMassNorm += 1; }, a => { a.initialLinearModalEnergyScale *= 2; },
    a => { a.nonMembraneEnergy = 1e-20; }, a => { a.nonMembraneGradientMaximum = 1e-20; },
    a => { a.metric.maximumStretch += 1; }, a => { a.planarExact = false; }, a => { a.asleep = true; },
    a => { a.measurementValid = false; }, a => { a.errors.push('producer failure'); },
    a => { a.solver.newtonIterations++; }, a => { a.solver.substeps++; }, a => { a.solver.previousPoseStart = true; },
    a => { a.solver.factorizations++; }, a => { a.solver.pcgRelativeTolerance = 1e-2; },
    a => { a.solver.linearDirectionResiduals = []; }, a => { a.solver.acceptedAlphaHistory = [1]; },
    a => { a.displacement[0][0] += 1; }, a => { a.velocityUV[0][0] += 1; },
    a => { a.rawSHA256.x = '0'.repeat(64); }, a => { a.solver = null; }, a => { a.x = []; },
  ];
  for (const change of mutations) {
    const fake = structuredClone(o); change(fake);
    const proof = validate(f, fake, f.initial);
    assert.equal(proof.valid, false, change.toString()); assert.equal(proof.converged, false);
    assert.ok(proof.errors.length > 0);
  }
  const fake = structuredClone(o);
  fake.elasticGradient = fake.inertiaGradient.map(g => -g); fake.residual.fill(0);
  fake.residualInfinity = fake.residualMaximumNodal = fake.massDualResidualNorm = fake.normalizedResidual = 0;
  fake.literalForceGate = true; f.context.world.g.set(fake.elasticGradient);
  const disguised = validate(f, fake, f.initial);
  assert.equal(disguised.valid, false); assert.equal(disguised.converged, false);
  assert.ok(disguised.errors.some(e => e.includes('actual selected/full-path gradient')));
  const signedZero = structuredClone(o); signedZero.x[1] = -0;
  signedZero.rawSHA256.x = createHash('sha256').update(new Uint8Array(Float64Array.from(signedZero.x).buffer)).digest('hex');
  assert.equal(validate(f, signedZero, f.initial).valid, false, 'coordinated self-hash must not hide actual World byte mismatch');
  const sparseConfig = { ...f.context, phi: f.context.phi.slice() }; delete sparseConfig.phi[0];
  assert.equal(validateObservation(sparseConfig, o, { world: f.context.world, previous: f.initial, referenceMass: f.referenceMass }).valid, false);
  console.log(`modal-validation-negative: ${mutations.length + 3} mutations refused, including coordinated false gradient/residual/World.g, actual-byte mismatch and ULP tolerance inflation`);
});

test('modal acceptance verifies prior state, independent mass and actual hidden physics', () => {
  const f = fixture(), o = next(f.context, f.initial), w = f.context.world;
  assert.equal(validate(f, o, undefined).valid, false);
  const previous = structuredClone(f.initial); previous.x[0] += 1e-9;
  assert.equal(validate(f, o, previous).valid, false);
  assert.equal(validate(f, o, f.initial, { referenceMass: f.referenceMass.map(m => m * 1.001) }).valid, false);
  const smallAssociationDifference = f.referenceMass.map(m => m * (1 + 2e-13));
  const allowed = validate(f, o, f.initial, { referenceMass: smallAssociationDifference });
  assert.equal(allowed.valid, true, allowed.errors.join('\n'));
  assert.equal(allowed.computedForceTolerance, o.forceTolerance, 'native fixed force threshold must not use rounded reference mass');
  const corruptions = [
    () => { w.fixed[0] = 1; return () => { w.fixed[0] = 0; }; },
    () => { const x = w.invMass[0]; w.invMass[0] = 0; return () => { w.invMass[0] = x; }; },
    () => { w.userForce[0] = 1; return () => { w.userForce[0] = 0; }; },
    () => { w.fext[0] = 1; return () => { w.fext[0] = 0; }; },
    () => { w.opts.damping = 1; return () => { w.opts.damping = 0; }; },
    () => { w.bendDamp = 1; return () => { w.bendDamp = 0; }; },
    () => { w.drivers.wind = 1; return () => { w.drivers.wind = 0; }; },
    () => { w.opts.contact = true; return () => { w.opts.contact = false; }; },
    () => { w.contact = {}; return () => { w.contact = null; }; },
    () => { w.opts.physicalMembrane = false; return () => { w.opts.physicalMembrane = true; }; },
    () => { w.driveOn[0] = 1; return () => { w.driveOn[0] = 0; }; },
    () => { w.terms.active[w.drivers.grabTerm] = 1; return () => { w.terms.active[w.drivers.grabTerm] = 0; }; },
    () => { const x = w.X0[0]; w.X0[0] += 1; return () => { w.X0[0] = x; }; },
  ];
  for (const corrupt of corruptions) { const restore = corrupt(); try { assert.equal(validate(f, o, f.initial).valid, false); } finally { restore(); } }
  assert.equal(validate(f, o, f.initial).valid, true);
  const offline = validateObservation(f.context, o, { previous: f.initial, referenceMass: f.referenceMass });
  assert.equal(offline.valid, true, offline.errors.join('\n')); assert.equal(offline.liveWorldChecked, false);
  assert.equal(offline.actualGradientChecked, false); assert.equal(offline.converged, false);
  console.log('modal-validation-domain: predecessor, independent/native mass association, actual hidden physics and offline certification scope checked');
});

test('modal validation leaves live solver scratch/state and subsequent exact replay unchanged', () => {
  const a = fixture(), b = fixture();
  const before = a.context.world.snapshot(), selectedWork = structuredClone(a.context.world.orthotropicMembrane.work);
  const caches = Object.fromEntries(['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK'].map(k => [k, a.context.world[k].slice()]));
  assert.equal(validate(a, a.initial).valid, true);
  assert.deepEqual(a.context.world.snapshot(), before);
  assert.deepEqual(a.context.world.orthotropicMembrane.work, selectedWork);
  for (const [k, value] of Object.entries(caches)) assert.deepEqual(a.context.world[k], value);
  let pa = a.initial, pb = b.initial;
  for (let i = 0; i < 6; i++) {
    const oa = next(a.context, pa), ob = next(b.context, pb);
    const proof = validate(a, oa, pa); assert.equal(proof.valid, true, proof.errors.join('\n'));
    assert.deepEqual(oa, ob); assert.deepEqual(a.context.world.snapshot(), b.context.world.snapshot());
    pa = oa; pb = ob;
  }
  console.log('modal-validation-replay: cloned full-gradient caches preserve all raw state, selected scratch and six subsequent public-substep snapshots exactly');
});

test('binary64 inertia resolution scale is exact adjacent spacing and never modifies force acceptance', () => {
  assert.equal(binary64Spacing(0), Number.MIN_VALUE); assert.equal(binary64Spacing(-0), Number.MIN_VALUE);
  assert.equal(binary64Spacing(Number.MIN_VALUE), Number.MIN_VALUE);
  assert.equal(binary64Spacing(1), Number.EPSILON); assert.equal(binary64Spacing(-1), Number.EPSILON);
  assert.ok(Number.isFinite(binary64Spacing(Number.MAX_VALUE)));
  assert.equal(binary64Spacing(NaN), null); assert.equal(binary64Spacing(Infinity), null);
  const f = fixture(), o = next(f.context, f.initial), proof = validate(f, o, f.initial);
  assert.ok(proof.inertiaResolutionDiagnostic.maximumNativeCoordinateSpacingForce > 0);
  assert.equal(proof.computedForceTolerance, Math.max(1e-7, 1e-10 * o.forceScale));
  assert.equal(proof.computedConverged, o.residualInfinity <= proof.computedForceTolerance);
  console.log('modal-validation-spacing: exact binary64 adjacency diagnostic retained separately from the unchanged literal force gate');
});
