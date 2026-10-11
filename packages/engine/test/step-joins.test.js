// @ts-check
/**
 * Step-activated joins (spec §5.19, backlog item 16d): a glue that holds from a chosen step, so a
 * fold program shows the making and still ends glued. Engine and preview stub on one document.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument } from '../src/index.js';
import * as stub from '../../../apps/web/studio/src/engine-stub.js';
import { gluedFold } from './helpers/linkages.js';
import { proof } from './helpers/bench.js';
import { termResidual } from '../src/xpbd/implicit.js';

const R2D = 180 / Math.PI;

/** Largest distance between a tab vertex and its weld point over the holding tab welds (mm). @param {World} w */
function weldGap(w) {
  const T = w.terms, r = [0, 0, 0];
  let worst = 0;
  for (let t = 0; t < T.count; t++) if (T.info[t].join === 'tab' && T.active[t]) { termResidual(T, t, w.x, r); worst = Math.max(worst, Math.hypot(r[0], r[1], r[2])); }
  return worst;
}

/**
 * Largest distance from a tab vertex to the plane of the paper under it (the left half), after
 * the fold: the tab sits on the paper when this is about one caliper.
 * @param {World} w @param {any} [doc] @param {number} [shift]
 */
function tabGap(w, doc, shift = 0) {
  void doc; void shift;
  let worst = 0;
  const left = [];
  for (let v = 0; v < w.mesh.nV; v++) if (w.mesh.uv[2 * v] < 45) left.push(v);
  // plane of the left half: centroid + normal of three far-apart vertices
  const P = (/** @type {number} */ v) => [w.x[3 * v], w.x[3 * v + 1], w.x[3 * v + 2]];
  const pick = (/** @type {number} */ u, /** @type {number} */ vv) => left.reduce((b, v) => (Math.hypot(w.mesh.uv[2 * v] - u, w.mesh.uv[2 * v + 1] - vv) < Math.hypot(w.mesh.uv[2 * b] - u, w.mesh.uv[2 * b + 1] - vv) ? v : b), left[0]);
  const a = P(pick(0, 0)), b = P(pick(40, 0)), c = P(pick(0, 40));
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const L = Math.hypot(n[0], n[1], n[2]);
  for (let v = 0; v < w.mesh.nV; v++) {
    const u = w.mesh.uv[2 * v], vv = w.mesh.uv[2 * v + 1];
    if (u < 86 || u > 96 || vv < 6 || vv > 34) continue;
    const p = P(v);
    worst = Math.max(worst, Math.abs(((p[0] - a[0]) * n[0] + (p[1] - a[1]) * n[1] + (p[2] - a[2]) * n[2]) / L));
  }
  return worst;
}
const OPTS = { meshEdge: 8, substeps: 10, gravity: false, ground: false };

/** Play the program to position p and return the crease angle (deg). @param {World} w @param {number} e @param {number} p @param {number} frames */
function playTo(w, e, p, frames) {
  w.setControl('sequence', p);
  for (let f = 0; f < frames; f++) w.step();
  return w.drivers.edgeAngle(w, e) * R2D;
}

test('step-activated glue: flat at t = 0, folds, glues at its step, and stays shut after letting go', () => {
  const g = gluedFold({ angle: 180 });
  const doc = loadDocument(g.doc); // rule 9 does not ask the gated weld to hold in the flat initial frame
  const w = new World(doc, OPTS);
  const tab = w.terms.info.map((i, t) => (i.join === 'tab' ? t : -1)).filter((t) => t >= 0);
  assert.ok(tab.length > 0 && tab.every((t) => w.terms.active[t] === 0), 'inactive before its step');
  const folded = playTo(w, g.crease, 1, 150);
  assert.ok(tab.every((t) => w.terms.active[t] === 0), 'still inactive at the end of the fold step');
  playTo(w, g.crease, 2, 60);
  assert.ok(tab.every((t) => w.terms.active[t] === 1), 'holds once the glue step has begun');
  const snapped = w.terms.info.filter((i) => i.join === 'tab' && !i.slid && !i.unheld).length;
  const glued = playTo(w, g.crease, 3, 240);
  const gap = weldGap(w);
  // baseline: the same program without the glue springs back by about the yield angle
  const b = gluedFold({ angle: 180, gate: false });
  const wb = new World(b.doc, OPTS);
  playTo(wb, b.crease, 1, 150); playTo(wb, b.crease, 2, 60);
  const open = playTo(wb, b.crease, 3, 240);
  const openGap = tabGap(wb, g.doc);
  const pass = folded > 170 && gap < 0.3 && openGap > 10 && glued > open + 5 && snapped === tab.length && w.stats().finite && w.stats().unheldWelds === 0;
  proof('step-glue-shut', gap, 0, '<0.3 mm tab to its weld point after letting go (unglued tab >10 mm off the paper)', pass,
    `folded ${folded.toFixed(1)}°, ${snapped}/${tab.length} welds snapped; after letting go the glued crease bows to ${glued.toFixed(1)}° (a teardrop), unglued springs to ${open.toFixed(1)}° with the tab ${openGap.toFixed(1)} mm off`);
  assert.ok(pass);
  // scrubbing back before the glue step unglues (a join is a function of the step position)
  w.setControl('sequence', 1); for (let f = 0; f < 200; f++) w.step();
  assert.ok(tab.every((t) => w.terms.active[t] === 0), 'released when scrubbed back before its step');
});

test('step-activated glue meets the paper where it lies: slid welds hold, paper off its zone does not take hold', () => {
  // the zone is drawn 3 mm off where the fold lands: the tab lies on the paper, slid along it
  const g = gluedFold({ angle: 180, shift: 3 });
  const w = new World(g.doc, OPTS);
  playTo(w, g.crease, 1, 150); playTo(w, g.crease, 2, 60);
  const slid = w.terms.info.filter((i) => i.join === 'tab' && i.slid).length;
  playTo(w, g.crease, 3, 240);
  const gap = weldGap(w);
  // a flap standing at 90° is far off its zone: the glue does not take hold, the crease springs
  const u = gluedFold({ angle: 90 });
  const wu = new World(u.doc, OPTS);
  playTo(wu, u.crease, 1, 150);
  const at = playTo(wu, u.crease, 2, 60);
  const unheld = wu.stats().unheldWelds;
  const sprung = playTo(wu, u.crease, 3, 240);
  const pass = slid > 0 && gap < 0.3 && unheld > 0 && sprung < at - 15;
  proof('step-glue-current-geometry', gap, 0, '<0.3 mm from where the tab lay; off-zone welds unheld', pass,
    `${slid} welds slid onto the paper they touched; at 90° ${unheld} weld points did not take hold and the crease sprang from ${at.toFixed(1)}° to ${sprung.toFixed(1)}°`);
  assert.ok(pass);
});

test('preview stub: a crease on the glued loop does not spring back after the glue step', () => {
  const run = (/** @type {any} */ doc, /** @type {number} */ e) => {
    const s = new stub.World(stub.loadDocument(doc), { seed: 1 });
    s.setControl('sequence', 3); s.step();
    return s._angles()[e];
  };
  const g = gluedFold({ angle: 180 }), b = gluedFold({ angle: 180, gate: false });
  const glued = run(g.doc, g.crease), open = run(b.doc, b.crease);
  // glue that holds only from a later step leaves the release free
  const late = gluedFold({ angle: 180, glueAt: 'tail', extra: [{ id: 'tail', label: { en: 'tail', es: 'cola', fr: 'queue', pt: 'cauda' }, duration_ms: 500, targets: [], release: [], note: null }] });
  const lateAngle = run(late.doc, late.crease);
  const pass = glued > 179 && open < 150 && lateAngle < 150;
  proof('step-glue-preview', glued, '≈180 (held)', '>179° held; unglued and later glue <150°', pass, `unglued ${open.toFixed(1)}°, glue from a later step ${lateAngle.toFixed(1)}°`);
  assert.ok(pass);
});

test('rule 20: active_from must resolve to a step of the program and suits glue, pivot, string, pin', () => {
  const g = gluedFold();
  g.doc['pliego:joins'][0].active_from = 'nope';
  assert.throws(() => loadDocument(g.doc), /rule 20.*not a step id or index/);
  g.doc['pliego:joins'][0].active_from = 7;
  assert.throws(() => loadDocument(g.doc), /rule 20/);
  g.doc['pliego:joins'][0].active_from = 1;
  assert.doesNotThrow(() => loadDocument(g.doc));
  const h = gluedFold();
  delete h.doc['pliego:joins'][0].active_from; // an ungated glue must hold in the flat initial frame
  assert.throws(() => loadDocument(h.doc), /rule 9: glue join tab is off its zone/);
});

test('step-activated pin grips the paper where it is when its step begins; snapshot/restore replays bit-exactly', async () => {
  const { DocBuilder } = await import('./helpers/docbuilder.js');
  const b = new DocBuilder('falling card caught by a pin');
  b.rect({ id: 'card', width: 60, height: 40, placement: { origin: [0, 200, 0], rotation: [0, 0, 0, 1] } });
  b.joins.push({ id: 'catch', type: 'pin', a: { sheet: 'card', along: [[0, 40], [60, 40]] }, world: null, active_from: 'catch' });
  const L = { en: 'step', es: 'paso', fr: 'étape', pt: 'passo' };
  b.sequence = { mode: 'physical', steps: [{ id: 'drop', label: L, duration_ms: 300, targets: [], release: [], note: null }, { id: 'catch', label: L, duration_ms: 300, targets: [], release: [], note: null }] };
  b.control({ id: 'sequence', kind: 'sequence', min: 0, max: 2, default: 0 });
  const doc = b.build();
  const w = new World(doc, { meshEdge: 8, substeps: 10, ground: false, contact: false });
  const edge = [];
  for (let v = 0; v < w.mesh.nV; v++) if (Math.abs(w.mesh.uv[2 * v + 1] - 40) < 1e-9) edge.push(v);
  w.setControl('sequence', 2);
  let caughtAt = NaN;
  for (let f = 0; f < 40; f++) { w.step(); if (Number.isNaN(caughtAt) && w.drivers.seqPos > 1) caughtAt = w.x[3 * edge[0] + 1]; }
  const snap = w.snapshot();
  for (let f = 0; f < 60; f++) w.step();
  const after = w.x[3 * edge[0] + 1];
  const a = Float64Array.from(w.x);
  w.restore(snap);
  for (let f = 0; f < 60; f++) w.step();
  const same = Buffer.compare(Buffer.from(a.buffer), Buffer.from(Float64Array.from(w.x).buffer)) === 0;
  const fell = 200 - caughtAt;
  const pass = fell > 1 && Math.abs(after - caughtAt) < 0.2 && same;
  proof('step-pin-catch', after - caughtAt, 0, '±0.2 mm once caught; restore bit-exact', pass, `fell ${fell.toFixed(2)} mm before its step, replay identical=${same}`);
  assert.ok(pass);
});
