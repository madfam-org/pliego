// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { exactHash, summarizeProfile } from '../bench/profile-docs.mjs';

test('bench-tools: the identity hash sees a one-ulp change in any coordinate', () => {
  const x = Float64Array.from([1, 2.5, -3, 1e-300, 0]);
  const h = exactHash(x);
  assert.equal(exactHash(Float64Array.from(x)), h);
  for (let i = 0; i < x.length; i++) {
    const y = Float64Array.from(x);
    const u = new BigInt64Array(y.buffer);
    u[i] += 1n; // next representable double
    assert.notEqual(exactHash(y), h, `coordinate ${i}`);
  }
  // -0 and +0 differ in bits: a speed-up must not even flip a sign of zero
  assert.notEqual(exactHash(Float64Array.from([0])), exactHash(Float64Array.from([-0])));
  console.log('bench bench-tools-hash: measured=ulp-sensitive expected=ulp-sensitive tol=exact PASS');
});

test('bench-tools: profile summary attributes self time to engine stages', () => {
  const cf = (/** @type {string} */ fn, /** @type {string} */ url) => ({ functionName: fn, url, lineNumber: 0 });
  const prof = {
    nodes: [
      { id: 1, callFrame: cf('broadPhase', 'file:///x/packages/engine/src/xpbd/contact.js') },
      { id: 2, callFrame: cf('factor', 'file:///x/packages/engine/src/linalg/blockchol.js') },
      { id: 3, callFrame: cf('(garbage collector)', '') },
    ],
    samples: [1, 1, 1, 2, 3],
    timeDeltas: [1000, 1000, 1000, 1000, 1000],
  };
  const s = summarizeProfile(prof);
  assert.equal(s.totalMs, 5);
  assert.deepEqual(s.stages.map((r) => [r.name, r.ms]), [['contact broad phase', 3], ['BlockCholesky factor', 1], ['garbage collector', 1]]);
  console.log('bench bench-tools-profile: measured=3 stages expected=3 stages tol=exact PASS');
});
