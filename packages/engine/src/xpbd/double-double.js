// @ts-check
/** Bounded two-word arithmetic for a research candidate, not correctly rounded
 * polynomial evaluation. TwoSum / split TwoProduct follow Ogita–Rump–Oishi,
 * SISC26(6),2005, algorithms3.1–3.3. No FMA, bit tricks or precision fallback.
 * Each nonzero multiplication argument is restricted to [2^-450,2^450].
 * Split components then have normal nonzero products >=2^-1004; splitter and
 * high products cannot overflow. Low-word cross products get the SAME guard.
 */
const LOW = 2 ** -450, HIGH = 2 ** 450, SPLITTER = 2 ** 27 + 1;
/** @typedef {[number,number]} DD */
export const DOUBLE_DOUBLE_IDENTITY = Object.freeze({ name: 'double-double', version: 1, productExponentLimit: 450, derivative: 'coherent-difference', displacement: 'two-diff' });
function finite(value) { if (!Number.isFinite(value)) throw new RangeError('double-double: nonfinite intermediate'); return value; }
function factor(value) {
  finite(value);
  if (value !== 0 && (Math.abs(value) < LOW || Math.abs(value) > HIGH)) throw new RangeError('double-double: multiplication operand outside [2^-450,2^450]');
}
/** Error-free addition under binary64 round-to-nearest, gradual underflow, no overflow.
 * @param {number} a @param {number} b @returns {DD} */
export function twoSum(a, b) {
  finite(a); finite(b); const sum = finite(a + b), virtual = sum - a;
  return [sum, finite((a - (sum - virtual)) + (b - virtual))];
}
/** Exact two-word product within the explicitly guarded normal-product domain.
 * @param {number} a @param {number} b @returns {DD} */
export function twoProduct(a, b) {
  factor(a); factor(b); const product = finite(a * b);
  if (a === 0 || b === 0) return [product, 0];
  const ca = SPLITTER * a, ah = ca - (ca - a), al = a - ah;
  const cb = SPLITTER * b, bh = cb - (cb - b), bl = b - bh;
  return [product, finite(al * bl - (((product - ah * bh) - al * bh) - ah * bl))];
}
/** Rounded two-word sum; discarded third-order terms are not an interval bound.
 * @param {DD} a @param {DD} b @returns {DD} */
export function add(a, b) {
  const s = twoSum(a[0], b[0]), t = twoSum(a[1], b[1]);
  const u = twoSum(s[1], t[0]), v = twoSum(s[0], u[0]);
  return twoSum(v[0], finite((v[1] + u[1]) + t[1]));
}
/** @param {DD} a @returns {DD} */
export function neg(a) { return [-a[0], -a[1]]; }
/** @param {DD} a @param {DD} b @returns {DD} */
export function sub(a, b) { return add(a, neg(b)); }
/** Four guarded products, accumulated in a fixed order. @param {DD} a @param {DD} b @returns {DD} */
export function mul(a, b) {
  let value = twoProduct(a[0], b[0]);
  if (b[1] !== 0) value = add(value, twoProduct(a[0], b[1]));
  if (a[1] !== 0) value = add(value, twoProduct(a[1], b[0]));
  if (a[1] !== 0 && b[1] !== 0) value = add(value, twoProduct(a[1], b[1]));
  return value;
}
/** @param {DD} a @param {number} b @returns {DD} */
export function scale(a, b) { return mul(a, [b, 0]); }
/** @param {DD[]} values @returns {DD} */
export function sum(values) { let out = /** @type {DD} */ ([0, 0]); for (const value of values) out = add(out, value); return out; }
/** One binary64 view, not a universally correct-rounding claim. @param {DD} a */
export function rounded(a) { return finite(a[0] + a[1]); }
/** @param {Float64Array} a @param {number} i @returns {DD} */
export function get(a, i) { return [a[2 * i], a[2 * i + 1]]; }
/** @param {Float64Array} a @param {number} i @param {DD} value */
export function put(a, i, value) { a[2 * i] = value[0]; a[2 * i + 1] = value[1]; }
