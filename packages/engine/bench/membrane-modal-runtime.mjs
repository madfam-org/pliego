// Observe actual World substeps. No substitute integrator, private Newton calls or oracle targets.
import { createHash } from 'node:crypto';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import * as K from '../src/constants.js';

const ATOL = 1e-7, RTOL = 1e-10, MASS_TOLERANCE = 1e-12;
const demand = (ok, message) => { if (!ok) throw new Error('membrane-modal-runtime: ' + message); };
const finite = x => typeof x === 'number' && Number.isFinite(x);
const bytesHash = a => createHash('sha256').update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const zero = a => Array.from(a).every(x => x === 0);
const maximum = a => Math.max(0, ...a.map(Math.abs));

/** Make a NEW actual World with legal research options, then initialize x/v ONCE.
 * phi is supplied by the independent oracle, dimensionless with max nodal norm1.
 * No eigenproblem, mode projection or integrator is substituted for World here.
 */
export function createModalWorld(patch, { phi, omega, amplitude, substeps, newtonIterations = 1, previousPoseStart = false, lineSearchArithmetic, membraneArithmetic, ...unknown } = {}) {
  demand(Object.keys(unknown).length === 0, 'unknown/unsupported observer options: ' + Object.keys(unknown).join(','));
  const n = patch.vertices.length;
  demand(Array.isArray(phi) && phi.length === n && phi.every(p => Array.isArray(p) && p.length === 2 && p.every(finite)), 'one finite [phi_u,phi_v] per native vertex required');
  const maximumModeNorm = Math.max(...phi.map(p => Math.hypot(...p)));
  demand(Math.abs(maximumModeNorm - 1) <= 1e-12, 'phi must already have maximum nodal norm1; no silent renormalization');
  demand(finite(omega) && omega > 0 && finite(amplitude) && amplitude >= 0, 'positive omega and nonnegative amplitude required');
  demand(Number.isSafeInteger(substeps) && substeps > 0 && Number.isSafeInteger(newtonIterations) && newtonIterations > 0, 'positive integer public substep/Newton budgets required');
  demand(typeof previousPoseStart === 'boolean', 'previousPoseStart must be boolean');
  demand(lineSearchArithmetic === undefined || ['total-energy', 'membrane-inertia-increment'].includes(lineSearchArithmetic), 'unsupported line-search arithmetic');
  demand(membraneArithmetic === undefined || ['binary64', 'double-double'].includes(membraneArithmetic), 'unsupported membrane arithmetic');
  demand(membraneArithmetic !== 'double-double' || lineSearchArithmetic === 'membrane-inertia-increment', 'double-double requires explicit membrane-inertia-increment search');
  demand(patch.options.membraneModel === 'orthotropic-stvk', 'selected-law native patch required');
  const options = { ...patch.options, substeps, newtonIterations, previousPoseStart, damping: 0, bendDamping: 0,
    gravity: false, ground: false, contact: false, plasticity: false, lineSearch: true,
    ...(lineSearchArithmetic === undefined ? {} : { lineSearchArithmetic }), ...(membraneArithmetic === undefined ? {} : { membraneArithmetic }) };
  const world = new World(patch.doc, options), mesh = world.mesh;
  demand(world.dt === 1 / (60 * substeps) && finite(world.dt) && world.dt > 0, 'actual public timestep differs or is invalid');
  demand(mesh.nV === n && mesh.nT === patch.triangles.length, 'native mesh counts changed');
  if (membraneArithmetic === 'double-double') {
    demand(world.opts.membraneArithmetic === membraneArithmetic && world.orthotropicMembrane.configuration.arithmetic?.name === membraneArithmetic, 'actual membrane arithmetic identity differs');
    demand(world.orthotropicMembrane.elements.every((element, t) => ['alpha', 'beta', 'Q'].every(key =>
      element[key].every((value, i) => Object.is(value, patch.world.orthotropicMembrane.elements[t][key][i]))) &&
      Object.is(element.volume, patch.world.orthotropicMembrane.elements[t].volume)), 'arithmetic candidate changed captured real polynomial coefficients');
  }
  demand(Array.from(mesh.uv).every((v, i) => v === patch.world.mesh.uv[i]) &&
    Array.from(mesh.tris).every((v, i) => v === patch.world.mesh.tris[i]), 'native UV/connectivity changed');
  demand(!world.fixed.some(Boolean) && world.sys.nFree === n, 'free vibration cannot contain runtime or benchmark constraints');
  demand(!world.contact && !world.coupledContact && !world.motionGuard && !world.edgeContact, 'contact path entered experiment');
  demand(world.opts.damping === 0 && world.bendDamp === 0 && world.drivers.wind === 0, 'hidden damping/wind configuration');
  const independentlyLumpedMass = Array(n).fill(0), consumed = new Set();
  for (let t = 0; t < mesh.nT; t++) {
    const ids = Array.from(mesh.tris.subarray(3 * t, 3 * t + 3)), a = patch.vertices[ids[0]], b = patch.vertices[ids[1]], c = patch.vertices[ids[2]];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    demand(finite(area) && area > 0, 'invalid reference triangle area');
    const mass = area * world.materials[mesh.triSheet[t]].rhoA / 3;
    for (const v of ids) { independentlyLumpedMass[v] += mass; consumed.add(v); }
  }
  const masses = Array.from(world.mass);
  demand(consumed.size === n && masses.every(m => finite(m) && m > 0), 'native masses must be positive and consume every vertex');
  const massScale = Math.max(...masses), maximumMassScaledDifference = Math.max(...masses.map((m, i) => Math.abs(m - independentlyLumpedMass[i]) / massScale));
  demand(maximumMassScaledDifference <= MASS_TOLERANCE, 'native/reference lumped masses disagree');
  for (let v = 0; v < n; v++) {
    demand(world.x[3 * v] === patch.vertices[v][0] && world.x[3 * v + 1] === 0 && world.x[3 * v + 2] === -patch.vertices[v][1], 'unexpected native reference placement');
    world.positions[3 * v] = patch.vertices[v][0] + amplitude * phi[v][0];
    world.positions[3 * v + 1] = 0;
    world.positions[3 * v + 2] = -(patch.vertices[v][1] + amplitude * phi[v][1]);
  }
  world.v.fill(0);
  const mode = phi.map(p => p.slice()), modalMass = masses.reduce((sum, m, i) => sum + m * (mode[i][0] ** 2 + mode[i][1] ** 2), 0);
  const forceScale = amplitude * omega ** 2 * Math.max(...masses.map((m, i) => m * Math.hypot(...mode[i])));
  demand(finite(forceScale) && finite(modalMass) && modalMass > 0, 'invalid fixed modal normalization');
  return { patch, world, options, phi: mode, omega, amplitude, masses, modalMass, forceScale,
    parameters: { phi: mode, omega, amplitude, substeps, newtonIterations, previousPoseStart,
      ...(lineSearchArithmetic === undefined ? {} : { lineSearchArithmetic }), ...(membraneArithmetic === undefined ? {} : { membraneArithmetic }) },
    forceTolerance: Math.max(ATOL, RTOL * forceScale), maximumModeNorm,
    massProof: { native: masses.slice(), independentlyLumpedMass, verticesConsumed: consumed.size,
      totalMass: masses.reduce((a, b) => a + b, 0), maximumMassScaledDifference, massScale, tolerance: MASS_TOLERANCE,
      convention: 'reference UV triangle area times native areal density /3 per node; grams; no extra thickness or consistent-mass substitution' } };
}

/** Read actual state and recompute the final force equation, never re-run a solve.
 * Initial raw xs/xt are preserved but explicitly not called an inertial prediction.
 * Solver gradient scratch caches are restored; x/xs/xt/v are never modified.
 */
export function observeModalWorld(context, { step = 0, initial = step === 0, execution = null } = {}) {
  const { world: w, patch, masses, phi, modalMass, amplitude, omega, forceScale, forceTolerance } = context;
  const n = w.mesh.nV, h = w.dt, errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
  const raw = { x: Array.from(w.x), xs: Array.from(w.xs), xt: Array.from(w.xt), v: Array.from(w.v) };
  const hashes = { x: bytesHash(w.x), xs: bytesHash(w.xs), xt: bytesHash(w.xt), v: bytesHash(w.v) };
  const targetValid = !initial && w.substepsRun > 0 && (!execution || (execution.actualSubstepExecuted && !execution.exception));
  check(Object.values(raw).every(a => a.every(finite)), 'nonfinite actual state');
  check(w.dt === 1 / (60 * w.opts.substeps), 'actual timestep/configuration mismatch');
  check(!w.fixed.some(Boolean) && w.sys.nFree === n && w.invMass.every(v => v > 0), 'unexpected fixed/zero-inverse-mass DOF');
  check(zero(w.userForce) && zero(w.fext) && w.drivers.wind === 0, 'external force or wind work entered experiment');
  check(!w.driveOn.some(Boolean) && !w.terms.active.some(Boolean), 'drive/join term entered experiment');
  check(w.opts.damping === 0 && w.bendDamp === 0 && !w.opts.gravity && !w.opts.ground && !w.opts.contact && !w.opts.plasticity, 'disabled external/dissipative option changed');
  check(!w.contact && !w.coupledContact && !w.motionGuard && !w.edgeContact, 'unexpected contact path');
  check(masses.every((m, i) => m === w.mass[i]), 'native masses changed');
  if (execution) {
    check(execution.returnedSubsteps === 1 && execution.actualSubstepExecuted && execution.framesAdvancedExactlyOne && execution.accumulatedTimeExact, 'public call did not execute exactly one actual substep/time increment');
    check(execution.xsMatchesPreviousX && execution.xtMatchesActualPredictor && execution.velocityMatchesActualDifference, 'actual predecessor/predictor/velocity identity mismatch');
  }
  let inertiaEnergy = 0;
  const idt2 = 1 / (h * h);
  for (let v = 0; v < n; v++) for (let c = 0; c < 3; c++) inertiaEnergy += 0.5 * masses[v] * idt2 * (w.x[3 * v + c] - w.xt[3 * v + c]) ** 2;
  let elasticEnergy = null, rawImplicitEnergy = null, nonMembraneEnergy = null, nonMembraneGradientMaximum = null, metric = null;
  let elasticGradient = null, inertiaGradient = null, residual = null;
  const selected = w.orthotropicMembrane, stiffness = w.kMem.slice(), thetaPred = w.thetaPred.slice(), hingeGrad = w.hingeGrad.slice();
  try {
    demand(selected, 'selected runtime membrane missing');
    elasticEnergy = selected.energy(w.x); rawImplicitEnergy = implicitEnergy(w, w.x); metric = selected.diagnostics(w.x);
    check(finite(elasticEnergy) && metric.finite, 'invalid selected-law metric/energy');
    check(rawImplicitEnergy === inertiaEnergy + elasticEnergy, 'actual incremental objective contains unexplained energy');
    try { w.kMem.fill(0); w.orthotropicMembrane = null; nonMembraneEnergy = implicitEnergy(w, w.x) - inertiaEnergy; }
    finally { w.kMem.set(stiffness); w.orthotropicMembrane = selected; }
    check(nonMembraneEnergy === 0, 'nonzero bending/drive/other omitted energy');
    const full = new Float64Array(3 * n), membrane = new Float64Array(3 * n);
    gradient(w, w.x, full); selected.addGradient(w.x, membrane);
    elasticGradient = Array.from(full); nonMembraneGradientMaximum = maximum(Array.from(full, (g, i) => g - membrane[i]));
    check(elasticGradient.every(finite) && nonMembraneGradientMaximum === 0, 'nonzero/nonfinite non-membrane gradient');
    if (targetValid) {
      inertiaGradient = Array.from(full, (_g, i) => masses[Math.floor(i / 3)] * idt2 * (w.x[i] - w.xt[i]));
      residual = elasticGradient.map((g, i) => g + inertiaGradient[i]);
      check(residual.every(finite), 'nonfinite final incremental residual');
    }
    const stats = w.stats();
    check(stats.energy.stretch === elasticEnergy && stats.energy.bend === 0 && stats.energy.crease === 0, 'actual current energy diagnostics contain bending/other work');
  } catch (cause) { errors.push(cause.message); }
  finally { w.kMem.set(stiffness); w.orthotropicMembrane = selected; w.thetaPred.set(thetaPred); w.hingeGrad.set(hingeGrad); }
  let kineticEnergy = 0, q = 0, qdot = 0, leakageSquared = 0;
  const displacement = [], velocityUV = [], momentum = [0, 0, 0], angularMomentum = [0, 0, 0], centerOfMass = [0, 0, 0];
  const totalMass = masses.reduce((a, b) => a + b, 0);
  for (let v = 0; v < n; v++) {
    const u = [w.x[3 * v] - patch.vertices[v][0], -w.x[3 * v + 2] - patch.vertices[v][1]], vel = [w.v[3 * v], -w.v[3 * v + 2]];
    displacement.push(u); velocityUV.push(vel);
    q += masses[v] * (phi[v][0] * u[0] + phi[v][1] * u[1]);
    qdot += masses[v] * (phi[v][0] * vel[0] + phi[v][1] * vel[1]);
    kineticEnergy += 0.5 * masses[v] * (w.v[3 * v] ** 2 + w.v[3 * v + 1] ** 2 + w.v[3 * v + 2] ** 2);
    for (let c = 0; c < 3; c++) { momentum[c] += masses[v] * w.v[3 * v + c]; centerOfMass[c] += masses[v] * w.x[3 * v + c] / totalMass; }
    angularMomentum[0] += masses[v] * (w.x[3 * v + 1] * w.v[3 * v + 2] - w.x[3 * v + 2] * w.v[3 * v + 1]);
    angularMomentum[1] += masses[v] * (w.x[3 * v + 2] * w.v[3 * v] - w.x[3 * v] * w.v[3 * v + 2]);
    angularMomentum[2] += masses[v] * (w.x[3 * v] * w.v[3 * v + 1] - w.x[3 * v + 1] * w.v[3 * v]);
  }
  q /= modalMass; qdot /= modalMass;
  for (let v = 0; v < n; v++) leakageSquared += masses[v] * ((displacement[v][0] - q * phi[v][0]) ** 2 + (displacement[v][1] - q * phi[v][1]) ** 2);
  const planarExact = raw.x.every((value, i) => i % 3 !== 1 || value === 0) && raw.v.every((value, i) => i % 3 !== 1 || value === 0) &&
    (!elasticGradient || elasticGradient.every((value, i) => i % 3 !== 1 || value === 0));
  check(planarExact, 'out-of-plane actual position/velocity/gradient');
  const residualInfinity = residual ? maximum(residual) : null;
  const residualMaximumNodal = residual ? Math.max(...masses.map((_m, v) => Math.hypot(...residual.slice(3 * v, 3 * v + 3)))) : null;
  const massDualResidualNorm = residual ? Math.sqrt(residual.reduce((sum, r, i) => sum + r * r / masses[Math.floor(i / 3)], 0)) : null;
  check(Object.entries(hashes).every(([key, hash]) => hash === bytesHash(w[key])), 'observation changed raw World state');
  return { step, initial, h, time: w.time, ...raw, rawSHA256: hashes, displacement, velocityUV,
    targetValid, targetScope: initial ? 'constructor xs/xt buffers retained raw; no inertial prediction exists before first actual substep' : targetValid ? 'actual World xs/xt, never supplied by oracle or benchmark' : 'no completed actual substep target; raw buffers retained as failure/censoring evidence',
    elasticEnergy, kineticEnergy, mechanicalEnergy: elasticEnergy === null ? null : elasticEnergy + kineticEnergy,
    rawImplicitEnergy, inertiaEnergy: targetValid ? inertiaEnergy : null, incrementalEnergy: targetValid ? rawImplicitEnergy : null,
    elasticGradient, inertiaGradient, residual, residualInfinity, residualMaximumNodal, massDualResidualNorm,
    forceScale, forceTolerance, absoluteForceTolerance: ATOL, relativeForceTolerance: RTOL,
    normalizedResidual: forceScale > 0 && residualInfinity !== null ? residualInfinity / forceScale : null,
    literalForceGate: initial ? null : targetValid && finite(residualInfinity) && residualInfinity <= forceTolerance,
    forceScaleConvention: 'FIXED abs(A)*omega^2*max_i(native lumped mass_i*Euclidean norm(phi_i)); no instantaneous-force or ULP acceptance scaling',
    nonMembraneEnergy, nonMembraneGradientMaximum, planarExact, metric,
    modalCoordinate: q, modalVelocity: qdot, modalMass, modalLeakageMassNorm: Math.sqrt(leakageSquared),
    initialLinearModalEnergyScale: 0.5 * modalMass * (amplitude * omega) ** 2,
    linearMomentum: momentum, angularMomentumAboutWorldOrigin: angularMomentum, centerOfMass,
    asleep: w.asleep, framesRun: w.framesRun, substepsRun: w.substepsRun, execution,
    solver: { newtonIterations: w.opts.newtonIterations, substeps: w.opts.substeps, previousPoseStart: w.opts.previousPoseStart,
      factorizations: w.factorCount, lastPublicPcgIterations: w.pcgIterations,
      lineSearchBacktracks: w.energySearch?.backtracks ?? 0, lineSearchRejected: w.energySearch?.rejected ?? 0,
      linearDirectionResiduals: null, acceptedAlphaHistory: null, perNewtonPcgHistory: null,
      missingDiagnostics: 'World exposes final PCG iteration count and cumulative factor/search counters only; no per-Newton direction residual, alpha or linear history observed',
      pcgMaxIterations: K.PCG_MAX_ITER, pcgRelativeTolerance: K.PCG_RTOL,
      ...(w.opts.lineSearchArithmetic === 'membrane-inertia-increment' ? {
        lineSearchArithmetic: w.opts.lineSearchArithmetic, increment: w.energySearch?.increment ? structuredClone(w.energySearch.increment) : null } : {}),
      ...(w.opts.membraneArithmetic === 'double-double' ? { membraneArithmetic: w.opts.membraneArithmetic,
        membraneArithmeticIdentity: structuredClone(w.orthotropicMembrane.configuration.arithmetic) } : {}) },
    measurementValid: errors.length === 0, errors };
}

/** Public step(h) once per observation. Callback receives copied data, never World.
 * Retention is explicit; all observations are still produced and callback-delivered.
 */
export function runModalRuntime(patch, { steps, retain = 'all', onObservation, ...parameters } = {}) {
  const context = createModalWorld(patch, parameters);
  return runModalContext(context, { steps, retain, onObservation });
}

/** The one shared actual stepping loop, also usable with a caller-owned live
 * context so an independent callback validator can inspect that current World.
 */
export function runModalContext(context, { steps, retain = 'all', onObservation } = {}) {
  demand(Number.isSafeInteger(steps) && steps >= 0, 'nonnegative integer step count required');
  demand(['all', 'initial-final'].includes(retain), 'unknown retention policy');
  demand(onObservation === undefined || typeof onObservation === 'function', 'onObservation must be a synchronous function');
  const w = context.world, observations = [];
  demand(w.substepsRun === 0 && w.framesRun === 0 && w.time === 0, 'runModalContext requires a newly initialized, unstepped World');
  let observedCount = 0, callbackCount = 0, last = null, initial = null, completedSteps = 0, status = 'completed', error = null;
  let allMeasurementValid = true, allLiteralForceGates = true, noSleep = true, countersExact = true;
  const consume = observation => {
    observedCount++; last = observation; allMeasurementValid &&= observation.measurementValid;
    if (!observation.initial) allLiteralForceGates &&= observation.literalForceGate === true;
    noSleep &&= !observation.asleep;
    if (retain === 'all' || observation.initial) observations.push(observation);
    if (onObservation) { const result = onObservation(structuredClone(observation)); demand(!result || typeof result.then !== 'function', 'asynchronous observation callback unsupported'); callbackCount++; }
  };
  initial = observeModalWorld(context, { initial: true, step: 0 }); consume(initial);
  for (let step = 1; step <= steps; step++) {
    const before = { x: w.x.slice(), v: w.v.slice(), time: w.time, frames: w.framesRun, substeps: w.substepsRun };
    let returned = null, exception = null;
    try { returned = w.step(w.dt); }
    catch (cause) { exception = { name: cause.name, message: cause.message }; status = 'world-step-exception'; error = exception; }
    const actualSubstepExecuted = w.substepsRun === before.substeps + 1;
    if (actualSubstepExecuted) completedSteps++;
    const execution = { returnedSubsteps: returned, actualSubstepExecuted, framesAdvancedExactlyOne: w.framesRun === before.frames + 1,
      accumulatedTimeExact: w.time === before.time + w.dt, xsMatchesPreviousX: w.xs.every((value, i) => value === before.x[i]),
      xtMatchesActualPredictor: w.xt.every((value, i) => value === before.x[i] + (w.dt * before.v[i] + w.dt * w.dt * w.invMass[Math.floor(i / 3)] * w.fext[i])),
      velocityMatchesActualDifference: w.v.every((value, i) => value === (w.x[i] - w.xs[i]) / w.dt), exception };
    countersExact &&= returned === 1 && actualSubstepExecuted && execution.framesAdvancedExactlyOne && execution.accumulatedTimeExact;
    const observation = observeModalWorld(context, { step, initial: false, execution }); consume(observation);
    if (exception) break;
    if (w.asleep) { status = 'sleep-censored'; break; }
    if (!observation.measurementValid) { status = 'invalid-observation'; break; }
  }
  if (retain === 'initial-final' && last !== initial) observations.push(last);
  return { schema: 'pliego-membrane-modal-runtime/0.1', status, error, parameters: { ...context.parameters, phi: context.phi, steps, retain },
    options: context.options, h: w.dt, initial, final: last, observations, observedCount, retainedCount: observations.length, callbackCount,
    requestedSteps: steps, completedSteps, actualTime: w.time, requestedHorizon: steps * w.dt,
    retentionPolicy: retain === 'all' ? 'all initial and post-public-substep observations retained' : 'initial and final observed states only; every intermediate observation still evaluated and callback-delivered; no silent truncation',
    massProof: context.massProof, fixedInitialForceScale: context.forceScale, forceTolerance: context.forceTolerance,
    modalMass: context.modalMass, maximumModeNorm: context.maximumModeNorm,
    sleepPolicy: { speedMmPerSecond: K.SLEEP_SPEED, consecutivePublicCalls: K.SLEEP_FRAMES, override: 'none; sleep censors this experiment' },
    gates: { measurementValid: allMeasurementValid, noSleep, exactActualSubstepCounters: countersExact,
      completeRequestedSteps: completedSteps === steps, literalFinalForceEverySubstep: allLiteralForceGates,
      perNewtonLinearDiagnostics: 'not exposed; not measured', discreteIntegratorAccuracy: 'separate oracle required',
      continuousTimeAccuracy: 'separate oracle required', physicalStockCalibration: 'not measured' },
    scope: 'actual public World stepping only; initial position/zero velocity set once, no oracle prediction, hidden Newton repetition, material/mass rescaling or sleep override; literal force gate failures retained' };
}
