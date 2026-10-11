// @ts-check
/**
 * Spec §5.16 (lane H) in the engine's render output: `presentation.end` blends in over the fold
 * program about the root face's t = 0 centroid. Physics is untouched; render, creaseLines and pick
 * are presented, and grab points are mapped back to the simulation frame.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument } from '../src/index.js';
import { squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

const S = Math.SQRT1_2;
const OPTS = { meshEdge: 10, substeps: 8, gravity: false, ground: false };

test('presentation.end turns the rendered model, not the simulated one', () => {
  const plain = squareValley({ size: 80, release: false }).doc;
  const shown = squareValley({ size: 80, release: false }).doc;
  shown['pliego:sheets'][0].presentation = { root_face: 0, end: { origin: [0, 40, 0], rotation: [S, 0, 0, S] } }; // stand up: 90° about +x, lift 40
  const a = new World(plain, OPTS), b = new World(shown, OPTS);
  const r0 = Float32Array.from(b.render().positions);
  const same0 = r0.every((v, i) => v === Float32Array.from(a.render().positions)[i]);
  for (const w of [a, b]) { w.setControl('sequence', 1); for (let f = 0; f < 120; f++) w.step(); }
  const physicsSame = Buffer.compare(Buffer.from(a.x.buffer), Buffer.from(b.x.buffer)) === 0;
  // rendered = R·x + t with R = 90° about x about the root face's t = 0 centroid
  const c = b.presentation.ends[0].centroid;
  const ra = a.render().positions, rb = b.render().positions;
  let worst = 0;
  for (let i = 0; i < ra.length; i += 3) {
    const p = [ra[i] - c[0], ra[i + 1] - c[1], ra[i + 2] - c[2]];
    const q = [p[0] + c[0], -p[2] + c[1] + 40, p[1] + c[2]];
    worst = Math.max(worst, Math.abs(q[0] - rb[i]), Math.abs(q[1] - rb[i + 1]), Math.abs(q[2] - rb[i + 2]));
  }
  // a ray at the presented sheet hits it; grab points map back into the simulation frame
  const k = 3 * Math.floor(rb.length / 6); // a rendered (presented) point of the sheet
  const hit = b.pick([rb[k] + 1e-3, rb[k + 1] + 1e-3, rb[k + 2] + 200], [0, 0, -1]);
  const pass = same0 && physicsSame && worst < 1e-3 && hit !== null;
  proof('presentation-render', worst, 0, '<1e-3 mm (Float32 render) vs R·x + t; physics bit-identical; identity at t = 0', pass, `pick ${hit ? 'hits' : 'misses'} the presented sheet`);
  assert.ok(pass);
  const v = /** @type {any} */ (hit).vertex;
  const shownPoint = [b.x[3 * v], b.x[3 * v + 1], b.x[3 * v + 2]];
  b.presentation.point(shownPoint, 0, 0);
  assert.ok(b.grab(v, shownPoint));
  const target = b.terms.info[b.drivers.grabTerm].target;
  assert.ok(Math.hypot(target[0] - b.x[3 * v], target[1] - b.x[3 * v + 1], target[2] - b.x[3 * v + 2]) < 1e-9, 'grab target is in the simulation frame');
});

test('rule 17: presentation has only root_face and end, a face of its sheet and a unit quaternion', () => {
  const bad = (/** @type {any} */ pr) => { const d = squareValley().doc; d['pliego:sheets'][0].presentation = pr; return () => loadDocument(d); };
  assert.throws(bad({ root_face: 9 }), /rule 17.*not a face of this sheet/);
  assert.throws(bad({ end: { origin: [0, 0, 0], rotation: [0, 0, 0, 2] } }), /rule 17.*unit quaternion/);
  assert.throws(bad({ upright: true }), /rule 17.*only root_face and end/);
  assert.doesNotThrow(bad({ root_face: 1 }));
});
