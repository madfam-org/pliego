// Authority-aware observation of actual public World steps with panel bending. No substitute solver.
// Mirrors membrane-state-modal-runtime.mjs: the same lossless state/force bindings and execution
// identities. What differs: the state identity includes the bending identity, out-of-plane state
// is admitted, the energy check includes the bending term, and the modal reduction projects the
// out-of-plane field onto the independent bending mode.
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { REFERENCE_STATE_IDENTITY } from '../src/xpbd/reference-state.js';
import { REFERENCE_BENDING_IDENTITY } from '../src/xpbd/reference-bending.js';
import { encodeStateModalVectors } from './membrane-state-modal-runtime.mjs';
import { captureModalReference } from './membrane-modal-runtime.mjs';
import { bendingStatePatch, bendingStateOptions } from './bending-state-inputs.mjs';
import * as D from '../src/xpbd/double-double.js';
import * as K from '../src/constants.js';

const MODE = 'reference-displacement', ABS = 'absolute-position', ATOL = 1e-7, RTOL = 1e-10;
// Energies are summed in different orders by the residual and by the search objective; agreement is
// required to this many ulps of the summed magnitudes. A real omitted term would be far larger.
export const BENDING_SUMMATION_ULPS = 64;
const finite = x => typeof x === 'number' && Number.isFinite(x), arr = x => Array.from(x ?? []);
const same = (a, b) => a?.length === b?.length && arr(a).every((v, i) => Object.is(v, b[i]));
const zero = a => arr(a).every(v => v === 0);
const demand = (ok, message) => { if (!ok) throw new Error('bending-state-runtime: ' + message); };
export const BENDING_STATE_IDENTITY = Object.freeze({ ...REFERENCE_STATE_IDENTITY, bending: REFERENCE_BENDING_IDENTITY });
const canonical = value => JSON.stringify(value, (_k, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
export const bendingIdentityMatches = w => w.opts.stateCoordinates === MODE && canonical(w._referenceIdentity) === canonical(BENDING_STATE_IDENTITY);
/** Named engine options of the candidate arm; omission keeps the historical defaults. */
export const BENDING_STATE_PCG_STOPS = Object.freeze({ 'half-force-tolerance': Object.freeze({ rule: 'absolute-residual-infinity-norm', factorOfForceTolerance: .5 }) });

function controlledExecutionErrors(context) {
  const w = context.world, errors = [];
  for (const key of ['newtonIterations', 'previousPoseStart', 'substeps']) if (!Object.is(w.opts[key], context.options[key])) errors.push('live controlled solver option changed: ' + key);
  if (!Object.is(w.dt, 1 / (60 * context.options.substeps))) errors.push('live controlled timestep changed');
  return errors;
}
function referenceNative(w) {
  const values = new Float64Array(22 * w.orthotropicMembrane.elements.length); let offset = 0;
  for (const e of w.orthotropicMembrane.elements) for (const part of [e.reference.u, e.reference.v, e.reference.x0, Float64Array.of(e.reference.c, e.reference.s), e.Q, Float64Array.of(e.volume)]) {
    new Uint8Array(values.buffer, 8 * offset, 8 * part.length).set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength)); offset += part.length;
  }
  return values;
}
const bindingFields = w => ({ x: w.x, xs: w.xs, xt: w.xt, v: w.v, u: w._u, us: w._us, ut: w._ut, x0: w.X0, mass: w.mass, h: [w.dt],
  initialX: w._referenceInitialX, initialU: w._referenceInitialU, initialV: w._referenceInitialV, reference: referenceNative(w), hingeK: w.hingeK, restTheta: w.restTheta,
  // The continued hinge angles choose each hinge's branch for the bending energy; bound so offline replay can reproduce it.
  theta: w.theta });

/** One World per row, initialized once from the fixture's A*phi field and zero velocity.
 * @param {any} inputs loadBendingStateInputs() @param {any} row */
export function createBendingStateWorld(inputs, row, { membraneCurvature = 'gauss-newton', pcgStop, ...unknown } = {}) {
  demand(Object.keys(unknown).length === 0, 'unknown options: ' + Object.keys(unknown).join(','));
  demand(['gauss-newton', 'exact-hessian'].includes(membraneCurvature), 'named membraneCurvature required');
  demand(pcgStop === undefined || Object.hasOwn(BENDING_STATE_PCG_STOPS, pcgStop), 'unknown named PCG stop');
  const patch = bendingStatePatch();
  demand(patch.fixtureSHA256 === inputs.fixtureSHA256 && patch.meshSHA256 === inputs.meshSHA256, 'patch differs from the fixture');
  const n = patch.vertices.length, phi = inputs.reference.mode.phiBinary64, omega = inputs.reference.mode.omegaBinary64, amplitude = row.amplitude;
  const forceScale = amplitude * omega ** 2 * Math.max(...inputs.massWords.map((m, i) => m * Math.abs(phi[i])));
  const forceTolerance = Math.max(ATOL, RTOL * forceScale);
  const named = { ...(membraneCurvature === 'exact-hessian' ? { membraneCurvature } : {}),
    ...(pcgStop === undefined ? {} : { pcgAbsoluteTolerance: BENDING_STATE_PCG_STOPS[pcgStop].factorOfForceTolerance * forceTolerance }) };
  const options = { ...bendingStateOptions(patch), substeps: row.substeps, newtonIterations: row.budget, previousPoseStart: row.seed, ...named };
  const world = new World(patch.doc, options), mesh = world.mesh;
  demand(world.dt === row.h && world.dt === 1 / (60 * row.substeps), 'actual public timestep differs');
  demand(mesh.nV === n && mesh.nT === patch.triangles.length && mesh.nH === inputs.referenceInput.hinges.length, 'native mesh counts changed');
  demand(same(world.mass, inputs.massWords) && same(world.hingeK, inputs.hingeKWords) && same(world.X0, inputs.x0Words), 'native mass, hinge stiffness or reference pose differs from the fixture');
  demand(!world.fixed.some(Boolean) && world.sys.nFree === n, 'free vibration cannot contain constraints');
  demand(!world.contact && !world.coupledContact && !world.motionGuard && !world.edgeContact, 'contact path entered experiment');
  demand(world.opts.damping === 0 && world.bendDamp === 0 && world.drivers.wind === 0, 'hidden damping/wind configuration');
  demand(world.restTheta.every(t => t === 0) && world.mesh.hingeKind.every(k => k === 0), 'nonflat rest angle or non-panel hinge');
  // Independent lumped mass: rho*A*area/3 per triangle corner.
  const lumped = Array(n).fill(0);
  for (let t = 0; t < mesh.nT; t++) {
    const ids = Array.from(mesh.tris.subarray(3 * t, 3 * t + 3)), [a, b, c] = ids.map(i => patch.vertices[i]);
    const mass = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2 * world.materials[mesh.triSheet[t]].rhoA / 3;
    for (const v of ids) lumped[v] += mass;
  }
  const massScale = Math.max(...world.mass);
  demand(arr(world.mass).every((m, i) => Math.abs(m - lumped[i]) <= 1e-12 * massScale), 'native and independently lumped masses disagree');
  const x = world.X0.map((x0, i) => x0 + inputs.uWords[i]), v = Float64Array.from(inputs.vWords);
  world.setInitialReferencePose(x, v);
  demand(same(world._u, inputs.uWords) && same(world.v, inputs.vWords), 'one exact conversion did not reproduce the fixture field');
  demand(bendingIdentityMatches(world), 'bending state identity not selected');
  const masses = arr(world.mass), modalMass = masses.reduce((s, m, i) => s + m * phi[i] * phi[i], 0);
  const words = arr(referenceNative(world)), binding = encodeStateModalVectors(bindingFields(world));
  return { patch, world, options, parameters: { substeps: row.substeps, newtonIterations: row.budget, previousPoseStart: row.seed, membraneCurvature, ...(pcgStop === undefined ? {} : { pcgStop }) },
    phi: phi.slice(), omega, amplitude, masses, modalMass, forceScale, forceTolerance, maximumModeNorm: Math.max(...phi.map(Math.abs)),
    referenceWords: words, referenceCoefficients: captureModalReference({ world }), hingeKWords: arr(world.hingeK), initialBinding: binding,
    massProof: { native: masses.slice(), independentlyLumpedMass: lumped, scope: 'rho*A*area/3 per triangle corner, 1e-12 relative to the largest native mass' },
    initialization: { physicalSolvesExecuted: 0, policy: 'fixture u = A*phi (one binary64 product), v = +0; one exact X0+u conversion, Object.is checked; no target supplied' },
    forceScaleConvention: 'FIXED |A| omega^2 max_i(native mass_i |phi_i|), binary64 from the fixture words' };
}

function shadowWorld(w) {
  const s = Object.create(w);
  for (const key of ['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK']) s[key] = w[key].slice();
  s.theta = w.theta.slice();
  s.orthotropicMembrane = Object.create(w.orthotropicMembrane);
  s.orthotropicMembrane.work = structuredClone(w.orthotropicMembrane.work);
  s.orthotropicMembrane.block = w.orthotropicMembrane.block.slice();
  return s;
}
function inertiaEnergy(x, xt, mass, h) {
  let value = 0; const reciprocal = 1 / (h * h);
  for (let v = 0; v < mass.length; v++) for (let c = 0; c < 3; c++) value += .5 * mass[v] * reciprocal * (x[3 * v + c] - xt[3 * v + c]) ** 2;
  return value;
}
/** Out-of-plane modal reduction; everything outside the mode (other bending modes and all in-plane motion) is leakage. */
export function bendingReductions(context, u, v, elasticEnergy) {
  const { masses, phi, modalMass } = context;
  let q = 0, qdot = 0, kineticEnergy = 0, leak = 0, inPlane = 0;
  const linearMomentum = [0, 0, 0];
  for (let i = 0; i < masses.length; i++) {
    q += masses[i] * phi[i] * u[3 * i + 1]; qdot += masses[i] * phi[i] * v[3 * i + 1];
    kineticEnergy += .5 * masses[i] * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
    for (let c = 0; c < 3; c++) linearMomentum[c] += masses[i] * v[3 * i + c];
  }
  q /= modalMass; qdot /= modalMass;
  for (let i = 0; i < masses.length; i++) {
    leak += masses[i] * ((u[3 * i + 1] - q * phi[i]) ** 2 + u[3 * i] ** 2 + u[3 * i + 2] ** 2);
    inPlane += masses[i] * (u[3 * i] ** 2 + u[3 * i + 2] ** 2);
  }
  return { outOfPlane: masses.map((_m, i) => u[3 * i + 1]), outOfPlaneVelocity: masses.map((_m, i) => v[3 * i + 1]),
    modalCoordinate: q, modalVelocity: qdot, modalLeakageMassNorm: Math.sqrt(leak), inPlaneMassNorm: Math.sqrt(inPlane),
    kineticEnergy, mechanicalEnergy: elasticEnergy === null ? null : elasticEnergy + kineticEnergy, linearMomentum };
}
function authorityMoments(x0, u, v, mass) {
  const sum = () => /** @type {D.DD} */ ([0, 0]); let center = [sum(), sum(), sum()]; const angular = [sum(), sum(), sum()];
  const total = mass.reduce((s, m) => s + m, 0);
  for (let i = 0; i < mass.length; i++) {
    const q = [0, 1, 2].map(c => D.twoSum(x0[3 * i + c], u[3 * i + c])), vel = v.slice(3 * i, 3 * i + 3);
    for (let c = 0; c < 3; c++) {
      center[c] = D.add(center[c], D.scale(q[c], mass[i]));
      const a = (c + 1) % 3, b = (c + 2) % 3;
      angular[c] = D.add(angular[c], D.scale(D.sub(D.scale(q[a], vel[b]), D.scale(q[b], vel[a])), mass[i]));
    }
  }
  center = center.map(value => D.scale(value, 1 / total));
  return { centerOfMassWords: center, angularMomentumAboutWorldOriginWords: angular,
    momentsScope: 'approximate DD reductions of represented X0+u and actual v; diagnostics only' };
}

/** Boundary-only observation. Failure buffers remain labelled incomplete; no repair. */
export function observeBendingStateWorld(context, { step = 0, initial = step === 0, execution = null } = {}) {
  const w = context.world, n = w.mesh.nV, errors = controlledExecutionErrors(context), check = (ok, message) => { if (!ok) errors.push(message); };
  const raw = { x: arr(w.x), xs: arr(w.xs), xt: arr(w.xt), v: arr(w.v) }, latent = { u: arr(w._u), us: arr(w._us), ut: arr(w._ut), v: arr(w.v), x0: arr(w.X0),
    initialX: arr(w._referenceInitialX), initialU: arr(w._referenceInitialU), initialV: arr(w._referenceInitialV) };
  let fields = null;
  try { fields = bindingFields(w); } catch (cause) { errors.push('reference unavailable: ' + cause.message); }
  const binding = encodeStateModalVectors(fields ?? {});
  const targetValid = !initial && step > 0 && !w.asleep && w.framesRun === step && w.substepsRun === step && !!execution && execution.actualSubstepExecuted && !execution.exception;
  check(Number.isSafeInteger(step) && step >= 0 && initial === (step === 0) && step === w.framesRun && step === w.substepsRun, 'actual one-call/one-substep index identity mismatch');
  check(!w.asleep, 'sleep censors measurement');
  check(fields !== null && Object.values(fields).every(a => arr(a).every(finite)), 'nonfinite actual buffers');
  if (initial) check(Object.entries(binding.stateSHA256).every(([key, value]) => value === context.initialBinding.stateSHA256[key]), 'actual initial native-word binding changed');
  check(raw.x.length === 3 * n && latent.u.length === 3 * n, 'actual state dimensions changed');
  check(bendingIdentityMatches(w), 'bending state identity changed');
  check(same(w.mass, context.masses) && w.dt === 1 / (60 * w.opts.substeps), 'native mass/timestep changed');
  check(same(fields?.reference, context.referenceWords) && same(w.hingeK, context.hingeKWords) && zero(w.restTheta), 'reference words, hinge stiffness or rest angles changed');
  check(zero(w.userForce) && zero(w.fext) && w.drivers.wind === 0 && zero(w.driveOn) && zero(w.terms.active), 'external work entered experiment');
  check(w.opts.damping === 0 && w.bendDamp === 0 && w.opts.gravity === false && w.opts.contact === false && w.opts.ground === false && w.opts.plasticity === false, 'omitted physics options changed');
  if (execution) check(execution.returnedSubsteps === 1 && execution.actualSubstepExecuted && execution.framesAdvancedExactlyOne && execution.accumulatedTimeExact &&
    execution.usMatchesPreviousU && execution.utMatchesActualDisplacementPredictor && execution.velocityMatchesActualDisplacementDifference &&
    execution.xProjectionMatchesAuthority && execution.xsProjectionMatchesAuthority && execution.xtProjectionMatchesAuthority && !execution.exception, 'actual authority predecessor/predictor/velocity/execution mismatch');
  let authority = null, publicData = null, omitted = null, metric = null, authorityMetric = null, rawPublicImplicitEnergy = null, rawAuthorityImplicitEnergy = null;
  try {
    const boundary = w.authoritativeState(); check(boundary !== undefined && same(boundary.u, latent.u), 'authority boundary unavailable');
    const observed = w.authoritativeResiduals(context.forceTolerance); authority = observed.authoritative; publicData = observed.public;
    const shadow = shadowWorld(w), g = new Float64Array(3 * n), gu = new Float64Array(3 * n);
    gradient(shadow, w.x, g, ABS); gradient(shadow, w._u, gu, MODE);
    const ie = inertiaEnergy(raw.x, raw.xt, w.mass, w.dt), ue = inertiaEnergy(latent.u, latent.ut, w.mass, w.dt);
    rawPublicImplicitEnergy = implicitEnergy(shadow, w.x, ABS); rawAuthorityImplicitEnergy = implicitEnergy(shadow, w._u, MODE);
    // The engine's search objective and gradient against the residual's membrane+bending sum: equal up to summation order.
    const term = (label, inertial, residual, objective, objectiveGradient) => {
      const energyScale = Math.abs(inertial) + Math.abs(residual.energy - (residual.bendingEnergy ?? 0)) + Math.abs(residual.bendingEnergy ?? 0);
      const energyDifference = objective - (inertial + residual.energy);
      let gradientDifference = 0, gradientScale = 0;
      for (let i = 0; i < 3 * n; i++) { gradientDifference = Math.max(gradientDifference, Math.abs(objectiveGradient[i] - residual.elasticGradient[i])); gradientScale = Math.max(gradientScale, Math.abs(residual.elasticGradient[i])); }
      const energyBound = BENDING_SUMMATION_ULPS * Number.EPSILON * energyScale, gradientBound = BENDING_SUMMATION_ULPS * Number.EPSILON * gradientScale;
      check(Math.abs(energyDifference) <= energyBound && gradientDifference <= gradientBound, label + ' omitted energy/gradient beyond summation order');
      return { energyDifference, energyBound, gradientDifference, gradientBound };
    };
    omitted = { public: term('public', ie, publicData, rawPublicImplicitEnergy, g), authoritative: term('authoritative', ue, authority, rawAuthorityImplicitEnergy, gu),
      scope: 'search objective minus (inertia + membrane + bending) and engine gradient minus residual elastic gradient; nonzero only by summation order' };
    metric = shadow.orthotropicMembrane.diagnostics(w.x, ABS); authorityMetric = shadow.orthotropicMembrane.diagnostics(w._u, MODE);
    check(metric.finite && authorityMetric.finite, 'nonfinite actual selected metric');
  } catch (cause) { errors.push(cause.message); }
  const force = (value, mode) => {
    const elasticEnergy = value?.energy ?? null, inertial = mode === MODE ? inertiaEnergy(latent.u, latent.ut, w.mass, w.dt) : inertiaEnergy(raw.x, raw.xt, w.mass, w.dt);
    return { elasticEnergy, bendingEnergy: value?.bendingEnergy ?? null, rawImplicitEnergy: mode === MODE ? rawAuthorityImplicitEnergy : rawPublicImplicitEnergy, rawInertiaEnergy: inertial,
      elasticGradient: value ? arr(value.elasticGradient) : null, inertiaGradient: targetValid && value ? arr(value.inertiaGradient) : null,
      residual: targetValid && value ? arr(value.residual) : null, residualInfinity: targetValid && value ? value.residualInfinity : null,
      inertiaEnergy: targetValid ? inertial : null, incrementalEnergy: targetValid && elasticEnergy !== null ? elasticEnergy + inertial : null,
      forceScale: context.forceScale, forceTolerance: context.forceTolerance, targetValid };
  };
  const p = force(publicData, ABS), a = force(authority, MODE), publicU = raw.x.map((x, i) => x - w.X0[i]);
  const authorityResult = { identity: structuredClone(w._referenceIdentity), ...latent, ...a, ...bendingReductions(context, latent.u, raw.v, a.elasticEnergy),
    converged: targetValid && authority ? authority.residualInfinity <= context.forceTolerance : null, metric: authorityMetric,
    hingeAngles: arr(w.theta), omittedWork: omitted?.authoritative ?? null,
    rawSHA256: Object.fromEntries(['u', 'us', 'ut', 'v', 'x0', 'initialX', 'initialU', 'initialV'].map(k => [k, binding.stateSHA256[k]])) };
  try { Object.assign(authorityResult, authorityMoments(latent.x0, latent.u, raw.v, context.masses)); } catch (cause) { errors.push('authority moment diagnostic: ' + cause.message); }
  const forceVectors = {};
  for (const [prefix, value] of [['public', publicData], ['authoritative', authority]]) if (value) for (const key of ['elasticGradient', 'inertiaGradient', 'residual']) forceVectors[prefix + key[0].toUpperCase() + key.slice(1)] = value[key];
  const forceBinding = encodeStateModalVectors(forceVectors);
  const projected = bendingReductions(context, publicU, raw.v, p.elasticEnergy);
  let afterBinding = null; try { afterBinding = encodeStateModalVectors(bindingFields(w)); } catch (cause) { errors.push('after binding: ' + cause.message); }
  check(afterBinding !== null && Object.entries(binding.stateSHA256).every(([key, value]) => afterBinding.stateSHA256[key] === value), 'observation changed actual raw bytes');
  return { schema: 'pliego-bending-state-observation/1', step, initial, h: w.dt, time: w.time, ...raw, ...p, ...projected,
    modalMass: context.modalMass, publicMetricCoordinates: 'rounded-public-position-with-authoritative-velocity', metric,
    literalForceGate: targetValid && publicData ? publicData.residualInfinity <= context.forceTolerance : null,
    absoluteForceTolerance: ATOL, relativeForceTolerance: RTOL, normalizedResidual: p.residualInfinity === null ? null : p.residualInfinity / context.forceScale,
    targetScope: targetValid ? 'completed actual displacement predictor projected into public xt' : 'constructor/incomplete/unverified/sleep-censored buffers; no completed target certification',
    omittedWork: omitted?.public ?? null, authoritative: authorityResult, ...binding,
    forceFloat64LE: forceBinding.stateFloat64LE, forceSHA256: forceBinding.stateSHA256, forceBindingScope: 'raw selected native force tuples; only completed-target flags certify a force equation',
    rawSHA256: Object.fromEntries(['x', 'xs', 'xt', 'v'].map(k => [k, binding.stateSHA256[k]])),
    asleep: w.asleep, framesRun: w.framesRun, substepsRun: w.substepsRun, execution,
    solver: { newtonIterations: w.opts.newtonIterations, substeps: w.opts.substeps, previousPoseStart: w.opts.previousPoseStart,
      factorizations: w.factorCount, lastPublicPcgIterations: w.pcgIterations, pcgMaxIterations: K.PCG_MAX_ITER, pcgRelativeTolerance: K.PCG_RTOL,
      ...(w.opts.pcgAbsoluteTolerance !== undefined ? { pcgAbsoluteTolerance: w.opts.pcgAbsoluteTolerance } : {}), lineSearchBacktracks: w.energySearch.backtracks, lineSearchRejected: w.energySearch.rejected,
      lineSearchArithmetic: w.opts.lineSearchArithmetic, membraneArithmetic: w.opts.membraneArithmetic, membraneReference: w.opts.membraneReference, referenceBending: w.opts.referenceBending,
      stateCoordinates: MODE, membraneArithmeticIdentity: structuredClone(w.orthotropicMembrane.configuration.arithmetic), membraneReferenceIdentity: structuredClone(w.orthotropicMembrane.configuration.reference),
      stateIdentity: structuredClone(w._referenceIdentity),
      ...(w._exactCurvature ? { membraneCurvature: w.opts.membraneCurvature, membraneCurvatureIdentity: structuredClone(w.orthotropicMembrane.configuration.curvaturePolicy),
        factorCurvature: w._factorState?.curvature ?? null, membraneCurvatureCounters: structuredClone(w._exactCurvature.counters), lastCurvatureReceipt: structuredClone(w._exactCurvature.last) } : {}) },
    measurementValid: errors.length === 0, errors,
    scope: 'boundary observation of an actual reference-displacement World with panel bending; public and authority force gates separate; a force failure is data, never a tolerance waiver' };
}

/** Every requested interval is one real public step; no sleep, reset or extra solve. */
export function runBendingStateContext(context, { steps = 1, retain = 'all', onObservation, ...unknown } = {}) {
  demand(Object.keys(unknown).length === 0, 'unknown runner options');
  demand(Number.isSafeInteger(steps) && steps > 0 && ['all', 'initial-final'].includes(retain), 'positive steps and supported retention required');
  demand(onObservation === undefined || typeof onObservation === 'function' && onObservation.constructor.name !== 'AsyncFunction', 'synchronous callback required');
  const w = context.world; demand(w.framesRun === 0 && w.substepsRun === 0 && w.time === 0 && w._acc === 0, 'newly initialized, unstepped context required');
  const observations = [], initial = observeBendingStateWorld(context, { step: 0, initial: true });
  let last = initial, status = 'completed', error = null, completedSteps = 0, observedCount = 0, callbackCount = 0, valid = true, noSleep = true, counters = true, publicAll = true, authorityAll = true;
  const consume = o => {
    last = o; observedCount++; valid &&= o.measurementValid; noSleep &&= !o.asleep;
    if (!o.initial) { publicAll &&= o.literalForceGate === true; authorityAll &&= o.authoritative.converged === true; }
    if (retain === 'all' || o.initial) observations.push(o);
    if (onObservation) { const result = onObservation(structuredClone(o)); demand(!result || typeof result.then !== 'function', 'async callback result unsupported'); callbackCount++; }
  }; consume(initial);
  if (!initial.measurementValid) status = w.asleep ? 'sleep-censored' : 'invalid-initial-observation';
  for (let step = 1; step <= steps && initial.measurementValid; step++) {
    const before = { u: w._u.slice(), x: w.x.slice(), v: w.v.slice(), time: w.time, frames: w.framesRun, substeps: w.substepsRun };
    let returned = null, exception = null;
    try {
      const changed = controlledExecutionErrors(context); demand(changed.length === 0, changed.join('; '));
      const binding = encodeStateModalVectors(bindingFields(w));
      demand(Object.entries(binding.stateSHA256).every(([key, value]) => value === last.stateSHA256[key]), 'native boundary input changed after observation');
      returned = w.step(w.dt);
    } catch (cause) { exception = { name: cause.name, message: cause.message }; status = 'world-step-exception'; error = exception; }
    const actual = w.substepsRun === before.substeps + 1; if (actual) completedSteps++;
    const execution = { returnedSubsteps: returned, actualSubstepExecuted: actual, framesAdvancedExactlyOne: w.framesRun === before.frames + 1, accumulatedTimeExact: w.time === before.time + w.dt,
      usMatchesPreviousU: same(w._us, before.u), utMatchesActualDisplacementPredictor: w._ut.every((v, i) => Object.is(v, before.u[i] + w.dt * before.v[i])),
      velocityMatchesActualDisplacementDifference: w.v.every((v, i) => Object.is(v, (w._u[i] - w._us[i]) / w.dt)),
      xProjectionMatchesAuthority: w.x.every((v, i) => Object.is(v, w.X0[i] + w._u[i])), xsProjectionMatchesAuthority: w.xs.every((v, i) => Object.is(v, w.X0[i] + w._us[i])), xtProjectionMatchesAuthority: w.xt.every((v, i) => Object.is(v, w.X0[i] + w._ut[i])),
      exception };
    counters &&= returned === 1 && actual && execution.framesAdvancedExactlyOne && execution.accumulatedTimeExact;
    const observation = observeBendingStateWorld(context, { step, initial: false, execution }); consume(observation);
    if (exception) break; if (w.asleep) { status = 'sleep-censored'; break; } if (!observation.measurementValid) { status = 'invalid-observation'; break; }
  }
  if (retain === 'initial-final' && last !== initial) observations.push(last);
  return { schema: 'pliego-bending-state-runtime/1', status, error, parameters: { ...context.parameters, steps, retain }, options: context.options, h: w.dt,
    initial, final: last, observations, observedCount, retainedCount: observations.length, callbackCount, requestedSteps: steps, completedSteps, actualTime: w.time, requestedHorizon: steps * w.dt,
    massProof: context.massProof, initialization: context.initialization, initialBinding: context.initialBinding, fixedInitialForceScale: context.forceScale, forceTolerance: context.forceTolerance,
    modalMass: context.modalMass, maximumModeNorm: context.maximumModeNorm,
    sleepPolicy: { speedMmPerSecond: K.SLEEP_SPEED, consecutivePublicCalls: K.SLEEP_FRAMES, override: 'none; sleep censors this experiment' },
    gates: { measurementValid: valid, noSleep, exactActualSubstepCounters: counters, completeRequestedSteps: completedSteps === steps,
      literalFinalForceEverySubstep: completedSteps === steps && status === 'completed' && publicAll, authoritativeFinalForceEverySubstep: completedSteps === steps && status === 'completed' && authorityAll },
    scope: 'one actual public substep per call, unchanged budgets and inputs; independent public/authority force gates; all incomplete/failed outcomes retained' };
}
