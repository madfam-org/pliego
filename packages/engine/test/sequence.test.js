// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument } from '../src/index.js';
import { miura, squareValley, vfoldCard } from './helpers/docbuilder.js';
import { miuraAngles } from './helpers/miura.js';
import { proof } from './helpers/bench.js';

const D = Math.PI / 180;

test('kinematic-sequence: rigid Miura fold program keeps closure along the way', () => {
  const m = miura({ gamma: 60 });
  const doc0 = loadDocument(m.doc);
  const r = miuraAngles(doc0, m, 60 * D, 100 * D);
  const crease = [...m.zig.flat(), ...m.straight.flat()];
  const json = m.doc;
  json['pliego:controls'] = [{ id: 'sequence', kind: 'sequence', label: { en: 'step' }, min: 0, max: 1, default: 0 }];
  json['pliego:sequence'] = { mode: 'kinematic', steps: [{ id: 'fold', label: { en: 'fold' }, duration_ms: 1000, targets: crease.map((e) => [e, +(r[e] / D).toFixed(6)]), release: [], note: null }] };
  const w = new World(json, { meshEdge: 6, gravity: false });
  w.setControl('sequence', 1);
  let worstRes = 0, worstStrain = 0;
  for (let f = 0; f < 55; f++) { w.step(); worstRes = Math.max(worstRes, w.stats().kinematicResidual); worstStrain = Math.max(worstStrain, w.stats().maxStrain); }
  const pass = worstRes < 1e-9 && worstStrain < 1e-6;
  proof('kinematic-sequence', worstRes, 0, '<1e-9 rad closure, <1e-6 strain', pass, `in-between states solved (not blended), max strain ${worstStrain.toExponential(1)}`);
  assert.ok(pass);
});

test('sequence: physical steps hold unlisted creases; release hands back to the paper', () => {
  const { doc, crease } = squareValley({ size: 80 });
  const w = new World(doc, { meshEdge: 10, gravity: false, ground: false, contact: false });
  w.setControl('sequence', 0.5);
  for (let f = 0; f < 90; f++) w.step();
  assert.equal(w.getControl('sequence'), 0.5);
  assert.ok(w.driveOn.some((x) => x === 1), 'mid-step drives the crease');
  w.setControl('sequence', 2);
  for (let f = 0; f < 200; f++) w.step();
  assert.ok(!w.driveOn.some((x) => x === 1), 'released');
  void crease;
});

test('fixed board: a kinematic sheet not listed in sheets_moving keeps its placement', async () => {
  const { doc } = await vfoldCard();
  doc['pliego:mechanisms'] = doc['pliego:mechanisms'].filter((/** @type {any} */ m) => m.id === 'open');
  doc['pliego:sheets'][0].kinematic = { mechanism: 'open' }; // left board references the spread hinge, not moved by it
  doc['pliego:controls'] = doc['pliego:controls'].filter((/** @type {any} */ c) => c.id === 'open');
  const w = new World(doc, { meshEdge: 8, gravity: false, ground: false });
  const before = Float64Array.from(w.x);
  w.setControl('open', 120);
  for (let f = 0; f < 30; f++) w.step();
  let moved = 0, turned = 0;
  for (let v = 0; v < w.mesh.nV; v++) for (let c = 0; c < 3; c++) {
    const d = Math.abs(w.x[3 * v + c] - before[3 * v + c]);
    if (w.mesh.vSheet[v] === 0) moved = Math.max(moved, d); else if (w.mesh.vSheet[v] === 1) turned = Math.max(turned, d);
  }
  assert.ok(moved < 1e-12, `fixed board moved by ${moved}`);
  assert.ok(turned > 1, 'the listed board turns');
});
