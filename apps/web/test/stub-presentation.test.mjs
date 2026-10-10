// Spec §5.16 presentation in the studio stub: the root face stays put, the end transform is
// blended in over the program about the root face's centroid, and the ground clamp keeps the
// posed paper above the table (backlog items 14 and 16e).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as stub from '../studio/src/engine-stub.js';

const L = (en) => ({ en, es: en, fr: en, pt: en });
const STOCK = {
  name: L('Copy paper'), gsm: 80, caliper_mm: 0.1, derived_basis: 'test',
  derived: { areal_density: 8e-5, thickness: 0.1, E_md: 5.5e9, E_cd: 2.5e9, nu: 0.293, D_md: 5e5, D_cd: 2.3e5, crease_k: 1e5, crease_yield_deg: 35, crease_set_rate: 0.5, score_factor: 0.35, perf_factor: 0.2, tear_strain: 0.02, friction: 0.4, collision_thickness: 0.1 },
};
const S45 = Math.SQRT1_2;

/** A 100 × 60 card folded along x = 50 by one step (valley +90 or mountain −90). */
function card({ angle = 90, presentation = undefined } = {}) {
  const sheet = { id: 'card', label: L('Card'), stock: 'copy-80', grain_deg: 90, offset: [0, 0], placement: { origin: [0, 0, 0], rotation: [0, 0, 0, 1] }, front: { color: '#ffffff', art: null }, back: { color: '#ffffff', art: null }, kinematic: null };
  if (presentation) sheet.presentation = presentation;
  return {
    file_spec: 1.2, file_creator: 'test', file_classes: ['singleModel'], frame_classes: ['creasePattern'], frame_attributes: ['2D', 'noCuts', 'noJoins'], frame_unit: 'mm',
    vertices_coords: [[0, 0], [50, 0], [100, 0], [100, 60], [50, 60], [0, 60]],
    edges_vertices: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0], [1, 4]],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', angle > 0 ? 'V' : 'M'],
    edges_foldAngle: [0, 0, 0, 0, 0, 0, angle],
    faces_vertices: [[0, 1, 4, 5], [1, 2, 3, 4]],
    'pliego:version': 1, 'pliego:vertices_sheet': [0, 0, 0, 0, 0, 0], 'pliego:edges_sheet': [0, 0, 0, 0, 0, 0, 0], 'pliego:faces_sheet': [0, 0],
    'pliego:edges_treatment': ['none', 'none', 'none', 'none', 'none', 'none', 'crease'],
    'pliego:sheets': [sheet], 'pliego:stocks': { 'copy-80': STOCK },
    'pliego:controls': [{ id: 'seq', kind: 'sequence', label: L('Fold'), min: 0, max: 1, default: 0, unit: 'step' }],
    'pliego:sequence': { mode: 'physical', steps: [{ id: 'fold', label: L('Fold'), duration_ms: 1000, targets: [[6, angle]], release: [], note: null }] },
    'pliego:meta': { kernel: 'test' },
  };
}

function faceCoords(world, face, doc) {
  world.render();
  return doc.faces_vertices[face].map((v) => [...world.positions.slice(v * 3, v * 3 + 3)]);
}

test('presentation root_face is the face the preview holds still', () => {
  for (const root of [0, 1]) {
    const doc = card({ presentation: { root_face: root } });
    const w = new stub.World(stub.loadDocument(doc));
    const before = faceCoords(w, root, doc);
    w.setControl('seq', 1);
    const after = faceCoords(w, root, doc);
    for (let i = 0; i < before.length; i++) for (let k = 0; k < 3; k++) assert.ok(Math.abs(before[i][k] - after[i][k]) < 1e-9);
    const other = faceCoords(w, 1 - root, doc);
    assert.ok(Math.max(...other.map((p) => p[1])) > 40, 'the other half stands up');
  }
});

test('presentation end is blended in over the program about the root face centroid', () => {
  // +90° about +x turns the root face (lying flat, front up) to stand in a vertical plane
  const doc = card({ presentation: { root_face: 1, end: { origin: [0, 30, 0], rotation: [S45, 0, 0, S45] } } });
  const w = new stub.World(stub.loadDocument(doc), { ground: false });
  const flat = faceCoords(w, 1, doc);
  assert.ok(flat.every((p) => Math.abs(p[1]) < 1e-9), 't = 0 is untouched: the sheet lies flat');
  w.setControl('seq', 1);
  const up = faceCoords(w, 1, doc);
  const ys = up.map((p) => p[1]);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 59, 'the root face stands upright at the end');
  const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
  assert.ok(Math.abs(cy - 30) < 1e-6, 'its centroid moved by the end origin');
  w.setControl('seq', 0.5);
  const mid = faceCoords(w, 1, doc).map((p) => p[1]);
  const span = Math.max(...mid) - Math.min(...mid);
  assert.ok(span > 30 && span < 59, 'half way through the program it is half turned');
});

test('ground clamp keeps a mountain fold above the table (and can be turned off)', () => {
  const doc = card({ angle: -90 });
  const clamped = new stub.World(stub.loadDocument(doc));
  const free = new stub.World(stub.loadDocument(doc), { ground: false });
  for (const v of [0, 0.25, 0.5, 1]) {
    clamped.setControl('seq', v); free.setControl('seq', v);
    const yc = Math.min(...faceCoords(clamped, 0, doc).concat(faceCoords(clamped, 1, doc)).map((p) => p[1]));
    const yf = Math.min(...faceCoords(free, 0, doc).concat(faceCoords(free, 1, doc)).map((p) => p[1]));
    assert.ok(yc > -1e-9, `clamped min y ${yc} at ${v}`);  // float32 render rounding: ≤ 1e-6
    assert.ok(Math.abs(yc) < 1e-6, 'the lowest point rests on the table');
    if (v > 0) assert.ok(yf < -1, 'without the clamp the flap passes through the table');
  }
});
