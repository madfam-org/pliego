// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { cantilever, twoSheetStack, DocBuilder, STOCKS } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('board: 4 mm corrugated-like stock — orthotropic cantilever, scored flap, stack gap = caliper', () => {
  const d = STOCKS['board-c'].derived;
  const q = d.areal_density * 9810;
  const drops = [];
  for (const alongU of [false, true]) {
    const { doc } = cantilever({ length: 300, width: 100, stock: 'board-c', alongU, spacing: 5 });
    const w = new World(doc, { meshEdge: 10, contact: false, ground: false, damping: 8 });
    for (let f = 0; f < 240; f++) w.step();
    let tip = 0, n = 0;
    for (let v = 0; v < w.mesh.nV; v++) { const a = alongU ? w.mesh.uv[2 * v] : w.mesh.uv[2 * v + 1]; if (Math.abs(a - 312) < 1e-6) { tip += 200 - w.x[3 * v + 1]; n++; } }
    drops.push({ drop: tip / n, theory: (q * 300 ** 4) / (8 * (alongU ? d.D_cd : d.D_md)), finite: w.stats().finite });
  }
  const b = new DocBuilder('box flap');
  const s = b.sheet({ id: 'panel', stock: 'board-c', width: 200, height: 160 });
  const v = (/** @type {number} */ u, /** @type {number} */ w) => b.vertex(s, u, w);
  const a0 = v(0, 0), a1 = v(200, 0), a2 = v(200, 100), a3 = v(0, 100), a4 = v(200, 160), a5 = v(0, 160);
  b.face([a0, a1, a2, a3]); b.face([a3, a2, a4, a5]);
  const crease = b.assign(a3, a2, 'V', 90, 'score');
  b.joins.push({ id: 'hold', type: 'pin', a: { sheet: 'panel', along: [[0, 0], [200, 0]] }, world: null });
  b.joins.push({ id: 'hold-2', type: 'pin', a: { sheet: 'panel', along: [[0, 50], [200, 50]] }, world: null });
  b.control({ id: 'sequence', kind: 'sequence', min: 0, max: 1, default: 0 });
  b.sequence = { mode: 'physical', steps: [{ id: 'fold', label: { en: 'Fold the flap' }, duration_ms: 1500, targets: [[crease, 90]], release: [], note: null }] };
  const fw = new World(b.build(), { meshEdge: 10, ground: false });
  fw.setControl('sequence', 1);
  for (let f = 0; f < 120; f++) fw.step();
  let sum = 0, n = 0;
  for (let h = 0; h < fw.mesh.nH; h++) if (fw.mesh.hingeDoc[h] === crease) { sum += fw.theta[h]; n++; }
  const flap = (sum / n) * 180 / Math.PI;
  const sw = new World(twoSheetStack({ size: 120, gap: 12, height: 30, stock: 'board-c' }), { meshEdge: 10 });
  for (let f = 0; f < 120; f++) sw.step();
  let lower = -Infinity, upper = Infinity;
  for (let i = 0; i < sw.mesh.nV; i++) { const y = sw.x[3 * i + 1]; if (sw.mesh.vSheet[i] === 0) lower = Math.max(lower, y); else upper = Math.min(upper, y); }
  const gap = upper - lower;
  const ratio = drops[1].drop / drops[0].drop, ratioT = d.D_md / d.D_cd;
  const pass = drops.every((x) => x.finite && Math.abs(x.drop / x.theory - 1) < 0.08) && Math.abs(flap - 90) < 2 && gap >= 0.9 * d.collision_thickness && sw.stats().finite;
  proof('board-orthotropy', ratio, ratioT, '±10% (CD/MD drop ratio)', Math.abs(ratio / ratioT - 1) < 0.1, `MD ${drops[0].drop.toFixed(3)} vs ${drops[0].theory.toFixed(3)} mm, CD ${drops[1].drop.toFixed(3)} vs ${drops[1].theory.toFixed(3)} mm`);
  proof('board-scored-flap', flap, 90, '±2°', Math.abs(flap - 90) < 2);
  proof('board-stack-gap', gap, d.collision_thickness, '≥0.9·caliper', gap >= 0.9 * d.collision_thickness);
  assert.ok(pass);
});
