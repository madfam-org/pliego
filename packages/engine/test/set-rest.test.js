// @ts-check
// Spec §5.14 set creases in the engine: a crease folded flat in the initial frame starts on the
// branch of its rest angle (±180° is ambiguous for atan2), a plain line folded in that frame keeps its
// rest angle, and paper that starts below the table is lifted onto it instead of being snapped up in
// one substep. The fox-puppet `talk` document had all three and blew apart at its first substep.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDocument } from '../src/index.js';
import { proof } from './helpers/bench.js';

const kernelDoc = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(`./fixtures/kernel/${name}.fold`, import.meta.url), 'utf8'));

test('set-rest: flat-folded creases start at their rest angle and the puppet lands on the table without blowing apart', () => {
  const doc = loadDocument(kernelDoc('fox-puppet-talk'));
  const w = new World(doc, { meshEdge: 11.6, substeps: 8 });
  let worst = 0;
  for (let h = 0; h < w.mesh.nH; h++) if (w.mesh.hingeDoc[h] >= 0) worst = Math.max(worst, Math.abs(w.theta[h] - w.restTheta[h]));
  const x0 = Float64Array.from(w.x);
  w.step(1 / 480); // one substep (S = 8)
  let first = 0;
  for (let i = 0; i < x0.length; i++) first = Math.max(first, Math.abs(w.x[i] - x0[i]));
  for (let f = 0; f < 30; f++) w.step();
  const lifted = w.warnings.some((s) => /below the table/.test(s));
  const pass = worst < 1e-6 && w.stats().finite && first < 2 && lifted;
  proof('set-rest-fox-talk', first, '< 2 mm', 'largest move in the first substep; set creases start at rest; finite after 0.5 s', pass,
    `worst |θ − rest| at start ${(worst * 180 / Math.PI).toFixed(3)}°, lifted onto the table ${lifted}, finite ${w.stats().finite}; main before: 95 mm in the first substep (then NaN or an explosion). The puppet still topples and stretches afterwards (not asserted)`);
  assert.ok(pass);
});
