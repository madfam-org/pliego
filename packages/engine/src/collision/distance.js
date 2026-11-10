// @ts-check
// Closest-feature distances for codimensional contact. No enlarged face or
// negative barycentric weights: outside a face, its actual edges/vertices win.
// Optional weights describe r = Σ weights[i] x[id[i]] (first primitive minus
// second), usable for distance gradients. Fixed traversal makes ties repeatable.

const clamp = x => Math.max(0, Math.min(1, x));

/** Squared distance from p to segment ab; optionally write [1, -(1-t), -t].
 * @param {ArrayLike<number>} x @param {number} p @param {number} a @param {number} b
 * @param {Float64Array|number[]} [weights]
 */
export function pointSegmentDistanceSquared(x, p, a, b, weights) {
  const px = x[3 * p] - x[3 * a], py = x[3 * p + 1] - x[3 * a + 1], pz = x[3 * p + 2] - x[3 * a + 2];
  const ux = x[3 * b] - x[3 * a], uy = x[3 * b + 1] - x[3 * a + 1], uz = x[3 * b + 2] - x[3 * a + 2];
  const length2 = ux * ux + uy * uy + uz * uz;
  const t = length2 > 0 ? clamp((px * ux + py * uy + pz * uz) / length2) : 0;
  if (weights) { weights[0] = 1; weights[1] = t - 1; weights[2] = -t; }
  const dx = px - t * ux, dy = py - t * uy, dz = pz - t * uz;
  return dx * dx + dy * dy + dz * dz;
}

/** Squared point–triangle distance, including edge/vertex and degenerate features.
 * @param {ArrayLike<number>} x @param {number} p @param {number} a @param {number} b @param {number} c
 * @param {Float64Array|number[]} [weights] [p,a,b,c]
 */
export function pointTriangleDistanceSquared(x, p, a, b, c, weights) {
  const px = x[3 * p] - x[3 * a], py = x[3 * p + 1] - x[3 * a + 1], pz = x[3 * p + 2] - x[3 * a + 2];
  const ux = x[3 * b] - x[3 * a], uy = x[3 * b + 1] - x[3 * a + 1], uz = x[3 * b + 2] - x[3 * a + 2];
  const vx = x[3 * c] - x[3 * a], vy = x[3 * c + 1] - x[3 * a + 1], vz = x[3 * c + 2] - x[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const area2 = nx * nx + ny * ny + nz * nz;
  if (area2 > 0) {
    // Oriented areas avoid subtracting almost equal Gram products for slivers.
    const bb = ((py * vz - pz * vy) * nx + (pz * vx - px * vz) * ny + (px * vy - py * vx) * nz) / area2;
    const cc = ((uy * pz - uz * py) * nx + (uz * px - ux * pz) * ny + (ux * py - uy * px) * nz) / area2;
    const aa = 1 - bb - cc;
    if (aa >= 0 && bb >= 0 && cc >= 0) {
      if (weights) { weights[0] = 1; weights[1] = -aa; weights[2] = -bb; weights[3] = -cc; }
      const height = px * nx + py * ny + pz * nz;
      return height * height / area2;
    }
  }
  let best = Infinity, bestEdge = 0, bestT = 0;
  for (let edge = 0; edge < 3; edge++) {
    const i = edge === 0 ? a : edge === 1 ? b : c, j = edge === 0 ? b : edge === 1 ? c : a;
    const ex = x[3 * j] - x[3 * i], ey = x[3 * j + 1] - x[3 * i + 1], ez = x[3 * j + 2] - x[3 * i + 2];
    const qx = x[3 * p] - x[3 * i], qy = x[3 * p + 1] - x[3 * i + 1], qz = x[3 * p + 2] - x[3 * i + 2];
    const len2 = ex * ex + ey * ey + ez * ez;
    const t = len2 > 0 ? clamp((qx * ex + qy * ey + qz * ez) / len2) : 0;
    const dx = qx - t * ex, dy = qy - t * ey, dz = qz - t * ez, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) { best = d2; bestEdge = edge; bestT = t; }
  }
  if (weights) {
    weights[0] = 1; weights[1] = 0; weights[2] = 0; weights[3] = 0;
    weights[bestEdge + 1] = bestT - 1;
    weights[(bestEdge + 1) % 3 + 1] = -bestT;
  }
  return best;
}

/** Squared segment–segment distance. Parallel/zero-length edges use boundaries.
 * @param {ArrayLike<number>} x @param {number} a @param {number} b @param {number} c @param {number} d
 * @param {Float64Array|number[]} [weights] [a,b,c,d]
 */
export function edgeEdgeDistanceSquared(x, a, b, c, d, weights) {
  const ux = x[3 * b] - x[3 * a], uy = x[3 * b + 1] - x[3 * a + 1], uz = x[3 * b + 2] - x[3 * a + 2];
  const vx = x[3 * d] - x[3 * c], vy = x[3 * d + 1] - x[3 * c + 1], vz = x[3 * d + 2] - x[3 * c + 2];
  const wx = x[3 * c] - x[3 * a], wy = x[3 * c + 1] - x[3 * a + 1], wz = x[3 * c + 2] - x[3 * a + 2];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const area2 = nx * nx + ny * ny + nz * nz;
  if (area2 > 0) {
    const s = ((wy * vz - wz * vy) * nx + (wz * vx - wx * vz) * ny + (wx * vy - wy * vx) * nz) / area2;
    const t = ((wy * uz - wz * uy) * nx + (wz * ux - wx * uz) * ny + (wx * uy - wy * ux) * nz) / area2;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1) {
      if (weights) { weights[0] = 1 - s; weights[1] = s; weights[2] = t - 1; weights[3] = -t; }
      const dx = s * ux - wx - t * vx, dy = s * uy - wy - t * vy, dz = s * uz - wz - t * vz;
      return dx * dx + dy * dy + dz * dz;
    }
  }
  // A convex segment-pair problem has an interior minimum or a boundary minimum.
  let best = Infinity, bestS = 0, bestT = 0;
  for (let edge = 0; edge < 4; edge++) {
    const p = edge === 0 ? a : edge === 1 ? b : edge === 2 ? c : d;
    const i = edge < 2 ? c : a, j = edge < 2 ? d : b;
    const ex = x[3 * j] - x[3 * i], ey = x[3 * j + 1] - x[3 * i + 1], ez = x[3 * j + 2] - x[3 * i + 2];
    const qx = x[3 * p] - x[3 * i], qy = x[3 * p + 1] - x[3 * i + 1], qz = x[3 * p + 2] - x[3 * i + 2];
    const len2 = ex * ex + ey * ey + ez * ez;
    const t = len2 > 0 ? clamp((qx * ex + qy * ey + qz * ez) / len2) : 0;
    const dx = qx - t * ex, dy = qy - t * ey, dz = qz - t * ez, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < best) { best = d2; bestS = edge < 2 ? edge : t; bestT = edge < 2 ? t : edge - 2; }
  }
  if (weights) { weights[0] = 1 - bestS; weights[1] = bestS; weights[2] = bestT - 1; weights[3] = -bestT; }
  return best;
}
