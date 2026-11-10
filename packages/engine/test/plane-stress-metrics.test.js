import test from 'node:test';
import assert from 'node:assert/strict';
import { fitAffine, compareFields, sampleField, compareMeshFields } from '../bench/plane-stress-metrics.mjs';

const close = (a, b, tol = 1e-12) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
const square = { vertices: [[0, 0], [1, 0], [1, 1], [0, 1]], triangles: [[0, 1, 2], [0, 2, 3]] };
const affine = ([u, v]) => [0.3 + 0.2 * u - 0.1 * v, -0.7 - 0.3 * u + 0.6 * v];
function grid(n) {
  const vertices = [], triangles = [], id = (i, j) => j * (n + 1) + i;
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) vertices.push([i / n, j / n]);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = id(i, j), b = id(i + 1, j), c = id(i + 1, j + 1), d = id(i, j + 1);
    triangles.push([a, b, c], [a, c, d]);
  }
  return { vertices, triangles };
}

test('centered/scaled affine fit recovers both full displacement gradients and retains non-affinity separately', () => {
  const patch = grid(6), field = patch.vertices.map(affine), fitted = fitAffine(patch.vertices, field);
  assert.ok(fitted.relativeResidual < 1e-14);
  for (const [i, expected] of [[0, [0.3, 0.2, -0.1]], [1, [-0.7, -0.3, 0.6]]]) {
    for (let j = 0; j < 3; j++) close(fitted.coefficients[i][j], expected[j]);
  }
  for (let i = 0; i < field.length; i++) for (let j = 0; j < 2; j++) close(fitted.predicted[i][j], field[i][j]);
  const quadratic = patch.vertices.map(([u, v]) => [u * u, u * v + v * v]);
  const curved = fitAffine(patch.vertices, quadratic);
  assert.ok(curved.relativeResidual > .1 && curved.relativeResidual < .5);
  assert.ok(curved.relativeResidual > 1e-3, 'non-affinity scope threshold must distinguish quadratic field');
  const zero = fitAffine(patch.vertices, field.map(() => [0, 0]));
  assert.equal(zero.relativeResidual, 0); assert.equal(zero.absoluteResidualL2, 0);
  assert.deepEqual(curved, fitAffine(patch.vertices, quadratic));
  console.log('plane-stress-affine: exact coupled affine coefficients and predictions; nonaffine quadratic exceeds 1e-3 scope floor; exact repeat and zero field verified');
});

test('affine residual is stable under reference-coordinate scaling/translation; collinear/invalid inputs reject visibly', () => {
  const patch = grid(5), field = patch.vertices.map(([u, v]) => [u * u + .1 * v, u * v - .2 * u]);
  const original = fitAffine(patch.vertices, field);
  for (const scale of [1e-6, 1e3]) {
    const transformed = patch.vertices.map(([u, v]) => [scale * (u + 13), scale * (v - 17)]);
    const result = fitAffine(transformed, field);
    close(result.relativeResidual, original.relativeResidual, 1e-12);
    for (let i = 0; i < field.length; i++) for (let j = 0; j < 2; j++) close(result.predicted[i][j], original.predicted[i][j], 1e-12);
  }
  assert.throws(() => fitAffine([[0, 0], [1, 1], [2, 2]], [[0, 0], [1, 1], [2, 2]]), /rank-deficient/);
  assert.throws(() => fitAffine([[0, 0], [1, 1], [2, 2 + 1e-8]], [[0, 0], [1, 1], [2, 2]]), /rank-deficient|ill-conditioned/);
  assert.throws(() => fitAffine([[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 1], [2, 2]]), /rank-deficient/);
  assert.throws(() => fitAffine(square.vertices, [[0, 0]]), /count mismatch/);
  assert.throws(() => fitAffine(square.vertices, square.vertices.map(() => [Infinity, 0])), /finite/);
  console.log('plane-stress-fit-domain: centered/rescaled fits preserve nonaffinity; rank/near-rank/shape/nonfinite failures remain visible');
});

test('area-lumped field L2, absolute RMS, maximum nodal error and tiny declared eta floor match known fields', () => {
  const reference = square.vertices.map(() => [3, 4]), actual = square.vertices.map(() => [6, 8]);
  const measured = compareFields(square, actual, reference, { eta: 1e-4 });
  close(measured.area, 1); close(measured.referenceL2, 5); close(measured.absoluteL2, 5);
  close(measured.absoluteRms, 5); close(measured.maximumNodalError, 5); close(measured.relativeL2, 1);
  assert.deepEqual(measured.lumpedAreas, [1 / 3, 1 / 6, 1 / 3, 1 / 6]);
  close(measured.displacementFloor, 1e-16, 1e-20);
  const one = compareFields(square, [[1, 0], [0, 0], [0, 0], [0, 0]], square.vertices.map(() => [0, 0]), { eta: 1e-4 });
  close(one.absoluteL2, Math.sqrt(1 / 3)); close(one.maximumNodalError, 1);
  assert.equal(one.rmsDenominator, one.displacementFloor);
  const zero = compareFields(square, square.vertices.map(() => [0, 0]), square.vertices.map(() => [0, 0]), { eta: 1e-4 });
  assert.equal(zero.relativeL2, 0);
  const scaled = { vertices: square.vertices.map(v => v.map(x => 2 * x)), triangles: square.triangles };
  const large = compareFields(scaled, actual, reference, { eta: 1e-4 });
  close(large.absoluteL2, 2 * measured.absoluteL2); close(large.absoluteRms, measured.absoluteRms); close(large.relativeL2, 1);
  assert.throws(() => compareFields(square, actual, reference, { eta: 0 }), /eta/);
  assert.throws(() => compareFields({ ...square, vertices: [...square.vertices, [2, 2]] }, [...actual, [0, 0]], [...reference, [0, 0]], { eta: 1e-4 }), /all vertices/);
  console.log('plane-stress-field-norm: independently known area-lumped L2/RMS/max error; units, area scaling, zero-reference floor and unused-node rejection explicit');
});

test('CCW barycentric interpolation uses lowest authored triangle on shared edges and never falls back outside', () => {
  const field = square.vertices.map(affine), points = [[.75, .25], [.25, .75], [.5, .5], [0, 0], [1, 1]];
  const result = sampleField(square.vertices, square.triangles, field, points);
  assert.deepEqual(result.triangleIndices, [0, 1, 0, 0, 0]);
  for (let i = 0; i < points.length; i++) {
    for (let c = 0; c < 2; c++) close(result.values[i][c], affine(points[i])[c]);
    close(result.barycentric[i].reduce((s, v) => s + v, 0), 1);
  }
  assert.deepEqual(result, sampleField(square.vertices, square.triangles, field, points));
  assert.throws(() => sampleField(square.vertices, square.triangles, field, [[-1e-6, .5]]), /outside/);
  assert.throws(() => sampleField(square.vertices, [[0, 2, 1]], field, [[.5, .5]]), /CCW/);
  assert.throws(() => sampleField(square.vertices, [[0, 1, 1]], field, [[.5, .5]]), /indices/);
  assert.throws(() => sampleField(square.vertices, [[0, 1, 2], [2, 0, 1]], field, [[.5, .5]]), /duplicate/);
  assert.throws(() => sampleField([[0, 0], [1, 0], [2, 0]], [[0, 1, 2]], [[0, 0], [0, 0], [0, 0]], [[.5, 0]]), /degenerate/);
  console.log('plane-stress-sampling: exact affine interpolation; stable lowest-triangle edge/vertex ties; outside/reversed/duplicate/degenerate inputs rejected');
});

test('common-point mesh comparison retains sampled RMS separately from FE L2 and matches a known affine field', () => {
  const a = grid(2), b = grid(4), points = grid(8).vertices;
  const fieldA = a.vertices.map(affine), fieldB = b.vertices.map(affine);
  const same = compareMeshFields(a, fieldA, b, fieldB, points, { eta: 1e-4 });
  assert.ok(same.relativeRms < 1e-14);
  assert.equal(same.points, 81);
  const double = compareMeshFields(a, fieldA.map(row => row.map(v => v * 2)), b, fieldB, points, { eta: 1e-4 });
  close(double.relativeRms, 1);
  const single = compareMeshFields(a, fieldA, b, fieldB, [[.5, .5]], { eta: 1e-4 });
  assert.ok(single.relativeRms < 1e-14);
  assert.throws(() => compareMeshFields(a, fieldA, b, fieldB, [[1.1, .5]], { eta: 1e-4 }), /outside/);
  console.log('plane-stress-cross-mesh: same common-grid affine field matches; known doubled-field RMS error=1; single-point and outside handling explicit');
});
