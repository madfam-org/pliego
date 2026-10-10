// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument, DocumentError } from '../src/index.js';
import * as F from './helpers/docbuilder.js';

const clone = (/** @type {any} */ o) => JSON.parse(JSON.stringify(o));

test('document: every fixture loads (read-proof counts)', () => {
  const docs = {
    'square-valley': F.squareValley().doc, strip: F.strip(), cantilever: F.cantilever().doc,
    'tissue-flag': F.tissueFlag(), 'page-leaf': F.pageLeaf(), 'two-sheet-stack': F.twoSheetStack(),
  };
  let n = 0;
  for (const [name, d] of Object.entries(docs)) {
    const doc = loadDocument(d);
    assert.ok(doc.sheets.length >= 1, name);
    console.log(`load ${name}: sheets=${doc.sheets.length} vertices=${doc.nV} edges=${doc.nE} faces=${doc.nF} joins=${doc.joins.length} errors=0`);
    n++;
  }
  assert.equal(n, 6);
});

test('document: accepts a JSON string and rejects non-objects', () => {
  assert.equal(loadDocument(JSON.stringify(F.strip())).nF, 1);
  assert.throws(() => loadDocument('not json'), DocumentError);
  assert.throws(() => loadDocument([]), DocumentError);
});

test('document: fails closed and lists EVERY problem', () => {
  const d = clone(F.squareValley().doc);
  d['pliego:sheets'][0].stock = 'nope';                       // rule 6
  d['pliego:edges_treatment'][0] = 'cut';                     // rule 4 (B + cut)
  d.edges_foldAngle[1] = 30;                                  // rule 4 (B with angle)
  d.faces_vertices[1] = d.faces_vertices[1].slice().reverse(); // rule 3 (clockwise)
  d['pliego:sequence'].steps[0].targets.push([0, 90]);        // rule 8 (B edge target)
  d['pliego:controls'][0].kind = 'angle';                     // rule 7 (no sequence control)
  d['pliego:edges_sheet'][2] = 5;                             // rule 1
  let err = null;
  try { loadDocument(d); } catch (e) { err = e; }
  assert.ok(err instanceof DocumentError, 'must throw DocumentError');
  const p = /** @type {DocumentError} */(err).problems.join('\n');
  for (const needle of ['rule 6', 'rule 1', 'rule 8', 'rule 7']) assert.ok(p.includes(needle), `missing ${needle} in:\n${p}`);
  console.log(`load broken-square: errors=${/** @type {DocumentError} */(err).problems.length} (all listed, nothing half-loaded)`);
  // geometric rules are reported once structure is sound
  const g = clone(F.squareValley().doc);
  g['pliego:edges_treatment'][0] = 'cut';
  g.edges_foldAngle[1] = 30;
  g.faces_vertices[1] = g.faces_vertices[1].slice().reverse();
  let e2 = null;
  try { loadDocument(g); } catch (e) { e2 = e; }
  const q = /** @type {DocumentError} */(e2).problems.join('\n');
  for (const needle of ['rule 4: edge 0 treatment cut', 'rule 4: edge 1 (B) must have fold angle 0', 'rule 3: face 1 is clockwise']) assert.ok(q.includes(needle), `missing ${needle} in:\n${q}`);
});

test('document: plain FOLD loads with spec §7 defaults (stock kami, one sequence step)', () => {
  const fold = {
    file_spec: 1.1, file_creator: 'hand', vertices_coords: [[0, 0], [100, 0], [100, 100], [0, 100]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]], edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    edges_foldAngle: [0, 0, 0, 0, -180], faces_vertices: [[0, 1, 2], [0, 2, 3]],
  };
  const doc = loadDocument(fold);
  assert.equal(doc.plainFold, true);
  assert.equal(doc.sheets[0].id, 'sheet-0');
  assert.equal(doc.sheets[0].stockId, 'kami');
  assert.equal(doc.sheets[0].grainDeg, 90);
  assert.equal(doc.treatment[4], 'crease');
  assert.deepEqual(doc.sequence?.steps[0].targets, [[4, -180]]);
  assert.equal(doc.controls[0].kind, 'sequence');
});

test('document: min_feature_mm sets the face-area floor (contract 11c37b6)', () => {
  const b = new F.DocBuilder('tiny');
  b.rect({ id: 'tiny', width: 0.8, height: 0.8 });
  const d = b.build();
  assert.throws(() => loadDocument(d), /below the 1 mm² floor/);
  d['pliego:meta'].min_feature_mm = 0.5;
  assert.equal(loadDocument(d).nF, 1);
  d['pliego:meta'].min_feature_mm = -1;
  assert.throws(() => loadDocument(d), /min_feature_mm/);
});

test('document: translate mechanism and driven pins validate (contract e99db11)', () => {
  const b = new F.DocBuilder('pull');
  b.rect({ id: 'sheet', width: 50, height: 20 });
  b.mechanisms.push({ id: 'pull', type: 'translate', control: 'pull', direction: [1, 0, 0], travel: 10 });
  b.joins.push({ id: 'grip', type: 'pin', a: { sheet: 'sheet', along: [[50, 0], [50, 20]] }, world: null, mechanism: 'pull' });
  b.control({ id: 'pull', kind: 'distance', min: 0, max: 10, default: 0, unit: 'mm' });
  const d = b.build();
  const doc = loadDocument(d);
  assert.equal(doc.mechanisms[0].type, 'translate');
  const bad = clone(d);
  bad['pliego:joins'][0].mechanism = 'nope';
  assert.throws(() => loadDocument(bad), /not a translate mechanism/);
  const bad2 = clone(d);
  bad2['pliego:mechanisms'][0].direction = [0, 0, 0];
  assert.throws(() => loadDocument(bad2), /direction must be a non-zero/);
});

test('document: initial-frame rules (rule 9) and sheet overlap (rule 5)', () => {
  const d = clone(F.twoSheetStack());
  d.file_frames[0].vertices_coords[1][0] += 5; // stretch an edge
  assert.throws(() => loadDocument(d), /rule 9: initial frame stretches edge/);
  const o = clone(F.twoSheetStack());
  o['pliego:sheets'][1].offset = [10, 10];
  for (let v = 4; v < 8; v++) { o.vertices_coords[v][0] -= 90; }
  assert.throws(() => loadDocument(o), /rule 5/);
  const j = clone(F.tissueFlag());
  delete j.file_frames;
  assert.throws(() => loadDocument(j), /initial" frame is required/);
});
