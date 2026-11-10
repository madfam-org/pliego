// Independent acceptance reductions; actual gradients use cloned scratch only.
import { createHash } from 'node:crypto';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';

const ATOL = 1e-7, RTOL = 1e-10, MASS_TOLERANCE = 1e-12;
const finite = x => typeof x === 'number' && Number.isFinite(x);
const integer = x => Number.isSafeInteger(x) && x >= 0;
const array = x => Array.isArray(x) || ArrayBuffer.isView(x) && !(x instanceof DataView);
const vector = (x, n) => array(x) && x.length === n && Array.from(x).every(finite);
const field = (x, n) => Array.isArray(x) && x.length === n && Array.from(x).every(p => vector(p, 2));
const same = (a, b) => array(a) && array(b) && a.length === b.length && Array.from(a).every((v, i) => v === b[i]);
const zero = a => array(a) && Array.from(a).every(x => x === 0);
const maximum = a => Array.from(a).reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const sha = a => createHash('sha256').update(new Uint8Array(Float64Array.from(a).buffer)).digest('hex');
const equalObject = (a, b) => a && b && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => v === b[k]);

function scratchCopy(w) {
  const shadow = Object.create(w);
  for (const key of ['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK']) shadow[key] = w[key].slice();
  const selected = Object.create(w.orthotropicMembrane);
  selected.work = Object.fromEntries(Object.entries(w.orthotropicMembrane.work).map(([k, v]) => [k, ArrayBuffer.isView(v) ? v.slice() : v]));
  shadow.orthotropicMembrane = selected;
  return shadow;
}

/** Adjacent binary64 spacing; a descriptive scale, never a force allowance/bound. */
export function binary64Spacing(value) {
  if (!finite(value)) return null;
  const x = Math.abs(value);
  if (x === 0) return Number.MIN_VALUE;
  const data = new DataView(new ArrayBuffer(8));
  data.setFloat64(0, x, false);
  const bits = data.getBigUint64(0, false);
  if (x === Number.MAX_VALUE) { data.setBigUint64(0, bits - 1n, false); return x - data.getFloat64(0, false); }
  data.setBigUint64(0, bits + 1n, false);
  return data.getFloat64(0, false) - x;
}

/**
 * config: {vertices, triangles?, mass|masses, phi, omega, amplitude, substeps,
 * newtonIterations, previousPoseStart, options?}; createModalWorld context works.
 * referenceMass MUST be independently produced; never replaces native mass.
 * previous is the preceding observation, including initial step0. Live mode
 * certifies the supplied current World only; offline mode checks reported algebra
 * and cannot certify force convergence. No old-snapshot World mutation/replay.
 */
export function validateObservation(config, observation, { world, previous, referenceMass } = {}) {
  const errors = [], check = (ok, message) => { if (!ok) errors.push(message); };
  const vertices = config?.vertices ?? config?.patch?.vertices;
  const triangles = config?.triangles ?? config?.patch?.triangles;
  const mass = config?.mass ?? config?.masses, phi = config?.phi;
  const options = config?.options ?? {}, omega = config?.omega, amplitude = config?.amplitude;
  const substeps = config?.substeps ?? options.substeps;
  const newtonIterations = config?.newtonIterations ?? options.newtonIterations;
  const previousPoseStart = config?.previousPoseStart ?? options.previousPoseStart;
  const n = vertices?.length ?? 0, size = 3 * n, o = observation;
  check(n > 0 && field(vertices, n) && field(phi, n), 'invalid reference vertices or modal field');
  check(vector(mass, n) && Array.from(mass).every(m => m > 0), 'positive native masses required');
  check(vector(referenceMass, n) && Array.from(referenceMass).every(m => m > 0), 'independent positive referenceMass required');
  check(finite(omega) && omega > 0 && finite(amplitude) && amplitude >= 0, 'invalid fixed physical modal parameters');
  check(integer(substeps) && substeps > 0 && integer(newtonIterations) && newtonIterations > 0 && typeof previousPoseStart === 'boolean', 'invalid declared public solver options');
  check(o && typeof o === 'object', 'missing observation');
  if (errors.length) return { valid: false, converged: false, errors, liveWorldChecked: !!world, actualGradientChecked: false };
  const h = 1 / (60 * substeps), idt2 = 1 / (h * h), initial = o.initial === true;
  check(finite(h) && h > 0 && finite(idt2), 'nonfinite timestep/inertial scale');
  check(Math.abs(Math.max(...phi.map(p => Math.hypot(...p))) - 1) <= 1e-12, 'mode is not dimensionless max-node-normalized');
  const massScale = Math.max(...mass), massDifference = Math.max(...mass.map((m, i) => Math.abs(m - referenceMass[i]) / massScale));
  check(massDifference <= MASS_TOLERANCE, 'native and independent lumped masses disagree');
  const modalMass = mass.reduce((s, m, i) => s + m * (phi[i][0] ** 2 + phi[i][1] ** 2), 0);
  const referenceModalMass = referenceMass.reduce((s, m, i) => s + m * (phi[i][0] ** 2 + phi[i][1] ** 2), 0);
  check(modalMass > 0 && finite(modalMass) && Math.abs(modalMass - referenceModalMass) / modalMass <= MASS_TOLERANCE, 'independent modal mass disagrees');
  if (config.referenceModalMass !== undefined) check(finite(config.referenceModalMass) && Math.abs(modalMass - config.referenceModalMass) / modalMass <= MASS_TOLERANCE, 'independent oracle modal mass disagrees');
  const forceScale = amplitude * omega ** 2 * Math.max(...mass.map((m, i) => m * Math.hypot(...phi[i])));
  const forceTolerance = Math.max(ATOL, RTOL * forceScale);
  check(finite(forceScale) && finite(forceTolerance), 'nonfinite fixed force scale');
  check(o.forceScale === forceScale && o.forceTolerance === forceTolerance && o.absoluteForceTolerance === ATOL && o.relativeForceTolerance === RTOL, 'changed fixed force scale or literal force policy');
  check(integer(o.step) && typeof o.initial === 'boolean' && initial === (o.step === 0), 'invalid initial/step classification');
  check(o.h === h && finite(o.time) && o.time >= 0, 'incorrect actual timestep/time');
  check(o.targetValid === !initial, 'initial xs/xt falsely treated as prediction or poststep target missing');
  check(o.asleep === false, 'sleep-censored observation cannot pass measurement');
  check(o.measurementValid === true && Array.isArray(o.errors) && o.errors.length === 0, 'observer reported invalid measurement');
  check(o.planarExact === true && o.nonMembraneEnergy === 0 && o.nonMembraneGradientMaximum === 0, 'omitted physics or false planarity flag');
  check(o.framesRun === o.step && o.substepsRun === o.step, 'public call/substep count mismatch');
  check(o.solver?.substeps === substeps && o.solver?.newtonIterations === newtonIterations && o.solver?.previousPoseStart === previousPoseStart, 'reported public solver configuration differs');
  check(o.solver?.pcgMaxIterations === 12 && o.solver?.pcgRelativeTolerance === 1e-3, 'changed runtime PCG policy');
  for (const key of ['factorizations', 'lastPublicPcgIterations', 'lineSearchBacktracks', 'lineSearchRejected']) check(integer(o.solver?.[key]), 'invalid public solver counter: ' + key);
  check(o.solver?.linearDirectionResiduals === null && o.solver?.acceptedAlphaHistory === null && o.solver?.perNewtonPcgHistory === null && typeof o.solver?.missingDiagnostics === 'string' && o.solver.missingDiagnostics.length > 0, 'unmeasured per-Newton diagnostics falsely supplied');
  for (const key of ['x', 'xs', 'xt', 'v', 'elasticGradient']) check(vector(o[key], size), 'invalid finite 3D field: ' + key);
  if (['x', 'xs', 'xt', 'v', 'elasticGradient'].some(key => !vector(o[key], size))) return { valid: false, converged: false, errors, liveWorldChecked: !!world, actualGradientChecked: false };
  for (const key of ['x', 'xs', 'xt', 'v']) {
    check(o.rawSHA256?.[key] === sha(o[key]), 'raw bytes/hash mismatch: ' + key);
    check(o[key].every((v, i) => i % 3 !== 1 || v === 0), 'nonzero Y in actual field: ' + key);
  }
  check(o.elasticGradient.every((g, i) => i % 3 !== 1 || g === 0), 'nonzero Y elastic gradient');
  if (initial) {
    check(o.time === 0 && o.execution === null && zero(o.v), 'invalid initial clock/velocity/execution');
    check(o.x.every((value, i) => { const v = Math.floor(i / 3); return value === (i % 3 === 0 ? vertices[v][0] + amplitude * phi[v][0] : i % 3 === 1 ? 0 : -(vertices[v][1] + amplitude * phi[v][1])); }), 'initial pose differs from one-time physical modal initialization');
  } else {
    const p = previous, e = o.execution;
    check(p && vector(p.x, size) && vector(p.v, size) && finite(p.time) && p.step === o.step - 1, 'preceding actual observation required');
    check(e && e.returnedSubsteps === 1 && e.actualSubstepExecuted === true && e.framesAdvancedExactlyOne === true && e.accumulatedTimeExact === true && e.xsMatchesPreviousX === true && e.xtMatchesActualPredictor === true && e.velocityMatchesActualDifference === true && e.exception === null, 'invalid public one-substep execution proof');
    if (p && vector(p.x, size) && vector(p.v, size)) {
      check(o.time === p.time + h && o.framesRun === p.framesRun + 1 && o.substepsRun === p.substepsRun + 1, 'actual clock/counter increment mismatch');
      check(same(o.xs, p.x), 'xs differs from actual previous pose');
      check(o.xt.every((value, i) => value === p.x[i] + (h * p.v[i] + 0)), 'xt differs from undamped zero-force actual predictor');
      for (const key of ['factorizations', 'lineSearchBacktracks', 'lineSearchRejected']) check(o.solver?.[key] >= p.solver?.[key], 'public cumulative counter decreased: ' + key);
    }
    check(o.v.every((value, i) => value === (o.x[i] - o.xs[i]) / h), 'velocity differs from actual position difference/h');
  }

  let verifiedGradient = null, verifiedEnergy = null, actualGradientChecked = false;
  if (world) {
    const w = world;
    check(w.mesh?.nV === n && w.x?.length === size, 'live World mesh/pose size differs');
    for (const key of ['x', 'xs', 'xt', 'v']) check(same(o[key], w[key]) && o.rawSHA256?.[key] === sha(w[key]), 'reported field/bytes differ from actual live World: ' + key);
    check(w.dt === h && w.time === o.time && w.framesRun === o.framesRun && w.substepsRun === o.substepsRun && w.asleep === false, 'live World clock/counter/sleep mismatch');
    check(same(mass, w.mass), 'configured native masses differ from actual live World');
    check(vector(w.fixed, n) && zero(w.fixed) && w.sys?.nFree === n && vector(w.invMass, n) && w.invMass.every((v, i) => v === 1 / mass[i]), 'live fixed/free/inverse-mass configuration changed');
    check(w.opts?.substeps === substeps && w.opts?.newtonIterations === newtonIterations && w.opts?.previousPoseStart === previousPoseStart, 'live public solver configuration differs');
    check(w.opts?.membraneModel === 'orthotropic-stvk' && w.opts?.membranePoissonConvention === 'nu12' && w.opts?.membraneCurvature === 'gauss-newton' && w.opts?.membraneProjection === 'none', 'wrong actual selected-law research configuration');
    check(w.opts?.physicalMembrane === true && w.membraneCap === Infinity && w.kCompFactor === 1 && w.opts?.lineSearch === true && !!w.energySearch, 'cap/compression/projection/globalization research domain changed');
    check(w.opts?.damping === 0 && w.bendDamp === 0 && w.opts?.gravity === false && w.opts?.ground === false && w.opts?.contact === false && w.opts?.plasticity === false, 'actual physical damping/external option enabled');
    check(!w.contact && !w.coupledContact && !w.motionGuard && !w.edgeContact, 'actual contact/projection path present');
    check(zero(w.userForce) && zero(w.fext) && w.drivers?.wind === 0 && zero(w.driveOn) && zero(w.terms?.active), 'actual force/wind/drive/join work present');
    check(w.drivers?.groups?.length === 0 && w.drivers?.controls?.size === 0 && w.drivers?.mech?.size === 0 && w.gates?.count === 0 && w.mesh?.perfPairs?.length === 0, 'unsupported pins/controls/mechanisms/gates/perforations');
    check(w.doc?.sheets?.every(s => !s.kinematic) && w.doc?.controls?.length === 0 && w.doc?.mechanisms?.length === 0 && w.doc?.joins?.length === 0, 'unsupported authored motion/joins');
    check(w.X0?.length === size && vertices.every(([u, v], i) => w.mesh.uv[2 * i] === u && w.mesh.uv[2 * i + 1] === v && w.X0[3 * i] === u && w.X0[3 * i + 1] === 0 && w.X0[3 * i + 2] === -v), 'native reference UV/rest pose changed');
    if (triangles) {
      check(Array.isArray(triangles) && triangles.length === w.mesh.nT && Array.from(triangles).every((t, i) => vector(t, 3) && t.every(v => integer(v) && v < n) && [0, 1, 2].some(k => t.every((v, j) => v === w.mesh.tris[3 * i + (j + k) % 3]))), 'native triangle connectivity differs');
      check(Array.isArray(triangles) && new Set(triangles.flat()).size === n, 'unconsumed reference vertices');
    }
    for (const key of ['membraneNu12', 'windDir']) if (options[key] !== undefined) check(same(options[key], w.opts[key]), 'actual option differs from declared ' + key);
    for (const [key, actual] of Object.entries({ factorizations: w.factorCount, lastPublicPcgIterations: w.pcgIterations, lineSearchBacktracks: w.energySearch?.backtracks, lineSearchRejected: w.energySearch?.rejected })) check(o.solver?.[key] === actual, 'reported counter differs from live World: ' + key);
    try {
      if (!w.orthotropicMembrane || w.mesh.nV !== n) throw new Error('selected membrane/mesh missing');
      const shadow = scratchCopy(w), selected = shadow.orthotropicMembrane;
      const full = new Float64Array(size), membrane = new Float64Array(size);
      gradient(shadow, w.x, full); selected.addGradient(w.x, membrane);
      verifiedGradient = Array.from(full); verifiedEnergy = selected.energy(w.x);
      check(same(o.elasticGradient, full), 'reported gradient differs from actual selected/full-path gradient');
      check(maximum(Array.from(full, (g, i) => g - membrane[i])) === 0, 'actual full-path gradient contains omitted physics');
      check(o.elasticEnergy === verifiedEnergy && equalObject(o.metric, selected.diagnostics(w.x)) && o.metric?.finite === true && o.metric?.invalidTriangles === 0, 'reported selected-law energy/metric differs from live World');
      check(o.rawImplicitEnergy === implicitEnergy(shadow, w.x), 'reported incremental objective differs from actual full path');
      shadow.orthotropicMembrane = null; shadow.kMem = new Float64Array(w.kMem.length);
      check(implicitEnergy(shadow, w.x) === inertialEnergy(o.x, o.xt, mass, idt2), 'actual non-membrane energy is nonzero');
      actualGradientChecked = true;
    } catch (cause) { check(false, 'actual final physics evaluation failed: ' + cause.message); }
  }

  const g = verifiedGradient ?? o.elasticGradient, energy = verifiedEnergy ?? o.elasticEnergy;
  check(finite(energy) && energy >= 0, 'nonfinite/negative selected-law energy');
  const inertiaEnergy = inertialEnergy(o.x, o.xt, mass, idt2);
  check(o.rawImplicitEnergy === inertiaEnergy + energy, 'raw objective differs from inertia plus selected elastic energy');
  const momentum = [0, 0, 0], angular = [0, 0, 0], com = [0, 0, 0], totalMass = mass.reduce((a, b) => a + b, 0);
  let kinetic = 0, q = 0, qdot = 0;
  const displacement = [], velocityUV = [];
  for (let i = 0; i < n; i++) {
    const k = 3 * i, m = mass[i], u = [o.x[k] - vertices[i][0], -o.x[k + 2] - vertices[i][1]], v = [o.v[k], -o.v[k + 2]];
    displacement.push(u); velocityUV.push(v);
    kinetic += 0.5 * m * (o.v[k] ** 2 + o.v[k + 1] ** 2 + o.v[k + 2] ** 2);
    q += m * (phi[i][0] * u[0] + phi[i][1] * u[1]); qdot += m * (phi[i][0] * v[0] + phi[i][1] * v[1]);
    for (let c = 0; c < 3; c++) { momentum[c] += m * o.v[k + c]; com[c] += m * o.x[k + c] / totalMass; }
    angular[0] += m * (o.x[k + 1] * o.v[k + 2] - o.x[k + 2] * o.v[k + 1]);
    angular[1] += m * (o.x[k + 2] * o.v[k] - o.x[k] * o.v[k + 2]);
    angular[2] += m * (o.x[k] * o.v[k + 1] - o.x[k + 1] * o.v[k]);
  }
  q /= modalMass; qdot /= modalMass;
  let leakageSquared = 0;
  for (let i = 0; i < n; i++) leakageSquared += mass[i] * ((displacement[i][0] - q * phi[i][0]) ** 2 + (displacement[i][1] - q * phi[i][1]) ** 2);
  check(field(o.displacement, n) && displacement.every((p, i) => same(p, o.displacement[i])) && field(o.velocityUV, n) && velocityUV.every((p, i) => same(p, o.velocityUV[i])), 'sheet field differs from actual 3D state');
  check(o.kineticEnergy === kinetic && o.mechanicalEnergy === energy + kinetic, 'mechanical/kinetic energy inconsistency');
  check(same(o.linearMomentum, momentum) && same(o.angularMomentumAboutWorldOrigin, angular) && same(o.centerOfMass, com), 'momentum/center-of-mass reduction inconsistency');
  check(o.modalMass === modalMass && o.modalCoordinate === q && o.modalVelocity === qdot && o.modalLeakageMassNorm === Math.sqrt(leakageSquared) && o.initialLinearModalEnergyScale === 0.5 * modalMass * (amplitude * omega) ** 2, 'fixed-scale modal reduction inconsistency');
  let computedResidualInfinity = null, computedConverged = null;
  if (initial) {
    for (const key of ['inertiaGradient', 'residual', 'residualInfinity', 'residualMaximumNodal', 'massDualResidualNorm', 'normalizedResidual', 'literalForceGate', 'inertiaEnergy', 'incrementalEnergy']) check(o[key] === null, 'initial observation falsely contains poststep quantity: ' + key);
  } else {
    const inertia = g.map((_v, i) => mass[Math.floor(i / 3)] * idt2 * (o.x[i] - o.xt[i]));
    const residual = g.map((v, i) => v + inertia[i]);
    computedResidualInfinity = maximum(residual); computedConverged = computedResidualInfinity <= forceTolerance;
    const nodal = Math.max(...mass.map((_m, i) => Math.hypot(...residual.slice(3 * i, 3 * i + 3))));
    const dual = Math.sqrt(residual.reduce((s, r, i) => s + r * r / mass[Math.floor(i / 3)], 0));
    check(residual.every(finite) && same(o.inertiaGradient, inertia) && same(o.residual, residual), 'actual inertia/full residual field mismatch');
    check(o.residualInfinity === computedResidualInfinity && o.residualMaximumNodal === nodal && o.massDualResidualNorm === dual, 'residual norm reduction mismatch');
    check(o.normalizedResidual === (forceScale > 0 ? computedResidualInfinity / forceScale : null), 'incorrect fixed-scale relative residual');
    check(o.literalForceGate === computedConverged, 'false literal force-gate classification');
    check(o.inertiaEnergy === inertiaEnergy && o.incrementalEnergy === o.rawImplicitEnergy, 'poststep incremental/inertial energy mismatch');
  }
  const resolutionScale = Math.max(...o.x.map((x, i) => mass[Math.floor(i / 3)] * idt2 * Math.max(binary64Spacing(x), binary64Spacing(o.xt[i]))));
  return { valid: errors.length === 0, converged: errors.length === 0 && actualGradientChecked && computedConverged === true,
    errors, computedConverged, computedResidualInfinity, computedForceScale: forceScale, computedForceTolerance: forceTolerance,
    nativeMass: Array.from(mass), referenceMass: Array.from(referenceMass), massScale, maximumMassScaledDifference: massDifference,
    massTolerance: MASS_TOLERANCE, computedModalMass: modalMass, referenceModalMass,
    liveWorldChecked: !!world, actualGradientChecked, initial,
    inertiaResolutionDiagnostic: { maximumNativeCoordinateSpacingForce: resolutionScale,
      relativeToFixedModalForce: forceScale > 0 ? resolutionScale / forceScale : null,
      scope: 'adjacent binary64 spacing times native mass/h^2; heuristic scale only, neither rigorous bound nor acceptance allowance' },
    perNewtonDiagnosticsMeasured: false,
    scope: world ? 'live World binding, cloned-cache full/selected gradient, exact endpoint residual and fixed literal force gate; finite honest force failure remains valid diagnostics' : 'reported-field algebra only; no actual-gradient verification or physics convergence certification' };
}

function inertialEnergy(x, xt, mass, idt2) {
  let value = 0;
  for (let v = 0; v < mass.length; v++) for (let c = 0; c < 3; c++) value += 0.5 * mass[v] * idt2 * (x[3 * v + c] - xt[3 * v + c]) ** 2;
  return value;
}
