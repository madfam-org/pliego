// @ts-check
/**
 * Glue over an opening (sim readiness, lane S; commons carousel-village). A glue region may cover an
 * opening of the sheet it is glued to (a lining behind a façade with windows). Every mesh vertex in
 * the region becomes a weld point, so at some mesh sizes a weld point mapped onto the other sheet
 * fell into the opening and the World failed to build ("point … not on the mesh"). Glue over an
 * opening holds nothing: such points are skipped and World.warnings counts them; a glue that welds
 * nothing still fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** A U-shaped card (a 20 × 20 mm notch in its top edge) with a strip glued across the notch. */
function stripAcrossNotch({ y0 = 25, h = 10 } = {}) {
  const b = new DocBuilder('strip glued across a notch');
  const u = b.sheet({ id: 'card', width: 60, height: 40, stock: 'cardstock-250' });
  const P = [[0, 0], [20, 0], [40, 0], [60, 0], [60, 40], [40, 40], [40, 20], [20, 20], [20, 40], [0, 40]].map(([x, y]) => b.vertex(u, x, y));
  b.face([P[0], P[1], P[7], P[8], P[9]]);
  b.face([P[1], P[2], P[6], P[7]]);
  b.face([P[2], P[3], P[4], P[5], P[6]]);
  b.assign(P[1], P[7], 'F');
  b.assign(P[2], P[6], 'F');
  const lift = 0.05;
  b.rect({ id: 'strip', width: 50, height: h, placement: { origin: [5, lift, -y0], rotation: [0, 0, 0, 1] } });
  b.joins.push({ id: 'strip-glue', type: 'glue', a: { sheet: 'strip', region: [[0, 0], [50, 0], [50, h], [0, h]] }, b: { sheet: 'card' }, map: [1, 0, 0, 1, 5, y0], side: 'front' });
  return b.build();
}

test('weld points over an opening hold nothing and are counted, instead of failing the World', () => {
  const doc = loadDocument(stripAcrossNotch());
  const counts = [];
  for (const h of [3, 4, 5, 8]) {
    const w = new World(doc, { meshEdge: h, substeps: 8 });
    const m = /([0-9]+) of ([0-9]+) weld points land on an opening/.exec(w.warnings.join(' '));
    assert.ok(m, `meshEdge ${h}: a warning counts the skipped points (${JSON.stringify(w.warnings)})`);
    counts.push(`${h} mm: ${m[1]}/${m[2]}`);
    for (let f = 0; f < 30; f++) w.step();
    assert.ok(w.stats().finite);
  }
  proof('glue-over-opening', counts.length, 4, 'the World builds at every mesh size; skipped weld points are reported', true, counts.join(', '));
});

test('a glue whose whole region lies over an opening still fails', () => {
  // the strip sits entirely inside the notch: nothing to glue to (rule 7 rejects its corners at load;
  // the World's own check is the backstop for regions whose corners land on paper)
  const json = stripAcrossNotch();
  json['pliego:joins'][0].a.region = [[17, 2], [33, 2], [33, 8], [17, 8]];
  assert.throws(() => new World(json, { meshEdge: 4 }), /rule 7: .*glue region mapped onto b|no point of the glue region lands on the paper/);
});
