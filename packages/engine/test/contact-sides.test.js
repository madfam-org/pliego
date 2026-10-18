// @ts-check
/**
 * Contact sides in typed arrays (lane E4, 2026-10-18). The memorised side of a (vertex, triangle)
 * pair lives beside the pair and carries over to the next broad phase while the pair stays a
 * candidate, and is forgotten when it drops out, exactly as the Map it replaces did; snapshots keep
 * it bit-exactly. The corpus check that positions did not change is bench/identity.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { twoSheetStack } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** @param {Float64Array} a @param {Float64Array} b */
const sameBits = (a, b) => {
  const p = new BigInt64Array(a.buffer, a.byteOffset, a.length), q = new BigInt64Array(b.buffer, b.byteOffset, b.length);
  if (p.length !== q.length) return false;
  for (let i = 0; i < p.length; i++) if (p[i] !== q[i]) return false;
  return true;
};

test('contact-sides: a side carries over while its pair stays a candidate and is forgotten when it drops out', () => {
  const w = new World(twoSheetStack({ size: 60, gap: 0.05, height: 8 }), { meshEdge: 8, substeps: 8 });
  const c = /** @type {any} */ (w.contact), x = Float64Array.from(w.x), xs = Float64Array.from(w.x);
  c.broadPhase(x, w.fixed, 1);
  c.project(x, xs, w.invMass);
  const first = c.sideEntries();
  assert.ok(first.length > 0, 'the stacked sheets memorise sides');
  // same layout again: every side survives the merge
  c.broadPhase(x, w.fixed, 1);
  assert.deepEqual(c.sideEntries(), first);
  // lift the upper sheet 40 mm: its pairs leave the candidate list and their sides go with them
  const far = Float64Array.from(x);
  for (let v = 0; v < w.mesh.nV; v++) if (w.mesh.vSheet[v] === 1) far[3 * v + 1] += 40;
  c.broadPhase(far, w.fixed, 1);
  const lifted = c.sideEntries().length;
  c.broadPhase(x, w.fixed, 1);
  const back = c.sideEntries().length;
  const pass = lifted < first.length && back === lifted;
  proof('contact-sides-merge', `${first.length}→${lifted}→${back}`, 'kept, dropped, not revived', 'exact', pass, `${c.nPairs} pairs`);
  assert.ok(pass);
});

test('contact-sides: memorised sides survive snapshot/restore bit-exactly', () => {
  const w = new World(twoSheetStack({ size: 60, gap: 4, height: 8 }), { meshEdge: 8, substeps: 8 });
  for (let f = 0; f < 50; f++) w.step();
  const sided = /** @type {any} */ (w.contact).sideEntries().length;
  const snap = w.snapshot();
  for (let f = 0; f < 30; f++) w.step();
  const a = Float64Array.from(w.x);
  w.restore(snap);
  assert.equal(/** @type {any} */ (w.contact).sideEntries().length, sided);
  for (let f = 0; f < 30; f++) w.step();
  const pass = sameBits(a, w.x) && sided > 0;
  proof('contact-sides-snapshot', pass ? 'identical' : 'differs', 'identical', 'bitwise after 30 frames', pass, `${sided} memorised sides at the snapshot`);
  assert.ok(pass);
});
