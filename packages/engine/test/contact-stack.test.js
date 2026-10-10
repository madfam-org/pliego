// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { twoSheetStack } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('contact-stack: two sheets dropped onto each other and onto the ground', () => {
  const w = new World(twoSheetStack(), { meshEdge: 6 });
  const tc = Math.max(w.doc.sheets[0].derived.collision_thickness, 0.05);
  let minGap = Infinity, minGround = Infinity;
  const m = w.mesh;
  for (let f = 0; f < 150; f++) {
    w.step();
    assert.ok(w.stats().finite, 'NaN');
    if (f < 60) continue;
    // upper-sheet vertices over a lower-sheet triangle: signed gap along the triangle normal
    for (let v = 0; v < m.nV; v++) {
      if (m.vSheet[v] !== 1) continue;
      for (let t = 0; t < m.nT; t++) {
        if (m.triSheet[t] !== 0) continue;
        const a = m.tris[3 * t], b = m.tris[3 * t + 1], c = m.tris[3 * t + 2];
        const x = w.x;
        const e1 = [x[3 * b] - x[3 * a], x[3 * b + 1] - x[3 * a + 1], x[3 * b + 2] - x[3 * a + 2]];
        const e2 = [x[3 * c] - x[3 * a], x[3 * c + 1] - x[3 * a + 1], x[3 * c + 2] - x[3 * a + 2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const L = Math.hypot(...n);
        const p = [x[3 * v] - x[3 * a], x[3 * v + 1] - x[3 * a + 1], x[3 * v + 2] - x[3 * a + 2]];
        const d11 = e1[0] ** 2 + e1[1] ** 2 + e1[2] ** 2, d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2], d22 = e2[0] ** 2 + e2[1] ** 2 + e2[2] ** 2;
        const p1 = p[0] * e1[0] + p[1] * e1[1] + p[2] * e1[2], p2 = p[0] * e2[0] + p[1] * e2[1] + p[2] * e2[2];
        const den = d11 * d22 - d12 * d12, s = (d22 * p1 - d12 * p2) / den, r = (d11 * p2 - d12 * p1) / den;
        if (s < 0.05 || r < 0.05 || s + r > 0.95) continue;
        const gap = (p[0] * n[0] + p[1] * n[1] + p[2] * n[2]) / L;
        if (Math.abs(gap) < 5) minGap = Math.min(minGap, gap);
      }
    }
    for (let v = 0; v < m.nV; v++) minGround = Math.min(minGround, w.x[3 * v + 1]);
  }
  const pass = minGap >= 0.9 * tc && minGround >= 0.45 * tc;
  proof('contact-stack', minGap, `≥${(0.9 * tc).toFixed(3)}`, '≥0.9·t_c, no NaN', pass, `t_c=${tc} mm, min height over ground ${minGround.toFixed(4)} mm`);
  assert.ok(pass);
});
