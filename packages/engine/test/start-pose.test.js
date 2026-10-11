// @ts-check
/**
 * Stretch on new content (backlog item 21). Two engine causes, each with a regression test:
 * - a mechanism control whose default differs from the pose the document places its kinematic
 *   sheets in used to teleport them on the first substep (pull-tab-slider `straight`, dissolve-scene);
 * - layers of two stocks touch at the mean of their collision thicknesses, not the larger one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** A free card lying on a kinematic board hinged at its left edge; the board is placed flat (rest 0) and the control's default is `def`°. */
function liftBoard(def) {
  const b = new DocBuilder('card on a hinged board');
  b.rect({ id: 'board', width: 80, height: 60, stock: 'cardstock-250', kinematic: { mechanism: 'lift' } });
  b.rect({ id: 'card', width: 60, height: 40, placement: { origin: [10, 0.2, -10], rotation: [0, 0, 0, 1] } });
  b.mechanisms.push({ id: 'lift', type: 'hinge', axis: { origin: [0, 0, 0], direction: [0, 0, 1] }, angle_control: 'lift', rest: 0, sheets_moving: ['board'] });
  b.control({ id: 'lift', kind: 'angle', min: 0, max: 90, default: def, unit: 'deg' });
  return b.build();
}

test('a control whose default disagrees with the placed pose glides there instead of teleporting the sheet', () => {
  const w = new World(liftBoard(60), { meshEdge: 6, substeps: 10 });
  let worst = 0;
  for (let f = 0; f < 40; f++) { w.step(); worst = Math.max(worst, w.stats().maxStrain); }
  const glided = w.getControl('lift');
  // the card stays on the board's top side: signed distance of its vertices to the board plane
  // (the hinge is the world z axis; at 60° the board's front normal is (−sin 60°, cos 60°, 0))
  const n = [-Math.sin(Math.PI / 3), Math.cos(Math.PI / 3), 0];
  let below = Infinity;
  for (let v = 0; v < w.mesh.nV; v++) if (w.mesh.vSheet[v] === 1) below = Math.min(below, w.x[3 * v] * n[0] + w.x[3 * v + 1] * n[1]);
  const pass = w.warnings.length === 1 && /starts at 0/.test(w.warnings[0]) && glided === 60 && worst < 0.015 && below > 0 && w.stats().finite;
  proof('start-pose-glide', below, '>0', 'card stays on top of the board as it rises to its default (no teleport through it), stretch <1.5 % while lifted at 180°/s', pass, `max stretch ${(worst * 100).toFixed(3)} %; ${w.warnings[0]}`);
  assert.ok(pass);
  // a document whose pose matches its default starts there, silently
  const ok = new World(liftBoard(0), { meshEdge: 6, substeps: 10 });
  assert.equal(ok.warnings.length, 0);
});

test('layers of two stocks rest at the mean of their collision thicknesses', () => {
  const b = new DocBuilder('copy paper on cardstock');
  b.rect({ id: 'lower', width: 60, height: 60, stock: 'cardstock-250' });
  b.rect({ id: 'upper', width: 40, height: 40, stock: 'copy-80', placement: { origin: [10, 1, -10], rotation: [0, 0, 0, 1] } });
  const w = new World(b.build(), { meshEdge: 6, substeps: 10 });
  for (let f = 0; f < 120; f++) w.step();
  let gap = Infinity;
  for (let v = 0; v < w.mesh.nV; v++) if (w.mesh.vSheet[v] === 1) gap = Math.min(gap, w.x[3 * v + 1]);
  const expect = 0.5 * (0.3 + 0.1);
  const pass = Math.abs(gap - expect) < 0.02;
  proof('contact-mean-thickness', gap, expect, '±0.02 mm (cardstock 0.3 + copy 0.1)', pass, 'the larger thickness (0.3) would hold it 0.1 mm too high');
  assert.ok(pass);
});
