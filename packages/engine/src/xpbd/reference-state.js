// @ts-check
/** Experimental state ABI. Physical q is the real sum X0+u; public x is its
 * binary64 projection. No rebasing, rounding feedback or external forces.
 */
import { twoSum, add as addDD, rounded } from './double-double.js';
import { assembleAndFactor } from './implicit.js';
import { validateIncrementDomain } from './increment-search.js';
import { bendingIdentity, bendingSelected, creaseSelected, setLatentAngleMemory, creaseBeyondFoldLimit, admissibleComponent, addBendingGradient } from './reference-bending.js';

export const REFERENCE_STATE_IDENTITY = Object.freeze({ mode: 'reference-displacement', version: 1,
  representation: 'binary64', origin: 'actual-X0', predictor: 'displacement-first',
  projection: 'round-X0-plus-u', preconditioner: 'rounded-public-pose' });

/** Opt-in two-word state (`stateRepresentation: 'double-double'`): the latent displacement is
 * A + u, where A is a two-word anchor set to the exact latent state at the start of each substep
 * and u is the binary64 offset the solvers update. Corrections below ulp(|A + u|) survive in u.
 * Re-anchoring rounds A + u to two words (relative 2^-106). */
export const REFERENCE_STATE_IDENTITY_TWO_WORD = Object.freeze({ ...REFERENCE_STATE_IDENTITY, version: 2,
  representation: 'two-word-substep-anchor', projection: 'round-X0-plus-anchor-plus-u', anchor: 'exact-state-at-substep-start' });
/** @param {any} w */
export function twoWordState(w) { return w.opts.stateRepresentation === 'double-double'; }
/** The live anchor, or null for the single-word state. @param {any} w */
export function stateAnchor(w) { return w._anchorHi ? { hi: w._anchorHi, lo: w._anchorLo } : null; }
/** The identity a World must carry: the planar identity, plus the bending version when selected.
 * @param {any} w */
export function expectedReferenceIdentity(w) {
  const state = twoWordState(w) ? REFERENCE_STATE_IDENTITY_TWO_WORD : REFERENCE_STATE_IDENTITY;
  return bendingSelected(w) ? { ...state, bending: { ...bendingIdentity(w) } } : state;
}
/** @param {any} w */
export function stateCoordinates(w) { return w.opts.stateCoordinates ?? 'absolute-position'; }
/** @param {any} w */
export function solverPositions(w) { return stateCoordinates(w) === 'reference-displacement' ? w._u : w.x; }
/** @param {any} w */
export function solverTarget(w) { return stateCoordinates(w) === 'reference-displacement' ? w._ut : w.xt; }
/** Explicit rounded geometry for the old hinge/preconditioner diagnostics only.
 * Elasticity, inertia and the realized solver update must use u directly.
 * @param {any} w @param {ArrayLike<number>} u @returns {Float64Array} */
export function projectReference(w, u, anchor = stateAnchor(w)) {
  const x = new Float64Array(u.length), origin = w._referenceOrigin ?? w.X0;
  if (!anchor) { for (let i = 0; i < u.length; i++) x[i] = origin[i] + u[i]; return x; }
  // X0 + A + u: exact two-word sums, rounded once.
  for (let i = 0; i < u.length; i++) x[i] = rounded(addDD(addDD(twoSum(origin[i], anchor.hi[i]), [anchor.lo[i], 0]), [u[i], 0]));
  return x;
}
/** The pose a saved factor was built at: its latent offset with its own anchor. @param {any} w @param {any} f */
export function factorPose(w, f) { return projectReference(w, f.x, f.anchorHi ? { hi: f.anchorHi, lo: f.anchorLo } : null); }
/** @param {ArrayLike<number>} a @param {ArrayLike<number>} b */
function same(a, b) { return a?.length === b?.length && Array.from(a).every((v, i) => Object.is(v, b[i])); }
/** Require exact real conversion AND the same public bytes, including zero signs.
 * -0 origin/-0 position uses -0 displacement; +0 origin/-0 position is refused.
 * @param {ArrayLike<number>} x @param {ArrayLike<number>} origin */
function exactDisplacement(x, origin, bending = false) {
  if (x.length !== origin.length) throw new Error('Reference state: invalid pose dimensions');
  const u = new Float64Array(x.length);
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || (!bending && i % 3 === 1 && x[i] !== 0)) throw new Error(bending ? 'Reference state: finite pose required' : 'Reference state: finite exact Y=0 pose required');
    const [hi, lo] = twoSum(x[i], -origin[i]);
    if (lo !== 0) throw new Error('Reference state: initial displacement needs more than one binary64 word');
    u[i] = Object.is(x[i], -0) && Object.is(origin[i], -0) ? -0 : hi;
    if (!Object.is(origin[i] + u[i], x[i])) throw new Error('Reference state: initial projection changes public bytes');
  }
  return u;
}
/** Bind every native represented element coefficient, including signed zeros.
 * @param {any} w */
function coefficients(w) {
  return Float64Array.from(w.orthotropicMembrane.elements.flatMap(e => [...e.reference.u, ...e.reference.v, ...e.reference.x0, e.reference.c, e.reference.s, ...e.Q, e.volume]));
}
/** Observation/preflight scratch is never the live solver cache. @param {any} w */
function observationMembrane(w, anchor) {
  const m = Object.assign(Object.create(Object.getPrototypeOf(w.orthotropicMembrane)), w.orthotropicMembrane);
  m.work = structuredClone(m.work); m.block = m.block.slice();
  if (anchor !== undefined) m.work.referenceAnchor = anchor ?? undefined;
  return m;
}
/** @param {any} w */
export function initialiseReferenceState(w) {
  if (stateCoordinates(w) !== 'reference-displacement') return;
  w._referenceIdentity = Object.freeze(structuredClone(expectedReferenceIdentity(w)));
  w._referenceOrigin = w.X0.slice(); w._referenceCoefficients = coefficients(w); w._referenceMass = w.mass.slice(); w._referenceH = w.dt;
  w._referenceHingeK = w.hingeK.slice(); w._referenceDriveK = w.driveK.slice();
  const bending = bendingSelected(w);
  if (twoWordState(w)) {
    w._anchorHi = new Float64Array(w.X0.length); w._anchorLo = new Float64Array(w.X0.length);
    w.orthotropicMembrane.work.referenceAnchor = { hi: w._anchorHi, lo: w._anchorLo };
  }
  w._u = exactDisplacement(w.x, w.X0, bending);
  // Preserve the actual constructor's zero xs/xt buffers, not invented targets.
  w._us = exactDisplacement(w.xs, w.X0, bending); w._ut = exactDisplacement(w.xt, w.X0, bending);
  w._referenceTargetValid = false; w._referenceStepActive = false; w._referenceNewtonActive = false;
  w._referenceInitialX = w.x.slice(); w._referenceInitialU = w._u.slice(); w._referenceInitialV = w.v.slice();
  validateReferenceState(w);
}
/** Pure preflight; mode/reference/mass/time-step drift or public writes refuse.
 * @param {any} w */
export function validateReferenceBinding(w) {
  const selected = stateCoordinates(w) === 'reference-displacement';
  if (!['absolute-position', 'reference-displacement'].includes(stateCoordinates(w)) || selected !== !!w._referenceIdentity) throw new Error('Reference state: coordinate identity changed');
  if (!selected) return;
  if (JSON.stringify(w._referenceIdentity) !== JSON.stringify(expectedReferenceIdentity(w)) ||
      w.opts.membraneReference !== 'uv-displacement' || w.opts.membraneArithmetic !== 'double-double' ||
      w.opts.lineSearchArithmetic !== 'membrane-inertia-increment') throw new Error('Reference state: model identity changed');
  if (!same(w.X0, w._referenceOrigin) || !same(w.mesh.X0, w._referenceOrigin) || !same(w.mass, w._referenceMass) || !same(coefficients(w), w._referenceCoefficients) || !same(w.hingeK, w._referenceHingeK) || !same(w.driveK, w._referenceDriveK) || !Object.is(w.dt, w._referenceH)) throw new Error('Reference state: immutable origin/mass/timestep changed');
}
/** Full boundary/state preflight. @param {any} w @param {boolean} [projections] */
export function validateReferenceState(w, projections = true) {
  validateReferenceBinding(w);
  if (!w._referenceIdentity) return;
  for (const a of [w._u, w._us, w._ut, w.v]) {
    if (!(a instanceof Float64Array) || a.length !== w.X0.length || !a.every((v, i) => admissibleComponent(w, v, i))) throw new Error(bendingSelected(w) ? 'Reference state: invalid authoritative arrays' : 'Reference state: invalid planar authoritative arrays');
  }
  if (twoWordState(w) !== !!w._anchorHi || (w._anchorHi && (![w._anchorHi, w._anchorLo].every(a => a instanceof Float64Array && a.length === w.X0.length && a.every(Number.isFinite)) ||
      w.orthotropicMembrane.work.referenceAnchor?.hi !== w._anchorHi || w.orthotropicMembrane.work.referenceAnchor?.lo !== w._anchorLo))) throw new Error('Reference state: invalid two-word anchor');
  if (typeof w._referenceTargetValid !== 'boolean' || (!w._referenceStepActive && w._referenceTargetValid !== (w.substepsRun > 0))) throw new Error('Reference state: invalid target validity');
  if (projections && (!same(w.x, projectReference(w, w._u)) || !same(w.xs, projectReference(w, w._us)) || !same(w.xt, projectReference(w, w._ut)))) throw new Error('Reference state: unsynchronized public projection edit');
  validateIncrementDomain(w, w.x);
}
/** @param {any} w */
function boundary(w) {
  if (w._referenceStepActive || w._referenceNewtonActive || w.energySearch?._incrementObjective) throw new Error('Reference state: mid-Newton/substep boundary operation is unsupported');
}
/** Explicit initial-state conversion, before any stepping/factor/search work.
 * @param {any} w @param {ArrayLike<number>} x @param {ArrayLike<number>} [velocity] */
export function setInitialReferencePose(w, x, velocity = new Float64Array(x.length)) {
  validateReferenceState(w); boundary(w);
  if (!w._referenceIdentity) throw new Error('Reference state: select reference-displacement first');
  if (w.substepsRun !== 0 || w.framesRun !== 0 || w.time !== 0 || w._acc !== 0 || w.factorCount !== 0 || w.energySearch?._incrementObjective || w.energySearch?.increment.last !== null) throw new Error('Reference state: initial pose requires a pristine World');
  const u = exactDisplacement(x, w.X0, bendingSelected(w)), v = Float64Array.from(velocity);
  if (v.length !== x.length || !v.every((n, i) => admissibleComponent(w, n, i))) throw new Error('Reference state: invalid initial velocity');
  if (!observationMembrane(w).diagnostics(u, 'reference-displacement').finite) throw new Error('Reference state: invalid initial membrane metric');
  // Crease law: the angle memory starts from the latent initial pose on each rest branch, and the pose must lie inside every fold limit.
  const memory = creaseSelected(w) ? w.theta.slice() : null;
  w._u.set(u);
  if (memory) {
    setLatentAngleMemory(w);
    const h = creaseBeyondFoldLimit(w, u);
    if (h >= 0) { w.theta.set(memory); w._u.fill(0); throw new Error(`Reference state: crease hinge ${h} starts beyond its fold limit; contact is not admitted`); }
  }
  w.x.set(x); w.v.set(v);
  w._referenceInitialX = w.x.slice(); w._referenceInitialU = u.slice(); w._referenceInitialV = v.slice();
  w.dirty = true; w.poseVersion++; w.wake();
}
/** @param {any} w */
export function projectCurrentReference(w) { if (w._referenceIdentity) w.x.set(projectReference(w, w._u)); }
/** Restricted backward-Euler substep. The coordinate shift changes native
 * predictor association; masses/h, solver budgets and Armijo policy do not.
 * @param {any} w */
export function stepReferenceState(w) {
  validateReferenceState(w);
  boundary(w); w._referenceStepActive = true;
  try {
  const dt = w.dt, u = w._u, us = w._us, ut = w._ut, v = w.v;
  if (w._anchorHi) {
    // Re-anchor: A <- A + u in two words, u <- 0; the public pose is re-projected from the new anchor.
    for (let i = 0; i < u.length; i++) { const a = addDD([w._anchorHi[i], w._anchorLo[i]], [u[i], 0]); w._anchorHi[i] = a[0]; w._anchorLo[i] = a[1]; u[i] = 0; }
    projectCurrentReference(w);
  }
  us.set(u); w.xs.set(w.x);
  for (let i = 0; i < u.length; i++) u[i] += dt * v[i];
  ut.set(u); w.xt.set(projectReference(w, ut)); w._referenceTargetValid = true;
  if (w.opts.previousPoseStart) u.set(us);
  projectCurrentReference(w);
  w._checkRotation(); w._newton();
  for (let i = 0; i < u.length; i++) v[i] = (u[i] - us[i]) / dt;
  projectCurrentReference(w); w._hingeUpdate();
  w.time += dt; w.substepsRun++;
  } finally { w._referenceStepActive = false; }
}
/** Copies, never writable aliases of authority. Boundary/substep snapshots only.
 * @param {any} w */
export function referenceStateSnapshot(w) {
  validateReferenceState(w);
  if (!w._referenceIdentity) return undefined;
  boundary(w);
  return { identity: structuredClone(w._referenceIdentity), ...(w._anchorHi ? { anchorHi: w._anchorHi.slice(), anchorLo: w._anchorLo.slice() } : {}), u: w._u.slice(), us: w._us.slice(), ut: w._ut.slice(),
    x: w.x.slice(), xs: w.xs.slice(), xt: w.xt.slice(), v: w.v.slice(), x0: w._referenceOrigin.slice(),
    coefficients: w._referenceCoefficients.slice(), mass: w._referenceMass.slice(), h: w._referenceH, targetValid: w._referenceTargetValid,
    initialX: w._referenceInitialX.slice(), initialU: w._referenceInitialU.slice(), initialV: w._referenceInitialV.slice() };
}
/** Atomic preflight of incoming latent/public pair before any World writes.
 * @param {any} w @param {any} s */
export function prepareReferenceRestore(w, s) {
  validateReferenceState(w);
  const r = s.referenceState;
  if (!!r !== !!w._referenceIdentity) throw new Error('Reference state: snapshot coordinate mismatch');
  if (!r) return null;
  boundary(w);
  const arrays = { x: w.x, v: w.v, theta: w.theta, restTheta: w.restTheta, memory: w.memory,
    hingeK: w.hingeK, driveK: w.driveK, edgeComp: w.edgeComp, driveOn: w.driveOn, driveTarget: w.driveTarget,
    fixedTarget: w.fixedTarget, userForce: w.userForce, stringTaut: w._stringTaut, factorDir: w.factorDir };
  const check = (values, expected) => values?.constructor === expected.constructor && values.length === expected.length && values.every(Number.isFinite);
  for (const [name, expected] of Object.entries(arrays)) if (!check(s[name], expected)) throw new Error('Reference state: invalid snapshot array ' + name);
  for (const name of ['substepsRun', 'framesRun', 'quiet', 'pcgFail', 'torn']) if (!Number.isSafeInteger(s[name]) || s[name] < 0) throw new Error('Reference state: invalid snapshot counter');
  for (const name of ['time', 'handScale', 'handCalm']) if (!Number.isFinite(s[name]) || s[name] < 0) throw new Error('Reference state: invalid snapshot scalar');
  if (!Number.isFinite(s.acc) || s.acc < -1e-9 || s.acc >= 1) throw new Error('Reference state: invalid snapshot frame accumulator');
  if (!same(s.hingeK, w._referenceHingeK) || !same(s.driveK, w._referenceDriveK)) throw new Error('Reference state: snapshot stiffness binding mismatch');
  if (r.targetValid !== (s.substepsRun > 0)) throw new Error('Reference state: snapshot target validity mismatch');
  if (!s.terms || !Array.isArray(s.terms.info) || s.terms.info.length !== w.terms.info.length || s.terms.info.some(v => !v || typeof v !== 'object' || ['target', 'held'].some(k => v[k] && (!Array.isArray(v[k]) || v[k].length !== 3 || !v[k].every(Number.isFinite))))) throw new Error('Reference state: invalid snapshot term metadata');
  for (const name of ['active', 'k', 'mode', 'verts', 'coef']) if (!check(s.terms[name], w.terms[name])) throw new Error('Reference state: invalid snapshot term array');
  if (!!s.terms.gateOff !== !!w.terms.gateOff || (s.terms.gateOff && !check(s.terms.gateOff, w.terms.gateOff))) throw new Error('Reference state: invalid snapshot gateOff array');
  if (!Array.isArray(s.gates) || s.gates.length !== 0 || !['backtracks', 'rejected'].every(k => Number.isSafeInteger(s.energySearch?.[k]) && s.energySearch[k] >= 0)) throw new Error('Reference state: invalid snapshot gate/search metadata');
  if (!s.drivers || !['value', 'goal', 'entry'].every(name => Array.isArray(s.drivers[name]) && s.drivers[name].length === 0) || s.drivers.program !== null || s.drivers.kin !== null || s.drivers.wind !== 0) throw new Error('Reference state: invalid snapshot drivers');
  if (!s.membrane || !['factorCount', 'pcgIterations'].every(name => Number.isSafeInteger(s.membrane[name]) && s.membrane[name] >= 0)) throw new Error('Reference state: invalid snapshot solver counters');
  if (JSON.stringify(r.identity) !== JSON.stringify(w._referenceIdentity) || !same(r.x0, w._referenceOrigin) || !same(r.mass, w._referenceMass) || !same(r.coefficients, w._referenceCoefficients) || !Object.is(r.h, w.dt)) throw new Error('Reference state: snapshot binding mismatch');
  const anchor = w._anchorHi ? { hi: r.anchorHi, lo: r.anchorLo } : null;
  if (anchor && ![anchor.hi, anchor.lo].every(a => a instanceof Float64Array && a.length === w.x.length && a.every(Number.isFinite))) throw new Error('Reference state: invalid snapshot anchor');
  if (!anchor && (r.anchorHi !== undefined || r.anchorLo !== undefined)) throw new Error('Reference state: snapshot binding mismatch');
  const zero = anchor ? { hi: new Float64Array(w.x.length), lo: new Float64Array(w.x.length) } : null;
  const fields = ['u', 'us', 'ut', 'x', 'xs', 'xt', 'v', 'initialX', 'initialU', 'initialV'];
  for (const name of fields) if (!(r[name] instanceof Float64Array) || r[name].length !== w.x.length || !r[name].every((n, i) => admissibleComponent(w, n, i))) throw new Error('Reference state: invalid snapshot arrays');
  if (!same(r.x, s.x) || !same(r.v, s.v) || !same(r.x, projectReference(w, r.u, anchor)) || !same(r.xs, projectReference(w, r.us, anchor)) || !same(r.xt, projectReference(w, r.ut, anchor)) ||
      !same(r.initialX, projectReference(w, r.initialU, zero)) || !same(r.initialU, exactDisplacement(r.initialX, w.X0, bendingSelected(w))) || typeof r.targetValid !== 'boolean') throw new Error('Reference state: inconsistent snapshot projection');
  if (s.factor && (s.factor.coordinates !== 'reference-displacement' || !(s.factor.x instanceof Float64Array) || s.factor.x.length !== w.x.length || !s.factor.x.every((n, i) => admissibleComponent(w, n, i)) || !observationMembrane(w, s.factor.anchorHi ? { hi: s.factor.anchorHi, lo: s.factor.anchorLo } : null).diagnostics(s.factor.x, 'reference-displacement').finite)) throw new Error('Reference state: invalid snapshot factor coordinates');
  if (s.factor && anchor && ![s.factor.anchorHi, s.factor.anchorLo].every(a => a instanceof Float64Array && a.length === w.x.length && a.every(Number.isFinite))) throw new Error('Reference state: invalid snapshot factor anchor');
  if (!observationMembrane(w, anchor).diagnostics(r.u, 'reference-displacement').finite) throw new Error('Reference state: invalid snapshot current metric');
  if (s.factor) {
    const f = s.factor;
    const factorArrays = { driveOn: w.driveOn, edgeComp: w.edgeComp, active: w.terms.active, k: w.terms.k,
      mode: w.terms.mode, verts: w.terms.verts, c: w.terms.c, dir: w.terms.dir, len: w.terms.len };
    for (const [name, expected] of Object.entries(factorArrays)) if (!check(f[name], expected)) throw new Error('Reference state: invalid snapshot factor array');
    const factorAnchor = f.anchorHi ? { hi: f.anchorHi, lo: f.anchorLo } : null;
    const factorWorld = Object.assign(Object.create(w), { x: factorPose(w, f), xs: r.xs, xt: r.xt, v: s.v, ...(factorAnchor ? { _anchorHi: factorAnchor.hi, _anchorLo: factorAnchor.lo } : {}),
      driveOn: f.driveOn, terms: { ...w.terms, active: f.active, k: f.k, mode: f.mode, verts: f.verts, c: f.c, dir: f.dir, len: f.len }, restTheta: s.restTheta, theta: s.theta, hingeK: s.hingeK,
      orthotropicMembrane: observationMembrane(w, factorAnchor), factorDir: w.factorDir.slice(),
      sys: { ...w.sys, ch: Object.assign(Object.create(Object.getPrototypeOf(w.sys.ch)), structuredClone(w.sys.ch)) } });
    validateIncrementDomain(factorWorld, factorWorld.x);
    try { assembleAndFactor(factorWorld, f.x, 'reference-displacement', f.curvature ?? 'gauss-newton'); }
    catch { throw new Error('Reference state: snapshot factor cannot be rebuilt'); }
  }
  const candidate = Object.assign(Object.create(w), { x: r.x, xs: r.xs, xt: r.xt, v: s.v,
    userForce: s.userForce, theta: s.theta, restTheta: s.restTheta, hingeK: s.hingeK, driveOn: s.driveOn,
    terms: { ...w.terms, ...s.terms }, drivers: { ...w.drivers, ...s.drivers,
      value: new Map(s.drivers.value), goal: new Map(s.drivers.goal) } });
  validateIncrementDomain(candidate, r.x);
  return r;
}
/** @param {any} w @param {any} r */
export function restoreReferenceState(w, r) {
  if (!r) return;
  w._u.set(r.u); w._us.set(r.us); w._ut.set(r.ut); w.xs.set(r.xs); w.xt.set(r.xt);
  w._referenceInitialX = r.initialX.slice(); w._referenceInitialU = r.initialU.slice(); w._referenceInitialV = r.initialV.slice();
  w._referenceTargetValid = r.targetValid;
  if (w._anchorHi) { w._anchorHi.set(r.anchorHi); w._anchorLo.set(r.anchorLo); }
}

/** Both native residuals, same caller-supplied frozen tau. Public fields retain
 * their absolute-position meaning; targetValid=false cannot certify a solve.
 * This observation never changes live force/factor/model scratch.
 * @param {any} w @param {number} forceTolerance */
export function referenceResiduals(w, forceTolerance) {
  validateReferenceState(w);
  if (!w._referenceIdentity || !(Number.isFinite(forceTolerance) && forceTolerance > 0)) throw new Error('Reference state: selected mode and positive finite force tolerance required');
  boundary(w);
  const model = observationMembrane(w), idt2 = 1 / (w.dt * w.dt);
  const evaluate = (x, target, coordinates) => {
    const elasticGradient = new Float64Array(x.length), inertiaGradient = new Float64Array(x.length), residual = new Float64Array(x.length);
    model.addGradient(x, elasticGradient, coordinates);
    // Bending joins the elastic force only under its identity; the planar path is unchanged.
    const bendingEnergy = bendingSelected(w) ? addBendingGradient(w, x, elasticGradient, coordinates) : undefined;
    let residualInfinity = 0;
    for (let i = 0; i < x.length; i++) {
      const c = w.mass[Math.floor(i / 3)] * idt2;
      inertiaGradient[i] = c * (x[i] - target[i]);
      residual[i] = elasticGradient[i] + inertiaGradient[i];
      residualInfinity = Math.max(residualInfinity, Math.abs(residual[i]));
    }
    const membraneEnergy = model.energy(x, coordinates);
    return { energy: bendingEnergy === undefined ? membraneEnergy : membraneEnergy + bendingEnergy, ...(bendingEnergy === undefined ? {} : { bendingEnergy }), elasticGradient, inertiaGradient, residual, residualInfinity };
  };
  const authoritative = evaluate(w._u, w._ut, 'reference-displacement'), publicState = evaluate(w.x, w.xt, 'absolute-position');
  return { forceTolerance, targetValid: w._referenceTargetValid,
    authoritative: { ...authoritative, converged: w._referenceTargetValid ? authoritative.residualInfinity <= forceTolerance : null },
    public: { ...publicState, literalForceGate: w._referenceTargetValid ? publicState.residualInfinity <= forceTolerance : null } };
}

/** Existing stats fields describe projected geometry; label the changed ABI and
 * add independently named authoritative diagnostics without changing old fields.
 * @param {any} w */
export function referenceDiagnostics(w) {
  if (!w._referenceIdentity) return undefined;
  validateReferenceState(w); boundary(w);
  const m = observationMembrane(w);
  return { identity: structuredClone(w._referenceIdentity), existingStatsCoordinates: 'rounded-public-position',
    authoritative: { energyNJ: m.energy(w._u, 'reference-displacement'), membrane: m.diagnostics(w._u, 'reference-displacement'),
      ...(bendingSelected(w) ? { bendingEnergyNJ: addBendingGradient(w, w._u, new Float64Array(w._u.length), 'reference-displacement') } : {}) } };
}
