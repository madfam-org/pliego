// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** A scripted session: sequence, grab/move/release, controls — the same calls in the same order. */
function session(/** @type {World} */ w, /** @type {number} */ frames) {
  for (let f = 0; f < frames; f++) {
    if (f === 0) w.setControl('sequence', 1);
    if (f === 150) w.grab(w.mesh.docVertex[1], [w.x[3 * w.mesh.docVertex[1]], w.x[3 * w.mesh.docVertex[1] + 1] + 5, w.x[3 * w.mesh.docVertex[1] + 2]]);
    if (f > 150 && f < 250) { const v = w.mesh.docVertex[1]; w.moveGrab([w.x[3 * v], 20 + 10 * Math.sin(f / 10), w.x[3 * v + 2]]); }
    if (f === 250) w.release();
    if (f === 300) w.setControl('sequence', 2);
    w.step();
  }
}

test('determinism-replay: 600 scripted frames twice give byte-identical positions; snapshot/restore is bit-exact', () => {
  const make = () => new World(squareValley({ size: 60 }).doc, { meshEdge: 8, seed: 3 });
  const a = make(), b = make();
  session(a, 600); session(b, 600);
  const A = new Uint8Array(a.x.buffer), B = new Uint8Array(b.x.buffer);
  let diff = 0;
  for (let i = 0; i < A.length; i++) if (A[i] !== B[i]) diff++;
  // snapshot at 300, continue 300; restore, continue 300 again
  const c = make();
  session(c, 300);
  const snap = c.snapshot();
  for (let f = 0; f < 300; f++) c.step();
  const X1 = Float64Array.from(c.x);
  c.restore(snap);
  for (let f = 0; f < 300; f++) c.step();
  const X2 = c.x;
  let diff2 = 0;
  const U1 = new Uint8Array(X1.buffer), U2 = new Uint8Array(X2.buffer);
  for (let i = 0; i < U1.length; i++) if (U1[i] !== U2[i]) diff2++;
  const pass = diff === 0 && diff2 === 0 && a.stats().finite;
  proof('determinism-replay', diff, 0, '0 differing bytes', diff === 0, `${A.length} bytes compared after 600 frames`);
  proof('determinism-snapshot', diff2, 0, '0 differing bytes', diff2 === 0, 'restore at frame 300, replay 300');
  assert.ok(pass);
});
