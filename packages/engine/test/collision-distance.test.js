import test from 'node:test';
import assert from 'node:assert/strict';
import { pointSegmentDistanceSquared, pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from '../src/collision/distance.js';
import { mulberry32 } from '../src/geom.js';

const close = (a, b, tolerance = 1e-12) => assert.ok(Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)), `${a} != ${b}`);
function witness(x, distance, weights, firstCount) {
  let first = 0, second = 0;
  const r = [0, 0, 0];
  for (let i = 0; i < weights.length; i++) {
    if (i < firstCount) { assert.ok(weights[i] >= 0); first += weights[i]; }
    else { assert.ok(weights[i] <= 0); second += weights[i]; }
    for (let c = 0; c < 3; c++) r[c] += weights[i] * x[3 * i + c];
  }
  close(first, 1); close(second, -1);
  close(r.reduce((s, v) => s + v * v, 0), distance);
}

test('closest point–triangle features cover interior, exact edges, vertices and pinned-corner extrapolation', () => {
  for (const [p, expected] of [
    [[0.25, 0.5, 0.25], 0.25], [[0.5, 0.5, 0], 0.25], [[-1, 0.5, -1], 2.25],
    [[-0.0001, 0.05, -0.0001], 0.05 ** 2 + 2e-8], [[0.75, 0.5, 0.75], 0.375],
  ]) {
    const x = new Float64Array([...p, 0, 0, 0, 1, 0, 0, 0, 0, 1]), weights = new Float64Array(4);
    const d = pointTriangleDistanceSquared(x, 0, 1, 2, 3, weights);
    close(d, expected); witness(x, d, weights, 1);
  }
  console.log('closest-triangle: features=5, convex weights, no negative-weight face extension');
});

test('distance queries handle collapsed triangles/edges, parallel overlaps and skinny nonparallel edges', () => {
  for (const triangle of [[0, 0, 0, 1, 0, 0, 2, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0, 0]]) {
    const x = new Float64Array([0, 0.5, 0, ...triangle]), weights = new Float64Array(4);
    const d = pointTriangleDistanceSquared(x, 0, 1, 2, 3, weights); close(d, 0.25); witness(x, d, weights, 1);
  }
  for (const [vertices, expected] of [
    [[-1, 0, 0, 1, 0, 0, 0, 0.5, -1, 0, 0.5, 1], 0.25],
    [[0, 0, 0, 1, 0, 0, 0.25, 0.5, 0, 0.75, 0.5, 0], 0.25],
    [[0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0], 1],
    [[0, 0, 0, 1, 0, 0, 0.1, -0.5e-12, 0, 1.1, 0.5e-12, 0], 0],
  ]) {
    const x = new Float64Array(vertices), weights = new Float64Array(4);
    const d = edgeEdgeDistanceSquared(x, 0, 1, 2, 3, weights); close(d, expected); witness(x, d, weights, 2);
  }
  const x = new Float64Array([1, 2, 3, 0, 0, 0, 0, 0, 0]);
  close(pointSegmentDistanceSquared(x, 0, 1, 2), 14);
  const sliver = new Float64Array([0, 0, 0, 1, 0, 0, 0.1, -0.5e-12, 0, 1.1, 0.5e-12, 0]);
  assert.ok(edgeEdgeDistanceSquared(sliver, 0, 1, 2, 3) < 1e-40, 'near-parallel interior crossing must beat endpoint distance');
  console.log('closest-degenerate: collapsed/parallel/sliver fixtures=7 finite, bounded feature weights');
});

test('closest distances respect rigid transforms and scale, and beat sampled feature candidates', () => {
  const random = mulberry32(7), weights = new Float64Array(4);
  let sampled = 0;
  for (let n = 0; n < 60; n++) {
    const x = Float64Array.from({ length: 12 }, () => 4 * random() - 2);
    for (const [fn, count] of [[pointTriangleDistanceSquared, 1], [edgeEdgeDistanceSquared, 2]]) {
      const d = fn(x, 0, 1, 2, 3, weights); witness(x, d, weights, count);
      // Cyclic rotation, translation and uniform scale preserve squared distance.
      for (const scale of [1e-6, 1, 1e6]) {
        const y = x.map((_, i) => scale * (x[3 * Math.floor(i / 3) + (i + 1) % 3] + 8));
        close(fn(y, 0, 1, 2, 3) / (scale * scale), d, 1e-10);
      }
      for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
        if (count === 1 && i + j > 12) continue;
        const s = i / 12, t = j / 12, r = [0, 0, 0];
        for (let c = 0; c < 3; c++) r[c] = count === 1
          ? x[c] - ((1 - s - t) * x[3 + c] + s * x[6 + c] + t * x[9 + c])
          : (1 - s) * x[c] + s * x[3 + c] - (1 - t) * x[6 + c] - t * x[9 + c];
        const candidate = r.reduce((sum, v) => sum + v * v, 0);
        assert.ok(d <= candidate + 1e-10, 'closest query cannot exceed a feasible sampled pair'); sampled++;
      }
    }
  }
  console.log(`closest-metamorphic: pairs=120, scaled/rotated=360, feasible samples=${sampled}`);
});
