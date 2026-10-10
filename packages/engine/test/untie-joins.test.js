// @ts-check
/**
 * Untie and release joins (spec §5.22, backlog item 12): a step lists `release_joins`, and from
 * that step on the joins no longer hold — a carousel book's tie ribbons are untied before it opens.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument } from '../src/index.js';
import * as stub from '../../../apps/web/studio/src/engine-stub.js';
import { gluedFold } from './helpers/linkages.js';
import { proof } from './helpers/bench.js';
import { termResidual } from '../src/xpbd/implicit.js';

const R2D = 180 / Math.PI;
const L = (/** @type {string} */ en, /** @type {string} */ es, /** @type {string} */ fr, /** @type {string} */ pt) => ({ en, es, fr, pt });
const step = (/** @type {string} */ id, /** @type {any} */ label, /** @type {any} */ more = {}) => ({ id, label, duration_ms: 1000, targets: [], release: [], note: null, ...more });

/** A folded strip tied shut by a ribbon (a string from the flap's end to the sheet under it), then untied. */
function tiedFold() {
  const g = gluedFold({ angle: 180, gate: false, extra: [step('untie', L('Untie the ribbon', 'Desata el listón', 'Dénouez le ruban', 'Desamarre a fita'), { release_joins: ['tie'] })] });
  g.doc['pliego:sequence'].steps[1].label = L('Tie the ribbon', 'Ata el listón', 'Nouez le ruban', 'Amarre a fita');
  g.doc['pliego:joins'] = [{ id: 'tie', type: 'string', a: { sheet: 'strip', at: [96, 20] }, b: { sheet: 'strip', at: [4, 20] }, length: 1.5, active_from: 'glue' }];
  g.doc.frame_attributes = ['2D', 'noCuts', 'joins'];
  g.doc.file_frames = [{ frame_title: 'initial', frame_classes: ['foldedForm'], frame_attributes: ['3D'], frame_inherit: true, frame_parent: 0,
    vertices_coords: g.doc.vertices_coords.map((/** @type {number[]} */ p) => [p[0], 0, -p[1]]) }];
  return g;
}

test('untie: a ribbon holds the fold shut after letting go, and the fold springs open once its step unties it', () => {
  const g = tiedFold();
  const w = new World(g.doc, { meshEdge: 8, substeps: 10, gravity: false, ground: false });
  const tie = w.terms.info.findIndex((i) => i.join === 'tie');
  const play = (/** @type {number} */ p, /** @type {number} */ n) => { w.setControl('sequence', p); for (let f = 0; f < n; f++) w.step(); return w.drivers.edgeAngle(w, g.crease) * R2D; };
  play(1, 150); play(2, 60);
  const tied = play(3, 240);
  const r = [0, 0, 0]; termResidual(w.terms, tie, w.x, r);
  const span = Math.hypot(r[0], r[1], r[2]);
  const held = w.terms.active[tie] === 1;
  const untied = play(4, 240);
  const pass = held && span < 1.5 + 0.2 && untied < tied - 10 && w.terms.active[tie] === 0 && w.terms.gateOff[tie] === 1;
  proof('untie-ribbon', untied, `< ${(tied - 10).toFixed(1)}`, 'tied ≤ length, then springs ≥10° once untied', pass,
    `tied: crease ${tied.toFixed(1)}°, ribbon span ${span.toFixed(2)} mm (length 1.5); untied: crease ${untied.toFixed(1)}°`);
  assert.ok(pass);
});

test('preview stub: glue released by a later step stops holding its loop', () => {
  const g = gluedFold({ angle: 180, extra: [
    step('unglue', L('Peel the tab', 'Despega la pestaña', 'Décollez la patte', 'Descole a aba'), { release_joins: ['tab'] }),
    step('let-go-again', L('Let go', 'Suelta', 'Lâchez', 'Solte'), { release: [0] }),
  ] });
  g.doc['pliego:sequence'].steps[4].release = [g.crease];
  const s = new stub.World(stub.loadDocument(g.doc), { seed: 1 });
  s.setControl('sequence', 3); s.step();
  const held = s._angles()[g.crease];
  s.setControl('sequence', 5); s.step();
  const sprung = s._angles()[g.crease];
  const pass = held > 179 && sprung < 150;
  proof('untie-preview', sprung, '<150', 'held >179° while glued, springs once released', pass, `held ${held.toFixed(1)}°`);
  assert.ok(pass);
});

test('rule 22: release_joins names existing gateable joins once, after they take hold', () => {
  const base = () => tiedFold();
  const steps = (/** @type {any} */ g) => g.doc['pliego:sequence'].steps;
  let g = base(); steps(g)[3].release_joins = ['nope'];
  assert.throws(() => loadDocument(g.doc), /rule 22.*not a join/);
  g = base(); steps(g)[2].release_joins = ['tie'];
  assert.throws(() => loadDocument(g.doc), /rule 22.*already released/);
  g = base(); steps(g)[3].release_joins = []; steps(g)[1].release_joins = ['tie'];
  assert.throws(() => loadDocument(g.doc), /rule 22.*at or before the step that activates it/);
  g = base(); steps(g)[3].release_joins = 'tie';
  assert.throws(() => loadDocument(g.doc), /rule 22.*must be an array/);
  assert.doesNotThrow(() => loadDocument(base().doc));
});
