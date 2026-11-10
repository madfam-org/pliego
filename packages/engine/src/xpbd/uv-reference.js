// @ts-check
/** Explicit alternative represented law: covariant UV Green strain relative to
 * the actual stored X0, rotated as a tensor before engineering Voigt assembly.
 * No rest-force subtraction, metric whitening, or change to Q/volume/mass.
 * DD arithmetic is approximate; large nearly rigid rotations remain ill-conditioned.
 */
import * as D from './double-double.js';
import { hypot2, hypot3 } from '../fastmath.js';

export const UV_REFERENCE_IDENTITY = Object.freeze({ mode: 'uv-displacement', version: 1,
  metric: 'actual-X0', strain: 'uv-covariant', rotation: 'tensor-before-voigt' });
export const REFERENCE_POSE_QUALITY_MIN = 1e-12;
/** @typedef {{mode:'uv-displacement',version:number,u:Float64Array,v:Float64Array,x0:Float64Array,c:number,s:number}} UVReference */
/** @param {ArrayLike<number>} uv @param {ArrayLike<number>} x0 @param {number} grainRadians @returns {UVReference} */
export function createUVReference(uv, x0, grainRadians) {
  if (uv.length !== 6 || x0.length !== 9 || ![...Array.from(uv), ...Array.from(x0), grainRadians].every(Number.isFinite)) throw new Error('UV reference: finite triangle and reference pose required');
  const du1 = uv[2] - uv[0], dv1 = uv[3] - uv[1], du2 = uv[4] - uv[0], dv2 = uv[5] - uv[1];
  const det = du1 * dv2 - du2 * dv1;
  const u = Float64Array.of(0, dv2 / det, -dv1 / det), v = Float64Array.of(0, -du2 / det, du1 / det);
  u[0] = -(u[1] + u[2]); v[0] = -(v[1] + v[2]);
  const reference = { mode: /** @type {const} */ ('uv-displacement'), version: 1, u, v, x0: Float64Array.from(x0), c: Math.cos(grainRadians), s: Math.sin(grainRadians) };
  const edges = [1, 2].map(i => [0, 1, 2].map(r => D.twoSum(x0[3*i+r], -x0[r])));
  const third = edges[1].map((v, i) => D.sub(v, edges[0][i]));
  const quality = crossNorm({ a: edges[0], b: edges[1] }) / Math.max(...[...edges, third].map(v => D.rounded(referenceDot(v, v))));
  if (!(Number.isFinite(quality) && quality > REFERENCE_POSE_QUALITY_MIN)) throw new Error('UV reference: degenerate or ill-conditioned reference pose');
  const { a, b } = referenceTangents(reference, reference.x0, [0, 1, 2]);
  const aa = D.rounded(referenceDot(a, a)), bb = D.rounded(referenceDot(b, b)), area = crossNorm({ a, b });
  if (!(det > 0 && Number.isFinite(aa + bb + area) && aa > 0 && area > 0)) throw new Error('UV reference: degenerate reference metric');
  return reference;
}
/** Plain values bind the represented polynomial, including the actual X0.
 * @param {UVReference} reference */
export function describeUVReference(reference) {
  return { ...reference, u: Array.from(reference.u), v: Array.from(reference.v), x0: Array.from(reference.x0) };
}
/** Rounded node-zero storage is informational; derivative follows difference form.
 * @param {Float64Array} values @param {number} i @returns {D.DD} */
export function referenceCoefficient(values, i) { return i ? [values[i], 0] : D.neg(D.twoSum(values[1], values[2])); }
/** @param {D.DD[]} a @param {D.DD[]} b */
export function referenceDot(a, b) { return D.sum(a.map((v, i) => D.mul(v, b[i]))); }
/** @param {{a:D.DD[],b:D.DD[]}} frame */
function crossWords({ a, b }) {
  return [D.sub(D.mul(a[1], b[2]), D.mul(a[2], b[1])), D.sub(D.mul(a[2], b[0]), D.mul(a[0], b[2])),
    D.sub(D.mul(a[0], b[1]), D.mul(a[1], b[0]))];
}
/** DD cross product avoids subtracting nearly equal rounded Gram products.
 * @param {{a:D.DD[],b:D.DD[]}} frame */
function crossNorm(frame) {
  const values = crossWords(frame).map(D.rounded);
  return hypot3(values[0], values[1], values[2]);
}
/** @param {UVReference} ref @param {D.DD[][]} values */
export function referenceApply(ref, values) {
  const a = [], b = [];
  for (let r = 0; r < 3; r++) {
    const d1 = D.sub(values[1][r], values[0][r]), d2 = D.sub(values[2][r], values[0][r]);
    a.push(D.add(D.scale(d1, ref.u[1]), D.scale(d2, ref.u[2])));
    b.push(D.add(D.scale(d1, ref.v[1]), D.scale(d2, ref.v[2])));
  }
  return { a, b };
}
/** @param {UVReference} ref @param {ArrayLike<number>} x @param {ArrayLike<number>} ids */
export function referenceTangents(ref, x, ids) {
  return referenceApply(ref, Array.from(ids, id => [0, 1, 2].map(r => /** @type {D.DD} */ ([x[3 * id + r], 0]))));
}
/** All L entries are DD products of the stored c/s, never rounded coefficients.
 * @param {UVReference} ref @returns {D.DD[][]} */
function rotation(ref) {
  const cc = D.twoProduct(ref.c, ref.c), ss = D.twoProduct(ref.s, ref.s), cs = D.twoProduct(ref.c, ref.s);
  return [[cc, ss, cs], [ss, cc, D.neg(cs)], [D.scale(cs, -2), D.scale(cs, 2), D.sub(cc, ss)]];
}
/** Engineering strain rotation, or its transpose for conjugate stresses.
 * @param {UVReference} ref @param {D.DD[]} values @param {boolean} [transpose] */
export function referenceRotate(ref, values, transpose = false) {
  const L = rotation(ref);
  return [0, 1, 2].map(i => D.sum(values.map((v, j) => D.mul(transpose ? L[j][i] : L[i][j], v))));
}
/** Recompute A=KX0; cached rounded A would define a different real polynomial.
 * Euv = sym(A^T H) + H^T H/2, H=K(x-X0), evaluated without subtracting metrics.
 * @param {UVReference} ref @param {ArrayLike<number>} x @param {ArrayLike<number>} ids */
export function referenceKinematics(ref, x, ids) {
  const base = referenceTangents(ref, ref.x0, [0, 1, 2]);
  const delta = referenceApply(ref, Array.from(ids, (id, i) => [0, 1, 2].map(r => D.twoSum(x[3 * id + r], -ref.x0[3 * i + r]))));
  const uvStrain = [D.add(referenceDot(base.a, delta.a), D.scale(referenceDot(delta.a, delta.a), .5)),
    D.add(referenceDot(base.b, delta.b), D.scale(referenceDot(delta.b, delta.b), .5)),
    D.sum([referenceDot(base.a, delta.b), referenceDot(base.b, delta.a), referenceDot(delta.a, delta.b)])];
  return { a: base.a.map((v, i) => D.add(v, delta.a[i])), b: base.b.map((v, i) => D.add(v, delta.b[i])),
    strain: referenceRotate(ref, uvStrain), uvStrain, base };
}
/** Local rounded DD Newton refinements for diagnostic coordinates only.
 * @param {D.DD} a @param {D.DD} b @returns {D.DD} */
function divide(a, b) {
  const q = a[0] / b[0];
  return D.add([q, 0], [D.rounded(D.sub(a, D.scale(b, q))) / b[0], 0]);
}
/** @param {D.DD} value @returns {D.DD} */
function squareRoot(value) {
  if (value[0] === 0 && value[1] === 0) return [0, 0];
  const root = Math.sqrt(D.rounded(value));
  return D.add([root, 0], divide(D.sub(value, D.twoProduct(root, root)), [2 * root, 0]));
}
/** Generalized metric eigenvalues relative to G0=A^T A. Cholesky here is only
 * a diagnostic coordinate transform; constitutive energy uses the UV chart.
 * Retain DD through congruence: skew references amplify prematurely rounded ΔC.
 * @param {{a:D.DD[],b:D.DD[]}} base @param {{a:D.DD[],b:D.DD[]}} current */
export function referenceMetrics(base, current) {
  const aa = referenceDot(base.a, base.a), bb = referenceDot(base.b, base.b), ab = referenceDot(base.a, base.b);
  const cross = crossWords(base), area = squareRoot(referenceDot(cross, cross));
  const l00 = squareRoot(aa), l10 = divide(ab, l00), l11 = divide(area, l00);
  const p = current.a.map(v => divide(v, l00)), q = current.b.map((v, i) => divide(D.sub(v, D.mul(l10, p[i])), l11));
  const pp = D.rounded(referenceDot(p, p)), qq = D.rounded(referenceDot(q, q)), pq = D.rounded(referenceDot(p, q));
  const largest = pp / 2 + qq / 2 + hypot2((pp - qq) / 2, pq);
  const currentCross = crossWords(current), currentArea = squareRoot(referenceDot(currentCross, currentCross));
  const areaRatio = D.rounded(divide(currentArea, area));
  const maximumStretch = Math.sqrt(largest), minimumStretch = areaRatio / maximumStretch;
  return { maximumStretch, minimumStretch, areaRatio,
    referenceMetricMismatch: Math.max(Math.abs(D.rounded(D.sub(aa, [1, 0]))), Math.abs(D.rounded(D.sub(bb, [1, 0]))), Math.abs(D.rounded(ab))) };
}
