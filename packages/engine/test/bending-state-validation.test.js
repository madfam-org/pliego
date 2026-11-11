import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { loadBendingStateInputs } from '../bench/bending-state-inputs.mjs';
import { createBendingStateWorld, observeBendingStateWorld, runBendingStateContext } from '../bench/bending-state-runtime.mjs';
import { validateBendingObservation } from '../bench/bending-state-validation.mjs';

const NAMED = { membraneCurvature: 'exact-hessian', pcgStop: 'half-force-tolerance' };
function fixture(seed = false, named = NAMED) {
  const inputs = loadBendingStateInputs(), row = inputs.rows.find(r => r.level === 1 && r.budget === 4 && r.seed === seed);
  return createBendingStateWorld(inputs, row, named);
}
const validate = (context, o, previous = null, world = context.world) => validateBendingObservation(o, { context, previous, world });
const scratch = w => ({ snapshot: w.snapshot(), work: structuredClone(w.orthotropicMembrane.work), block: w.orthotropicMembrane.block.slice(),
  theta: w.theta.slice(), thetaPred: w.thetaPred.slice(), hingeGrad: w.hingeGrad.slice(), edgeDir: w.edgeDir.slice(), edgeComp: w.edgeComp.slice(), edgeK: w.edgeK.slice(), g: w.g.slice() });
const sha = b => createHash('sha256').update(b).digest('hex');
const words = (o, key, binding = 'stateFloat64LE') => { const raw = Buffer.from(o[binding][key], 'base64'); return Array.from({ length: raw.length / 8 }, (_, i) => raw.readDoubleLE(8 * i)); };
const encode = values => { const raw = Buffer.alloc(8 * values.length); values.forEach((v, i) => raw.writeDoubleLE(v, 8 * i)); return raw; };

function bound(o, key, values) {
  const raw = encode(values);
  o.stateFloat64LE[key] = raw.toString('base64'); o.stateSHA256[key] = sha(raw);
  if (['x', 'xs', 'xt', 'v'].includes(key)) o.rawSHA256[key] = o.stateSHA256[key];
  if (Object.hasOwn(o.authoritative.rawSHA256, key)) o.authoritative.rawSHA256[key] = o.stateSHA256[key];
}
function boundForce(o, key, values) { const raw = encode(values); o.forceFloat64LE[key] = raw.toString('base64'); o.forceSHA256[key] = sha(raw); }
/** One completed step, validated live at the final boundary. */
function oneStep() {
  const context = fixture(); let previous = null, final;
  runBendingStateContext(context, { steps: 1, onObservation(o) { if (o.initial) previous = o; else final = o; } });
  return { context, previous, final };
}

test('bending validator independently certifies three actual exact-curvature steps for both start policies without changing caches', () => {
  let checked = 0, certified = 0;
  for (const seed of [false, true]) {
    const context = fixture(seed); let previous = null;
    const runtime = runBendingStateContext(context, { steps: 3, onObservation(o) {
      const before = scratch(context.world), proof = validate(context, o, previous);
      assert.equal(proof.valid, true, proof.errors.join('\n')); assert.equal(proof.actualGradientChecked, true); assert.equal(proof.liveWorldChecked, true);
      assert.equal(proof.losslessBindingsVerified, true); assert.equal(proof.forceBindingsVerified, true); assert.deepEqual(scratch(context.world), before);
      if (o.initial) {
        assert.equal(proof.boundaryCertified, false); assert.equal(proof.computedPublicConverged, null);
        assert.equal(proof.computedAuthoritativeConverged, null); assert.equal(proof.converged, false);
      } else {
        assert.equal(proof.boundaryCertified, true); certified++;
        assert.equal(proof.publicConverged, o.literalForceGate); assert.equal(proof.authoritativeConverged, o.authoritative.converged);
        assert.equal(proof.converged, proof.publicConverged);
        assert.ok(o.authoritative.bendingEnergy > 0 && o.authoritative.u.some((v, i) => i % 3 === 1 && v !== 0), 'out-of-plane state with bending work is admitted');
      }
      checked++; previous = o;
    } });
    assert.equal(runtime.completedSteps, 3); assert.equal(runtime.status, 'completed');
  }
  assert.equal(checked, 8); assert.equal(certified, 6);
  console.log(`bending-validation-positive: ${checked} initial/actual boundaries, both starts, exact curvature + half-tolerance PCG stop; live membrane+bending force equations and scratch transparency`);
});

test('the Gauss–Newton default without a named PCG stop is certified too', () => {
  const context = fixture(false, {}); let previous = null;
  runBendingStateContext(context, { steps: 2, onObservation(o) {
    const proof = validate(context, o, previous); assert.equal(proof.valid, true, proof.errors.join('\n')); previous = o;
  } });
  assert.equal(Object.hasOwn(previous.solver, 'pcgAbsoluteTolerance'), false); assert.equal(Object.hasOwn(previous.solver, 'membraneCurvature'), false);
});

test('state, hinge stiffness, rest angle, identity, force and modal forgeries are refused', () => {
  const { context, previous, final } = oneStep();
  assert.equal(validate(context, final, previous).valid, true);
  const refuse = (label, fake, expected) => {
    const proof = validate(context, fake, previous);
    assert.equal(proof.valid, false, label); assert.equal(proof.boundaryCertified, false, label);
    assert.equal(proof.converged, false, label); assert.equal(proof.authoritativeConverged, false, label);
    if (expected) assert.ok(proof.errors.some(e => e.includes(expected)), label + ':\n' + proof.errors.join('\n'));
  };
  const mutations = {
    // State words: a numeric view, a bound word, and a coordinated rebinding all fail.
    'numeric u view': [o => { o.authoritative.u[1] += 1e-9; }, 'numeric view differs from bound state: u'],
    'bound u word': [o => { const u = words(o, 'u'); u[1] += 1e-9; o.stateFloat64LE.u = encode(u).toString('base64'); }, 'lossless SHA mismatch: u'],
    'coordinated u rebinding': [o => { o.authoritative.u[1] += 1e-9; bound(o, 'u', o.authoritative.u); }, 'public projection mismatch: x'],
    'state SHA': [o => { o.stateSHA256.x = '0'.repeat(64); }, 'lossless SHA mismatch: x'],
    'missing restTheta binding': [o => { delete o.stateFloat64LE.restTheta; }, 'lossless state binding keys differ'],
    // Hinge stiffness and rest angles are bound, immutable and live-checked.
    'hingeK word': [o => { const k = words(o, 'hingeK'); k[0] *= 1 + 1e-12; bound(o, 'hingeK', k); }, 'numeric view differs from bound state: hingeK'],
    'nonzero restTheta': [o => { const t = words(o, 'restTheta'); t[0] = 1e-3; bound(o, 'restTheta', t); }, 'nonzero rest angle'],
    'negative-zero restTheta': [o => { const t = words(o, 'restTheta'); t[0] = -0; bound(o, 'restTheta', t); }, 'initial immutable binding changed: restTheta'],
    // Identity: planar identity, changed bending version, schema.
    'planar identity': [o => { delete o.authoritative.identity.bending; }, 'authoritative identity/schema'],
    'bending identity version': [o => { o.authoritative.identity.bending.version++; }, 'authoritative identity/schema'],
    'bending identity curvature': [o => { o.solver.stateIdentity.bending.curvature = 'exact-hessian'; }, 'reported state/model/arithmetic identity differs'],
    'planar schema': [o => { o.schema = 'pliego-membrane-state-modal-observation/1'; }, 'authoritative identity/schema'],
    'referenceBending': [o => { o.solver.referenceBending = undefined; }, 'reported state/model/arithmetic identity differs'],
    // Residual and force words.
    'residual view': [o => { o.residual[1] += 1e-6; }, 'public native inertia/residual differs'],
    'authoritative residualInfinity': [o => { o.authoritative.residualInfinity = 0; }, 'authoritative native inertia/residual differs'],
    'force SHA': [o => { o.forceSHA256.publicResidual = '0'.repeat(64); }, 'raw force LE/SHA mismatch: publicResidual'],
    'coordinated residual word': [o => { const r = words(o, 'authoritativeResidual', 'forceFloat64LE'); r[1] += 1e-6; boundForce(o, 'authoritativeResidual', r); o.authoritative.residual = r; }, 'authoritative raw native force association differs'],
    'force gate': [o => { o.literalForceGate = !o.literalForceGate; }, 'public force gate differs'],
    'converged': [o => { o.authoritative.converged = !o.authoritative.converged; }, 'authoritative force gate differs'],
    // Bending energy, omitted work and hinge angles.
    'bending energy': [o => { o.authoritative.bendingEnergy *= 1 + 1e-9; }, 'authoritative differs from independent panel bending'],
    'elastic energy': [o => { o.elasticEnergy += 1e-9; }, 'public omitted-work record differs'],
    'omitted energy difference': [o => { o.authoritative.omittedWork.energyDifference = 0; o.authoritative.omittedWork.energyBound *= 2; }, 'authoritative omitted-work record differs'],
    'omitted gradient difference': [o => { o.omittedWork.gradientDifference = 1e-30; }, 'public differs from actual selected/full gradient'],
    'missing omitted work': [o => { o.omittedWork = null; }, 'public omitted-work record differs'],
    'hinge angle view': [o => { o.authoritative.hingeAngles[0] += 1e-9; }, 'numeric view differs from bound state: theta'],
    'theta word': [o => { const t = words(o, 'theta'); t[0] += 1e-9; o.stateFloat64LE.theta = encode(t).toString('base64'); }, 'lossless SHA mismatch: theta'],
    'coordinated theta rebinding': [o => { const t = words(o, 'theta'); t[0] += 1e-9; bound(o, 'theta', t); o.authoritative.hingeAngles = t; }, 'live hinge angle memory differs'],
    'missing solver arithmetic identity': [o => { delete o.solver.membraneArithmeticIdentity; }, 'reported state/model/arithmetic identity differs'],
    'missing solver reference identity': [o => { delete o.solver.membraneReferenceIdentity; }, 'reported state/model/arithmetic identity differs'],
    // Modal reductions.
    'modal coordinate': [o => { o.authoritative.modalCoordinate += 1e-12; }, 'authoritative modal reduction differs'],
    'public modal coordinate': [o => { o.modalCoordinate *= -1; }, 'public modal reduction differs'],
    'modal velocity': [o => { o.modalVelocity += 1e-9; }, 'public modal reduction differs'],
    'in-plane norm': [o => { o.authoritative.inPlaneMassNorm = 0; }, 'authoritative modal reduction differs'],
    'out-of-plane view': [o => { o.outOfPlane[0] += 1e-9; }, 'public out-of-plane reduction differs'],
    'linear momentum': [o => { o.authoritative.linearMomentum[1] += 1e-9; }, 'authoritative linear momentum differs'],
    'mechanical energy': [o => { o.authoritative.mechanicalEnergy += 1e-9; }, 'authoritative kinetic/mechanical energy differs'],
    'modal mass': [o => { o.modalMass *= 2; }, 'context modal mass differs'],
    // Clock, execution and policy metadata, as in the planar validator.
    'clock': [o => { o.time += o.h; }, 'actual clock/counter increment mismatch'],
    'execution': [o => { o.execution.usMatchesPreviousU = false; }, 'execution proof differs: usMatchesPreviousU'],
    'force tolerance': [o => { o.forceTolerance *= 2; }, 'fixed force scale/tolerance changed'],
    'PCG stop': [o => { o.solver.pcgAbsoluteTolerance *= 2; }, 'named absolute PCG stop differs'],
    'metric': [o => { o.metric.minimumStretch *= 2; }, 'public differs from actual metric'],
  };
  for (const [label, [mutate, expected]] of Object.entries(mutations)) { const fake = structuredClone(final); mutate(fake); refuse(label, fake, expected); }
  // A self-consistent forged equilibrium: elastic gradient = -inertia, residual 0, all rebound. Only the live recomputation refuses it.
  const forged = structuredClone(final);
  forged.authoritative.elasticGradient = forged.authoritative.inertiaGradient.map(v => -v); forged.authoritative.residual.fill(0);
  forged.authoritative.residualInfinity = 0; forged.authoritative.converged = true;
  boundForce(forged, 'authoritativeElasticGradient', forged.authoritative.elasticGradient); boundForce(forged, 'authoritativeResidual', forged.authoritative.residual);
  forged.authoritative.omittedWork.gradientBound = 64 * Number.EPSILON * Math.max(0, ...forged.authoritative.elasticGradient.map(Math.abs));
  assert.equal(validate(context, forged, previous, null).valid, true, 'offline algebra alone accepts a self-consistent forgery');
  refuse('forged equilibrium', forged, 'authoritative differs from actual membrane+bending residual sum');
  console.log(`bending-validation-negative: ${Object.keys(mutations).length + 1} state/hingeK/restTheta/identity/force/omitted-work/modal/metadata forgeries refused; a rebound equilibrium forgery passes offline algebra but not the live recomputation`);
});

test('wrong context, live hinge drift and predecessor forgery are refused; offline algebra is not a certificate', () => {
  const { context, previous, final } = oneStep();
  const offline = validate(context, final, previous, null);
  assert.equal(offline.valid, true, offline.errors.join('\n')); assert.equal(offline.actualGradientChecked, false);
  assert.equal(offline.boundaryCertified, false); assert.equal(offline.authoritativeConverged, false);
  const json = validate(context, JSON.parse(JSON.stringify(final)), JSON.parse(JSON.stringify(previous)));
  assert.equal(json.valid, true, 'lossless LE survives JSON numeric views: ' + json.errors.join('\n'));
  assert.equal(validate(context, final, null).valid, false, 'predecessor required');
  const badPrevious = structuredClone(previous); badPrevious.authoritative.u[1] += 1e-8; bound(badPrevious, 'u', badPrevious.authoritative.u);
  assert.equal(validate(context, final, badPrevious).valid, false);
  const contexts = {
    'hinge stiffness': { ...context, hingeKWords: context.hingeKWords.map((k, i) => i === 0 ? k * 2 : k) },
    'mode': { ...context, phi: context.phi.map(p => -p) },
    'options': { ...context, options: { ...context.options, bendDamping: .1 } },
    'planar options': { ...context, options: { ...context.options, referenceBending: undefined } },
    'curvature': { ...context, parameters: { ...context.parameters, membraneCurvature: 'gauss-newton' } },
    'initial binding': { ...context, initialBinding: { ...context.initialBinding, stateSHA256: { ...context.initialBinding.stateSHA256, hingeK: '0'.repeat(64) } } },
  };
  for (const [label, wrong] of Object.entries(contexts)) assert.equal(validate(wrong, final, previous).valid, false, label);
  // Live drift of the bending law: the engine's own preflight (validateReferenceState) refuses changed stiffness and nonflat rest angles.
  const w = context.world, k = w.hingeK[0], before = scratch(w);
  w.hingeK[0] = k * 2;
  let proof = validate(context, final, previous); assert.equal(proof.valid, false); assert.equal(proof.actualGradientChecked, false);
  w.hingeK[0] = k; w.restTheta[0] = 1e-3;
  proof = validate(context, final, previous); assert.equal(proof.valid, false); assert.equal(proof.actualGradientChecked, false);
  assert.ok(proof.errors.some(e => e.includes('nonflat rest angle')), proof.errors.join('\n'));
  w.restTheta[0] = 0; assert.deepEqual(scratch(w), before); assert.equal(validate(context, final, previous).valid, true);
  // A receiptless observation of a completed World never certifies a target.
  const receiptless = observeBendingStateWorld(context, { step: 1, initial: false });
  assert.equal(receiptless.targetValid, false); assert.equal(validate(context, receiptless, previous).boundaryCertified, false);
  console.log('bending-validation-domain: context/hinge/mode/option/initial-binding drift, predecessor forgery and live stiffness/rest-angle drift refused; offline stays algebra-only');
});

test('all seventeen initial bindings, including hingeK, restTheta and theta, stay anchored', () => {
  const context = fixture(), initial = observeBendingStateWorld(context);
  assert.equal(validate(context, initial).valid, true);
  const names = ['x', 'xs', 'xt', 'v', 'u', 'us', 'ut', 'x0', 'mass', 'h', 'initialX', 'initialU', 'initialV', 'reference', 'hingeK', 'restTheta', 'theta'];
  assert.deepEqual(Object.keys(initial.stateSHA256).sort(), [...names].sort());
  for (const key of names) {
    const wrong = { ...context, initialBinding: { ...context.initialBinding, stateSHA256: { ...context.initialBinding.stateSHA256, [key]: '0'.repeat(64) } } };
    const proof = validate(wrong, initial);
    assert.equal(proof.valid, false, key); assert.ok(proof.errors.includes('initial native binding changed: ' + key), key);
  }
  // The constructor's flat angles stay pinned: a rebound nonzero theta is refused even offline.
  const fake = structuredClone(initial), theta = words(fake, 'theta'); theta[0] = 1e-6; bound(fake, 'theta', theta); fake.authoritative.hingeAngles = theta;
  const offline = validate(context, fake, null, null);
  assert.ok(offline.errors.includes('initial hinge angle memory is not the flat constructor angle'), offline.errors.join('\n'));
  assert.ok(offline.errors.includes('initial native binding changed: theta'));
});
