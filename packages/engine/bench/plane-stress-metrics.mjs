// Field measurements for a declared 2D static comparison; no constitutive/solver imports.
import assert from 'node:assert/strict';

const RANK_TOLERANCE = 1e-12, CONTAINMENT_TOLERANCE = 1e-12, FLOOR_FRACTION = 1e-12;
const finite = (v, label) => assert.ok(Number.isFinite(v), label + ' must be finite');
function vectors(value, label, count) {
  assert.ok(Array.isArray(value) && value.length > 0, label + ' must be a nonempty array');
  if (count !== undefined) assert.equal(value.length, count, label + ' count mismatch');
  for (const row of value) {
    assert.ok((Array.isArray(row) || ArrayBuffer.isView(row)) && row.length === 2, label + ' requires [u,v] rows');
    for (const v of row) finite(v, label);
  }
}
function magnitude(rows) {
  let result = 0;
  for (const row of rows) for (const v of row) result = Math.hypot(result, v);
  return result;
}
function difference(a, b) {
  return a.map((row, i) => row.map((v, j) => { const d = v - b[i][j]; finite(d, 'field difference'); return d; }));
}
function coordinateFrame(vertices) {
  vectors(vertices, 'vertices');
  const origin = vertices[0], offsets = vertices.map(row => row.map((v, j) => v - origin[j]));
  vectors(offsets, 'coordinate offsets');
  const average = [0, 0];
  for (const row of offsets) for (let j = 0; j < 2; j++) average[j] += row[j] / vertices.length;
  const center = average.map((v, j) => v + origin[j]);
  const normalized = vertices.map(row => row.map((v, j) => v - center[j]));
  const scale = [0, 0];
  for (const row of normalized) for (let j = 0; j < 2; j++) scale[j] = Math.max(scale[j], Math.abs(row[j]));
  assert.ok(scale.every(v => Number.isFinite(v) && v > 0), 'rank-deficient coordinate frame');
  return { center, scale, rows: normalized.map(row => [1, row[0] / scale[0], row[1] / scale[1]]) };
}
function solveThree(matrix, rhs) {
  const a = matrix.map((row, i) => [...row, rhs[i]]), n = matrix.length;
  const matrixScale = Math.max(...matrix.map(row => row.reduce((s, v) => s + Math.abs(v), 0)));
  let minimumScaledPivot = Infinity;
  for (let k = 0; k < n; k++) {
    let pivot = k;
    // Strict > retains the lowest row in an exact tie.
    for (let i = k + 1; i < n; i++) if (Math.abs(a[i][k]) > Math.abs(a[pivot][k])) pivot = i;
    const scaled = Math.abs(a[pivot][k]) / matrixScale;
    assert.ok(Number.isFinite(scaled) && scaled > RANK_TOLERANCE, 'rank-deficient or ill-conditioned affine fit');
    minimumScaledPivot = Math.min(minimumScaledPivot, scaled);
    [a[k], a[pivot]] = [a[pivot], a[k]];
    for (let i = k + 1; i < n; i++) {
      const factor = a[i][k] / a[k][k];
      for (let j = k + 1; j <= n; j++) a[i][j] -= factor * a[k][j];
      a[i][k] = 0;
    }
  }
  const solution = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let value = a[i][n];
    for (let j = i + 1; j < n; j++) value -= a[i][j] * solution[j];
    solution[i] = value / a[i][i]; finite(solution[i], 'affine coefficient');
  }
  return { solution, minimumScaledPivot };
}

/** Unweighted all-node best affine fit. Coefficients are [constant,u-slope,v-slope]
 * for each displacement component; predictions use centered/scaled coordinates.
 * Relative residual is ||u-u_affine||_nodes / ||u||_nodes, NOT an accuracy gate. */
export function fitAffine(vertices, displacements) {
  vectors(displacements, 'displacements', vertices.length);
  assert.ok(vertices.length >= 3, 'at least three vertices required for affine rank');
  const frame = coordinateFrame(vertices), n = vertices.length;
  const gram = Array.from({ length: 3 }, () => [0, 0, 0]);
  for (const row of frame.rows) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) gram[i][j] += row[i] * row[j] / n;
  let responseScale = 0;
  for (const row of displacements) for (const v of row) responseScale = Math.max(responseScale, Math.abs(v));
  if (responseScale === 0) responseScale = 1;
  const values = displacements.map(row => row.map(v => v / responseScale));
  let minimumScaledPivot = Infinity;
  const normalizedCoefficients = [0, 1].map(component => {
    const rhs = [0, 0, 0];
    for (let v = 0; v < n; v++) for (let j = 0; j < 3; j++) rhs[j] += frame.rows[v][j] * values[v][component] / n;
    const result = solveThree(gram, rhs); minimumScaledPivot = Math.min(minimumScaledPivot, result.minimumScaledPivot);
    return result.solution;
  });
  const predictedNormalized = frame.rows.map(row => normalizedCoefficients.map(c => row.reduce((sum, v, j) => sum + v * c[j], 0)));
  const residual = magnitude(difference(values, predictedNormalized)), dataNorm = magnitude(values);
  const coefficients = normalizedCoefficients.map(c => {
    const u = c[1] * responseScale / frame.scale[0], v = c[2] * responseScale / frame.scale[1];
    const result = [c[0] * responseScale - u * frame.center[0] - v * frame.center[1], u, v];
    for (const x of result) finite(x, 'original-coordinate affine coefficient');
    return result;
  });
  const predicted = predictedNormalized.map(row => row.map(v => v * responseScale));
  const absoluteResidualL2 = residual * responseScale, displacementL2 = dataNorm * responseScale;
  finite(absoluteResidualL2, 'affine residual'); finite(displacementL2, 'displacement norm');
  return { coefficients, centeredScaledCoefficients: normalizedCoefficients.map(row => row.map(v => v * responseScale)),
    center: frame.center, scale: frame.scale, predicted, absoluteResidualL2, displacementL2,
    relativeResidual: dataNorm === 0 ? 0 : residual / dataNorm, minimumScaledPivot, rankTolerance: RANK_TOLERANCE,
    normalization: 'unweighted all-node Euclidean displacement residual; zero field has zero residual; nonaffinity is a scope check, not material accuracy' };
}

function triangleData(vertices, triangles) {
  vectors(vertices, 'vertices'); assert.ok(Array.isArray(triangles) && triangles.length > 0, 'triangles must be nonempty');
  const seen = new Set();
  return triangles.map((tri, index) => {
    assert.ok(Array.isArray(tri) && tri.length === 3 && tri.every(v => Number.isInteger(v) && v >= 0 && v < vertices.length) && new Set(tri).size === 3, 'invalid triangle indices');
    const key = tri.toSorted((a, b) => a - b).join(','); assert.ok(!seen.has(key), 'duplicate triangle'); seen.add(key);
    const a = vertices[tri[0]], d1 = vertices[tri[1]].map((v, i) => v - a[i]), d2 = vertices[tri[2]].map((v, i) => v - a[i]);
    const scale = Math.max(...d1.map(Math.abs), ...d2.map(Math.abs));
    assert.ok(Number.isFinite(scale) && scale > 0, 'degenerate reference triangle');
    const e1 = d1.map(v => v / scale), e2 = d2.map(v => v / scale), det = e1[0] * e2[1] - e1[1] * e2[0];
    assert.ok(Number.isFinite(det) && det > RANK_TOLERANCE, 'reference triangle must be CCW and nondegenerate');
    const area = det * scale * scale / 2; assert.ok(Number.isFinite(area) && area > 0, 'reference area outside finite domain');
    return { index, tri, origin: a, scale, e1, e2, det, area };
  });
}
function fieldScales(vertices, eta) {
  assert.ok(Number.isFinite(eta) && eta > 0, 'positive finite eta required');
  const span = [0, 1].map(j => {
    let lo = Infinity, hi = -Infinity;
    for (const row of vertices) { lo = Math.min(lo, row[j]); hi = Math.max(hi, row[j]); }
    return hi - lo;
  });
  const lengthScale = Math.max(...span), displacementFloor = eta * lengthScale * FLOOR_FRACTION;
  assert.ok(Number.isFinite(lengthScale) && lengthScale > 0 && Number.isFinite(displacementFloor) && displacementFloor > 0, 'field scale outside finite positive domain');
  return { eta, lengthScale, displacementFloor, floorFraction: FLOOR_FRACTION };
}
function weightedRms(rows, weights, total) {
  let scale = 0;
  for (const row of rows) for (const v of row) scale = Math.max(scale, Math.abs(v));
  if (scale === 0) return 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) sum += weights[i] / total * ((rows[i][0] / scale) ** 2 + (rows[i][1] / scale) ** 2);
  const result = scale * Math.sqrt(sum); finite(result, 'weighted field RMS'); return result;
}

/** Area-lumped FE L2 absolute error has units displacement*sqrt(area); RMS is
 * also returned in displacement units. Relative denominator is reference L2 with
 * an explicit tiny eta*patch-span floor; no energy/reaction gate is inferred. */
export function compareFields(patch, actual, reference, { eta } = {}) {
  const geometry = triangleData(patch.vertices, patch.triangles);
  vectors(actual, 'actual displacement', patch.vertices.length); vectors(reference, 'reference displacement', patch.vertices.length);
  const weights = Array(patch.vertices.length).fill(0);
  for (const t of geometry) for (const v of t.tri) weights[v] += t.area / 3;
  assert.ok(weights.every(v => v > 0), 'all vertices must be consumed by positive reference triangles');
  const area = weights.reduce((sum, v) => sum + v, 0); finite(area, 'reference area');
  const errors = difference(actual, reference), scales = fieldScales(patch.vertices, eta);
  const absoluteRms = weightedRms(errors, weights, area), referenceRms = weightedRms(reference, weights, area), actualRms = weightedRms(actual, weights, area);
  const rmsDenominator = Math.max(referenceRms, scales.displacementFloor), sqrtArea = Math.sqrt(area);
  const absoluteL2 = absoluteRms * sqrtArea, referenceL2 = referenceRms * sqrtArea, actualL2 = actualRms * sqrtArea;
  const relativeL2 = absoluteRms / rmsDenominator, l2Denominator = rmsDenominator * sqrtArea;
  for (const v of [absoluteL2, referenceL2, actualL2, relativeL2, l2Denominator]) finite(v, 'area-lumped L2');
  return { relativeL2, relativeAreaLumpedL2: relativeL2,
    absoluteL2, referenceL2, actualL2, absoluteRms, referenceRms, actualRms,
    maximumNodalError: Math.max(...errors.map(row => Math.hypot(...row))),
    rmsDenominator, l2Denominator, area, lumpedAreas: weights, ...scales,
    normalization: 'area-lumped L2 error / max(reference L2, eta*max(UV spans)*1e-12*sqrt(area)); RMS has displacement units; energy/reaction and scope gates separate' };
}

/** Deterministic CCW containment; shared-edge ties choose lowest triangle index.
 * The declared barycentric roundoff band does not authorize nearest-node fallback. */
export function sampleField(vertices, triangles, displacements, points) {
  const geometry = triangleData(vertices, triangles);
  vectors(displacements, 'displacements', vertices.length); vectors(points, 'sample points');
  const values = [], triangleIndices = [], barycentric = [];
  for (const point of points) {
    let found = null;
    for (const t of geometry) {
      const p = point.map((v, j) => (v - t.origin[j]) / t.scale);
      const w1 = (p[0] * t.e2[1] - p[1] * t.e2[0]) / t.det;
      const w2 = (t.e1[0] * p[1] - t.e1[1] * p[0]) / t.det, weights = [1 - w1 - w2, w1, w2];
      if (weights.every(v => v >= -CONTAINMENT_TOLERANCE && v <= 1 + CONTAINMENT_TOLERANCE)) { found = { t, weights }; break; }
    }
    assert.ok(found, 'sample point outside CCW reference mesh (no nearest fallback)');
    const value = [0, 1].map(j => found.t.tri.reduce((sum, v, i) => sum + found.weights[i] * displacements[v][j], 0));
    for (const v of value) finite(v, 'sampled displacement');
    values.push(value); triangleIndices.push(found.t.index); barycentric.push(found.weights);
  }
  return { values, triangleIndices, barycentric, containmentTolerance: CONTAINMENT_TOLERANCE,
    tieRule: 'lowest authored triangle index; raw barycentric weights retained; no clamping or outside fallback' };
}

/** Uniform sample-point RMS for cross-mesh comparison, distinct from FE L2. */
export function compareMeshFields(meshA, fieldA, meshB, fieldB, points, { eta } = {}) {
  const a = sampleField(meshA.vertices, meshA.triangles, fieldA, points), b = sampleField(meshB.vertices, meshB.triangles, fieldB, points);
  const weights = Array(points.length).fill(1), errors = difference(a.values, b.values), scales = fieldScales(meshB.vertices, eta);
  const absoluteRms = weightedRms(errors, weights, points.length), referenceRms = weightedRms(b.values, weights, points.length);
  const denominator = Math.max(referenceRms, scales.displacementFloor), relativeRms = absoluteRms / denominator;
  finite(relativeRms, 'sampled relative RMS');
  return { relativeRms, absoluteRms, referenceRms, denominator,
    maximumSampleError: Math.max(...errors.map(row => Math.hypot(...row))), points: points.length,
    triangleIndicesA: a.triangleIndices, triangleIndicesB: b.triangleIndices,
    ...scales, normalization: 'uniform common-point displacement RMS, not area-integrated FE L2; second field is reference; eta*reference-mesh-domain-span*1e-12 floor' };
}
