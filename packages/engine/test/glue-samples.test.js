// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDocument } from '../src/index.js';
import { TK_GLUE, glueSamples } from '../src/xpbd/joins.js';

const kernelDoc = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(`./fixtures/kernel/${name}.fold`, import.meta.url), 'utf8'));
const glueTerms = (/** @type {any} */ w) => { let n = 0; for (let t = 0; t < w.terms.count; t++) if (w.terms.kind[t] === TK_GLUE) n++; return n; };

test('glue-samples: a glue zone narrower than the mesh says so without samples, and glue samples (the default) weld it', () => {
  // card-linkages four-bar: two 7 × 9 mm feet glued to the base; at the studio mesh (8.2 mm) no mesh vertex lies inside either zone
  const plain = new World(loadDocument(kernelDoc('four-bar-linkage')), { meshEdge: 8.2, substeps: 8, glueSamples: false });
  assert.equal(glueTerms(plain), 0);
  assert.equal(plain.warnings.filter((s) => /glue zone holds 0 mesh point/.test(s)).length, 2, plain.warnings.join('\n'));
  const byDefault = new World(loadDocument(kernelDoc('four-bar-linkage')), { meshEdge: 8.2, substeps: 8 });
  assert.ok(glueTerms(byDefault) >= 2 * 5, `default weld terms ${glueTerms(byDefault)} (glue samples are on by default)`);
  const sampled = new World(loadDocument(kernelDoc('four-bar-linkage')), { meshEdge: 8.2, substeps: 8, glueSamples: true });
  assert.ok(glueTerms(sampled) >= 2 * 5, `sampled weld terms ${glueTerms(sampled)}`);
  for (let i = 0; i < 30; i++) sampled.step();
  // every sampled weld holds: its a-point and b-point coincide within a tenth of a millimetre
  const T = sampled.terms, x = sampled.x;
  let worst = 0;
  for (let t = 0; t < T.count; t++) {
    if (T.kind[t] !== TK_GLUE) continue;
    const r = [0, 0, 0];
    for (let i = T.start[t]; i < T.start[t + 1]; i++) for (let c = 0; c < 3; c++) r[c] += T.coef[i] * x[3 * T.verts[i] + c];
    worst = Math.max(worst, Math.hypot(...r));
  }
  assert.ok(worst < 0.1, `weld gap ${worst} mm`);
  assert.ok(sampled.stats().finite);
});

test('glue-samples: centroid, inset corners and edge points at most h apart', () => {
  const s = glueSamples([[0, 0], [30, 0], [30, 5], [0, 5]], 10);
  assert.deepEqual(s[0], [15, 2.5]);
  assert.equal(s.length, 1 + 3 + 1 + 3 + 1); // centroid + 24 mm sides in 3 + 4 mm ends in 1
  for (const [u, v] of s) assert.ok(u > 0 && u < 30 && v > 0 && v < 5);
});

test('glue-samples: by default the narrow feet of the V-fold pop-up hold and it opens without stretching (sim-matrix drive)', async () => {
  const { simulateDocument, STRETCH_FAIL } = await import('./helpers/sim-matrix.js');
  const json = kernelDoc('v-fold-popup-spread');
  const rec = simulateDocument(json);
  const w = new World(loadDocument(json), { meshEdge: rec.meshEdge, substeps: 8 });
  const pass = glueTerms(w) > 0 && rec.loads && rec.finite && !rec.exploded && rec.maxStretch <= STRETCH_FAIL;
  console.log(`bench glue-default-v-fold: measured=${rec.maxStretch} expected=≤ ${STRETCH_FAIL} tol=peak stretch, studio options ${pass ? 'PASS' : 'FAIL'} (${glueTerms(w)} glue welds at the studio mesh h = ${rec.meshEdge} mm; main before: 6.31 % with the feet holding nothing)`);
  assert.ok(pass);
});
