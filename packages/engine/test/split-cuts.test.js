// @ts-check
/**
 * Split cuts (spec §5.13, lane H): the kernel writes a cut once per side — twin `C` edges with the
 * same coordinates, each bordering one face, over split vertices. The engine accepts them (rule
 * 4), meshes one side per twin, and keeps the copies in one contact group.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World, loadDocument } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** A 60 mm square with a slit from the bottom edge to its centre, split as the kernel writes it, and a valley crease that folds the flap beside it. */
function slitSquare({ split = true } = {}) {
  const b = new DocBuilder('split slit');
  const s = b.sheet({ id: 'card', width: 60, height: 60 });
  const P = (/** @type {number} */ u, /** @type {number} */ v) => b.vertex(s, u, v);
  const [p00, pa, tip, mid, p66, p06] = [P(0, 0), P(30, 0), P(30, 30), P(60, 30), P(60, 60), P(0, 60)];
  const pb = split ? P(30, 0) : pa;
  const p60 = P(60, 0);
  b.face([p00, pa, tip, mid, p66, p06]); // the L-shaped rest of the card
  b.face([pb, p60, mid, tip]); // the bottom-right flap, beside the slit
  b.assign(pa, tip, 'C');
  if (split) b.assign(pb, tip, 'C');
  const crease = b.assign(tip, mid, 'V', 90);
  b.control({ id: 'sequence', kind: 'sequence', min: 0, max: 1, default: 0 });
  b.sequence = { mode: 'physical', steps: [{ id: 'fold', label: { en: 'Fold', es: 'Dobla', fr: 'Pliez', pt: 'Dobre' }, duration_ms: 1000, targets: [[crease, 90]], release: [], note: null }] };
  return { doc: b.build(), pa, pb };
}

test('split cut: twin C edges load, mesh one side each, share contact groups, and the slit opens', () => {
  const { doc, pa, pb } = slitSquare();
  const w = new World(loadDocument(doc), { meshEdge: 6, substeps: 10, gravity: false, ground: false });
  const used = new Uint8Array(w.mesh.nV); for (const v of w.mesh.tris) used[v] = 1;
  const orphans = used.reduce((n, u) => n + (u ? 0 : 1), 0);
  const va = w.mesh.docVertex[pa], vb = w.mesh.docVertex[pb];
  const sameGroup = w.mesh.vGroup[va] === w.mesh.vGroup[vb];
  // the slit's mesh points come in coincident pairs, one per side, with one group per pair
  let pairs = 0, pairedGroups = 0;
  for (let i = 0; i < w.mesh.nV; i++) for (let k = i + 1; k < w.mesh.nV; k++) {
    if (Math.abs(w.mesh.uv[2 * i] - 30) > 1e-9 || Math.abs(w.mesh.uv[2 * k] - 30) > 1e-9) continue;
    if (Math.abs(w.mesh.uv[2 * i + 1] - w.mesh.uv[2 * k + 1]) > 1e-9 || w.mesh.uv[2 * i + 1] >= 30 - 1e-9) continue;
    pairs++; if (w.mesh.vGroup[i] === w.mesh.vGroup[k]) pairedGroups++;
  }
  w.setControl('sequence', 1);
  let worst = 0;
  for (let f = 0; f < 120; f++) { w.step(); worst = Math.max(worst, w.stats().maxStrain); }
  const open = Math.hypot(w.x[3 * va] - w.x[3 * vb], w.x[3 * va + 1] - w.x[3 * vb + 1], w.x[3 * va + 2] - w.x[3 * vb + 2]);
  const pass = orphans === 0 && sameGroup && pairs > 0 && pairedGroups === pairs && open > 20 && worst < 0.005 && w.stats().finite;
  proof('split-cut', open, '>20 mm', 'the slit opens; no orphan vertices; copies share contact groups; stretch <0.5 %', pass,
    `${pairs} coincident slit pairs, ${pairedGroups} sharing a group, max stretch ${(worst * 100).toFixed(3)} %`);
  assert.ok(pass);
});

test('rule 4: a C edge bordering one face needs exactly one twin', () => {
  const { doc } = slitSquare();
  const lone = JSON.parse(JSON.stringify(doc));
  // move the twin's free end off the slit: it no longer has the same coordinates
  const e = lone.edges_assignment.lastIndexOf('C');
  const [a, b] = lone.edges_vertices[e];
  const v = lone.vertices_coords[a][1] === 0 ? a : b;
  lone.vertices_coords[v] = [lone.vertices_coords[v][0] + 0.5, 0];
  assert.throws(() => loadDocument(lone), /rule 4: C edge \d+ borders 1 face and has no split-cut twin/);
  assert.doesNotThrow(() => loadDocument(slitSquare({ split: false }).doc), 'an unsplit cut still loads (the engine splits it)');
});
