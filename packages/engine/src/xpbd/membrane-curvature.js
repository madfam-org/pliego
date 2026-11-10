// @ts-check
/** Named membrane search-curvature identity and its exact-only receipts.
 * Dependency leaf: no World, solver or search imports, so the identity can be
 * checked from the increment search and reference state without new cycles.
 * 'exact-hessian' is exact membrane curvature (Gauss–Newton plus the geometric
 * stress term) for the orthotropic membrane only. Hinges, terms and inertia keep
 * their existing operators; no regularization, shift or clipping is applied.
 */

export const MEMBRANE_CURVATURES = Object.freeze(['gauss-newton', 'exact-hessian']);

export const EXACT_CURVATURE_IDENTITY = Object.freeze({ name: 'exact-membrane-curvature', version: 1,
  operator: 'gauss-newton-plus-geometric-stress', scope: 'orthotropic-membrane-only',
  fallback: 'gauss-newton-once-on-finite-nonpositive-pivot', pcg: 'exact-current-operator-stale-factor-preconditioner',
  regularization: 'none' });

const COUNTERS = Object.freeze(['iterations', 'pcgAttempts', 'pcgConverged', 'zeroRhs', 'pcgNonpositiveCurvature', 'pcgNonfiniteProduct',
  'pcgStagnation', 'pcgIterationLimit', 'pcgNonDescent', 'pcgNonfiniteDirection', 'exactFactorAttempts', 'exactFactors',
  'finiteNonpositivePivots', 'gnFallbackFactors', 'nonfiniteFailures']);
const PCG_REASONS = Object.freeze({ 'converged': 'pcgConverged', 'zero-rhs': 'zeroRhs', 'nonpositive-curvature': 'pcgNonpositiveCurvature',
  'nonfinite-product': 'pcgNonfiniteProduct', 'stagnation': 'pcgStagnation', 'iteration-limit': 'pcgIterationLimit',
  'non-descent': 'pcgNonDescent', 'nonfinite-direction': 'pcgNonfiniteDirection' });
const DIRECTIONS = ['exact-hessian', 'gauss-newton-fallback'], OPERATORS = ['exact-hessian', 'gauss-newton'];

/** @param {any} w @returns {'gauss-newton'|'exact-hessian'} */
export function requestedCurvature(w) { return w.opts.membraneCurvature === 'exact-hessian' ? 'exact-hessian' : 'gauss-newton'; }

/** Validate an explicit operator selector; old callers pass nothing.
 * @param {string} curvature @param {any} membrane */
export function selectCurvature(curvature, membrane) {
  if (!MEMBRANE_CURVATURES.includes(curvature)) throw new RangeError('Membrane curvature: invalid operator selector');
  if (curvature === 'exact-hessian' && !membrane) throw new Error('Membrane curvature: exact-hessian requires the orthotropic membrane');
  return curvature === 'exact-hessian';
}

/** Model configuration fields; the Gauss–Newton configuration bytes are unchanged.
 * @param {string} curvature */
export function curvatureConfiguration(curvature) {
  if (!MEMBRANE_CURVATURES.includes(curvature)) throw new Error('Orthotropic membrane: invalid membrane curvature');
  return curvature === 'exact-hessian' ? { curvature, curvaturePolicy: { ...EXACT_CURVATURE_IDENTITY } } : { curvature };
}

/** Pure identity preflight: option, model configuration and exact-only state agree.
 * @param {any} w */
export function validateCurvatureIdentity(w) {
  const requested = w.opts.membraneCurvature, model = w.orthotropicMembrane, exact = requested === 'exact-hessian';
  const policy = model?.configuration.curvaturePolicy;
  if (!MEMBRANE_CURVATURES.includes(requested) || model?.configuration.curvature !== requested || exact !== !!w._exactCurvature ||
      exact !== (policy !== undefined) || (exact && (Object.keys(policy).length !== Object.keys(EXACT_CURVATURE_IDENTITY).length ||
        Object.entries(EXACT_CURVATURE_IDENTITY).some(([key, value]) => policy[key] !== value))) ||
      (exact && (w.opts.stateCoordinates !== 'reference-displacement' || w._exactCurvature.requested !== 'exact-hessian'))) throw new Error('Membrane curvature identity changed');
}

/** Exact mode only; Gauss–Newton Worlds keep their historical shape. @param {any} w */
export function initialiseExactCurvature(w) {
  if (requestedCurvature(w) !== 'exact-hessian') return;
  w._exactCurvature = { requested: 'exact-hessian', counters: Object.fromEntries(COUNTERS.map(key => [key, 0])), last: null };
  validateCurvatureIdentity(w);
}

/** Count one PCG stop reason. @param {any} state @param {string} reason */
export function countPcgReason(state, reason) {
  const key = /** @type {Record<string,string>} */ (PCG_REASONS)[reason];
  if (!key) throw new Error('Membrane curvature: unknown PCG stop reason ' + reason);
  state.counters[key]++;
}

/** Separate requested, last direction and factor/preconditioner operator. @param {any} w */
export function exactCurvatureStats(w) {
  const state = w._exactCurvature;
  if (!state) return {};
  return { membraneCurvature: { requested: state.requested, policy: { ...EXACT_CURVATURE_IDENTITY },
    factorCurvature: w._factorState?.curvature ?? null, lastDirection: state.last?.direction ?? null,
    lastPreconditioner: state.last?.preconditioner ?? null, counters: { ...state.counters }, last: structuredClone(state.last) } };
}

/** @param {any} w */
export function exactCurvatureSnapshot(w) { return w._exactCurvature ? { exactCurvature: structuredClone(w._exactCurvature) } : {}; }

/** @param {any} value */
const finiteTree = value => value === null || typeof value === 'string' || typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(finiteTree));

/** Validate curvature metadata before any restore write, including the saved
 * effective factor operator. Cross-curvature snapshots refuse here.
 * @param {any} w @param {any} s */
export function validateCurvatureSnapshot(w, s) {
  if (!w.orthotropicMembrane) return;
  const exact = requestedCurvature(w) === 'exact-hessian', state = s.membrane?.exactCurvature, factor = s.factor;
  if (!exact) {
    if (state !== undefined || (factor && factor.curvature !== undefined)) throw new Error('Membrane curvature: snapshot curvature mismatch');
    return;
  }
  if (!state || typeof state !== 'object' || Object.keys(state).sort().join() !== 'counters,last,requested' || state.requested !== 'exact-hessian') throw new Error('Membrane curvature: snapshot curvature mismatch');
  const counters = state.counters;
  if (!counters || Object.keys(counters).length !== COUNTERS.length || COUNTERS.some(key => !Number.isSafeInteger(counters[key]) || counters[key] < 0)) throw new Error('Membrane curvature: invalid snapshot counters');
  if (counters.exactFactors + counters.gnFallbackFactors > counters.exactFactorAttempts || counters.gnFallbackFactors > counters.finiteNonpositivePivots) throw new Error('Membrane curvature: inconsistent snapshot counters');
  const last = state.last;
  if (last !== null && (!finiteTree(last) || !DIRECTIONS.includes(last.direction) || !['pcg', 'direct'].includes(last.source) ||
      (last.preconditioner !== null && !OPERATORS.includes(last.preconditioner)))) throw new Error('Membrane curvature: invalid snapshot receipt');
  if (factor && !OPERATORS.includes(factor.curvature)) throw new Error('Membrane curvature: invalid snapshot factor curvature');
  if (!factor && (counters.exactFactors || counters.gnFallbackFactors)) throw new Error('Membrane curvature: snapshot factor missing');
}

/** @param {any} w @param {any} s */
export function restoreExactCurvature(w, s) {
  if (w._exactCurvature) w._exactCurvature = structuredClone(s.membrane.exactCurvature);
}
