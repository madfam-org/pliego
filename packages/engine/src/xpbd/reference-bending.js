// @ts-check
/** Opt-in panel bending in the reference-displacement research domain
 * (`referenceBending: 'panel-hinges'`). Dependency leaf: no World, solver or
 * search imports.
 *
 * Hinge geometry is evaluated on the latent sum X0+u, not on the rounded public
 * projection: each wing/edge difference is formed exactly with TwoSum, rounded
 * once, and passed to the unchanged dihedral formula on a local frame with the
 * first hinge vertex at the origin. The bending law (k = C_B·D(φ)·L²/A, flat rest)
 * and its Gauss–Newton operator k·∇θ∇θᵀ are unchanged. The angle change used by
 * the increment search is binary64 (atan2 difference, wrapped); its rounding is
 * reported as a magnitude, not bounded. A two-word dihedral is a later step.
 */
import { dihedral } from './dihedral.js';
import { twoSum, add as addDD, rounded } from './double-double.js';

export const REFERENCE_BENDING_IDENTITY = Object.freeze({ name: 'latent-panel-bending', version: 1,
  hinges: 'panel-only', restAngle: 'flat', geometry: 'latent-sum-exact-differences-rounded-once',
  curvature: 'gauss-newton', angleChange: 'binary64-atan2-difference', damping: 'none' });

/** @param {any} w */
export function bendingSelected(w) { return w.opts.referenceBending === 'panel-hinges'; }

/** Coordinate admissibility of one state component: Y must stay exactly 0 unless bending is selected.
 * @param {any} w @param {number} value @param {number} i */
export function admissibleComponent(w, value, i) { return Number.isFinite(value) && (bendingSelected(w) || i % 3 !== 1 || value === 0); }

const LOCAL = new Float64Array(12);
/** Exact difference (X0[b]+u[b]) − (X0[a]+u[a]), rounded once.
 * @param {ArrayLike<number>} X0 @param {ArrayLike<number>} u @param {number} b @param {number} a */
function difference(X0, u, b, a) { return rounded(addDD(twoSum(X0[b], -X0[a]), twoSum(u[b], -u[a]))); }

/** Signed dihedral angle (and optional 12-gradient) of hinge h on the latent sum.
 * The gradient w.r.t. u equals the gradient w.r.t. positions (X0 is fixed).
 * @param {any} w @param {ArrayLike<number>} u @param {number} h @param {Float64Array|null} g */
export function latentHingeAngle(w, u, h, g) {
  const H = w.mesh.hinges, X0 = w._referenceOrigin ?? w.X0, a = 3 * H[4 * h];
  for (let i = 1; i < 4; i++) {
    const v = 3 * H[4 * h + i];
    for (let c = 0; c < 3; c++) LOCAL[3 * i + c] = difference(X0, u, v + c, a + c);
  }
  LOCAL[0] = 0; LOCAL[1] = 0; LOCAL[2] = 0;
  return dihedral(LOCAL, 0, 1, 2, 3, g);
}

/** Same continuation as implicit.js `unwrap` (kept local: importing it would form a cycle).
 * @param {number} prev @param {number} raw */
export function unwrapAngle(prev, raw) { let d = raw - prev; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); return prev + d; }

/** Wrapped binary64 angle change θ1−θ0 in (−π, π]. @param {number} theta1 @param {number} theta0 */
export function angleChange(theta1, theta0) {
  const d = theta1 - theta0;
  return d - 2 * Math.PI * Math.round(d / (2 * Math.PI));
}

/** Panel bending energy Σ ½k(θ−θ̄)² and its gradient (added into g) at a pose.
 * Latent coordinates use the latent-sum geometry; absolute positions use the
 * unchanged public dihedral. Angles continue from w.theta as the engine does.
 * @param {any} w @param {ArrayLike<number>} x @param {Float64Array} g @param {'absolute-position'|'reference-displacement'} coordinates */
export function addBendingGradient(w, x, g, coordinates) {
  const H = w.mesh.hinges, G = new Float64Array(12);
  let energy = 0;
  for (let h = 0; h < w.mesh.nH; h++) {
    const k = w.hingeK[h];
    if (k === 0) continue;
    const raw = coordinates === 'reference-displacement' ? latentHingeAngle(w, x, h, G) : dihedral(/** @type {Float64Array} */ (x), H[4 * h], H[4 * h + 1], H[4 * h + 2], H[4 * h + 3], G);
    const d = unwrapAngle(w.theta[h], raw) - w.restTheta[h], f = k * d;
    energy += 0.5 * k * d * d;
    for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) g[3 * H[4 * h + i] + c] += f * G[3 * i + c];
  }
  return energy;
}

/** Bending part of the increment search's Armijo change between two latent poses:
 * remainder = Σ k·(θ0−θ̄)·(Δθ − ∇θ0·d) + ½·k·Δθ², linear = Σ k·(θ0−θ̄)·∇θ0·d,
 * difference = linear + remainder. Neumaier sums; magnitudes are diagnostics.
 * @param {any} w @param {ArrayLike<number>} before @param {ArrayLike<number>} after */
export function bendingIncrement(w, before, after) {
  const H = w.mesh.hinges, g = new Float64Array(12);
  let remainder = 0, rc = 0, linear = 0, lc = 0, magnitude = 0;
  const add = (sum, corr, value) => { const t = sum + value; return [t, corr + (Math.abs(sum) >= Math.abs(value) ? (sum - t) + value : (value - t) + sum)]; };
  for (let h = 0; h < w.mesh.nH; h++) {
    const k = w.hingeK[h];
    if (k === 0) continue;
    const theta0 = latentHingeAngle(w, before, h, g), theta1 = latentHingeAngle(w, after, h, null);
    if (!Number.isFinite(theta0) || !Number.isFinite(theta1)) return { valid: false, difference: Infinity, linear: Infinity, remainder: Infinity, magnitude: Infinity };
    let directional = 0;
    for (let i = 0; i < 4; i++) for (let c = 0; c < 3; c++) {
      const v = 3 * H[4 * h + i] + c; directional += g[3 * i + c] * (after[v] - before[v]);
    }
    // The lever uses the same unwrapped angle as the engine's gradient.
    const dTheta = angleChange(theta1, theta0), lever = k * (unwrapAngle(w.theta[h], theta0) - w.restTheta[h]);
    const lin = lever * directional, rem = lever * (dTheta - directional) + 0.5 * k * dTheta * dTheta;
    [linear, lc] = add(linear, lc, lin); [remainder, rc] = add(remainder, rc, rem);
    magnitude += Math.abs(lin) + Math.abs(rem);
  }
  const lv = linear + lc, rv = remainder + rc, valid = [lv, rv, magnitude].every(Number.isFinite);
  return { valid, difference: valid ? lv + rv : Infinity, linear: lv, remainder: rv, magnitude };
}
