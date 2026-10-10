// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { settleCantilever, proof } from './helpers/bench.js';
import { pageLeaf, STOCKS } from './helpers/docbuilder.js';

test('mesh-sweep: E2 and a page turn at h ∈ {10, 6, 4, 3} mm', () => {
  const D = STOCKS['copy-80'].derived.D_md;
  const L = 50, w = 25, P = 150;
  const expected = (P * L ** 3) / (3 * D * w);
  /** @type {number[]} */ const ratios = [];
  /** @type {string[]} */ const notes = [];
  let ok = true;
  for (const h of [10, 6, 4, 3]) {
    const r = settleCantilever({ length: L, width: w, tipLoad: P, meshEdge: h, frames: 300 });
    ratios.push(r.drop / expected);
    const pw = new World(pageLeaf({ width: 74, height: 105 }), { meshEdge: h });
    pw.setControl('turn', 180);
    let maxS = 0, maxE = 0, fin = true;
    for (let f = 0; f < 90; f++) { pw.step(); const s = pw.stats(); maxS = Math.max(maxS, s.maxStrain); maxE = Math.max(maxE, s.energy.stretch + s.energy.bend + s.energy.crease); fin = fin && s.finite; }
    ok = ok && fin && r.finite && maxS < 0.005 && Number.isFinite(maxE);
    notes.push(`h=${h}: E2 δ/δ₀=${(r.drop / expected).toFixed(4)} page V=${pw.mesh.nV} stretch=${(maxS * 100).toFixed(3)}% Emax=${maxE.toExponential(2)}`);
  }
  const spread = Math.max(...ratios) - Math.min(...ratios);
  const fine = Math.abs(ratios[3] - ratios[2]);
  const pass = ok && spread < 0.08 && fine < 0.015;
  for (const n of notes) console.log(`mesh-sweep ${n}`);
  proof('mesh-sweep', `spread=${spread.toFixed(4)} fine=${fine.toFixed(4)}`, 'converging', 'no NaN, stretch<0.5%, E2 spread<8%, |h4−h3|<1.5%', pass);
  assert.ok(pass);
});
