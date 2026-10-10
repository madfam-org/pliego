// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { fourBar } from '../src/kinematics/closedform.js';
import { proof } from './helpers/bench.js';

const D = Math.PI / 180;

/**
 * Parallel (box) fold as a planar four-bar: gutter O at the origin, card-left fold A at (−a, 0)
 * (ground link OA), card-right link OC of length c turning with the opening, piece coupler CB and
 * piece wall AB. Returns the worst out-of-plane height of B at the extremes and whether it locks.
 * @param {number} a @param {number} c @param {number} cb @param {number} ab
 */
function parallelFold(a, c, cb, ab) {
  let lock = false, worstFlat = 0, closures = 0;
  for (let k = 0; k <= 180; k++) {
    const open = k; // degrees: 180 = flat open, 0 = closed
    const phi = open * D; // C = c(cos φ, sin φ)… flat open puts C at (c, 0)
    const ph = Math.PI - phi; // card-right angle measured from +x toward +y as it closes
    const rocker = fourBar(-a, c, cb, ab, Math.PI - ph);
    if (rocker === null) { lock = true; continue; }
    closures++;
    const B = [-a + ab * Math.cos(rocker), ab * Math.sin(rocker)];
    if (k === 0 || k === 180) worstFlat = Math.max(worstFlat, Math.abs(B[1]));
  }
  return { lock, worstFlat, closures };
}

test('E10-parallel: equal opposite links lie flat at both extremes; unequal links lock', () => {
  const eq = parallelFold(40, 30, 40, 30);
  const passEq = !eq.lock && eq.worstFlat < 1e-9 && eq.closures === 181;
  proof('E10-parallel-equal', eq.worstFlat, 0, '<1e-9 mm, closes at every angle', passEq, `parallelogram OA=CB=40, AB=OC=30, DOF=3·3−2·4=1`);
  const uneq = parallelFold(40, 30, 36, 30);
  const passUn = uneq.lock || uneq.worstFlat > 1e-3;
  proof('E10-parallel-unequal', uneq.lock ? 'lock' : uneq.worstFlat, 'lock or not flat', 'flagged', passUn, `CB=36 ≠ OA=40: ${uneq.lock ? `no closure at ${181 - uneq.closures} of 181 angles` : `B off the card by ${uneq.worstFlat.toFixed(3)} mm`}`);
  assert.ok(passEq && passUn);
});
