// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { Contact } from '../src/xpbd/contact.js';

// Isolate a real vertex–face projection at a pinned corner. The query is just
// outside both incident edges, so it belongs to neither the face nor its plane.
function faceQuery(point, weights) {
  const c = Object.create(Contact.prototype);
  Object.assign(c, {
    mesh: { nT: 1, tris: new Int32Array([0, 1, 2]) },
    nPairs: 1, used: new Uint8Array([1]), pv: new Int32Array([3]), pt: new Int32Array([0]),
    ps: new Int8Array(1), canon: null, tc: new Float64Array(4).fill(0.1),
    mu: new Float64Array(4), faceSide: new Map(),
  });
  const x = new Float64Array([0, 0, 0, 1, 0, 0, 0, 0, 1, ...point]);
  const before = x.slice(), active = c.project(x, before, new Float64Array(weights));
  return { x, before, active };
}

test('contact rejects an extrapolated face at a pinned corner without moving its wings', () => {
  const r = faceQuery([-0.0001, 0.05, -0.0001], [0, 1, 1, 0]);
  assert.equal(r.active, 0); assert.deepEqual(r.x, r.before);
  console.log('contact-feature: outside pinned corner rejected; no fictitious face reaction');
});

test('contact keeps exact face edges and genuine interior projections active', () => {
  for (const point of [[0.5, 0.05, 0], [0.25, 0.05, 0.25]]) {
    const r = faceQuery(point, [0, 0, 0, 1]);
    assert.equal(r.active, 1); assert.ok(Math.abs(r.x[10] - 0.1) < 1e-12);
    assert.deepEqual(r.x.slice(0, 9), r.before.slice(0, 9));
  }
  console.log('contact-feature: exact edge and interior retained; separation=0.1 mm');
});
