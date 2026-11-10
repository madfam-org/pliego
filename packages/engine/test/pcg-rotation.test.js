import test from 'node:test';
import assert from 'node:assert/strict';
import { bestRotation } from '../src/xpbd/pcg.js';

test('a point or zero-covariance free set preserves an invertible identity preconditioner rotation', () => {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const a = new Float64Array([0, 0, 0, 1, 0, 0]), b = new Float64Array([2, 3, 4, 3, 3, 4]);
  for (const free of [[0, -1], [-1, -1]]) assert.deepEqual([...bestRotation(a, b, new Int32Array(free))], identity);
  a.fill(1); assert.deepEqual([...bestRotation(a, b, new Int32Array([0, 1]))], identity);
  console.log('pcg-degenerate-rotation: one-point, empty and zero-covariance sets return identity, not a zero quaternion');
});
