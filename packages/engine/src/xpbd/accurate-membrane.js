// @ts-check
/** Two-word evaluation of the selected represented difference-form Green law.
 * The historical stored-material polynomial is unchanged when reference is absent.
 * UV-displacement is a separately named actual-X0 metric-relative polynomial.
 * Flat scratch arrays make cloned observation work independent of solver work.
 */
import * as D from './double-double.js';
import { hypot2, hypot3 } from '../fastmath.js';
import { referenceKinematics, referenceMetrics, referenceCoefficient, referenceRotate, validateMembraneCoordinates } from './uv-reference.js';

export function accurateScratch() {
  return { arithmetic: 'double-double', arithmeticError: '', ddA: new Float64Array(6), ddB: new Float64Array(6),
    ddStrain: new Float64Array(6), ddStress: new Float64Array(6), ddJ: new Float64Array(54), ddEnergy: new Float64Array(2) };
}
/** Stored alpha0 is rounded. Differentiate the actual difference-form tangents.
 * @param {Float64Array} coefficients @param {number} i */
function coefficient(coefficients, i) { return i ? /** @type {D.DD} */ ([coefficients[i], 0]) : D.neg(D.twoSum(coefficients[1], coefficients[2])); }
/** @param {any} e @param {ArrayLike<number>} x @param {ArrayLike<number>} ids */
function tangents(e, x, ids) {
  const a = [], b = [];
  for (let r = 0; r < 3; r++) {
    const d1 = D.twoSum(x[3 * ids[1] + r], -x[3 * ids[0] + r]);
    const d2 = D.twoSum(x[3 * ids[2] + r], -x[3 * ids[0] + r]);
    a.push(D.add(D.scale(d1, e.alpha[1]), D.scale(d2, e.alpha[2])));
    b.push(D.add(D.scale(d1, e.beta[1]), D.scale(d2, e.beta[2])));
  }
  return { a, b };
}
/** @param {D.DD[]} a @param {D.DD[]} b */
function dot(a, b) { return D.sum(a.map((v, i) => D.mul(v, b[i]))); }
/** @param {Float64Array} a @param {number} n */
function words(a, n) { return Array.from({ length: n }, (_, i) => D.get(a, i)); }
/** @param {any} e @param {ArrayLike<number>} x @param {ArrayLike<number>} ids @param {any} k @param {string} [coordinates] */
export function accurateKinematics(e, x, ids, k, coordinates = 'absolute-position') {
  validateMembraneCoordinates(coordinates, !!e.reference, 'double-double');
  k.arithmeticError = '';
  try {
    const reference = e.reference ? referenceKinematics(e.reference, x, ids, coordinates) : null;
    const { a, b } = reference ?? tangents(e, x, ids), aa = dot(a, a), bb = dot(b, b), ab = dot(a, b);
    const strain = reference ? reference.strain : [D.scale(D.sub(aa, [1, 0]), 0.5), D.scale(D.sub(bb, [1, 0]), 0.5), ab];
    const q = e.Q, stress = [D.add(D.scale(strain[0], q[0]), D.scale(strain[1], q[2])),
      D.add(D.scale(strain[0], q[2]), D.scale(strain[1], q[1])), D.scale(strain[2], q[3])];
    const energy = D.scale(D.scale(dot(strain, stress), e.volume), 0.5);
    for (let r = 0; r < 3; r++) {
      D.put(k.ddA, r, a[r]); D.put(k.ddB, r, b[r]); D.put(k.ddStrain, r, strain[r]); D.put(k.ddStress, r, stress[r]);
      k.a[r] = D.rounded(a[r]); k.b[r] = D.rounded(b[r]); k.strain[r] = D.rounded(strain[r]); k.stress[r] = D.rounded(stress[r]);
    }
    const ar = k.a, br = k.b;
    k.areaRatio = hypot3(ar[1] * br[2] - ar[2] * br[1], ar[2] * br[0] - ar[0] * br[2], ar[0] * br[1] - ar[1] * br[0]);
    const aa64 = D.rounded(aa), bb64 = D.rounded(bb), ab64 = D.rounded(ab);
    k.maximumStretch = Math.sqrt(aa64 / 2 + bb64 / 2 + hypot2((aa64 - bb64) / 2, ab64));
    k.minimumStretch = k.areaRatio / k.maximumStretch;
    if (reference) Object.assign(k, referenceMetrics(reference.base, reference));
    if (!(Number.isFinite(k.areaRatio + k.maximumStretch + k.minimumStretch) && k.areaRatio > 1e-12 && k.minimumStretch > 0)) { k.energy = Infinity; return false; }
    D.put(k.ddEnergy, 0, energy); k.energy = D.rounded(energy);
    for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) {
      const col = 3 * i + r, alpha = coefficient(e.reference?.u ?? e.alpha, i), beta = coefficient(e.reference?.v ?? e.beta, i);
      let values = [D.mul(alpha, a[r]), D.mul(beta, b[r]), D.add(D.mul(alpha, b[r]), D.mul(beta, a[r]))];
      if (e.reference) values = referenceRotate(e.reference, values);
      for (let c = 0; c < 3; c++) {
        D.put(k.ddJ, 9 * c + col, values[c]); k.J[9 * c + col] = D.rounded(values[c]);
      }
    }
    return true;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    k.energy = Infinity; k.arithmeticError = error.message; return false;
  }
}
/** @param {any} e @param {any} k @param {number} col */
export function accurateGradient(e, k, col) {
  return D.scale(D.sum([0, 1, 2].map(i => D.mul(D.get(k.ddJ, 9 * i + col), D.get(k.ddStress, i)))), e.volume);
}
/** @param {any} membrane @param {ArrayLike<number>} x @param {string} [coordinates] */
export function accurateEnergy(membrane, x, coordinates = 'absolute-position') {
  let value = /** @type {D.DD} */ ([0, 0]);
  for (let t = 0; t < membrane.mesh.nT; t++) {
    if (!accurateKinematics(membrane.elements[t], x, membrane.mesh.tris.subarray(3 * t, 3 * t + 3), membrane.work, coordinates)) return Infinity;
    value = D.add(value, D.get(membrane.work.ddEnergy, 0));
  }
  return D.rounded(value);
}
/** @param {any} e @param {any} k @param {number} row @param {number} col */
export function accurateGN(e, k, row, col) {
  if (row > col) [row, col] = [col, row];
  const q = e.Q, c = [0, 1, 2].map(i => D.get(k.ddJ, 9 * i + col));
  const s = [D.add(D.scale(c[0], q[0]), D.scale(c[1], q[2])), D.add(D.scale(c[0], q[2]), D.scale(c[1], q[1])), D.scale(c[2], q[3])];
  return D.scale(D.sum(s.map((v, i) => D.mul(D.get(k.ddJ, 9 * i + row), v))), e.volume);
}
/** @param {any} e @param {any} k @param {number} i @param {number} j */
export function accurateGeometric(e, k, i, j) {
  const u = e.reference?.u ?? e.alpha, v = e.reference?.v ?? e.beta;
  const a = referenceCoefficient(u, i), b = referenceCoefficient(v, i), c = referenceCoefficient(u, j), d = referenceCoefficient(v, j);
  const stress = e.reference ? referenceRotate(e.reference, words(k.ddStress, 3), true) : words(k.ddStress, 3);
  return D.scale(D.sum([D.mul(stress[0], D.mul(a, c)), D.mul(stress[1], D.mul(b, d)),
    D.mul(stress[2], D.add(D.mul(a, d), D.mul(b, c)))]), e.volume);
}
/** Add all element contributions in two words before the binary64 public gradient.
 * @param {any} membrane @param {ArrayLike<number>} x @param {Float64Array} g @param {string} [coordinates] */
export function addAccurateGradient(membrane, x, g, coordinates = 'absolute-position') {
  const values = new Float64Array(2 * g.length);
  for (let i = 0; i < g.length; i++) values[2 * i] = g[i];
  const k = membrane.work;
  for (let t = 0; t < membrane.mesh.nT; t++) {
    const e = membrane.elements[t], ids = membrane.mesh.tris.subarray(3 * t, 3 * t + 3);
    if (!accurateKinematics(e, x, ids, k, coordinates)) throw new Error('Double-double membrane: invalid metric or arithmetic domain: ' + k.arithmeticError);
    for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) {
      const index = 3 * ids[i] + r; D.put(values, index, D.add(D.get(values, index), accurateGradient(e, k, 3 * i + r)));
    }
  }
  for (let i = 0; i < g.length; i++) g[i] = D.rounded(D.get(values, i));
}
/** Same J^T Q J operator as sparse assembly; masks follow the native contract.
 * @param {any} membrane @param {ArrayLike<number>} x @param {ArrayLike<number>} p @param {Float64Array} out @param {ArrayLike<number>} [invMass] @param {string} [coordinates] */
export function addAccurateTimes(membrane, x, p, out, invMass, coordinates = 'absolute-position') {
  accurateTimes(membrane, x, p, out, invMass, coordinates, false);
}
/** Exact membrane curvature product: the GN value plus the geometric stress
 * term, both accumulated in two words before the single binary64 rounding.
 * @param {any} membrane @param {ArrayLike<number>} x @param {ArrayLike<number>} p @param {Float64Array} out @param {ArrayLike<number>} [invMass] @param {string} [coordinates] */
export function addAccurateExactTimes(membrane, x, p, out, invMass, coordinates = 'absolute-position') {
  accurateTimes(membrane, x, p, out, invMass, coordinates, true);
}
/** @param {any} membrane @param {ArrayLike<number>} x @param {ArrayLike<number>} p @param {Float64Array} out
 * @param {ArrayLike<number>|undefined} invMass @param {string} coordinates @param {boolean} exact */
function accurateTimes(membrane, x, p, out, invMass, coordinates, exact) {
  const values = new Float64Array(2 * out.length), k = membrane.work;
  for (let i = 0; i < out.length; i++) values[2 * i] = out[i];
  for (let t = 0; t < membrane.mesh.nT; t++) {
    const e = membrane.elements[t], ids = membrane.mesh.tris.subarray(3 * t, 3 * t + 3);
    if (!accurateKinematics(e, x, ids, k, coordinates)) throw new Error('Double-double membrane: invalid metric or arithmetic domain: ' + k.arithmeticError);
    const z = [[], [], []];
    for (let i = 0; i < 3; i++) if (!invMass || invMass[ids[i]]) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) z[c].push(D.scale(D.get(k.ddJ, 9 * c + 3 * i + r), p[3 * ids[i] + r]));
    const j = z.map(D.sum), q = e.Q;
    const stress = [D.add(D.scale(j[0], q[0]), D.scale(j[1], q[2])), D.add(D.scale(j[0], q[2]), D.scale(j[1], q[1])), D.scale(j[2], q[3])];
    // Canonical (min, max) node pair: the same stress curvature as the blocks.
    const geometric = exact ? [0, 1, 2].map(a => [0, 1, 2].map(b => accurateGeometric(e, k, Math.min(a, b), Math.max(a, b)))) : null;
    for (let i = 0; i < 3; i++) if (!invMass || invMass[ids[i]]) for (let r = 0; r < 3; r++) {
      const col = 3 * i + r, index = 3 * ids[i] + r;
      let value = D.scale(D.sum(stress.map((s, c) => D.mul(D.get(k.ddJ, 9 * c + col), s))), e.volume);
      if (geometric) for (let n = 0; n < 3; n++) if (!invMass || invMass[ids[n]]) value = D.add(value, D.scale(geometric[i][n], p[3 * ids[n] + r]));
      D.put(values, index, D.add(D.get(values, index), value));
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = D.rounded(D.get(values, i));
}
/** Carry exact endpoint TwoDiff words through the base and remainder.
 * @param {any} membrane @param {ArrayLike<number>} before @param {ArrayLike<number>} after @param {string} [coordinates] */
export function accurateDifference(membrane, before, after, coordinates = 'absolute-position') {
  validateMembraneCoordinates(coordinates, membrane.elements.every(e => !!e.reference), membrane.work.arithmetic);
  const k = { ...membrane.work };
  for (const [key, value] of Object.entries(k)) if (value instanceof Float64Array) k[key] = value.slice();
  let total = /** @type {D.DD} */ ([0, 0]), linear = /** @type {D.DD} */ ([0, 0]), remainder = /** @type {D.DD} */ ([0, 0]);
  let magnitude = 0, remainderMagnitude = 0;
  const invalid = () => ({ difference: Infinity, absoluteTermSum: Infinity, linear: Infinity, remainder: Infinity, absoluteRemainderTermSum: Infinity, triangles: membrane.mesh.nT, valid: false });
  try {
    for (let t = 0; t < membrane.mesh.nT; t++) {
      const e = membrane.elements[t], ids = membrane.mesh.tris.subarray(3 * t, 3 * t + 3);
      if (!accurateKinematics(e, after, ids, k, coordinates) || !accurateKinematics(e, before, ids, k, coordinates)) return invalid();
      const a = words(k.ddA, 3), b = words(k.ddB, 3), stress = words(k.ddStress, 3);
      const displacement = Array.from(ids, id => [0, 1, 2].map(r => D.twoSum(after[3 * id + r], -before[3 * id + r])));
      const da = [], db = [];
      for (let r = 0; r < 3; r++) {
        const d1 = D.sub(displacement[1][r], displacement[0][r]), d2 = D.sub(displacement[2][r], displacement[0][r]);
        da.push(D.add(D.scale(d1, (e.reference?.u ?? e.alpha)[1]), D.scale(d2, (e.reference?.u ?? e.alpha)[2])));
        db.push(D.add(D.scale(d1, (e.reference?.v ?? e.beta)[1]), D.scale(d2, (e.reference?.v ?? e.beta)[2])));
      }
      let de = [D.add(dot(a, da), D.scale(dot(da, da), .5)), D.add(dot(b, db), D.scale(dot(db, db), .5)), D.sum([dot(a, db), dot(b, da), dot(da, db)])];
      if (e.reference) de = referenceRotate(e.reference, de);
      const geometricStress = e.reference ? referenceRotate(e.reference, stress, true) : stress;
      const q = e.Q, ds = [D.add(D.scale(de[0], q[0]), D.scale(de[1], q[2])), D.add(D.scale(de[0], q[2]), D.scale(de[1], q[1])), D.scale(de[2], q[3])];
      const quadratic = de.map((v, i) => D.scale(D.mul(v, ds[i]), .5));
      const rrTerms = [...quadratic];
      for (let r = 0; r < 3; r++) rrTerms.push(D.scale(D.mul(geometricStress[0], D.mul(da[r], da[r])), .5), D.scale(D.mul(geometricStress[1], D.mul(db[r], db[r])), .5), D.mul(geometricStress[2], D.mul(da[r], db[r])));
      const changeTerms = [...de.map((v, i) => D.mul(v, stress[i])), ...quadratic];
      const rr = D.scale(D.sum(rrTerms), e.volume), change = D.scale(D.sum(changeTerms), e.volume);
      total = D.add(total, change); remainder = D.add(remainder, rr);
      magnitude += changeTerms.reduce((s, term) => s + Math.abs(D.rounded(D.scale(term, e.volume))), 0);
      remainderMagnitude += rrTerms.reduce((s, term) => s + Math.abs(D.rounded(D.scale(term, e.volume))), 0);
      for (let i = 0; i < 3; i++) for (let r = 0; r < 3; r++) linear = D.add(linear, D.mul(accurateGradient(e, k, 3 * i + r), displacement[i][r]));
    }
    if (!Number.isFinite(magnitude + remainderMagnitude)) return invalid();
    return { difference: D.rounded(total), absoluteTermSum: magnitude, linear: D.rounded(linear), remainder: D.rounded(remainder),
      remainderWords: remainder, absoluteRemainderTermSum: remainderMagnitude, triangles: membrane.mesh.nT, valid: true };
  } catch (error) { if (!(error instanceof RangeError)) throw error; return invalid(); }
}

/** DD selected objective evaluation; World predictor/inertia gradient and the
 * coefficient's native association stay unchanged. TwoDiff endpoint work avoids
 * mixing a rounded step slope with an exact-endpoint membrane remainder.
 * @param {any} w @param {Float64Array} before @param {Float64Array} after @param {Float64Array} gradient @param {Float64Array} [target] */
export function accurateTrialTerms(w, before, after, gradient, target = w.xt) {
  let slope = /** @type {D.DD} */ ([0, 0]), inertia = /** @type {D.DD} */ ([0, 0]), linear = /** @type {D.DD} */ ([0, 0]);
  let slopeMagnitude = 0, inertiaMagnitude = 0;
  const idt2 = 1 / (w.dt * w.dt);
  for (let i = 0; i < before.length; i++) {
    const d = D.twoSum(after[i], -before[i]), coefficient = w.mass[Math.floor(i / 3)] * idt2;
    const work = D.scale(d, gradient[i]), quadratic = D.scale(D.scale(D.mul(d, d), coefficient), .5);
    slope = D.add(slope, work); inertia = D.add(inertia, quadratic);
    linear = D.add(linear, D.scale(D.mul(D.twoSum(before[i], -target[i]), d), coefficient));
    slopeMagnitude += Math.abs(D.rounded(work)); inertiaMagnitude += Math.abs(D.rounded(quadratic));
  }
  return { slope: D.rounded(slope), inertiaRemainder: D.rounded(inertia), inertiaLinear: D.rounded(linear), slopeWords: slope, inertiaWords: inertia, slopeMagnitude, inertiaMagnitude };
}
