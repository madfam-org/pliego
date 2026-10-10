// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { settleCantilever, proof } from './helpers/bench.js';
import { STOCKS } from './helpers/docbuilder.js';

test('E2-cantilever: 50 mm strip, small tip load, δ = PL³/(3D·w)', () => {
  const D = STOCKS['copy-80'].derived.D_md;
  const L = 50, w = 25, P = 2.0;
  const r = settleCantilever({ length: L, width: w, tipLoad: P, meshEdge: 6, substeps: 20, frames: 300 });
  const expected = (P * L ** 3) / (3 * D * w);
  const err = (r.drop - expected) / expected;
  const pass = Math.abs(err) <= 0.02 && r.drop / L < 0.05;
  proof('E2-cantilever', r.drop, expected, '±2% (δ/L<0.05)', pass, `err ${(err * 100).toFixed(2)}%, δ/L=${(r.drop / L).toExponential(2)}, h=6 mm`);
  assert.ok(pass);
});
