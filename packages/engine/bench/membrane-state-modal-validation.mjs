// Independent acceptance of the displacement-authoritative benchmark contract.
// A native force check is not material calibration or an exact-arithmetic proof.
import { createHash } from 'node:crypto';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { REFERENCE_STATE_IDENTITY, validateReferenceState } from '../src/xpbd/reference-state.js';
import * as K from '../src/constants.js';
import { DOUBLE_DOUBLE_IDENTITY } from '../src/xpbd/double-double.js';
import { UV_REFERENCE_IDENTITY } from '../src/xpbd/uv-reference.js';

const MODE = 'reference-displacement', ABS = 'absolute-position', ATOL = 1e-7, RTOL = 1e-10;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const array = x => Array.isArray(x) || ArrayBuffer.isView(x) && !(x instanceof DataView);
const vector = (x, n) => array(x) && x.length === n && Array.from(x).every(finite);
const sameNumeric = (a, b) => array(a) && array(b) && a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
const same = (a, b) => array(a) && array(b) && a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]));
const zero = a => array(a) && Array.from(a).every(x => x === 0);
const maximum = a => Math.max(0, ...Array.from(a, Math.abs));
const hash = b => createHash('sha256').update(b).digest('hex');
const ownKeys = (o, keys) => o && typeof o === 'object' && Object.keys(o).sort().join() === [...keys].sort().join();
const equalObject = (value, expected) => ownKeys(value, Object.keys(expected)) && Object.entries(expected).every(([k, v]) => Object.is(value[k], v));
const equalIdentity = value => equalObject(value, REFERENCE_STATE_IDENTITY);
const names = ['x', 'xs', 'xt', 'v', 'u', 'us', 'ut', 'x0', 'mass', 'h', 'initialX', 'initialU', 'initialV', 'reference'];
const forceNames = ['public', 'authoritative'].flatMap(prefix => ['ElasticGradient', 'InertiaGradient', 'Residual'].map(key => prefix + key));
const authorityHashes = ['u', 'us', 'ut', 'v', 'x0', 'initialX', 'initialU', 'initialV'];

function sourceFields(o, context) {
  const a = o.authoritative;
  return { x: o.x, xs: o.xs, xt: o.xt, v: o.v, u: a?.u, us: a?.us, ut: a?.ut, x0: a?.x0,
    mass: o.mass ?? context.masses, h: [o.h], initialX: a?.initialX, initialU: a?.initialU,
    initialV: a?.initialV, reference: context.referenceWords };
}

function decode(o, context, n, check) {
  const result = {}, fields = sourceFields(o, context), count = context.patch?.triangles?.length;
  check(ownKeys(o.stateFloat64LE, names) && ownKeys(o.stateSHA256, names), 'lossless state binding keys differ');
  for (const key of names) {
    const length = key === 'mass' ? n : key === 'h' ? 1 : key === 'reference' ? 22 * count : 3 * n;
    const values = fields[key], encoded = o.stateFloat64LE?.[key];
    check(vector(values, length), 'invalid finite state field: ' + key);
    if (!vector(values, length) || typeof encoded !== 'string') { check(false, 'missing lossless field: ' + key); continue; }
    const raw = Buffer.from(encoded, 'base64');
    check(raw.toString('base64') === encoded && raw.length === 8 * length, 'invalid canonical LE encoding: ' + key);
    check(o.stateSHA256?.[key] === hash(raw), 'lossless SHA mismatch: ' + key);
    if (raw.length !== 8 * length) continue;
    const words = Array.from({ length }, (_, i) => raw.readDoubleLE(8 * i));
    // JSON numbers may lose -0. Signed native words come only from bound LE.
    check(words.every((v, i) => finite(v) && v === values[i]), 'numeric view differs from bound state: ' + key);
    result[key] = words;
  }
  check(ownKeys(o.rawSHA256, ['x', 'xs', 'xt', 'v']), 'public raw hash keys differ');
  for (const key of ['x', 'xs', 'xt', 'v']) check(o.rawSHA256?.[key] === o.stateSHA256?.[key], 'public raw hash mismatch: ' + key);
  check(ownKeys(o.authoritative?.rawSHA256, authorityHashes), 'authoritative raw hash keys differ');
  for (const key of authorityHashes) check(o.authoritative?.rawSHA256?.[key] === o.stateSHA256?.[key], 'authoritative raw hash mismatch: ' + key);
  return result;
}

function decodeForces(o, size, check) {
  check(ownKeys(o.forceFloat64LE, forceNames) && ownKeys(o.forceSHA256, forceNames), 'raw force binding keys differ');
  check(typeof o.forceBindingScope === 'string' && o.forceBindingScope.length > 0, 'raw force binding scope missing');
  const result = {};
  for (const key of forceNames) {
    const encoded = o.forceFloat64LE?.[key];
    if (typeof encoded !== 'string') { check(false, 'raw force encoding missing: ' + key); continue; }
    const raw = Buffer.from(encoded, 'base64');
    check(raw.toString('base64') === encoded && raw.length === 8 * size && hash(raw) === o.forceSHA256?.[key], 'raw force LE/SHA mismatch: ' + key);
    if (raw.length !== 8 * size) continue;
    result[key] = Array.from({ length: size }, (_, i) => raw.readDoubleLE(8 * i));
    check(result[key].every(finite), 'nonfinite bound force words: ' + key);
  }
  return result;
}

function energyOfDifference(x, target, mass, idt2) {
  let energy = 0;
  for (let v = 0; v < mass.length; v++) for (let c = 0; c < 3; c++) energy += .5 * mass[v] * idt2 * (x[3 * v + c] - target[3 * v + c]) ** 2;
  return energy;
}

function kinetic(v, mass) {
  let energy = 0;
  for (let i = 0; i < mass.length; i++) energy += .5 * mass[i] * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
  return energy;
}

function scratchCopy(w) {
  const shadow = Object.create(w);
  for (const key of ['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK']) shadow[key] = w[key].slice();
  const model = Object.create(w.orthotropicMembrane);
  model.work = structuredClone(w.orthotropicMembrane.work); model.block = w.orthotropicMembrane.block.slice();
  shadow.orthotropicMembrane = model;
  return shadow;
}

function references(w) {
  return w.orthotropicMembrane.elements.flatMap(e => [...e.reference.u, ...e.reference.v, ...e.reference.x0, e.reference.c, e.reference.s, ...e.Q, e.volume]);
}

function modalFields(context, displacement, velocity, reported, check, prefix) {
  const { masses, phi } = context, n = masses.length;
  let modalMass = 0, q = 0, qdot = 0;
  const uv = [], velocityUV = [];
  for (let i = 0; i < n; i++) {
    const u = [displacement[3 * i], -displacement[3 * i + 2]], v = [velocity[3 * i], -velocity[3 * i + 2]];
    uv.push(u); velocityUV.push(v);
    modalMass += masses[i] * (phi[i][0] ** 2 + phi[i][1] ** 2);
    q += masses[i] * (phi[i][0] * u[0] + phi[i][1] * u[1]);
    qdot += masses[i] * (phi[i][0] * v[0] + phi[i][1] * v[1]);
  }
  q /= modalMass; qdot /= modalMass;
  let leakage = 0;
  for (let i = 0; i < n; i++) leakage += masses[i] * ((uv[i][0] - q * phi[i][0]) ** 2 + (uv[i][1] - q * phi[i][1]) ** 2);
  check(Array.isArray(reported.displacement) && reported.displacement.length === n && reported.displacement.every((p, i) => sameNumeric(p, uv[i])), prefix + ' displacement reduction differs');
  check(Array.isArray(reported.velocityUV) && reported.velocityUV.length === n && reported.velocityUV.every((p, i) => sameNumeric(p, velocityUV[i])), prefix + ' velocity reduction differs');
  check(Object.is(reported.modalCoordinate, q) && Object.is(reported.modalVelocity, qdot) && Object.is(reported.modalLeakageMassNorm, Math.sqrt(leakage)), prefix + ' modal reduction differs');
  if (reported.modalMass !== undefined) check(Object.is(reported.modalMass, modalMass), prefix + ' modal mass differs');
  return modalMass;
}

/** Offline mode verifies reported algebra only and cannot certify live physics.
 * The optional World path independently recomputes both native force equations
 * using detached scratch. Precision/material/time truth requires separate oracles.
 */
export function validateStateObservation(observation, { context, previous = null, world = null } = {}) {
  const errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
  let actualGradientChecked = false, losslessBindingsVerified = false, forceBindingsVerified = false, completed = false;
  let computedPublicConverged = null, computedAuthoritativeConverged = null;
  const finish = () => ({ valid: errors.length === 0, errors, liveWorldChecked: !!world, actualGradientChecked,
    losslessBindingsVerified, forceBindingsVerified, boundaryCertified: errors.length === 0 && !!world && completed && actualGradientChecked,
    computedPublicConverged, computedAuthoritativeConverged,
    publicConverged: errors.length === 0 && !!world && completed && actualGradientChecked && computedPublicConverged === true,
    authoritativeConverged: errors.length === 0 && !!world && completed && actualGradientChecked && computedAuthoritativeConverged === true,
    converged: errors.length === 0 && !!world && completed && actualGradientChecked && computedPublicConverged === true,
    scope: 'native equation and state ABI verification; offline algebra cannot certify actual physics, material calibration or time accuracy' });
  try {
    const o = observation, a = o?.authoritative, vertices = context?.patch?.vertices ?? context?.vertices;
    const n = vertices?.length ?? 0, masses = context?.masses, phi = context?.phi, opts = context?.options;
    check(n > 0 && Array.isArray(vertices) && vertices.every(p => vector(p, 2)), 'invalid reference vertices');
    check(vector(masses, n) && masses.every(m => m > 0), 'invalid native masses');
    check(Array.isArray(phi) && phi.length === n && phi.every(p => vector(p, 2)), 'invalid modal field');
    check(context?.stateCoordinates === MODE && opts?.stateCoordinates === MODE, 'wrong context state coordinates');
    check(integer(opts?.substeps) && opts.substeps > 0 && integer(opts?.newtonIterations) && opts.newtonIterations > 0 && typeof opts.previousPoseStart === 'boolean', 'invalid solver options');
    check(finite(context?.omega) && context.omega > 0 && finite(context?.amplitude) && context.amplitude >= 0, 'invalid fixed modal parameters');
    check(o?.schema === 'pliego-membrane-state-modal-observation/1' && a && equalIdentity(a.identity), 'missing or changed authoritative identity/schema');
    for (const [key, value] of Object.entries({ membraneModel: 'orthotropic-stvk', membranePoissonConvention: 'nu12',
      membraneCurvature: 'gauss-newton', membraneProjection: 'none', membraneArithmetic: 'double-double', membraneReference: 'uv-displacement',
      lineSearchArithmetic: 'membrane-inertia-increment', lineSearch: true, physicalMembrane: true, membraneCompression: 1,
      damping: 0, bendDamping: 0, gravity: false, ground: false, contact: false, plasticity: false })) check(Object.is(opts?.[key], value), 'controlled option changed: ' + key);
    if (world) check(world instanceof World, 'actual engine World required for live certification');
    if (errors.length) return finish();
    const size = 3 * n, h = 1 / (60 * opts.substeps), idt2 = 1 / (h * h), state = decode(o, context, n, check);
    if (Object.keys(state).length !== names.length || errors.length) return finish();
    losslessBindingsVerified = true;
    const forceWords = decodeForces(o, size, check);
    if (Object.keys(forceWords).length !== forceNames.length || errors.length) return finish();
    forceBindingsVerified = true;
    check(Object.is(o.h, h) && Object.is(state.h[0], h) && finite(idt2), 'native timestep differs');
    check(same(state.mass, masses), 'bound native masses differ from context');
    const triangles = context.patch?.triangles, density = context.patch?.world?.materials?.[0]?.rhoA;
    const independentMass = Array(n).fill(0), consumed = new Set();
    check(Array.isArray(triangles) && finite(density) && density > 0, 'independent authored-area mass inputs unavailable');
    if (Array.isArray(triangles) && finite(density)) for (const tri of triangles) {
      check(vector(tri, 3) && tri.every(v => integer(v) && v < n), 'invalid authored triangle');
      if (!vector(tri, 3) || tri.some(v => !integer(v) || v >= n)) continue;
      const [p, q, r] = tri.map(i => vertices[i]);
      const area = Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
      check(finite(area) && area > 0, 'invalid authored reference area');
      for (const i of tri) { independentMass[i] += area * density / 3; consumed.add(i); }
    }
    const massScale = Math.max(...masses);
    check(consumed.size === n && masses.every((m, i) => Math.abs(m - independentMass[i]) / massScale <= 1e-12), 'independent authored-area lumped mass mismatch');
    if (context.referenceMass !== undefined) check(vector(context.referenceMass, n) && masses.every((m, i) => Math.abs(m - context.referenceMass[i]) / massScale <= 1e-12), 'independent oracle masses differ');
    for (const key of ['mass', 'h', 'reference', 'x0', 'initialX', 'initialU', 'initialV']) check(context.initialBinding?.stateSHA256?.[key] === o.stateSHA256[key], 'initial immutable binding changed: ' + key);
    check(sameNumeric(state.reference, context.referenceWords), 'bound represented reference differs from context');
    const forceScale = context.amplitude * context.omega ** 2 * Math.max(...masses.map((m, i) => m * Math.hypot(...phi[i])));
    const tolerance = Math.max(ATOL, RTOL * forceScale);
    check(Math.abs(Math.max(...phi.map(p => Math.hypot(...p))) - 1) <= 1e-12, 'mode normalization changed');
    check(Object.is(context.forceScale, forceScale) && Object.is(context.forceTolerance, tolerance) && Object.is(o.forceScale, forceScale) && Object.is(o.forceTolerance, tolerance), 'fixed force scale/tolerance changed');
    check(o.absoluteForceTolerance === ATOL && o.relativeForceTolerance === RTOL, 'literal force policy changed');
    check(integer(o.step) && typeof o.initial === 'boolean' && o.initial === (o.step === 0), 'invalid step/initial identity');
    check(integer(o.framesRun) && integer(o.substepsRun) && finite(o.time) && o.time >= 0, 'invalid clock/counters');
    check(o.framesRun === o.step && o.substepsRun === o.step, 'step identity differs from one-substep public counters');
    check(typeof o.targetValid === 'boolean' && a.targetValid === o.targetValid, 'target validity mismatch');
    check(o.measurementValid === true && Array.isArray(o.errors) && o.errors.length === 0, 'producer measurement invalid');
    check(o.asleep === false, 'sleep censors measurement');
    const planar = ['x', 'xs', 'xt', 'v', 'u', 'us', 'ut', 'x0', 'initialX', 'initialU', 'initialV'];
    for (const key of planar) check(state[key].every((x, i) => i % 3 !== 1 || x === 0), 'nonzero planar Y: ' + key);
    check(sameNumeric(state.v, a.v), 'authoritative and public actual velocity differ');
    for (const [view, authority] of [['x', 'u'], ['xs', 'us'], ['xt', 'ut']]) check(state[view].every((v, i) => Object.is(v, state.x0[i] + state[authority][i])), 'public projection mismatch: ' + view);
    for (let i = 0; i < size; i++) {
      const x = state.initialX[i], x0 = state.x0[i], sum = x + -x0, virtual = sum - x;
      const low = (x - (sum - virtual)) + (-x0 - virtual);
      const expected = Object.is(x, -0) && Object.is(x0, -0) ? -0 : sum;
      check(low === 0 && Object.is(state.initialU[i], expected) && Object.is(x0 + state.initialU[i], x), 'inexact/changed actual initial conversion');
    }
    check(zero(state.initialV), 'changed actual zero initial velocity');
    check(state.initialX.every((x, i) => { const v = Math.floor(i / 3); return Object.is(x, i % 3 === 0 ? vertices[v][0] + context.amplitude * phi[v][0] : i % 3 === 1 ? 0 : -(vertices[v][1] + context.amplitude * phi[v][1])); }), 'actual baseline initial x changed');
    if (o.initial) {
      for (const key of names) check(context.initialBinding?.stateSHA256?.[key] === o.stateSHA256[key], 'initial native binding changed: ' + key);
      check(o.time === 0 && o.framesRun === 0 && o.substepsRun === 0 && o.execution === null && zero(state.v), 'initial clock/velocity/execution changed');
      check(!o.targetValid && same(state.x, state.initialX) && same(state.u, state.initialU) && zero(state.xs) && zero(state.xt), 'initial buffers falsely made into predictors');
    } else {
      const e = o.execution, p = previous;
      completed = !!e && e.returnedSubsteps === 1 && e.actualSubstepExecuted === true && e.framesAdvancedExactlyOne === true && e.accumulatedTimeExact === true && e.exception === null && o.asleep === false;
      check(completed && o.targetValid, 'no completed current public substep target');
      check(p && p.step === o.step - 1 && p.authoritative, 'previous actual authority observation required');
      if (p?.authoritative) {
        check(integer(p.step) && p.initial === (p.step === 0) && p.framesRun === p.step && p.substepsRun === p.step && Object.is(p.h, h) && finite(p.time) && (p.step === 0 ? p.time === 0 : p.time > 0), 'previous step/initial/clock/counter identity differs');
        const prior = decode(p, context, n, check);
        if (Object.keys(prior).length === names.length) {
          check(Object.is(o.time, p.time + h) && o.framesRun === p.framesRun + 1 && o.substepsRun === p.substepsRun + 1, 'actual clock/counter increment mismatch');
          check(same(state.us, prior.u) && same(state.xs, prior.x), 'predecessor authority/public start mismatch');
          check(state.ut.every((v, i) => Object.is(v, prior.u[i] + h * prior.v[i])), 'displacement predictor differs');
          check(state.v.every((v, i) => Object.is(v, (state.u[i] - state.us[i]) / h)), 'displacement velocity differs');
          if (e) {
            for (const key of ['usMatchesPreviousU', 'utMatchesActualDisplacementPredictor', 'velocityMatchesActualDisplacementDifference', 'xProjectionMatchesAuthority', 'xsProjectionMatchesAuthority', 'xtProjectionMatchesAuthority']) check(e[key] === true, 'execution proof differs: ' + key);
            if (e.xsMatchesPreviousX !== undefined) check(e.xsMatchesPreviousX === same(state.xs, prior.x), 'public start diagnostic is false');
            if (e.xtMatchesActualPredictor !== undefined) check(e.xtMatchesActualPredictor === state.xt.every((v, i) => Object.is(v, prior.x[i] + (h * prior.v[i] + 0))), 'old public predictor diagnostic differs');
            if (e.velocityMatchesActualDifference !== undefined) check(e.velocityMatchesActualDifference === state.v.every((v, i) => Object.is(v, (state.x[i] - state.xs[i]) / h)), 'old public velocity diagnostic differs');
          }
        }
      }
    }
    check(o.solver?.substeps === opts.substeps && o.solver?.newtonIterations === opts.newtonIterations && o.solver?.previousPoseStart === opts.previousPoseStart, 'reported solver configuration changed');
    check(o.solver?.stateCoordinates === MODE && equalIdentity(o.solver?.stateIdentity) && o.solver?.lineSearchArithmetic === 'membrane-inertia-increment' && o.solver?.membraneArithmetic === 'double-double' && o.solver?.membraneReference === 'uv-displacement' && equalObject(o.solver?.membraneArithmeticIdentity, DOUBLE_DOUBLE_IDENTITY) && equalObject(o.solver?.membraneReferenceIdentity, UV_REFERENCE_IDENTITY), 'reported state/model/arithmetic identity differs');
    check(o.solver?.pcgMaxIterations === K.PCG_MAX_ITER && o.solver?.pcgRelativeTolerance === K.PCG_RTOL, 'native PCG policy changed');
    for (const key of ['factorizations', 'lastPublicPcgIterations', 'lineSearchBacktracks', 'lineSearchRejected']) check(integer(o.solver?.[key]), 'invalid solver counter: ' + key);
    const physics = {};
    for (const [label, reported, point, target] of [['public', o, state.x, state.xt], ['authoritative', a, state.u, state.ut]]) {
      check(vector(reported.elasticGradient, size) && reported.elasticGradient.every((v, i) => i % 3 !== 1 || v === 0), label + ' invalid elastic gradient');
      check(finite(reported.elasticEnergy) && reported.elasticEnergy >= 0, label + ' invalid elastic energy');
      if (!vector(reported.elasticGradient, size)) continue;
      const nativeGradient = forceWords[label + 'ElasticGradient'];
      check(sameNumeric(reported.elasticGradient, nativeGradient), label + ' elastic gradient differs from raw force binding');
      const inertia = point.map((x, i) => masses[Math.floor(i / 3)] * idt2 * (x - target[i]));
      const residual = nativeGradient.map((g, i) => g + inertia[i]);
      check(same(forceWords[label + 'InertiaGradient'], inertia) && same(forceWords[label + 'Residual'], residual), label + ' raw native force association differs');
      const rawInertiaEnergy = energyOfDifference(point, target, masses, idt2);
      check(finite(reported.rawInertiaEnergy) && Object.is(reported.rawInertiaEnergy, rawInertiaEnergy) && Object.is(reported.rawImplicitEnergy, rawInertiaEnergy + reported.elasticEnergy), label + ' raw objective/inertia differs');
      const residualInfinity = maximum(residual), gate = label === 'public' ? 'literalForceGate' : 'converged';
      if (o.initial || !completed) {
        for (const key of ['inertiaGradient', 'residual', 'residualInfinity', 'inertiaEnergy', 'incrementalEnergy', gate]) check(reported[key] === null, label + ' invalid-target quantity falsely certified: ' + key);
      } else {
        check(vector(reported.inertiaGradient, size) && vector(reported.residual, size) && finite(reported.residualInfinity) && residual.every(finite), label + ' nonfinite native force field');
        check(finite(reported.inertiaEnergy) && reported.inertiaEnergy >= 0 && finite(reported.incrementalEnergy), label + ' invalid incremental energy');
        check(sameNumeric(reported.inertiaGradient, inertia) && sameNumeric(reported.residual, residual) && Object.is(reported.residualInfinity, residualInfinity), label + ' native inertia/residual differs');
        check(typeof reported[gate] === 'boolean' && reported[gate] === (residualInfinity <= tolerance), label + ' force gate differs');
        check(Object.is(reported.inertiaEnergy, energyOfDifference(point, target, masses, idt2)) && Object.is(reported.incrementalEnergy, reported.inertiaEnergy + reported.elasticEnergy), label + ' incremental energy differs');
        if (label === 'public') computedPublicConverged = residualInfinity <= tolerance; else computedAuthoritativeConverged = residualInfinity <= tolerance;
      }
      check(reported.metric?.finite === true && reported.metric.invalidTriangles === 0 && reported.metric.minimumStretch > 0 && reported.metric.minimumAreaRatio > 0, label + ' invalid/missing metric diagnostics');
      check(Object.is(reported.kineticEnergy, kinetic(state.v, masses)) && Object.is(reported.mechanicalEnergy, reported.elasticEnergy + reported.kineticEnergy), label + ' kinetic/mechanical energy differs');
      physics[label] = { point, target, reported };
    }
    if (completed) check(Object.is(o.rawImplicitEnergy, o.incrementalEnergy) && Object.is(a.rawImplicitEnergy, a.incrementalEnergy), 'completed raw and certified objective differ');
    const normalized = o.initial || !completed || forceScale === 0 ? null : o.residualInfinity / forceScale;
    check(Object.is(o.normalizedResidual, normalized), 'public fixed-scale normalized residual differs');
    const publicDisplacement = state.x.map((x, i) => x - state.x0[i]);
    const modalMass = modalFields(context, publicDisplacement, state.v, o, check, 'public');
    modalFields(context, state.u, state.v, a, check, 'authoritative');
    check(Object.is(context.modalMass, modalMass), 'context modal mass differs');
    check(o.planarExact === true && o.nonMembraneEnergy === 0 && o.nonMembraneGradientMaximum === 0, 'public omitted-work/planarity proof differs');
    check(a.planarExact === true && a.nonMembraneEnergy === 0 && a.nonMembraneGradientMaximum === 0, 'authoritative omitted-work/planarity proof differs');
    if (world) {
      validateReferenceState(world);
      const live = world.authoritativeState();
      check(live && equalIdentity(live.identity), 'actual World state identity differs');
      for (const key of ['u', 'us', 'ut', 'v', 'x0', 'initialX', 'initialU', 'initialV']) check(same(state[key], live[key]), 'bound field differs from live World: ' + key);
      for (const key of ['x', 'xs', 'xt', 'v']) check(same(state[key], world[key]), 'public field differs from live World: ' + key);
      check(same(state.mass, world.mass) && world.invMass.every((v, i) => Object.is(v, 1 / masses[i])), 'live native/inverse mass differs');
      check(same(state.reference, references(world)), 'live represented reference differs');
      check(Object.is(world.dt, h) && Object.is(world.time, o.time) && world.framesRun === o.framesRun && world.substepsRun === o.substepsRun && world.asleep === false, 'live clock/counter/sleep differs');
      for (const key of ['newtonIterations', 'previousPoseStart', 'substeps']) check(Object.is(world.opts[key], opts[key]) && Object.is(world.opts[key], o.solver?.[key]), 'live solver configuration differs: ' + key);
      check(Object.is(world.dt, 1 / (60 * world.opts.substeps)), 'live timestep/substeps association differs');
      check(world.opts.stateCoordinates === MODE && world.opts.membraneArithmetic === 'double-double' && world.opts.membraneReference === 'uv-displacement' && world.opts.lineSearchArithmetic === 'membrane-inertia-increment', 'live arithmetic/state mode differs');
      for (const [key, value] of Object.entries({ factorizations: world.factorCount, lastPublicPcgIterations: world.pcgIterations, lineSearchBacktracks: world.energySearch.backtracks, lineSearchRejected: world.energySearch.rejected })) check(o.solver?.[key] === value, 'counter differs from live World: ' + key);
      const shadow = scratchCopy(world), selected = shadow.orthotropicMembrane;
      for (const [label, coordinates] of [['public', ABS], ['authoritative', MODE]]) {
        const { point, reported } = physics[label] ?? {};
        if (!point) continue;
        const full = new Float64Array(size), membrane = new Float64Array(size);
        gradient(shadow, Float64Array.from(point), full, coordinates); selected.addGradient(point, membrane, coordinates);
        check(same(forceWords[label + 'ElasticGradient'], full) && maximum(full.map((v, i) => v - membrane[i])) === 0, label + ' differs from actual selected/full gradient');
        check(Object.is(reported.elasticEnergy, selected.energy(point, coordinates)), label + ' differs from actual selected energy');
        check(Object.is(reported.rawImplicitEnergy, implicitEnergy(shadow, Float64Array.from(point), coordinates)), label + ' differs from actual raw full objective');
        const metric = selected.diagnostics(point, coordinates);
        check(reported.metric && ownKeys(reported.metric, Object.keys(metric)) && Object.keys(metric).every(k => Object.is(reported.metric[k], metric[k])) && metric.finite, label + ' differs from actual metric');
      }
      actualGradientChecked = true;
    }
  } catch (cause) { errors.push('state validation failed: ' + cause.message); }
  return finish();
}
