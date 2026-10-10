// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { peirceOverhang, proof } from './helpers/bench.js';
import { STOCKS } from './helpers/docbuilder.js';
import { GRAVITY } from '../src/constants.js';

/** Exact heavy-elastica constant: the chord droops 41.5° at overhang = ELASTICA · (D/q)^⅓ (shooting solution, 4000 RK4 steps). */
const ELASTICA_41_5 = 2.00035;

const d = STOCKS['copy-80'].derived;
const q = d.areal_density * GRAVITY;
const expectedMD = ELASTICA_41_5 * Math.cbrt(d.D_md / q);
const expectedCD = ELASTICA_41_5 * Math.cbrt(d.D_cd / q);

test('E1-peirce: copy paper strip, MD (calibrates C_B) then CD without recalibration', () => {
  const md = peirceOverhang({ meshEdge: 6, substeps: 20, ref: 172 });
  const cd = peirceOverhang({ meshEdge: 6, substeps: 20, alongU: true, ref: 132 });
  const eMD = (md.overhang - expectedMD) / expectedMD, eCD = (cd.overhang - expectedCD) / expectedCD;
  const passMD = Math.abs(eMD) <= 0.03, passCD = Math.abs(eCD) <= 0.05;
  proof('E1-peirce-MD', md.overhang, expectedMD, '±3%', passMD, `err ${(eMD * 100).toFixed(2)}%, chord residual ${md.residualDeg.toExponential(1)}°, ${md.runs} runs`);
  proof('E1-peirce-CD', cd.overhang, expectedCD, '±5%', passCD, `err ${(eCD * 100).toFixed(2)}%, no recalibration`);
  assert.ok(passMD && passCD);
});
