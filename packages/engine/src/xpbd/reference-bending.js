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
 * the increment search is formed from the exact step between the two poses, so its
 * error scales with the step instead of with θ (it is not an interval bound).
 * Outside the two-word product domain it throws, like the planar two-word path.
 */
import { dihedral } from './dihedral.js';
import { twoSum, twoProduct, add as addDD, sub as subDD, mul as mulDD, rounded } from './double-double.js';
import { HINGE_PANEL, HINGE_CREASE } from '../mesh.js';

export const REFERENCE_BENDING_IDENTITY = Object.freeze({ name: 'latent-panel-bending', version: 2,
  hinges: 'panel-only', restAngle: 'flat', geometry: 'latent-sum-exact-differences-rounded-once',
  curvature: 'gauss-newton', angleChange: 'two-word-step-expansion-atan2', damping: 'none' });

/** The panel identity plus crease hinges with fixed authored rest angles (G1 step 2). The fold limit
 * is a domain boundary (no projection, no contact) and the angle memory starts from the latent
 * initial pose on each hinge's rest branch. Everything else is the panel identity's. */
export const REFERENCE_CREASE_BENDING_IDENTITY = Object.freeze({ name: 'latent-panel-crease-bending', version: 1,
  hinges: 'panel-and-crease', restAngle: 'flat-panels-authored-creases', foldLimit: 'domain-boundary', initialAngleMemory: 'latent-rest-branch',
  geometry: 'latent-sum-exact-differences-rounded-once', curvature: 'gauss-newton', angleChange: 'two-word-step-expansion-atan2', damping: 'none' });
const LAWS = new Set(['panel-hinges', 'panel-and-crease-hinges']);

/** @param {any} w */
export function bendingSelected(w) { return LAWS.has(w.opts.referenceBending); }
/** @param {any} w */
export function creaseSelected(w) { return w.opts.referenceBending === 'panel-and-crease-hinges'; }
/** The bending identity a World selects. @param {any} w */
export function bendingIdentity(w) { return creaseSelected(w) ? REFERENCE_CREASE_BENDING_IDENTITY : REFERENCE_BENDING_IDENTITY; }
/** Hinge kinds the selected law admits. @param {any} w @param {number} kind */
export function admittedHingeKind(w, kind) { return kind === HINGE_PANEL || (creaseSelected(w) && kind === HINGE_CREASE); }

/** Coordinate admissibility of one state component: Y must stay exactly 0 unless bending is selected.
 * @param {any} w @param {number} value @param {number} i */
export function admissibleComponent(w, value, i) { return Number.isFinite(value) && (bendingSelected(w) || i % 3 !== 1 || value === 0); }

const LOCAL = new Float64Array(12);
/** Difference (X0[b]+u[b]) − (X0[a]+u[a]) as two words: both TwoSums are exact.
 * @param {ArrayLike<number>} X0 @param {ArrayLike<number>} u @param {number} b @param {number} a */
function differenceWords(X0, u, b, a) { return addDD(twoSum(X0[b], -X0[a]), twoSum(u[b], -u[a])); }
/** The same difference rounded once. @param {ArrayLike<number>} X0 @param {ArrayLike<number>} u @param {number} b @param {number} a */
function difference(X0, u, b, a) { return rounded(differenceWords(X0, u, b, a)); }

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

/** First crease hinge whose latent angle (continued from the memory) is beyond its fold limit, or -1.
 * Without contact, the fold limit bounds the admitted domain.
 * @param {any} w @param {ArrayLike<number>} u */
export function creaseBeyondFoldLimit(w, u) {
  for (let h = 0; h < w.mesh.nH; h++) {
    if (w.mesh.hingeKind[h] !== HINGE_CREASE) continue;
    if (!(Math.abs(unwrapAngle(w.theta[h], latentHingeAngle(w, u, h, null))) <= w.foldLimit[h])) return h;
  }
  return -1;
}
/** Angle memory from the latent pose, on each hinge's rest branch (initial pose only). @param {any} w */
export function setLatentAngleMemory(w) {
  for (let h = 0; h < w.mesh.nH; h++) w.theta[h] = unwrapAngle(w.restTheta[h], latentHingeAngle(w, w._u, h, null));
}

/** @typedef {import('./double-double.js').DD} DD */
/** @param {DD[]} a @param {DD[]} b @returns {DD[]} */
const crossDD = (a, b) => [subDD(mulDD(a[1], b[2]), mulDD(a[2], b[1])), subDD(mulDD(a[2], b[0]), mulDD(a[0], b[2])), subDD(mulDD(a[0], b[1]), mulDD(a[1], b[0]))];
/** @param {DD[]} a @param {DD[]} b @returns {DD} */
const dotDD = (a, b) => addDD(addDD(mulDD(a[0], b[0]), mulDD(a[1], b[1])), mulDD(a[2], b[2]));
/** Two-word square root of a nonnegative two-word value: one Newton correction. @param {DD} a @returns {DD} */
function sqrtDD(a) {
  if (a[0] === 0) return [0, 0];
  const s = Math.sqrt(a[0]);
  return twoSum(s, rounded(subDD(a, twoProduct(s, s))) / (2 * s));
}
/** Two-word quotient n/d (d ≠ 0): one correction. @param {DD} n @param {DD} d @returns {DD} */
function divDD(n, d) {
  const q = n[0] / d[0];
  return q === 0 ? [0, 0] : twoSum(q, rounded(subDD(n, mulDD(d, [q, 0]))) / d[0]);
}
/** a·(b×c). @param {DD[]} a @param {DD[]} b @param {DD[]} c @returns {DD} */
const tripleDD = (a, b, c) => dotDD(a, crossDD(b, c));
/** Change of A·B when A and B move by α and β: α·B + A·β + α·β. @param {DD[]} A @param {DD[]} alpha @param {DD[]} B @param {DD[]} beta @returns {DD} */
const dotChange = (A, alpha, B, beta) => addDD(addDD(dotDD(alpha, B), dotDD(A, beta)), dotDD(alpha, beta));
/** @param {DD} x @returns {DD} */
const twice = x => [2 * x[0], 2 * x[1]];

/** Angle change θ(after) − θ(before) of hinge h in (−π, π], with an error that scales with the step.
 *
 * With E = p1−p0, U = w0−p0, W = w1−p0 on the latent sum, the dihedral's normals give
 * N0·N1 = (E·W)(U·E) − (E·E)(U·W) =: D and E·(N1×N0) = |E|²·det[W,E,U], so
 * θ = atan2(r·T, D) with r = |E| and T = det[W,E,U]. The pose vectors are formed exactly and
 * rounded once to two words; their step (e, u, w) is formed exactly from after−before. Each
 * change ΔD, ΔT, Δr is expanded so every term carries a step factor, and
 *   Δθ = atan2(D0·(r0·ΔT + Δr·T1) − ΔD·r0·T0,  D1·D0 + r1·T1·r0·T0)
 * is the angle between the two (D, r·T) pairs. Not an interval bound.
 * @param {any} w @param {ArrayLike<number>} before @param {ArrayLike<number>} after @param {number} h */
export function latentAngleChange(w, before, after, h) {
  const H = w.mesh.hinges, X0 = w._referenceOrigin ?? w.X0, a = 3 * H[4 * h];
  /** @param {number} i */
  const pose = i => { const v = 3 * H[4 * h + i]; return [0, 1, 2].map(c => differenceWords(X0, before, v + c, a + c)); };
  /** @param {number} i */
  const step = i => { const v = 3 * H[4 * h + i]; return [0, 1, 2].map(c => subDD(twoSum(after[v + c], -before[v + c]), twoSum(after[a + c], -before[a + c]))); };
  const E = pose(1), U = pose(2), W = pose(3), e = step(1), u = step(2), v = step(3);
  const ee0 = dotDD(E, E), ew0 = dotDD(E, W), ue0 = dotDD(U, E), uw0 = dotDD(U, W);
  const dee = addDD(twice(dotDD(E, e)), dotDD(e, e)), dew = dotChange(E, e, W, v), due = dotChange(U, u, E, e), duw = dotChange(U, u, W, v);
  const D0 = subDD(mulDD(ew0, ue0), mulDD(ee0, uw0));
  const dD = subDD(addDD(addDD(mulDD(dew, ue0), mulDD(ew0, due)), mulDD(dew, due)), addDD(addDD(mulDD(dee, uw0), mulDD(ee0, duw)), mulDD(dee, duw)));
  const T0 = tripleDD(W, E, U);
  const dT = [tripleDD(v, E, U), tripleDD(W, e, U), tripleDD(W, E, u), tripleDD(v, e, U), tripleDD(v, E, u), tripleDD(W, e, u), tripleDD(v, e, u)].reduce(addDD);
  const r0 = sqrtDD(ee0), r1 = sqrtDD(addDD(ee0, dee)), dr = divDD(dee, addDD(r0, r1));
  const D1 = addDD(D0, dD), T1 = addDD(T0, dT), rT0 = mulDD(r0, T0);
  const cross = subDD(mulDD(D0, addDD(mulDD(r0, dT), mulDD(dr, T1))), mulDD(dD, rT0));
  return Math.atan2(rounded(cross), rounded(addDD(mulDD(D1, D0), mulDD(mulDD(r1, T1), rT0))));
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
    const dTheta = latentAngleChange(w, before, after, h), lever = k * (unwrapAngle(w.theta[h], theta0) - w.restTheta[h]);
    const lin = lever * directional, rem = lever * (dTheta - directional) + 0.5 * k * dTheta * dTheta;
    [linear, lc] = add(linear, lc, lin); [remainder, rc] = add(remainder, rc, rem);
    magnitude += Math.abs(lin) + Math.abs(rem);
  }
  const lv = linear + lc, rv = remainder + rc, valid = [lv, rv, magnitude].every(Number.isFinite);
  return { valid, difference: valid ? lv + rv : Infinity, linear: lv, remainder: rv, magnitude };
}
