// @ts-check
/** Opt-in planar membrane/inertia globalization. This is approximate binary64
 * arithmetic, not an interval bound, equilibrium certificate or material calibration.
 * Actual rounded trial displacements and a strict Armijo rule have no energy floor.
 * Under `referenceBending: 'panel-hinges'` states may leave the plane and the panel
 * bending remainder (reference-bending.js) joins the trial change.
 */
import { dihedral } from './dihedral.js';
import { unwrap } from './implicit.js';
import { implicitEnergy } from './energy-search.js';
import { HINGE_PANEL } from '../mesh.js';
import { DOUBLE_DOUBLE_IDENTITY, add as addDD, rounded as roundedDD } from './double-double.js';
import { accurateTrialTerms } from './accurate-membrane.js';
import { UV_REFERENCE_IDENTITY, describeUVReference } from './uv-reference.js';
import { stateCoordinates, solverPositions, solverTarget, projectReference, projectCurrentReference, validateReferenceBinding } from './reference-state.js';
import { validateCurvatureIdentity } from './membrane-curvature.js';
import { bendingSelected, creaseSelected, admittedHingeKind, creaseBeyondFoldLimit, admissibleComponent, bendingIncrement } from './reference-bending.js';

export const INCREMENT_SEARCH_IDENTITY = Object.freeze({ name: 'membrane-inertia-increment', version: 1, armijo: 1e-4, maxBacktracks: 20 });

/** Pure identity preflight, independent of the pose being replaced by restore.
 * @param {any} w */
export function validateMembraneArithmeticIdentity(w) {
  const mode = w.opts.membraneArithmetic, dd = mode === 'double-double', identity = w.orthotropicMembrane?.configuration.arithmetic;
  if (!['binary64', 'double-double'].includes(mode ?? 'binary64') || dd !== (w.orthotropicMembrane?.work.arithmetic === 'double-double') || dd !== !!identity ||
      (dd && (Object.keys(identity).length !== Object.keys(DOUBLE_DOUBLE_IDENTITY).length || Object.entries(DOUBLE_DOUBLE_IDENTITY).some(([key, value]) => identity[key] !== value)))) throw new Error('Membrane arithmetic identity changed');
  const reference = w.opts.membraneReference ?? 'material-coefficients', model = w.orthotropicMembrane, uv = reference === 'uv-displacement';
  if (!['material-coefficients', 'uv-displacement'].includes(reference) || uv !== !!model?.configuration.reference || uv !== (model?.work.reference === 'uv-displacement') ||
      (uv && (!dd || w.opts.lineSearchArithmetic !== 'membrane-inertia-increment' || JSON.stringify(model.configuration) !== model.configurationKey || model.configurationKey !== w.orthotropicMembraneSignature || JSON.stringify(model.configuration.reference) !== JSON.stringify(UV_REFERENCE_IDENTITY) ||
        !model.elements.every(e => e.reference?.mode === 'uv-displacement' && e.reference.version === 1) ||
        JSON.stringify(model.elements.map(e => describeUVReference(e.reference))) !== JSON.stringify(model.configuration.referenceElements))) ||
      (!uv && (model?.configuration.referenceElements !== undefined || model?.elements.some(e => e.reference !== undefined)))) throw new Error('Membrane reference identity changed');
}

/** @param {any} search */
export function initialiseIncrementSearch(search) {
  search.increment = { accepted: 0, stationaryNoops: 0, precisionLimited: 0, invalidTrials: 0, last: null };
  search._incrementObjective = null;
}

/** Reject omitted physics explicitly rather than subtracting nearly equal totals.
 * Invalid membrane metrics are checked separately so an invalid trial may backtrack.
 * @param {any} w @param {Float64Array} x
 */
export function validateIncrementDomain(w, x) {
  const fail = message => { throw new Error(`membrane-inertia-increment domain: ${message}`); };
  const o = w.opts, D = w.drivers;
  validateMembraneArithmeticIdentity(w);
  if (o.lineSearchArithmetic !== 'membrane-inertia-increment' || !w.orthotropicMembrane || o.membraneModel !== 'orthotropic-stvk' || !o.lineSearch || !o.physicalMembrane ||
      w.kCompFactor !== 1 || o.membranePoissonConvention !== 'nu12' || !['gauss-newton', 'exact-hessian'].includes(o.membraneCurvature) ||
      (o.membraneCurvature === 'exact-hessian' && stateCoordinates(w) !== 'reference-displacement') ||
      o.membraneProjection !== 'none' || o.plasticity !== false) fail('selected research membrane prerequisites changed');
  validateCurvatureIdentity(w);
  if (o.damping !== 0 || w.bendDamp !== 0 || o.gravity !== false || o.ground !== false || o.contact !== false ||
      o.continuousContact || o.barrierContact || w.contact || w.motionGuard || w.coupledContact || w.edgeContact) fail('damping, gravity and contact are unsupported');
  if (!(w.dt > 0 && Number.isFinite(w.dt) && Number.isFinite(1 / (w.dt * w.dt)))) fail('invalid timestep');
  if (D.wind !== 0 || D.program || D.kin || D.seq || D.groups.length || D.leaves.length || D.controls.size || D.mech.size || D.value.size || D.goal.size) fail('wind, drivers and kinematics are unsupported');
  if (w.doc.joins.length || w.doc.controls.length || w.doc.mechanisms.length || w.mesh.perfPairs.length ||
      w.doc.sheets.some(s => s.kinematic) || w.mesh.hingeKind.some(k => !admittedHingeKind(w, k))) fail('authored terms are unsupported');
  for (let t = 0; t < w.terms.count; t++) if (w.terms.active[t]) fail('active terms are unsupported');
  for (let i = 0; i < w.mesh.nV; i++) {
    if (w.fixed[i] || !(w.mass[i] > 0 && Number.isFinite(w.mass[i]) && w.invMass[i] > 0 && Number.isFinite(w.invMass[i])) || w.invMass[i] !== 1 / w.mass[i]) fail('all native vertices must be free with positive coherent mass');
  }
  const bending = bendingSelected(w);
  if (bending && stateCoordinates(w) !== 'reference-displacement') fail('panel bending is admitted only in reference-displacement coordinates');
  for (const a of [x, w.xs, w.xt, w.v]) {
    if (a.length !== 3 * w.mesh.nV) fail('state dimensions changed');
    for (let i = 0; i < a.length; i++) {
      if (!admissibleComponent(w, a[i], i)) fail(bending ? 'only finite states are supported' : 'only finite exact Y=0 planar states are supported');
    }
  }
  for (const a of [w.userForce, w.fext]) for (const f of a) if (f !== 0) fail('external forces are unsupported');
  const H = w.mesh.hinges;
  for (let h = 0; h < w.mesh.nH; h++) {
    if (w.driveOn[h]) fail('active hinge drives are unsupported');
    const angle = unwrap(w.theta[h], dihedral(x, H[4 * h], H[4 * h + 1], H[4 * h + 2], H[4 * h + 3], null));
    const k = w.hingeK[h], d = angle - w.restTheta[h];
    const panel = w.mesh.hingeKind[h] === HINGE_PANEL;
    if (!Number.isFinite(k) || k < 0 || !Number.isFinite(angle) || !Number.isFinite(w.theta[h]) || (panel && w.restTheta[h] !== 0)) fail('invalid hinge state or nonflat rest angle');
    // Crease law: an authored rest angle strictly inside the fold limit (contact is not admitted).
    if (!panel && !(Number.isFinite(w.restTheta[h]) && Math.abs(w.restTheta[h]) < w.foldLimit[h])) fail('crease rest angle outside its fold limit');
    // Without the bending identity, hinge energy is omitted work and must be exactly zero.
    if (!bending && (0.5 * k * d * d !== 0 || k * d !== 0)) fail('nonzero or invalid omitted hinge energy/force');
  }
}

/** @param {any} search @param {any} w */
export function beginIncrementSearch(search, w) {
  if (!search.increment) throw new Error('membrane-inertia-increment arithmetic identity changed');
  const coordinates = stateCoordinates(w), x = solverPositions(w);
  validateReferenceBinding(w);
  validateIncrementDomain(w, w.x);
  if (!w.orthotropicMembrane.diagnostics(x, coordinates).finite) throw new Error('membrane-inertia-increment: invalid starting membrane metric/arithmetic: ' + (w.orthotropicMembrane.work.arithmeticError ?? ''));
  search.start.set(x); search.energy = implicitEnergy(w, x, coordinates);
  if (!Number.isFinite(search.energy)) throw new Error('membrane-inertia-increment: non-finite starting objective');
  search._incrementObjective = { h: w.dt, mass: w.mass.slice(), inverse: w.invMass.slice(), target: solverTarget(w).slice(), coordinates };
}

/** Neumaier accumulation; the scale is diagnostic, never an acceptance bound. */
function accumulator() {
  let sum = 0, correction = 0, magnitude = 0;
  return { add(value) { const t = sum + value; correction += Math.abs(sum) >= Math.abs(value) ? (sum - t) + value : (value - t) + sum; sum = t; magnitude += Math.abs(value); }, value() { return sum + correction; }, magnitude() { return magnitude; } };
}

/** @param {any} search @param {any} w @param {Float64Array} gradient */
export function finishIncrementSearch(search, w, gradient) {
  const objective = search._incrementObjective, coordinates = objective?.coordinates ?? stateCoordinates(w);
  const target = coordinates === 'reference-displacement' ? w._ut : w.xt, x = coordinates === 'reference-displacement' ? w._u : w.x;
  const old = search.start, proposal = search.delta, counts = search.increment;
  if (!counts || !objective) throw new Error('membrane-inertia-increment: begin is required');
  const reject = () => { x.set(old); search.rejected++; w.dirty = true; };
  try {
    validateReferenceBinding(w);
    if (stateCoordinates(w) !== objective.coordinates) throw new Error('membrane-inertia-increment: coordinates changed during search');
    if (w.dt !== objective.h) throw new Error('membrane-inertia-increment: timestep changed during search');
    for (let i = 0; i < w.mass.length; i++) if (!Object.is(w.mass[i], objective.mass[i]) || !Object.is(w.invMass[i], objective.inverse[i])) throw new Error('membrane-inertia-increment: mass changed during search');
    for (let i = 0; i < target.length; i++) if (!Object.is(target[i], objective.target[i])) throw new Error('membrane-inertia-increment: target changed during search');
    if (gradient.length !== x.length || !gradient.every(Number.isFinite)) throw new Error('membrane-inertia-increment: invalid starting gradient');
    validateIncrementDomain(w, coordinates === 'reference-displacement' ? projectReference(w, old) : old);
    // A start already past a crease's fold limit (for example the predictor) needs contact: refuse visibly.
    if (creaseSelected(w) && creaseBeyondFoldLimit(w, old) >= 0) throw new Error('membrane-inertia-increment domain: crease beyond its fold limit; contact is not admitted');
    for (let i = 0; i < x.length; i++) proposal[i] = x[i] - old[i];
    let last = null;
    for (let trial = 0; trial <= INCREMENT_SEARCH_IDENTITY.maxBacktracks; trial++) {
      const alpha = 2 ** -trial;
      if (trial) for (let i = 0; i < x.length; i++) x[i] = old[i] + alpha * proposal[i];
      // A nonfinite/collapsed membrane proposal is a rejected trial. Unsupported
      // finite nonplanar physics is a visible error, not silently omitted work.
      let valid = x.every(Number.isFinite);
      validateReferenceBinding(w);
      validateIncrementDomain(w, coordinates === 'reference-displacement' ? projectReference(w, old) : old);
      if (valid) {
        // Check structural physics even for collapsed triangles; dihedral needs
        // a valid metric, so use the start only for this preliminary check.
        if (!bendingSelected(w)) for (let i = 1; i < x.length; i += 3) if (x[i] !== 0) throw new Error('membrane-inertia-increment domain: nonplanar trial');
        valid = w.orthotropicMembrane.diagnostics(x, coordinates).finite;
        // A crease past its fold limit would need contact: the trial is invalid and the search backtracks.
        if (valid && creaseSelected(w) && creaseBeyondFoldLimit(w, x) >= 0) valid = false;
        if (valid) validateIncrementDomain(w, coordinates === 'reference-displacement' ? projectReference(w, x) : x);
      }
      const slope = accumulator(), inertiaR = accumulator(), inertiaL = accumulator();
      let zero = true, stationary = true;
      const idt2 = 1 / (w.dt * w.dt);
      for (let i = 0; i < x.length; i++) {
        const d = x[i] - old[i], coefficient = w.mass[Math.floor(i / 3)] * idt2;
        if (d !== 0) zero = false;
        if (gradient[i] !== 0) stationary = false;
        slope.add(gradient[i] * d);
        inertiaR.add(0.5 * coefficient * d * d);
        inertiaL.add(coefficient * (old[i] - target[i]) * d);
      }
      const details = valid ? w.orthotropicMembrane.energyDifferenceDetails(old, x, coordinates) : null;
      // Bending: its linear part is already in the slope (the gradient includes hinges); the remainder joins the change.
      const bend = valid && bendingSelected(w) ? bendingIncrement(w, old, x) : null;
      if (bend && !bend.valid) valid = false;
      const dd = valid && w.opts.membraneArithmetic === 'double-double' ? accurateTrialTerms(w, old, x, gradient, target) : null;
      const s = dd?.slope ?? slope.value(), mr = details?.remainder ?? NaN, ir = dd?.inertiaRemainder ?? inertiaR.value(), il = dd?.inertiaLinear ?? inertiaL.value();
      const sum = accumulator(); sum.add(s); sum.add(mr); sum.add(ir); if (bend) sum.add(bend.remainder);
      const planarWords = dd && details?.valid ? addDD(addDD(dd.slopeWords, details.remainderWords), dd.inertiaWords) : null;
      const deltaWords = planarWords && bend ? addDD(planarWords, [bend.remainder, 0]) : planarWords;
      const delta = deltaWords ? roundedDD(deltaWords) : sum.value(), raw = valid ? implicitEnergy(w, x, coordinates) - search.energy : NaN;
      const finite = value => Number.isFinite(value) ? value : null;
      last = { decision: 'rejected', reason: valid ? 'non-descent' : 'invalid-trial', trials: trial + 1, alpha,
        slope: finite(s), delta: finite(delta), rawDifference: finite(raw), membraneDifference: finite(details?.difference),
        membraneRemainder: finite(mr), inertiaRemainder: finite(ir), membraneLinear: finite(details?.linear), inertiaLinear: finite(il),
        armijoRhs: finite(INCREMENT_SEARCH_IDENTITY.armijo * s),
        gradientDiscrepancy: finite(bend ? (details?.linear ?? NaN) + il + bend.linear - s : (details?.linear ?? NaN) + il - s),
        heuristicScale: finite(64 * Number.EPSILON * ((dd?.slopeMagnitude ?? slope.magnitude()) + (details?.absoluteRemainderTermSum ?? 0) + (dd?.inertiaMagnitude ?? inertiaR.magnitude()) + (bend ? bend.magnitude : 0))),
        ...(bend ? { bendingDifference: finite(bend.difference), bendingLinear: finite(bend.linear), bendingRemainder: finite(bend.remainder), bendingMagnitude: finite(bend.magnitude) } : {}),
        ...(w.opts.membraneArithmetic === 'double-double' ? { displacementArithmetic: 'two-diff',
          slopeHi: dd?.slopeWords[0] ?? null, slopeLo: dd?.slopeWords[1] ?? null,
          membraneRemainderHi: details?.remainderWords?.[0] ?? null, membraneRemainderLo: details?.remainderWords?.[1] ?? null,
          inertiaRemainderHi: dd?.inertiaWords[0] ?? null, inertiaRemainderLo: dd?.inertiaWords[1] ?? null,
          deltaHi: deltaWords?.[0] ?? null, deltaLo: deltaWords?.[1] ?? null } : {}) };
      if (zero) {
        last.decision = stationary ? 'stationary-noop' : 'precision-limited-zero-step';
        last.reason = 'zero-realized-step'; counts.last = last;
        if (stationary) { counts.stationaryNoops++; return; }
        counts.precisionLimited++; reject(); return;
      }
      if (!valid || !details.valid || !Number.isFinite(delta)) { counts.invalidTrials++; continue; }
      if (s < 0 && delta <= INCREMENT_SEARCH_IDENTITY.armijo * s) {
        last.decision = 'accepted'; last.reason = 'strict-armijo'; counts.last = last; counts.accepted++;
        search.backtracks += trial; if (trial) w.dirty = true; return;
      }
      if (s < 0) last.reason = 'armijo';
    }
    counts.last = last; reject();
  } catch (error) {
    x.set(old); w.dirty = true; throw error;
  } finally {
    search._incrementObjective = null;
    projectCurrentReference(w);
  }
}

/** No redundant metadata or shape changes on the historical arithmetic path.
 * @param {any} search @returns {any}
 */
export function getIncrementSearchSnapshot(search) {
  return search?.increment ? { arithmetic: { ...INCREMENT_SEARCH_IDENTITY }, increment: structuredClone(search.increment) } : {};
}

/** Validate before mutation; missing historical metadata means total-energy.
 * @param {any} search @param {any} payload
 */
export function restoreIncrementSearchSnapshot(search, payload) {
  const identity = payload?.arithmetic, selected = !!search?.increment;
  const expected = INCREMENT_SEARCH_IDENTITY;
  if (selected !== !!identity || (identity && (Object.keys(identity).length !== Object.keys(expected).length || Object.keys(expected).some(key => identity[key] !== expected[key])))) throw new Error('Line search: snapshot arithmetic identity mismatch');
  if (!selected) { if (payload?.increment !== undefined) throw new Error('Line search: unexpected increment snapshot'); return; }
  const value = payload?.increment;
  if (!value || Object.keys(value).sort().join() !== 'accepted,invalidTrials,last,precisionLimited,stationaryNoops' ||
      ['accepted', 'invalidTrials', 'precisionLimited', 'stationaryNoops'].some(key => !Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error('Line search: invalid increment snapshot counters');
  const finiteTree = item => item === null || typeof item === 'string' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'object' && Object.values(item).every(finiteTree));
  if (!finiteTree(value.last) || (value.last !== null && !['accepted', 'stationary-noop', 'precision-limited-zero-step', 'rejected'].includes(value.last.decision))) throw new Error('Line search: invalid increment snapshot decision');
  search.increment = structuredClone(value); search._incrementObjective = null;
}
