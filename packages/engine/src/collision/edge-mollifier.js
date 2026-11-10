// @ts-check
// IPC 2020 Eq.24 multiplier; native derivatives, with immutable rest threshold.
// Multiplying energy requires BOTH the distance and multiplier derivatives.

/** @param {ArrayLike<number>} x @param {number} a @param {number} b */
export function edgeLengthSquared(x, a, b) {
  let squared = 0;
  for (let k = 0; k < 3; k++) { const delta = x[3 * b + k] - x[3 * a + k]; squared += delta * delta; }
  return squared;
}

/** m(c), c=|(b-a)×(d-c)|², threshold ε fixed from rest edges (mm⁴).
 * values receives [m,dm/dc,c]. Optional caller-owned buffers receive ∇m and
 * the 3×12 row-major cross-product Jacobian inside the smoothing interval
 * (both buffers zero outside it). No per-call scratch allocation.
 * At zero rest threshold the reference branch is m=1, including c=0.
 * @param {ArrayLike<number>} x @param {ArrayLike<number>} ids @param {number} threshold
 * @param {Float64Array} values @param {Float64Array} [gradient] @param {Float64Array} [jacobian]
 */
export function edgeEdgeMollifier(x, ids, threshold, values, gradient, jacobian) {
  if (!(threshold >= 0 && Number.isFinite(threshold))) throw new RangeError('Mollifier: threshold must be finite and nonnegative');
  if (gradient && !jacobian) throw new Error('Mollifier: gradient requires a Jacobian scratch buffer');
  const a = 3 * ids[0], b = 3 * ids[1], c = 3 * ids[2], d = 3 * ids[3];
  const ux = x[b] - x[a], uy = x[b + 1] - x[a + 1], uz = x[b + 2] - x[a + 2];
  const vx = x[d] - x[c], vy = x[d + 1] - x[c + 1], vz = x[d + 2] - x[c + 2];
  const sx = uy * vz - uz * vy, sy = uz * vx - ux * vz, sz = ux * vy - uy * vx;
  const squared = sx * sx + sy * sy + sz * sz;
  values[2] = squared;
  if (squared >= threshold) { values[0] = 1; values[1] = 0; gradient?.fill(0); jacobian?.fill(0); return; }
  const r = squared / threshold, derivative = 2 * (1 - r) / threshold;
  values[0] = r * (2 - r); values[1] = derivative;
  if (!jacobian) return;
  skewBlock(jacobian, 0, vx, vy, vz); skewBlock(jacobian, 3, -vx, -vy, -vz);
  skewBlock(jacobian, 6, -ux, -uy, -uz); skewBlock(jacobian, 9, ux, uy, uz);
  if (gradient) for (let i = 0; i < 12; i++) gradient[i] = 2 * derivative * (sx * jacobian[i] + sy * jacobian[12 + i] + sz * jacobian[24 + i]);
}

/** @param {Float64Array} J @param {number} c @param {number} x @param {number} y @param {number} z */
function skewBlock(J, c, x, y, z) {
  J[c] = 0; J[c + 1] = -z; J[c + 2] = y;
  J[12 + c] = z; J[13 + c] = 0; J[14 + c] = -x;
  J[24 + c] = -y; J[25 + c] = x; J[26 + c] = 0;
}
