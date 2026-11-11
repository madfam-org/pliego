// Independent acceptance of the displacement-authoritative benchmark contract with panel bending.
// Port of membrane-state-modal-validation.mjs: the same lossless state/force bindings, execution,
// clock, predictor and native-force equations. What differs: the state identity carries the bending
// identity, out-of-plane state is admitted (no planarity), the bindings add hingeK and restTheta, the
// elastic energy/gradient are membrane + bending, the planar "omitted work is exactly zero" proof is
// replaced by omittedWork records bounded by summation order, and the modal reduction projects the
// out-of-plane field onto the independent bending mode.
//
// Independence (what this file recomputes versus what it asks the engine):
//   independent here: lossless LE decoding and SHA-256 of every bound word; authored-area lumped masses;
//     the fixed force scale/tolerance and named PCG stop; the initial A*phi field and its exact conversion;
//     predictor, velocity, clock and counters; inertia gradients, residuals, gates and every energy sum;
//     the bending modal reductions; the omitted-work bounds; hinge topology from the authored triangles;
//     and (live) the panel-bending angle, energy and gradient from plain binary64 geometry
//     (Bridson–Marino–Fedkiw 2003 §4 closed form, written here; it does not call dihedral.js).
//   engine calls (live only, on detached scratch): validateReferenceState, the membrane model's
//     addGradient/energy/diagnostics, implicit.js gradient (search gradient), energy-search implicitEnergy
//     (search objective) and reference-bending addBendingGradient (the residual's own bending sum, used
//     for bitwise association; the independent recomputation above is what certifies its physics).
// A native force check is not material calibration, plate theory or an exact-arithmetic proof.
import { createHash } from 'node:crypto';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { REFERENCE_STATE_IDENTITY, validateReferenceState } from '../src/xpbd/reference-state.js';
import { REFERENCE_BENDING_IDENTITY, addBendingGradient } from '../src/xpbd/reference-bending.js';
import * as K from '../src/constants.js';
import { DOUBLE_DOUBLE_IDENTITY } from '../src/xpbd/double-double.js';
import { UV_REFERENCE_IDENTITY } from '../src/xpbd/uv-reference.js';
import { EXACT_CURVATURE_IDENTITY } from '../src/xpbd/membrane-curvature.js';

const MODE = 'reference-displacement', ABS = 'absolute-position', ATOL = 1e-7, RTOL = 1e-10;
// Literal policies, restated here rather than imported from the producer.
const OMITTED_ULPS = 64; // search objective vs residual sum bending in different orders
const PCG_STOPS = Object.freeze({ 'half-force-tolerance': .5 });
// Independent bending uses plain binary64 differences (two roundings instead of the engine's exact
// difference rounded once) and an unnormalised atan2. Measured on the level-1/2 rows: <= 8e-16 of the
// summed gradient/energy magnitudes and < 1 ulp of angle; the bounds keep >1000x margin and stay far
// below any physical bending term.
const BENDING_RTOL = 1e-12, ANGLE_ULPS = 16;
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
// Independent canonical comparison: the planar identity's own keys plus a nested bending identity.
const equalIdentity = value => ownKeys(value, [...Object.keys(REFERENCE_STATE_IDENTITY), 'bending']) &&
  Object.entries(REFERENCE_STATE_IDENTITY).every(([k, v]) => Object.is(value[k], v)) && equalObject(value.bending, REFERENCE_BENDING_IDENTITY);
const names = ['x', 'xs', 'xt', 'v', 'u', 'us', 'ut', 'x0', 'mass', 'h', 'initialX', 'initialU', 'initialV', 'reference', 'hingeK', 'restTheta', 'theta'];
const immutable = ['mass', 'h', 'reference', 'x0', 'initialX', 'initialU', 'initialV', 'hingeK', 'restTheta'];
const forceNames = ['public', 'authoritative'].flatMap(prefix => ['ElasticGradient', 'InertiaGradient', 'Residual'].map(key => prefix + key));
const authorityHashes = ['u', 'us', 'ut', 'v', 'x0', 'initialX', 'initialU', 'initialV'];
const omittedKeys = ['energyDifference', 'energyBound', 'gradientDifference', 'gradientBound'];

/** Interior edges of the authored triangulation: each is one panel hinge with two opposite wings. */
function authoredHinges(triangles, n) {
  const edges = new Map();
  for (const tri of triangles) for (let k = 0; k < 3; k++) {
    const a = tri[k], b = tri[(k + 1) % 3], key = Math.min(a, b) * n + Math.max(a, b);
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push(tri[(k + 2) % 3]);
  }
  return new Map([...edges].filter(([, wings]) => wings.length === 2));
}

function sourceFields(o, context, nH) {
  const a = o.authoritative;
  return { x: o.x, xs: o.xs, xt: o.xt, v: o.v, u: a?.u, us: a?.us, ut: a?.ut, x0: a?.x0,
    mass: o.mass ?? context.masses, h: [o.h], initialX: a?.initialX, initialU: a?.initialU,
    initialV: a?.initialV, reference: context.referenceWords, hingeK: context.hingeKWords, restTheta: Array(nH).fill(0), theta: a?.hingeAngles };
}

function decode(o, context, n, nH, check) {
  const result = {}, fields = sourceFields(o, context, nH), count = context.patch?.triangles?.length;
  check(ownKeys(o.stateFloat64LE, names) && ownKeys(o.stateSHA256, names), 'lossless state binding keys differ');
  for (const key of names) {
    const length = key === 'mass' ? n : key === 'h' ? 1 : key === 'reference' ? 22 * count : ['hingeK', 'restTheta', 'theta'].includes(key) ? nH : 3 * n;
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
    if (key === 'restTheta') check(words.every(t => t === 0), 'nonzero rest angle: panel hinges are flat at rest');
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
  for (const key of ['theta', 'thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK']) shadow[key] = w[key].slice();
  const model = Object.create(w.orthotropicMembrane);
  model.work = structuredClone(w.orthotropicMembrane.work); model.block = w.orthotropicMembrane.block.slice();
  shadow.orthotropicMembrane = model;
  return shadow;
}

function references(w) {
  return w.orthotropicMembrane.elements.flatMap(e => [...e.reference.u, ...e.reference.v, ...e.reference.x0, e.reference.c, e.reference.s, ...e.Q, e.volume]);
}

const unwrap = (memory, raw) => { let d = raw - memory; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); return memory + d; };
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Independent signed dihedral (valley positive) of hinge (p0, p1 | w0, w1) and its 12-gradient.
 * `at(i, a)` is vertex i relative to vertex a. Bridson–Marino–Fedkiw 2003 §4: ∂θ/∂w = |e| N/|N|²;
 * the edge-vertex terms follow from the wing projections and translation invariance. */
function independentAngle(H, h, at) {
  const p0 = H[4 * h], p1 = H[4 * h + 1], w0 = H[4 * h + 2], w1 = H[4 * h + 3];
  const e = at(p1, p0), a0 = at(w0, p0), b1 = at(w1, p0), a1 = sub3(b1, e);
  const N0 = cross3(e, a0), N1 = cross3(a1, e), L = Math.sqrt(dot3(e, e));
  const theta = Math.atan2(dot3(cross3(N1, N0), e) / L, dot3(N0, N1));
  const g0 = N0.map(c => L * c / dot3(N0, N0)), g1 = N1.map(c => L * c / dot3(N1, N1));
  const s0 = dot3(a0, e) / (L * L), s1 = dot3(b1, e) / (L * L);
  const gp1 = [0, 1, 2].map(c => -(s0 * g0[c] + s1 * g1[c])), gp0 = [0, 1, 2].map(c => -(g0[c] + g1[c] + gp1[c]));
  return { theta, vertices: [p0, p1, w0, w1], grad: [gp0, gp1, g0, g1] };
}

/** Independent panel energy Σ ½k(θ−θ̄)², its gradient and magnitudes (for the stated tolerance). */
function independentBending(H, nH, hingeK, restTheta, memory, at, size) {
  const g = new Float64Array(size), scale = new Float64Array(size);
  let energy = 0;
  for (let h = 0; h < nH; h++) {
    const { theta, vertices, grad } = independentAngle(H, h, at), d = unwrap(memory[h], theta) - restTheta[h], f = hingeK[h] * d;
    energy += .5 * hingeK[h] * d * d;
    vertices.forEach((v, i) => { for (let c = 0; c < 3; c++) { g[3 * v + c] += f * grad[i][c]; scale[3 * v + c] += Math.abs(f * grad[i][c]); } });
  }
  return { energy, g, scale: maximum(scale) };
}

/** Out-of-plane reduction onto the bending mode; in-plane motion and other modes are leakage. */
function bendingModal(masses, phi, modalMass, displacement, velocity, elasticEnergy, reported, check, prefix) {
  const n = masses.length, outOfPlane = [], outOfPlaneVelocity = [], momentum = [0, 0, 0];
  let q = 0, qdot = 0, kineticEnergy = 0, leak = 0, inPlane = 0;
  for (let i = 0; i < n; i++) {
    outOfPlane.push(displacement[3 * i + 1]); outOfPlaneVelocity.push(velocity[3 * i + 1]);
    q += masses[i] * phi[i] * displacement[3 * i + 1]; qdot += masses[i] * phi[i] * velocity[3 * i + 1];
    kineticEnergy += .5 * masses[i] * (velocity[3 * i] ** 2 + velocity[3 * i + 1] ** 2 + velocity[3 * i + 2] ** 2);
    for (let c = 0; c < 3; c++) momentum[c] += masses[i] * velocity[3 * i + c];
  }
  q /= modalMass; qdot /= modalMass;
  for (let i = 0; i < n; i++) {
    leak += masses[i] * ((displacement[3 * i + 1] - q * phi[i]) ** 2 + displacement[3 * i] ** 2 + displacement[3 * i + 2] ** 2);
    inPlane += masses[i] * (displacement[3 * i] ** 2 + displacement[3 * i + 2] ** 2);
  }
  check(sameNumeric(reported.outOfPlane, outOfPlane) && sameNumeric(reported.outOfPlaneVelocity, outOfPlaneVelocity), prefix + ' out-of-plane reduction differs');
  check(Object.is(reported.modalCoordinate, q) && Object.is(reported.modalVelocity, qdot) && Object.is(reported.modalLeakageMassNorm, Math.sqrt(leak)) &&
    Object.is(reported.inPlaneMassNorm, Math.sqrt(inPlane)), prefix + ' modal reduction differs');
  check(sameNumeric(reported.linearMomentum, momentum), prefix + ' linear momentum differs');
  check(Object.is(reported.kineticEnergy, kineticEnergy) && Object.is(reported.mechanicalEnergy, elasticEnergy + kineticEnergy), prefix + ' kinetic/mechanical energy differs');
}

/** Offline mode verifies reported algebra only and cannot certify live physics.
 * The optional World path independently recomputes both native force equations
 * (membrane by engine scratch calls, bending independently) using detached scratch.
 * Precision/material/time truth requires separate oracles.
 */
export function validateBendingObservation(observation, { context, previous = null, world = null } = {}) {
  const errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
  let actualGradientChecked = false, losslessBindingsVerified = false, forceBindingsVerified = false, completed = false;
  let computedPublicConverged = null, computedAuthoritativeConverged = null;
  const finish = () => ({ valid: errors.length === 0, errors, liveWorldChecked: !!world, actualGradientChecked,
    losslessBindingsVerified, forceBindingsVerified, boundaryCertified: errors.length === 0 && !!world && completed && actualGradientChecked,
    computedPublicConverged, computedAuthoritativeConverged,
    publicConverged: errors.length === 0 && !!world && completed && actualGradientChecked && computedPublicConverged === true,
    authoritativeConverged: errors.length === 0 && !!world && completed && actualGradientChecked && computedAuthoritativeConverged === true,
    converged: errors.length === 0 && !!world && completed && actualGradientChecked && computedPublicConverged === true,
    scope: 'native equation and state ABI verification with panel bending; offline algebra cannot certify actual physics, material calibration, plate theory or time accuracy' });
  try {
    const o = observation, a = o?.authoritative, vertices = context?.patch?.vertices ?? context?.vertices;
    const n = vertices?.length ?? 0, masses = context?.masses, phi = context?.phi, opts = context?.options, triangles = context?.patch?.triangles;
    check(n > 0 && Array.isArray(vertices) && vertices.every(p => vector(p, 2)), 'invalid reference vertices');
    check(vector(masses, n) && masses.every(m => m > 0), 'invalid native masses');
    check(vector(phi, n), 'invalid out-of-plane modal field');
    // The bending context carries no top-level stateCoordinates; the named options are the request.
    check(opts?.stateCoordinates === MODE, 'wrong context state coordinates');
    check(integer(opts?.substeps) && opts.substeps > 0 && integer(opts?.newtonIterations) && opts.newtonIterations > 0 && typeof opts.previousPoseStart === 'boolean', 'invalid solver options');
    const parameters = context?.parameters;
    check(parameters?.substeps === opts?.substeps && parameters?.newtonIterations === opts?.newtonIterations && parameters?.previousPoseStart === opts?.previousPoseStart, 'context parameters differ from options');
    check(finite(context?.omega) && context.omega > 0 && finite(context?.amplitude) && context.amplitude >= 0, 'invalid fixed modal parameters');
    check(o?.schema === 'pliego-bending-state-observation/1' && a && equalIdentity(a.identity), 'missing or changed authoritative identity/schema');
    // Gauss–Newton is the default; exact curvature is admitted only as an explicitly named request.
    const curvature = parameters?.membraneCurvature, exactCurvature = curvature === 'exact-hessian';
    check(['gauss-newton', 'exact-hessian'].includes(curvature), 'invalid named membrane curvature request');
    for (const [key, value] of Object.entries({ membraneModel: 'orthotropic-stvk', membranePoissonConvention: 'nu12',
      membraneCurvature: curvature, membraneProjection: 'none', membraneArithmetic: 'double-double', membraneReference: 'uv-displacement',
      lineSearchArithmetic: 'membrane-inertia-increment', lineSearch: true, physicalMembrane: true, membraneCompression: 1, referenceBending: 'panel-hinges',
      damping: 0, bendDamping: 0, gravity: false, ground: false, contact: false, plasticity: false })) check(Object.is(opts?.[key], value), 'controlled option changed: ' + key);
    check(Array.isArray(triangles) && triangles.every(t => vector(t, 3) && t.every(v => integer(v) && v < n)), 'invalid authored triangles');
    if (world) check(world instanceof World, 'actual engine World required for live certification');
    if (errors.length) return finish();
    const hinges = authoredHinges(triangles, n), nH = hinges.size;
    check(nH > 0 && vector(context.hingeKWords, nH) && context.hingeKWords.every(k => k >= 0) && context.hingeKWords.some(k => k > 0), 'invalid authored hinge count or hinge stiffness words');
    if (errors.length) return finish();
    const size = 3 * n, h = 1 / (60 * opts.substeps), idt2 = 1 / (h * h), state = decode(o, context, n, nH, check);
    if (Object.keys(state).length !== names.length || errors.length) return finish();
    losslessBindingsVerified = true;
    const forceWords = decodeForces(o, size, check);
    if (Object.keys(forceWords).length !== forceNames.length || errors.length) return finish();
    forceBindingsVerified = true;
    check(Object.is(o.h, h) && Object.is(state.h[0], h) && finite(idt2), 'native timestep differs');
    check(same(state.mass, masses), 'bound native masses differ from context');
    check(same(state.hingeK, context.hingeKWords), 'bound hinge stiffness differs from context');
    const density = context.patch?.world?.materials?.[0]?.rhoA;
    const independentMass = Array(n).fill(0), consumed = new Set();
    check(finite(density) && density > 0, 'independent authored-area mass inputs unavailable');
    if (finite(density)) for (const tri of triangles) {
      const [p, q, r] = tri.map(i => vertices[i]);
      const area = Math.abs((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])) / 2;
      check(finite(area) && area > 0, 'invalid authored reference area');
      for (const i of tri) { independentMass[i] += area * density / 3; consumed.add(i); }
    }
    const massScale = Math.max(...masses);
    check(consumed.size === n && masses.every((m, i) => Math.abs(m - independentMass[i]) / massScale <= 1e-12), 'independent authored-area lumped mass mismatch');
    if (context.referenceMass !== undefined) check(vector(context.referenceMass, n) && masses.every((m, i) => Math.abs(m - context.referenceMass[i]) / massScale <= 1e-12), 'independent oracle masses differ');
    for (const key of immutable) check(context.initialBinding?.stateSHA256?.[key] === o.stateSHA256[key], 'initial immutable binding changed: ' + key);
    check(sameNumeric(state.reference, context.referenceWords), 'bound represented reference differs from context');
    const modeNorm = Math.max(...phi.map(Math.abs)), modalMass = masses.reduce((s, m, i) => s + m * phi[i] * phi[i], 0);
    const forceScale = context.amplitude * context.omega ** 2 * Math.max(...masses.map((m, i) => m * Math.abs(phi[i])));
    const tolerance = Math.max(ATOL, RTOL * forceScale);
    check(Math.abs(modeNorm - 1) <= 1e-12 && Object.is(context.maximumModeNorm, modeNorm), 'mode normalization changed');
    check(Object.is(context.forceScale, forceScale) && Object.is(context.forceTolerance, tolerance) && Object.is(o.forceScale, forceScale) && Object.is(o.forceTolerance, tolerance), 'fixed force scale/tolerance changed');
    check(o.absoluteForceTolerance === ATOL && o.relativeForceTolerance === RTOL, 'literal force policy changed');
    check(integer(o.step) && typeof o.initial === 'boolean' && o.initial === (o.step === 0), 'invalid step/initial identity');
    check(integer(o.framesRun) && integer(o.substepsRun) && finite(o.time) && o.time >= 0, 'invalid clock/counters');
    check(o.framesRun === o.step && o.substepsRun === o.step, 'step identity differs from one-substep public counters');
    check(typeof o.targetValid === 'boolean' && a.targetValid === o.targetValid, 'target validity mismatch');
    check(o.measurementValid === true && Array.isArray(o.errors) && o.errors.length === 0, 'producer measurement invalid');
    check(o.asleep === false, 'sleep censors measurement');
    // The planar "nonzero planar Y" check is dropped: bending admits out-of-plane state. Only the reference sheet is flat.
    check(state.x0.every((x, i) => { const v = Math.floor(i / 3); return i % 3 === 0 ? x === vertices[v][0] : i % 3 === 1 ? x === 0 : x === -vertices[v][1]; }), 'reference pose differs from the flat authored sheet');
    check(sameNumeric(state.v, a.v), 'authoritative and public actual velocity differ');
    for (const [view, authority] of [['x', 'u'], ['xs', 'us'], ['xt', 'ut']]) check(state[view].every((v, i) => Object.is(v, state.x0[i] + state[authority][i])), 'public projection mismatch: ' + view);
    for (let i = 0; i < size; i++) {
      const x = state.initialX[i], x0 = state.x0[i], sum = x + -x0, virtual = sum - x;
      const low = (x - (sum - virtual)) + (-x0 - virtual);
      const expected = Object.is(x, -0) && Object.is(x0, -0) ? -0 : sum;
      check(low === 0 && Object.is(state.initialU[i], expected) && Object.is(x0 + state.initialU[i], x), 'inexact/changed actual initial conversion');
    }
    check(zero(state.initialV), 'changed actual zero initial velocity');
    // Bending baseline: u = A*phi out of plane (one binary64 product), in-plane displacement zero.
    const initialField = i => i % 3 === 1 ? context.amplitude * phi[Math.floor(i / 3)] : 0;
    check(state.initialX.every((x, i) => Object.is(x, state.x0[i] + initialField(i))) && state.initialU.every((u, i) => i % 3 === 1 ? Object.is(u, initialField(i)) : u === 0), 'actual baseline initial x changed');
    // theta is the continued hinge-angle memory both bending energies unwrap from: bound words, view and live World agree per word.
    check(same(state.theta, a.hingeAngles), 'hinge angle memory view differs from bound theta words');
    let priorTheta = null;
    if (o.initial) {
      for (const key of names) check(context.initialBinding?.stateSHA256?.[key] === o.stateSHA256[key], 'initial native binding changed: ' + key);
      check(o.time === 0 && o.framesRun === 0 && o.substepsRun === 0 && o.execution === null && zero(state.v), 'initial clock/velocity/execution changed');
      check(!o.targetValid && same(state.x, state.initialX) && same(state.u, state.initialU) && zero(state.xs) && zero(state.xt), 'initial buffers falsely made into predictors');
      // The constructor measures the flat X0; setting the initial pose does not refresh the angle memory.
      check(zero(state.theta), 'initial hinge angle memory is not the flat constructor angle');
    } else {
      const e = o.execution, p = previous;
      completed = !!e && e.returnedSubsteps === 1 && e.actualSubstepExecuted === true && e.framesAdvancedExactlyOne === true && e.accumulatedTimeExact === true && e.exception === null && o.asleep === false;
      check(completed && o.targetValid, 'no completed current public substep target');
      check(p && p.step === o.step - 1 && p.authoritative, 'previous actual authority observation required');
      if (p?.authoritative) {
        check(integer(p.step) && p.initial === (p.step === 0) && p.framesRun === p.step && p.substepsRun === p.step && Object.is(p.h, h) && finite(p.time) && (p.step === 0 ? p.time === 0 : p.time > 0), 'previous step/initial/clock/counter identity differs');
        const prior = decode(p, context, n, nH, check);
        if (Object.keys(prior).length === names.length) {
          priorTheta = prior.theta;
          check(Object.is(o.time, p.time + h) && o.framesRun === p.framesRun + 1 && o.substepsRun === p.substepsRun + 1, 'actual clock/counter increment mismatch');
          check(same(state.us, prior.u) && same(state.xs, prior.x), 'predecessor authority/public start mismatch');
          check(state.ut.every((v, i) => Object.is(v, prior.u[i] + h * prior.v[i])), 'displacement predictor differs');
          check(state.v.every((v, i) => Object.is(v, (state.u[i] - state.us[i]) / h)), 'displacement velocity differs');
          if (e) {
            for (const key of ['usMatchesPreviousU', 'utMatchesActualDisplacementPredictor', 'velocityMatchesActualDisplacementDifference', 'xProjectionMatchesAuthority', 'xsProjectionMatchesAuthority', 'xtProjectionMatchesAuthority']) check(e[key] === true, 'execution proof differs: ' + key);
            // The planar runtime's old public-difference diagnostics (xsMatchesPreviousX, ...) are not emitted by the bending runtime.
            for (const key of ['xsMatchesPreviousX', 'xtMatchesActualPredictor', 'velocityMatchesActualDifference']) check(e[key] === undefined, 'unexpected execution diagnostic: ' + key);
          }
        }
      }
    }
    check(o.solver?.substeps === opts.substeps && o.solver?.newtonIterations === opts.newtonIterations && o.solver?.previousPoseStart === opts.previousPoseStart, 'reported solver configuration changed');
    check(o.solver?.stateCoordinates === MODE && equalIdentity(o.solver?.stateIdentity) && o.solver?.referenceBending === 'panel-hinges' && o.solver?.lineSearchArithmetic === 'membrane-inertia-increment' && o.solver?.membraneArithmetic === 'double-double' && o.solver?.membraneReference === 'uv-displacement' && equalObject(o.solver?.membraneArithmeticIdentity, DOUBLE_DOUBLE_IDENTITY) && equalObject(o.solver?.membraneReferenceIdentity, UV_REFERENCE_IDENTITY), 'reported state/model/arithmetic identity differs');
    check(o.solver?.pcgMaxIterations === K.PCG_MAX_ITER && o.solver?.pcgRelativeTolerance === K.PCG_RTOL, 'native PCG policy changed');
    // The absolute PCG stop is a named candidate only: its factor of the independently recomputed tolerance.
    const named = parameters?.pcgStop, stop = named === undefined ? undefined : Object.hasOwn(PCG_STOPS, named) ? PCG_STOPS[named] * tolerance : NaN;
    check(stop === undefined ? !Object.hasOwn(opts ?? {}, 'pcgAbsoluteTolerance') && !Object.hasOwn(o.solver ?? {}, 'pcgAbsoluteTolerance')
      : Number.isFinite(stop) && stop > 0 && Object.is(opts?.pcgAbsoluteTolerance, stop) && Object.is(o.solver?.pcgAbsoluteTolerance, stop), 'named absolute PCG stop differs');
    for (const key of ['factorizations', 'lastPublicPcgIterations', 'lineSearchBacktracks', 'lineSearchRejected']) check(integer(o.solver?.[key]), 'invalid solver counter: ' + key);
    const curvatureFields = ['membraneCurvature', 'membraneCurvatureIdentity', 'factorCurvature', 'membraneCurvatureCounters', 'lastCurvatureReceipt'];
    if (!exactCurvature) check(curvatureFields.every(key => !Object.hasOwn(o.solver ?? {}, key)), 'unexpected curvature receipts on the Gauss–Newton path');
    else {
      const counters = o.solver?.membraneCurvatureCounters;
      check(o.solver?.membraneCurvature === 'exact-hessian' && equalObject(o.solver?.membraneCurvatureIdentity, EXACT_CURVATURE_IDENTITY), 'reported curvature identity differs');
      check(counters && Object.values(counters).every(integer) && o.solver.factorizations === counters.exactFactors + counters.gnFallbackFactors, 'reported curvature counters inconsistent with successful factors');
      check([null, 'exact-hessian', 'gauss-newton'].includes(o.solver?.factorCurvature), 'invalid reported factor curvature');
    }
    const physics = {};
    for (const [label, reported, point, target] of [['public', o, state.x, state.xt], ['authoritative', a, state.u, state.ut]]) {
      // No zero-Y gradient requirement: bending forces are out of plane.
      check(vector(reported.elasticGradient, size), label + ' invalid elastic gradient');
      check(finite(reported.elasticEnergy) && reported.elasticEnergy >= 0 && finite(reported.bendingEnergy) && reported.bendingEnergy >= 0, label + ' invalid elastic/bending energy');
      if (!vector(reported.elasticGradient, size)) continue;
      const nativeGradient = forceWords[label + 'ElasticGradient'];
      check(sameNumeric(reported.elasticGradient, nativeGradient), label + ' elastic gradient differs from raw force binding');
      const inertia = point.map((x, i) => masses[Math.floor(i / 3)] * idt2 * (x - target[i]));
      const residual = nativeGradient.map((g, i) => g + inertia[i]);
      check(same(forceWords[label + 'InertiaGradient'], inertia) && same(forceWords[label + 'Residual'], residual), label + ' raw native force association differs');
      const rawInertiaEnergy = energyOfDifference(point, target, masses, idt2);
      check(finite(reported.rawInertiaEnergy) && Object.is(reported.rawInertiaEnergy, rawInertiaEnergy) && finite(reported.rawImplicitEnergy), label + ' raw objective/inertia differs');
      // Replaces the planar exact rawImplicit = inertia + elastic: the search objective sums bending in another order.
      const w = reported.omittedWork, energyScale = Math.abs(rawInertiaEnergy) + Math.abs(reported.elasticEnergy - reported.bendingEnergy) + Math.abs(reported.bendingEnergy);
      const energyBound = OMITTED_ULPS * Number.EPSILON * energyScale, gradientBound = OMITTED_ULPS * Number.EPSILON * maximum(nativeGradient);
      check(ownKeys(w, omittedKeys) && omittedKeys.every(k => finite(w[k])) && Object.is(w.energyDifference, reported.rawImplicitEnergy - (rawInertiaEnergy + reported.elasticEnergy)) &&
        Object.is(w.energyBound, energyBound) && Object.is(w.gradientBound, gradientBound) && w.gradientDifference >= 0, label + ' omitted-work record differs');
      check(ownKeys(w, omittedKeys) && Math.abs(w.energyDifference) <= energyBound && w.gradientDifference <= gradientBound, label + ' omitted work beyond summation order');
      const residualInfinity = maximum(residual), gate = label === 'public' ? 'literalForceGate' : 'converged';
      if (o.initial || !completed) {
        for (const key of ['inertiaGradient', 'residual', 'residualInfinity', 'inertiaEnergy', 'incrementalEnergy', gate]) check(reported[key] === null, label + ' invalid-target quantity falsely certified: ' + key);
      } else {
        check(vector(reported.inertiaGradient, size) && vector(reported.residual, size) && finite(reported.residualInfinity) && residual.every(finite), label + ' nonfinite native force field');
        check(finite(reported.inertiaEnergy) && reported.inertiaEnergy >= 0 && finite(reported.incrementalEnergy), label + ' invalid incremental energy');
        check(sameNumeric(reported.inertiaGradient, inertia) && sameNumeric(reported.residual, residual) && Object.is(reported.residualInfinity, residualInfinity), label + ' native inertia/residual differs');
        check(typeof reported[gate] === 'boolean' && reported[gate] === (residualInfinity <= tolerance), label + ' force gate differs');
        check(Object.is(reported.inertiaEnergy, rawInertiaEnergy) && Object.is(reported.incrementalEnergy, reported.elasticEnergy + reported.inertiaEnergy), label + ' incremental energy differs');
        // Planar required raw === certified objective; here they agree to the omitted-work bound.
        check(Math.abs(reported.rawImplicitEnergy - reported.incrementalEnergy) <= energyBound, label + ' completed raw and certified objective differ');
        if (label === 'public') computedPublicConverged = residualInfinity <= tolerance; else computedAuthoritativeConverged = residualInfinity <= tolerance;
      }
      check(reported.metric?.finite === true && reported.metric.invalidTriangles === 0 && reported.metric.minimumStretch > 0 && reported.metric.minimumAreaRatio > 0, label + ' invalid/missing metric diagnostics');
      physics[label] = { point, reported };
    }
    const normalized = o.initial || !completed || forceScale === 0 ? null : o.residualInfinity / forceScale;
    check(Object.is(o.normalizedResidual, normalized), 'public fixed-scale normalized residual differs');
    check(Object.is(context.modalMass, modalMass) && Object.is(o.modalMass, modalMass), 'context modal mass differs');
    const publicDisplacement = state.x.map((x, i) => x - state.x0[i]);
    bendingModal(masses, phi, modalMass, publicDisplacement, state.v, o.elasticEnergy, o, check, 'public');
    bendingModal(masses, phi, modalMass, state.u, state.v, a.elasticEnergy, a, check, 'authoritative');
    // The planar planarExact / nonMembraneEnergy === 0 proof cannot apply: bending is the admitted non-membrane work.
    if (world) {
      validateReferenceState(world);
      const live = world.authoritativeState();
      check(live && equalIdentity(live.identity) && equalIdentity(world._referenceIdentity) && world.opts.referenceBending === 'panel-hinges', 'actual World state identity differs');
      for (const key of ['u', 'us', 'ut', 'v', 'x0', 'initialX', 'initialU', 'initialV']) check(same(state[key], live[key]), 'bound field differs from live World: ' + key);
      for (const key of ['x', 'xs', 'xt', 'v']) check(same(state[key], world[key]), 'public field differs from live World: ' + key);
      check(same(state.mass, world.mass) && world.invMass.every((v, i) => Object.is(v, 1 / masses[i])), 'live native/inverse mass differs');
      check(same(state.reference, references(world)), 'live represented reference differs');
      check(same(state.hingeK, world.hingeK) && same(state.restTheta, world.restTheta), 'live hinge stiffness/rest angle differs');
      check(same(state.theta, world.theta), 'live hinge angle memory differs');
      // Independent hinge topology: every live hinge is one authored interior edge with its two opposite wings.
      const H = world.mesh.hinges, seen = new Set();
      check(world.mesh.nH === nH && H.length === 4 * nH && world.mesh.hingeKind.every(k => k === 0) && world.bendDamp === 0, 'live hinge set differs from the authored panel hinges');
      for (let k = 0; k < Math.min(nH, world.mesh.nH); k++) {
        const [p0, p1, w0, w1] = H.subarray(4 * k, 4 * k + 4), key = Math.min(p0, p1) * n + Math.max(p0, p1), wings = hinges.get(key);
        check(!!wings && !seen.has(key) && [w0, w1].sort().join() === [...wings].sort().join(), 'live hinge is not an authored interior edge: ' + k);
        seen.add(key);
      }
      check(Object.is(world.dt, h) && Object.is(world.time, o.time) && world.framesRun === o.framesRun && world.substepsRun === o.substepsRun && world.asleep === false, 'live clock/counter/sleep differs');
      for (const key of ['newtonIterations', 'previousPoseStart', 'substeps']) check(Object.is(world.opts[key], opts[key]) && Object.is(world.opts[key], o.solver?.[key]), 'live solver configuration differs: ' + key);
      check(Object.is(world.dt, 1 / (60 * world.opts.substeps)), 'live timestep/substeps association differs');
      check(world.opts.stateCoordinates === MODE && world.opts.membraneArithmetic === 'double-double' && world.opts.membraneReference === 'uv-displacement' && world.opts.lineSearchArithmetic === 'membrane-inertia-increment', 'live arithmetic/state mode differs');
      for (const [key, value] of Object.entries({ factorizations: world.factorCount, lastPublicPcgIterations: world.pcgIterations, lineSearchBacktracks: world.energySearch.backtracks, lineSearchRejected: world.energySearch.rejected })) check(o.solver?.[key] === value, 'counter differs from live World: ' + key);
      check(Object.is(world.opts.pcgAbsoluteTolerance, stop), 'live absolute PCG stop differs');
      check(Object.is(world.opts.membraneCurvature, curvature) && (exactCurvature ? JSON.stringify(o.solver?.membraneCurvatureCounters) === JSON.stringify(world._exactCurvature?.counters) &&
        JSON.stringify(o.solver?.lastCurvatureReceipt) === JSON.stringify(world._exactCurvature?.last) && o.solver?.factorCurvature === (world._factorState?.curvature ?? null) : !world._exactCurvature), 'curvature receipts differ from live World');
      const shadow = scratchCopy(world), selected = shadow.orthotropicMembrane, memory = state.theta;
      const latentAt = (i, j) => [0, 1, 2].map(c => (state.x0[3 * i + c] - state.x0[3 * j + c]) + (state.u[3 * i + c] - state.u[3 * j + c]));
      const publicAt = (i, j) => [0, 1, 2].map(c => state.x[3 * i + c] - state.x[3 * j + c]);
      if (!o.initial && priorTheta) {
        // _hingeUpdate measures the public pose continued from the predecessor's bound memory.
        const prior = priorTheta;
        for (let k = 0; k < nH; k++) {
          const expected = unwrap(prior[k], independentAngle(H, k, publicAt).theta);
          check(Math.abs(state.theta[k] - expected) <= ANGLE_ULPS * Number.EPSILON * Math.max(1, Math.abs(expected)), 'hinge angle memory differs from the independent public angle: ' + k);
        }
      }
      for (const [label, coordinates, at] of [['public', ABS, publicAt], ['authoritative', MODE, latentAt]]) {
        const { point, reported } = physics[label] ?? {};
        if (!point) continue;
        const x = Float64Array.from(point), full = new Float64Array(size), membrane = new Float64Array(size), residualOrder = new Float64Array(size);
        gradient(shadow, x, full, coordinates); selected.addGradient(point, membrane, coordinates);
        selected.addGradient(point, residualOrder, coordinates);
        const engineBending = addBendingGradient(shadow, x, residualOrder, coordinates);
        const native = forceWords[label + 'ElasticGradient'], bending = independentBending(H, nH, state.hingeK, state.restTheta, memory, at, size);
        // Engine association: the residual's own membrane-then-bending sum, bitwise.
        check(same(native, residualOrder) && Object.is(reported.bendingEnergy, engineBending), label + ' differs from actual membrane+bending residual sum');
        // Engine search gradient within the omitted-work bound, and the reported difference recomputed.
        let searchDifference = 0; for (let i = 0; i < size; i++) searchDifference = Math.max(searchDifference, Math.abs(full[i] - native[i]));
        check(Object.is(reported.omittedWork?.gradientDifference, searchDifference) && searchDifference <= reported.omittedWork?.gradientBound, label + ' differs from actual selected/full gradient');
        // Independent bending: no work beyond membrane + panel bending.
        const gradientError = maximum(native.map((g, i) => g - membrane[i] - bending.g[i]));
        check(gradientError <= BENDING_RTOL * bending.scale && Math.abs(reported.bendingEnergy - bending.energy) <= BENDING_RTOL * bending.energy, label + ' differs from independent panel bending');
        check(Object.is(reported.elasticEnergy, selected.energy(point, coordinates) + reported.bendingEnergy), label + ' differs from actual selected membrane + bending energy');
        check(Object.is(reported.rawImplicitEnergy, implicitEnergy(shadow, x, coordinates)), label + ' differs from actual raw full objective');
        const metric = selected.diagnostics(point, coordinates);
        check(reported.metric && ownKeys(reported.metric, Object.keys(metric)) && Object.keys(metric).every(k => Object.is(reported.metric[k], metric[k])) && metric.finite, label + ' differs from actual metric');
      }
      actualGradientChecked = true;
    }
  } catch (cause) { errors.push('state validation failed: ' + cause.message); }
  return finish();
}
