// Reveal preview (sheet-document spec §5.8): the stub lifts the excess pieces a step removes and
// then hides them, top sheet first; overlay lines of removed pieces disappear; bad piece
// references are rejected at load.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as stub from '../studio/src/engine-stub.js';
import { createOverlay } from '../studio/src/diagram.js';

const L = (en) => ({ en, es: en, fr: en, pt: en });
const STOCK = {
  name: L('Copy paper'), gsm: 80, caliper_mm: 0.1, derived_basis: 'test',
  derived: { areal_density: 8e-5, thickness: 0.1, E_md: 5.5e9, E_cd: 2.5e9, nu: 0.293, D_md: 5e5, D_cd: 2.3e5, crease_k: 1e5, crease_yield_deg: 35, crease_set_rate: 0.5, score_factor: 0.35, perf_factor: 0.2, tear_strain: 0.02, friction: 0.4, collision_thickness: 0.1 },
};

/**
 * `n` stacked 60 × 60 sheets, 0.1 mm apart. Each has a kept 20 × 20 square in the middle (cut
 * round) and an excess frame split into four trapezoids by perforations at the corners.
 */
function revealDoc(n = 2) {
  const d = {
    file_spec: 1.2, file_creator: 'test', file_classes: ['multiModel'], frame_classes: ['creasePattern'],
    frame_attributes: ['2D', 'cuts', 'noJoins'], frame_unit: 'mm',
    vertices_coords: [], edges_vertices: [], edges_assignment: [], edges_foldAngle: [], faces_vertices: [],
    'pliego:version': 1, 'pliego:vertices_sheet': [], 'pliego:edges_sheet': [], 'pliego:faces_sheet': [], 'pliego:edges_treatment': [],
    'pliego:sheets': [], 'pliego:stocks': { 'copy-80': STOCK }, 'pliego:pieces': [],
    'pliego:controls': [{ id: 'reveal', kind: 'sequence', label: L('Reveal'), min: 0, max: n, default: 0, unit: 'step' }],
    'pliego:sequence': { mode: 'physical', steps: [] },
    'pliego:meta': { kernel: 'test' },
  };
  const pts = [[0, 0], [60, 0], [60, 60], [0, 60], [20, 20], [40, 20], [40, 40], [20, 40]];
  for (let s = 0; s < n; s++) {
    const id = `layer-${s + 1}`, ox = s * 70, v0 = d.vertices_coords.length, f0 = d.faces_vertices.length;
    d['pliego:sheets'].push({ id, label: L(id), stock: 'copy-80', grain_deg: 90, offset: [ox, 0], placement: { origin: [0, 0.05 + 0.1 * s, 0], rotation: [0, 0, 0, 1] }, front: { color: '#f7f7f2', art: null }, back: { color: '#f7f7f2', art: null }, kinematic: null });
    for (const [x, y] of pts) { d.vertices_coords.push([x + ox, y]); d['pliego:vertices_sheet'].push(s); }
    const edge = (a, b, asg, trt) => { d.edges_vertices.push([v0 + a, v0 + b]); d.edges_assignment.push(asg); d.edges_foldAngle.push(0); d['pliego:edges_treatment'].push(trt); d['pliego:edges_sheet'].push(s); };
    [[0, 1], [1, 2], [2, 3], [3, 0]].forEach(([a, b]) => edge(a, b, 'B', 'none'));
    [[4, 5], [5, 6], [6, 7], [7, 4]].forEach(([a, b]) => edge(a, b, 'C', 'cut'));
    [[0, 4], [1, 5], [2, 6], [3, 7]].forEach(([a, b]) => edge(a, b, 'C', 'perforation'));
    for (const f of [[4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]) {
      d.faces_vertices.push(f.map((v) => v0 + v)); d['pliego:faces_sheet'].push(s);
    }
    d['pliego:pieces'].push({ id: `${id}-keep`, sheet: id, role: 'keep', faces: [f0] });
    for (let k = 1; k <= 4; k++) d['pliego:pieces'].push({ id: `${id}-excess-${k}`, sheet: id, role: 'excess', faces: [f0 + k] });
  }
  for (let s = n - 1; s >= 0; s--) {
    d['pliego:sequence'].steps.push({ id: `tear-${s + 1}`, label: L(`Tear ${s + 1}`), duration_ms: 400, targets: [], release: [], note: null, remove: [1, 2, 3, 4].map((k) => `layer-${s + 1}-excess-${k}`) });
  }
  return d;
}

const world = (d) => new stub.World(stub.loadDocument(d));
const maxY = (r) => { let m = -Infinity; for (let i = 1; i < r.positions.length; i += 3) m = Math.max(m, r.positions[i]); return m; };
/** Highest y over the triangles currently in the index buffer (what the renderer draws). */
const drawnMaxY = (r) => { let m = -Infinity; for (const i of r.indices) m = Math.max(m, r.positions[i * 3 + 1]); return m; };

test('reveal: excess lifts during its step, then disappears; the top sheet goes first', () => {
  const d = revealDoc(2);
  const w = world(d);
  const full = w.render().indices.length;
  assert.equal(full, 2 * 5 * 2 * 3, 'two triangles per quad face, five faces per sheet');
  assert.ok(Math.abs(maxY(w.render()) - 0.15) < 1e-6, 'block at rest');
  w.setControl('reveal', 0.4); w.step(1 / 60);
  let r = w.render();
  assert.equal(r.indices.length, full, 'still drawn while lifting');
  assert.ok(drawnMaxY(r) > 5, `top frame lifts (max y ${drawnMaxY(r)})`);
  w.setControl('reveal', 1); w.step(1 / 60);
  r = w.render();
  assert.equal(r.indices.length, full - 4 * 2 * 3, 'top sheet excess hidden after its step');
  assert.ok(Math.abs(drawnMaxY(r) - 0.15) < 1e-6, 'top keep square still drawn at rest');
  w.setControl('reveal', 2); w.step(1 / 60);
  r = w.render();
  assert.equal(r.indices.length, 2 * 2 * 3, 'only the two kept squares remain');
  w.setControl('reveal', 0); w.step(1 / 60);
  assert.equal(w.render().indices.length, full, 'scrubbing back restores every piece');
});

test('reveal: vertices shared with kept pieces stay put; overlay drops removed edges', () => {
  const d = revealDoc(2);
  const w = world(d);
  const corner = 8 + 4;   // top sheet, inner corner (20, 20): on the cut and on a perforation
  const y0 = w.positions[corner * 3 + 1];
  w.setControl('reveal', 0.5); w.step(1 / 60);
  assert.equal(w.positions[corner * 3 + 1], y0, 'the kept square owns the shared vertex');
  const ov = createOverlay(d, w);
  w.setControl('reveal', 1); w.step(1 / 60);
  const top = d.edges_vertices.map((_, e) => e).filter((e) => d['pliego:edges_sheet'][e] === 1);
  const perf = top.filter((e) => d['pliego:edges_treatment'][e] === 'perforation');
  const cut = top.filter((e) => d['pliego:edges_treatment'][e] === 'cut');
  assert.ok(perf.every((e) => w.hiddenEdges[e] === 1), 'perforations of the removed frame are hidden');
  assert.ok(cut.every((e) => w.hiddenEdges[e] === 0), 'the kept square keeps its cut outline');
  const o = ov.build();
  let collapsed = 0;
  for (let i = 0; i < o.positions.length; i += 6) if (o.positions[i] === o.positions[i + 3] && o.positions[i + 1] === o.positions[i + 4] && o.positions[i + 2] === o.positions[i + 5]) collapsed++;
  assert.equal(collapsed, 4, 'four overlay lines collapse');
});

test('reveal: a custom pull direction moves the piece that way', () => {
  const d = revealDoc(1);
  d['pliego:pieces'][1].pull = [0, 0, 1];
  const w = world(d);
  w.setControl('reveal', 0.5); w.step(1 / 60);
  const r = w.render();
  let zMax = -Infinity; for (const i of r.indices) zMax = Math.max(zMax, r.positions[i * 3 + 2]);
  assert.ok(zMax > 5, `pulled along +z (max z ${zMax})`);
});

test('reveal: bad piece references are rejected at load', () => {
  const bad = [
    (d) => d['pliego:sequence'].steps[0].remove.push('ghost'),
    (d) => d['pliego:sequence'].steps[0].remove.push('layer-1-keep'),
    (d) => d['pliego:sequence'].steps[1].remove.push('layer-2-excess-1'),
    (d) => d['pliego:pieces'][0].faces.push(1),
    (d) => { d['pliego:pieces'][0].faces = [5]; },
    (d) => { d['pliego:pieces'][0].sheet = 'nowhere'; },
  ];
  for (const mutate of bad) {
    const d = revealDoc(2);
    mutate(d);
    assert.throws(() => stub.loadDocument(d), stub.DocumentError);
  }
});

test('reveal: documents without pieces keep their triangle order and draw everything', () => {
  const d = revealDoc(2);
  delete d['pliego:pieces'];
  for (const st of d['pliego:sequence'].steps) delete st.remove;
  const w = world(d);
  w.setControl('reveal', 2); w.step(1 / 60);
  assert.equal(w.render().indices.length, 60);
  assert.ok([...w.render().indices.slice(0, 6)].every((i) => i < 4), 'face 0 is still drawn first');
});

test('reveal: an 80-layer block scrubs at interactive rates', () => {
  const d = revealDoc(80);
  const w = world(d);
  const t0 = performance.now();
  const frames = 160;
  for (let k = 0; k <= frames; k++) { w.setControl('reveal', (80 * k) / frames); w.step(1 / 60); w.render(); }
  const ms = (performance.now() - t0) / (frames + 1);
  console.log(`reveal-preview: layers=80 faces=${d.faces_vertices.length} pose=${ms.toFixed(3)}ms/frame`);
  assert.ok(ms < 16, `${ms.toFixed(2)} ms per frame`);
});
