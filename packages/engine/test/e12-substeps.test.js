// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { settleCantilever, proof } from './helpers/bench.js';
import { squareValley } from './helpers/docbuilder.js';

test('E12-substeps: doubling S shifts the E2 and crease-drive equilibria by < 0.5 %', () => {
  const a = settleCantilever({ length: 50, tipLoad: 150, meshEdge: 6, substeps: 20 });
  const b = settleCantilever({ length: 50, tipLoad: 150, meshEdge: 6, substeps: 40 });
  const shiftE2 = Math.abs(b.drop - a.drop) / a.drop;
  const rest = (/** @type {number} */ S) => {
    const { doc, crease } = squareValley({ size: 100 });
    const w = new World(doc, { meshEdge: 8, substeps: S, gravity: false, ground: false });
    w.setControl('sequence', 2);
    for (let f = 0; f < 270; f++) w.step();
    let s = 0, n = 0;
    for (let h = 0; h < w.mesh.nH; h++) if (w.mesh.hingeDoc[h] === crease) { s += w.theta[h]; n++; }
    return (s / n) * 180 / Math.PI;
  };
  const r20 = rest(20), r40 = rest(40);
  const shiftC = Math.abs(r40 - r20) / Math.abs(r20);
  proof('E12-substeps-E2', shiftE2, 0, '<0.5%', shiftE2 < 0.005, `δ(S=20)=${a.drop.toExponential(5)} δ(S=40)=${b.drop.toExponential(5)}`);
  proof('E12-substeps-crease', shiftC, 0, '<0.5%', shiftC < 0.005, `released angle S=20 ${r20.toFixed(3)}°, S=40 ${r40.toFixed(3)}°`);
  assert.ok(shiftE2 < 0.005 && shiftC < 0.005);
});
