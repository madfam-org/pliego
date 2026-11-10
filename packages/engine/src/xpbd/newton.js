// @ts-check
/** Shared Newton budgets and operation order; explicit coordinate selection. */
import { gradient, assembleAndFactor } from './implicit.js';
import { pcgStep } from './pcg.js';
import { stateCoordinates, solverPositions, solverTarget } from './reference-state.js';
import * as K from '../constants.js';
/** @param {any} w */
export function newtonStep(w) {
  const reference = stateCoordinates(w) === 'reference-displacement';
  if (reference && w._referenceNewtonActive) throw new Error('Reference state: recursive Newton solve is unsupported');
  if (reference) w._referenceNewtonActive = true;
  try {
    const S = w.sys;
    if (!S.ch) return;
    const coordinates = stateCoordinates(w), x = solverPositions(w), target = solverTarget(w), g = w.g, rhs = S.rhs, fi = S.freeIdx, nV = w.mesh.nV;
    const idt2 = 1 / (w.dt * w.dt);
    for (let it = 0; it < w.opts.newtonIterations; it++) {
      w.energySearch?.begin(w);
      g.fill(0);
      gradient(w, x, g, coordinates);
      if (it > 0 || w.opts.previousPoseStart || w.opts.lineSearchArithmetic === 'membrane-inertia-increment') for (let i = 0; i < nV; i++) { const m = w.mass[i] * idt2; for (let c = 0; c < 3; c++) g[3 * i + c] += m * (x[3 * i + c] - target[3 * i + c]); }
      if (!w.dirty && !(w._pcgFail > 0)) {
        const r = pcgStep(w, x, g, K.PCG_MAX_ITER, K.PCG_RTOL, null, true, coordinates);
        w.pcgIterations = r.iterations;
        if (r.converged) { if (r.iterations > K.PCG_REFACTOR_ITER) w.dirty = true; w.energySearch?.finish(w, g); continue; }
        w._pcgFail = K.PCG_FAIL_HOLD; // the sheet is moving fast: factor directly for a few substeps
      } else if (w._pcgFail > 0) w._pcgFail--;
      assembleAndFactor(w, x, coordinates);
      w._saveFactorState(x, coordinates);
      w.dirty = false;
      for (let i = 0; i < nV; i++) {
        const k = fi[i];
        if (k < 0) continue;
        rhs[3 * k] = -g[3 * i]; rhs[3 * k + 1] = -g[3 * i + 1]; rhs[3 * k + 2] = -g[3 * i + 2];
      }
      S.ch.solve(rhs);
      for (let i = 0; i < nV; i++) {
        const k = fi[i];
        if (k < 0) continue;
        x[3 * i] += rhs[3 * k]; x[3 * i + 1] += rhs[3 * k + 1]; x[3 * i + 2] += rhs[3 * k + 2];
      }
      w.energySearch?.finish(w, g);
    }
    } finally { if (reference) w._referenceNewtonActive = false; }
}
