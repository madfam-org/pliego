// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDocument } from '../src/index.js';
import { EdgeContact } from '../src/xpbd/edgecontact.js';
import { proof } from './helpers/bench.js';

const kernelDoc = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(`./fixtures/kernel/${name}.fold`, import.meta.url), 'utf8'));

/** Push the top corner of card A sideways for 1 s, let go, 1 s more. @param {boolean} edge @param {number} force µN */
function pushCross(edge, force) {
  const w = new World(loadDocument(kernelDoc('tab-and-slot')), { meshEdge: 10, substeps: 8, edgeContact: edge });
  const m = w.mesh;
  let top = -1;
  for (let v = 0; v < m.nV; v++) if (m.vSheet[v] === 0 && Math.abs(w.x[3 * v]) > 30 && (top < 0 || w.x[3 * v + 1] > w.x[3 * top + 1])) top = v;
  w.setForce(top, [0, 0, force]);
  let peak = 0;
  for (let i = 0; i < 60; i++) { w.step(); peak = Math.max(peak, w.stats().maxStrain); }
  w.clearForces();
  for (let i = 0; i < 60; i++) { w.step(); peak = Math.max(peak, w.stats().maxStrain); }
  const s = w.stats();
  assert.ok(s.finite);
  return { tilt: Math.abs(w.x[3 * top + 2]), peak, edges: s.edgeContacts, world: w };
}

test('edge-contact: only documents with interlock edge names build it', () => {
  assert.equal(EdgeContact.wanted(loadDocument(kernelDoc('tab-and-slot'))), true);
  const w = new World(loadDocument(kernelDoc('hexagonal-twist-steep')), { meshEdge: 10 });
  assert.equal(w.edgeContact, null);
  const t = new World(loadDocument(kernelDoc('tab-and-slot')), { meshEdge: 10 });
  assert.ok(t.edgeContact && t.edgeContact.enabled);
  assert.ok(t.edgeContact.lips.length >= 8, `lips=${t.edgeContact.lips.length}`); // two lips per slit, two slits, ≥ 2 mesh edges each
});

test('edge-contact: the slotted cross carries a push through the slot (tab-and-slot)', () => {
  const on = pushCross(true, 1500), off = pushCross(false, 1500);
  proof('edge-contact-tilt', on.tilt, '<1.5 mm', 'back upright after a 1.5 mN push', on.tilt < 1.5, `without edge contact ${off.tilt.toFixed(2)} mm`);
  proof('edge-contact-stretch', on.peak, '<½ without', 'peak stretch during the push', on.peak < 0.5 * off.peak, `without ${(100 * off.peak).toFixed(2)} %`);
  assert.ok(on.edges > 0);
  assert.ok(on.tilt < 1.5, `tilt with edge contact ${on.tilt}`);
  assert.ok(off.tilt > 3, `tilt without edge contact ${off.tilt} (the test must show a difference)`);
  assert.ok(on.peak < 0.5 * off.peak, `peak stretch ${on.peak} with, ${off.peak} without`);
});

test('edge-contact: lips stay on their own paper side of the other card at rest', () => {
  const w = new World(loadDocument(kernelDoc('tab-and-slot')), { meshEdge: 10, substeps: 8 });
  for (let i = 0; i < 60; i++) w.step();
  const ec = /** @type {EdgeContact} */ (w.edgeContact), m = w.mesh;
  let wrong = 0, checked = 0, worst = Infinity;
  for (const [key, side] of ec.side) {
    const li = Math.floor(key / m.nT), t = key % m.nT, e = ec.lips[li];
    const a = 3 * m.tris[3 * t], b = 3 * m.tris[3 * t + 1], c = 3 * m.tris[3 * t + 2];
    const x = w.x;
    const u = [x[b] - x[a], x[b + 1] - x[a + 1], x[b + 2] - x[a + 2]], v = [x[c] - x[a], x[c + 1] - x[a + 1], x[c + 2] - x[a + 2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...n);
    const p = 3 * m.edges[2 * e], q = 3 * m.edges[2 * e + 1];
    const mid = [0.5 * (x[p] + x[q]) - x[a], 0.5 * (x[p + 1] + x[q + 1]) - x[a + 1], 0.5 * (x[p + 2] + x[q + 2]) - x[a + 2]];
    const d = (mid[0] * n[0] + mid[1] * n[1] + mid[2] * n[2]) / L;
    // only pairs in contact range whose lip midpoint projects inside the face
    const d11 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2], d12 = u[0] * v[0] + u[1] * v[1] + u[2] * v[2], d22 = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const p1 = mid[0] * u[0] + mid[1] * u[1] + mid[2] * u[2], p2 = mid[0] * v[0] + mid[1] * v[1] + mid[2] * v[2], den = d11 * d22 - d12 * d12;
    const bb = (d22 * p1 - d12 * p2) / den, bc = (d11 * p2 - d12 * p1) / den;
    if (Math.abs(d) > 2 * ec.tc[e] || bb < 0 || bc < 0 || bb + bc > 1) continue;
    checked++;
    worst = Math.min(worst, side * d / ec.tc[e]);
    if (side * d < -0.5 * ec.tc[e]) wrong++; // a lip through the face by more than half a contact distance
  }
  proof('edge-contact-sides', worst, '>−0.5', 'lowest side·distance / contact distance over lip–face pairs at rest', wrong === 0, `${checked} pairs in range`);
  assert.ok(checked > 0);
  assert.equal(wrong, 0, `${wrong} of ${checked} lip–face pairs through the face`);
});
