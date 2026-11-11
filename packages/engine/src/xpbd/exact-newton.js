// @ts-check
/** Opt-in exact membrane curvature Newton iterations (membraneCurvature:'exact-hessian').
 * Same budgets, constants, inertia association, one EnergySearch begin/finish per
 * iteration and the same strict increment search as the Gauss–Newton loop in
 * newton.js, which is left untouched. Fixed policy, no regularization:
 *  - PCG applies the exact current membrane operator with the saved (stale) factor
 *    as preconditioner; a nonfinite or non-descent direction is never added.
 *  - The direct path attempts an exact factor. A finite nonpositive pivot rebuilds
 *    the Gauss–Newton factor once (a visible fallback, never labelled exact).
 *    A nonfinite pivot or direction is a visible invalid-state failure.
 * The effective factor operator is saved with the factor state so restore rebuilds
 * the same factor rather than retrying exact under the current options.
 */
import { gradient, assembleElastic } from './implicit.js';
import { pcgStep } from './pcg.js';
import { stateCoordinates, solverPositions, solverTarget } from './reference-state.js';
import { validateCurvatureIdentity, countPcgReason } from './membrane-curvature.js';
import * as K from '../constants.js';

/** Factor the exact operator, or the GN operator after a finite nonpositive pivot.
 * @param {any} w @param {Float64Array} x @param {string} coordinates @param {any} state @param {any} receipt
 * @returns {'exact-hessian'|'gauss-newton'} the effective factor operator */
function factorEffective(w, x, coordinates, state, receipt) {
  const ch = w.sys.ch;
  state.counters.exactFactorAttempts++;
  assembleElastic(w, x, ch, false, coordinates, 'exact-hessian');
  try {
    ch.factor();
  } catch (error) {
    const pivot = /** @type {any} */ (error)?.pivotFailure;
    if (!pivot || pivot.kind !== 'finite-nonpositive') {
      state.counters.nonfiniteFailures++;
      throw new Error('Exact membrane curvature: nonfinite factor arithmetic (invalid state, no fallback): ' + /** @type {any} */ (error)?.message);
    }
    state.counters.finiteNonpositivePivots++;
    receipt.pivot = { block: pivot.block, freeIndex: pivot.freeIndex, component: pivot.component, value: pivot.value };
    receipt.fallbackReason = 'finite-nonpositive-pivot';
    // Never solve with the partial exact factor: clear and rebuild Gauss–Newton completely.
    assembleElastic(w, x, ch, false, coordinates, 'gauss-newton');
    ch.factor(); w.factorCount++; state.counters.gnFallbackFactors++;
    return 'gauss-newton';
  }
  w.factorCount++; state.counters.exactFactors++;
  return 'exact-hessian';
}

/** @param {any} w */
export function exactNewtonStep(w) {
  if (stateCoordinates(w) !== 'reference-displacement') throw new Error('Exact membrane curvature: reference-displacement state required');
  if (w._referenceNewtonActive) throw new Error('Reference state: recursive Newton solve is unsupported');
  w._referenceNewtonActive = true;
  try {
    const S = w.sys;
    if (!S.ch) return;
    validateCurvatureIdentity(w);
    const state = w._exactCurvature, search = w.energySearch;
    const coordinates = stateCoordinates(w), x = solverPositions(w), target = solverTarget(w), g = w.g, rhs = S.rhs, fi = S.freeIdx, nV = w.mesh.nV;
    const idt2 = 1 / (w.dt * w.dt);
    for (let it = 0; it < w.opts.newtonIterations; it++) {
      search.begin(w);
      g.fill(0);
      gradient(w, x, g, coordinates);
      // The admitted domain always uses membrane-inertia-increment: inertia on every iteration, as in newton.js.
      for (let i = 0; i < nV; i++) { const m = w.mass[i] * idt2; for (let c = 0; c < 3; c++) g[3 * i + c] += m * (x[3 * i + c] - target[3 * i + c]); }
      const receipt = { iteration: it, requested: 'exact-hessian', direction: 'exact-hessian', source: 'pcg',
        preconditioner: w._factorState?.curvature ?? null, pcg: /** @type {any} */ (null), pivot: /** @type {any} */ (null),
        fallbackReason: /** @type {string|null} */ (null), slope: /** @type {number|null} */ (null), descent: /** @type {boolean|null} */ (null) };
      if (!w.dirty && !(w._pcgFail > 0)) {
        state.counters.pcgAttempts++;
        const r = pcgStep(w, x, g, K.PCG_MAX_ITER, K.PCG_RTOL, null, true, coordinates, 'exact-hessian', w.opts.pcgAbsoluteTolerance ?? null);
        w.pcgIterations = r.iterations;
        countPcgReason(state, /** @type {string} */ (r.reason));
        receipt.pcg = { iterations: r.iterations, reason: r.reason, slope: r.slope ?? null };
        if (r.converged) {
          if (r.iterations > K.PCG_REFACTOR_ITER) w.dirty = true;
          receipt.slope = r.slope ?? null; receipt.descent = r.reason === 'zero-rhs' ? null : true;
          state.last = receipt; search.finish(w, g); state.counters.iterations++;
          continue;
        }
        w._pcgFail = K.PCG_FAIL_HOLD;
      } else if (w._pcgFail > 0) w._pcgFail--;
      receipt.source = 'direct';
      const effective = factorEffective(w, x, coordinates, state, receipt);
      w._saveFactorState(x, coordinates); w._factorState.curvature = effective;
      w.dirty = false;
      receipt.direction = effective === 'exact-hessian' ? 'exact-hessian' : 'gauss-newton-fallback';
      receipt.preconditioner = effective;
      for (let i = 0; i < nV; i++) {
        const k = fi[i];
        if (k < 0) continue;
        rhs[3 * k] = -g[3 * i]; rhs[3 * k + 1] = -g[3 * i + 1]; rhs[3 * k + 2] = -g[3 * i + 2];
      }
      S.ch.solve(rhs);
      let slope = 0;
      for (let i = 0; i < nV; i++) { const k = fi[i]; if (k < 0) continue; for (let c = 0; c < 3; c++) slope += g[3 * i + c] * rhs[3 * k + c]; }
      if (!rhs.every(Number.isFinite) || !Number.isFinite(slope)) {
        state.counters.nonfiniteFailures++;
        throw new Error('Exact membrane curvature: nonfinite direct direction (invalid state, no write)');
      }
      // The strict increment search keeps the acceptance decision; the receipt only records the sign.
      receipt.slope = slope; receipt.descent = slope < 0;
      for (let i = 0; i < nV; i++) {
        const k = fi[i];
        if (k < 0) continue;
        x[3 * i] += rhs[3 * k]; x[3 * i + 1] += rhs[3 * k + 1]; x[3 * i + 2] += rhs[3 * k + 2];
      }
      state.last = receipt;
      search.finish(w, g);
      state.counters.iterations++;
    }
  } finally { w._referenceNewtonActive = false; }
}
