// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

const DEG = 180 / Math.PI;

/** Mean angle (deg) and rest angle of the hinges on document edge `e`. @param {World} w @param {number} e */
function creaseState(w, e) {
  let a = 0, r = 0, n = 0;
  for (let h = 0; h < w.mesh.nH; h++) if (w.mesh.hingeDoc[h] === e) { a += w.theta[h]; r += w.restTheta[h]; n++; }
  return { angle: (a / n) * DEG, rest: (r / n) * DEG };
}

test('crease-drive: valley crease driven to 180°, then released (yield 35°)', () => {
  const { doc, crease } = squareValley({ size: 100 });
  const w = new World(doc, { meshEdge: 8, gravity: false, ground: false });
  w.setControl('sequence', 1);
  for (let f = 0; f < 120; f++) w.step(); // 1.5 s fold + 0.5 s hold
  const driven = creaseState(w, crease);
  w.setControl('sequence', 2);
  for (let f = 0; f < 150; f++) w.step();
  const rel = creaseState(w, crease);
  const yieldDeg = doc['pliego:stocks']['copy-80'].derived.crease_yield_deg;
  const passD = Math.abs(driven.angle - 180) <= 2;
  const passR = Math.abs(rel.angle - (180 - yieldDeg)) <= 5;
  proof('crease-drive-driven', driven.angle, 180, '±2°', passD, `rest set to ${driven.rest.toFixed(2)}°`);
  proof('crease-drive-released', rel.angle, 180 - yieldDeg, '±5°', passR, `rest ${rel.rest.toFixed(2)}°, finite=${w.stats().finite}`);
  assert.ok(passD && passR && w.stats().finite);
});

test('crease-unfold: fold to 180°, drive back to 0°, release — the crease remembers', () => {
  const { doc, crease } = squareValley({ size: 100, unfold: true });
  const w = new World(doc, { meshEdge: 8, gravity: false, ground: false });
  w.setControl('sequence', 3);
  for (let f = 0; f < 300; f++) w.step(); // 1.5 + 1.5 + 1.0 s, then settle
  const s = creaseState(w, crease);
  const pass = Math.abs(s.rest) > 10 && Math.abs(s.angle) > 10;
  proof('crease-unfold', s.angle, '≠0 (memory)', 'rest>10° and angle>10°', pass, `rest ${s.rest.toFixed(2)}° (expected ≈ +yield)`);
  assert.ok(pass);
});
