// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument, buildMesh, HINGE_CREASE } from '../src/index.js';
import * as F from './helpers/docbuilder.js';

/** Square 100 mm with a slit cut up from the bottom edge to (50, 60) and a J edge on to the top. */
export function slitSquare() {
  const b = new F.DocBuilder('slit square');
  const s = b.sheet({ id: 'slit', width: 100, height: 100 });
  const v = (/** @type {number} */ u, /** @type {number} */ w) => b.vertex(s, u, w);
  const p00 = v(0, 0), p50 = v(50, 0), p100 = v(100, 0), q100 = v(100, 100), q50 = v(50, 100), q0 = v(0, 100), tip = v(50, 60);
  b.face([p00, p50, tip, q50, q0]);
  b.face([p50, p100, q100, q50, tip]);
  b.assign(p50, tip, 'C', 0, 'cut');
  b.assign(tip, q50, 'J', 0, 'none');
  return b.build();
}

test('mesh: crease lines stay exact mesh edges and both faces conform along them', () => {
  const { doc: d, crease } = F.squareValley({ size: 100 });
  const doc = loadDocument(d);
  const m = buildMesh(doc, { meshEdge: 6 });
  let len = 0, n = 0;
  for (let e = 0; e < m.nE; e++) {
    if (m.edgeDoc[e] !== crease) continue;
    const a = m.edges[2 * e], b = m.edges[2 * e + 1];
    for (const v of [a, b]) assert.ok(Math.abs(m.uv[2 * v] - m.uv[2 * v + 1]) < 1e-9, 'crease vertex off the diagonal');
    assert.ok(m.edgeTris[2 * e + 1] >= 0, 'crease edge must be interior (two triangles)');
    len += m.edgeLen[e]; n++;
  }
  assert.ok(Math.abs(len - 100 * Math.SQRT2) < 1e-9, `crease length ${len}`);
  const creaseHinges = [...m.hingeKind].filter((k) => k === HINGE_CREASE).length;
  assert.equal(creaseHinges, n);
  console.log(`mesh square-valley: h=6 V=${m.nV} T=${m.nT} crease segments=${n} crease length=${len.toFixed(6)} (exact ${(100 * Math.SQRT2).toFixed(6)})`);
});

test('mesh: cut edges duplicate vertices, cut tips keep one, no hinge spans the cut', () => {
  const doc = loadDocument(slitSquare());
  const m = buildMesh(doc, { meshEdge: 6 });
  /** @type {Map<string, number>} */
  const count = new Map();
  for (let v = 0; v < m.nV; v++) {
    if (Math.abs(m.uv[2 * v] - 50) > 1e-9) continue;
    const key = m.uv[2 * v + 1].toFixed(6);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  for (const [y, c] of count) {
    const yy = Number(y);
    if (yy < 60 - 1e-9) assert.equal(c, 2, `point (50, ${y}) on the cut must be duplicated`);
    else assert.equal(c, 1, `point (50, ${y}) at/after the tip must be single`);
  }
  for (let h = 0; h < m.nH; h++) {
    const a = m.hinges[4 * h], b = m.hinges[4 * h + 1];
    const onCut = Math.abs(m.uv[2 * a] - 50) < 1e-9 && Math.abs(m.uv[2 * b] - 50) < 1e-9 && Math.max(m.uv[2 * a + 1], m.uv[2 * b + 1]) <= 60 + 1e-9;
    assert.ok(!onCut, 'a hinge spans the cut');
  }
  const mass = m.mass.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(mass - 1e4 * 80e-6) < 1e-12);
  const dup = [...count.values()].filter((c) => c === 2).length;
  console.log(`mesh slit-square: duplicated cut points=${dup} tip copies=${count.get('60.000000')} mass=${mass.toFixed(6)} g`);
});

test('mesh: quality, lumped mass, render groups and determinism', () => {
  for (const [name, d] of /** @type {[string, any][]} */ ([['square-valley', F.squareValley().doc], ['page-leaf', F.pageLeaf()], ['two-sheet-stack', F.twoSheetStack()]])) {
    const doc = loadDocument(d);
    const h = 6;
    const m = buildMesh(doc, { meshEdge: h });
    let maxE = 0, minAng = 180;
    for (let e = 0; e < m.nE; e++) maxE = Math.max(maxE, m.edgeLen[e]);
    for (let t = 0; t < m.nT; t++) {
      const P = [0, 1, 2].map((i) => m.tris[3 * t + i]);
      for (let k = 0; k < 3; k++) {
        const p = P[k], q = P[(k + 1) % 3], r = P[(k + 2) % 3];
        const ux = m.uv[2 * q] - m.uv[2 * p], uy = m.uv[2 * q + 1] - m.uv[2 * p + 1], vx = m.uv[2 * r] - m.uv[2 * p], vy = m.uv[2 * r + 1] - m.uv[2 * p + 1];
        minAng = Math.min(minAng, (Math.atan2(Math.abs(ux * vy - uy * vx), ux * vx + uy * vy) * 180) / Math.PI);
      }
    }
    assert.ok(maxE <= 1.3 * h, `${name}: max edge ${maxE}`);
    assert.ok(minAng >= 20, `${name}: min angle ${minAng}`);
    const area = doc.faces.reduce((s, f) => s + Math.abs(f.reduce((a, v, i) => { const w = f[(i + 1) % f.length]; return a + doc.coords[2 * v] * doc.coords[2 * w + 1] - doc.coords[2 * w] * doc.coords[2 * v + 1]; }, 0)) / 2, 0);
    const massExpected = doc.faces.reduce((s, f, i) => s, 0) + area * doc.sheets[0].derived.areal_density;
    assert.ok(Math.abs(m.mass.reduce((s, x) => s + x, 0) - massExpected) < 1e-9 * massExpected + 1e-12, `${name}: lumped mass`);
    for (const u of m.render.uv) assert.ok(u >= -1e-6 && u <= 1 + 1e-6);
    const m2 = buildMesh(loadDocument(d), { meshEdge: h });
    assert.deepEqual(m2.tris, m.tris);
    assert.deepEqual(m2.uv, m.uv);
    console.log(`mesh ${name}: V=${m.nV} T=${m.nT} H=${m.nH} render=${m.render.nR} maxEdge=${(maxE / h).toFixed(3)}h minAngle=${minAng.toFixed(1)}° deterministic=yes`);
  }
  const sq = buildMesh(loadDocument(F.squareValley().doc), { meshEdge: 6 });
  assert.ok(sq.render.nR > sq.nV, 'render vertices split along the crease');
});
