import test from 'node:test';
import assert from 'node:assert/strict';
import { endpointProgress } from '../bench/paper-metrics.mjs';

test('endpoint gate distinguishes pre-promotion stalled geometry from an actual rigid turn', () => {
  const X0 = new Float64Array([5, 1, 0, 95, 1, 0, 95, 1, -128, 5, 1, -128]);
  const w = { X0, mesh: { nV: 4, vSheet: new Int32Array(4) } };
  const turn = degrees => X0.map((v, i) => i % 3 === 0 ? 5 + (v - 5) * Math.cos(degrees * Math.PI / 180)
    : i % 3 === 1 ? 1 + (X0[i - 1] - 5) * Math.sin(degrees * Math.PI / 180) : v);
  assert.equal(endpointProgress(w, 0, X0, 180).minimum, 0);
  assert.equal(endpointProgress(w, 0, turn(180), 180).minimum, 1);
  assert.equal(endpointProgress(w, 0, turn(180), 0).minimum, 0);
  assert.equal(endpointProgress(w, 0, X0, 0).minimum, 1);
  assert.ok(endpointProgress(w, 0, turn(90), 180).minimum < 0.9);
  assert.equal(endpointProgress(w, 1, X0, 180).samples, 0);
  console.log('paper-endpoints: rigid forward/reverse accepted; unturned, half-turned and empty geometry cannot masquerade as completed physics');
});
