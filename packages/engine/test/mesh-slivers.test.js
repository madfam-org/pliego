// @ts-check
// Sliver triangles (engine.md §2): plain-paper lines are not mesh constraints, no split point sits
// within h/4 of another line, and creases, cuts and the outline stay exact mesh edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMesh, loadDocument } from '../src/index.js';
import { DocBuilder } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** Shortest mesh edge that is not a piece of a document edge shorter than h/4, and the thinnest triangle. @param {any} m @param {any} doc */
function quality(m, doc) {
  let shortest = Infinity, thinnest = Infinity;
  for (let e = 0; e < m.nE; e++) {
    const d = m.edgeDoc[e];
    if (d >= 0) {
      const a = doc.edges[2 * d], b = doc.edges[2 * d + 1];
      if (Math.hypot(doc.coords[2 * a] - doc.coords[2 * b], doc.coords[2 * a + 1] - doc.coords[2 * b + 1]) < m.h / 4) continue;
    }
    shortest = Math.min(shortest, m.edgeLen[e]);
  }
  for (let t = 0; t < m.nT; t++) {
    let L = 0;
    for (let i = 0; i < 3; i++) {
      const a = m.tris[3 * t + i], b = m.tris[3 * t + ((i + 1) % 3)];
      L = Math.max(L, Math.hypot(m.uv[2 * a] - m.uv[2 * b], m.uv[2 * a + 1] - m.uv[2 * b + 1]));
    }
    thinnest = Math.min(thinnest, (2 * m.triArea[t]) / L);
  }
  return { shortest, thinnest };
}

/**
 * Creases stay exact: each crease is a chain of mesh edges along it, of its full length. The outline
 * stays exact: the mesh boundary has the outline's length and every boundary mesh edge lies on an
 * outline edge of the document (its two ends within 1e-9 mm of that edge's line segment).
 * @param {any} m @param {any} doc
 */
function exactLines(m, doc) {
  const C = doc.coords, len = new Float64Array(doc.nE);
  for (let e = 0; e < m.nE; e++) { const d = m.edgeDoc[e]; if (d >= 0) len[d] += m.edgeLen[e]; }
  const L = (/** @type {number} */ d) => Math.hypot(C[2 * doc.edges[2 * d]] - C[2 * doc.edges[2 * d + 1]], C[2 * doc.edges[2 * d] + 1] - C[2 * doc.edges[2 * d + 1] + 1]);
  let creases = 0, outline = 0, boundary = 0;
  for (let d = 0; d < doc.nE; d++) {
    if (doc.treatment[d] === 'crease') { if (Math.abs(len[d] - L(d)) > 1e-6 * L(d)) return { ok: false, why: `crease ${d}: ${len[d]} of ${L(d)} mm` }; creases++; }
    if (doc.assignment[d] === 'B') outline += L(d);
  }
  const [ox, oy] = doc.sheets[0].offset;
  const onOutline = (/** @type {number} */ v) => {
    for (let d = 0; d < doc.nE; d++) {
      if (doc.assignment[d] !== 'B') continue;
      const a = doc.edges[2 * d], b = doc.edges[2 * d + 1];
      const ax = C[2 * a] - ox, ay = C[2 * a + 1] - oy, dx = C[2 * b] - ox - ax, dy = C[2 * b + 1] - oy - ay;
      const t = Math.max(0, Math.min(1, ((m.uv[2 * v] - ax) * dx + (m.uv[2 * v + 1] - ay) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(ax + t * dx - m.uv[2 * v], ay + t * dy - m.uv[2 * v + 1]) <= 1e-9) return true;
    }
    return false;
  };
  for (let e = 0; e < m.nE; e++) {
    if (m.edgeTris[2 * e + 1] >= 0) continue;
    boundary += m.edgeLen[e];
    if (!onOutline(m.edges[2 * e]) || !onOutline(m.edges[2 * e + 1])) return { ok: false, why: `boundary mesh edge ${e} leaves the outline` };
  }
  if (Math.abs(boundary - outline) > 1e-6 * outline) return { ok: false, why: `boundary ${boundary} vs outline ${outline} mm` };
  return { ok: true, why: `${creases} creases exact, outline ${outline.toFixed(1)} mm exact` };
}

test('mesh-slivers: a kiss cut beside a crease is not a mesh constraint; the crease and the outline stay exact', () => {
  // 120 × 80 card, valley crease at v = 40, kiss-cut sticker line 1.5 mm beside it (F / halfcut)
  const b = new DocBuilder('kiss cut beside a crease');
  const s = b.sheet({ id: 'card', width: 120, height: 80 });
  const P = [[0, 0], [120, 0], [120, 40], [120, 41.5], [120, 80], [0, 80], [0, 41.5], [0, 40]].map(([u, v]) => b.vertex(s, u, v));
  b.face([P[0], P[1], P[2], P[7]]);
  b.face([P[7], P[2], P[3], P[6]]);
  b.face([P[6], P[3], P[4], P[5]]);
  const crease = b.assign(P[7], P[2], 'V', 90);
  const kiss = b.assign(P[6], P[3], 'F', 0, 'halfcut');
  b.control({ id: 'sequence', kind: 'sequence', min: 0, max: 1, default: 0 });
  b.sequence = { mode: 'physical', steps: [{ id: 'fold', label: { en: 'Fold', es: 'Doblar', fr: 'Plier', pt: 'Dobrar' }, duration_ms: 1000, targets: [[crease, 90]], release: [], note: null }] };
  const doc = loadDocument(b.build());
  const m = buildMesh(doc, { meshEdge: 8 });
  const q = quality(m, doc);
  const lines = exactLines(m, doc);
  let onKiss = 0;
  for (let e = 0; e < m.nE; e++) if (m.edgeDoc[e] === kiss) onKiss++;
  const pass = q.shortest >= m.h / 4 && q.thinnest >= m.h / 4 && lines.ok && onKiss === 0;
  proof('mesh-slivers-kiss-cut', q.thinnest, `≥ h/4 = ${m.h / 4}`, 'thinnest triangle; shortest edge ≥ h/4; crease and outline exact', pass,
    `shortest edge ${q.shortest.toFixed(3)} mm, ${lines.why}, ${onKiss} mesh edges on the kiss cut, V=${m.nV}`);
  assert.ok(pass);
});

test('mesh-slivers: two creases leaving a corner at a shallow angle share no split points closer than h/4', () => {
  // 100 mm square; valley creases from (0,0) to (100,25) and (100,40) (8.5° apart), outline exact
  const b = new DocBuilder('shallow crease fan');
  const s = b.sheet({ id: 'sq', width: 100, height: 100 });
  const P = [[0, 0], [100, 0], [100, 25], [100, 40], [100, 100], [0, 100]].map(([u, v]) => b.vertex(s, u, v));
  b.face([P[0], P[1], P[2]]);
  b.face([P[0], P[2], P[3]]);
  b.face([P[0], P[3], P[4], P[5]]);
  const c1 = b.assign(P[0], P[2], 'V', 20);
  const c2 = b.assign(P[0], P[3], 'M', -20);
  const doc = loadDocument(b.build());
  const m = buildMesh(doc, { meshEdge: 8 });
  // split points (mesh vertices on a crease, not its ends) closer than h/4 to a point of the other crease
  const on = (/** @type {number} */ d) => { const set = new Set(); for (let e = 0; e < m.nE; e++) if (m.edgeDoc[e] === d) { set.add(m.edges[2 * e]); set.add(m.edges[2 * e + 1]); } return set; };
  const A = on(c1), B = on(c2);
  const corner = m.docVertex[0];
  let closest = Infinity;
  for (const a of A) for (const c of B) {
    if (a === corner || c === corner) continue;
    closest = Math.min(closest, Math.hypot(m.uv[2 * a] - m.uv[2 * c], m.uv[2 * a + 1] - m.uv[2 * c + 1]));
  }
  const lines = exactLines(m, doc);
  const pass = closest >= m.h / 4 && lines.ok;
  proof('mesh-slivers-crease-fan', closest, `≥ h/4 = ${m.h / 4}`, 'closest points of the two creases (corner excluded); creases exact', pass, `${A.size} + ${B.size} crease vertices, ${lines.why}`);
  assert.ok(pass);
});
