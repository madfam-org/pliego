// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument, World } from '../src/index.js';
import { LoopClosure } from '../src/kinematics/facetree.js';
import { degree4 as closed } from '../src/kinematics/closedform.js';
import { degree4, withInitialPose } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

const D = Math.PI / 180;

/** Sector angles of the built document (after 1e-6 mm rounding), radians. */
function sectors(doc, L) {
  const loop = L.loops[0];
  const ang = loop.dirs.map((/** @type {number[]} */ d) => Math.atan2(-d[2], d[0]));
  // loop is sorted CCW; crease order in the fixture starts at creases[0]
  return ang;
}

test('E5-degree4 Tier R: closed forms and loop-closure tracking (α = 70, 80, 110, 100°)', () => {
  const m1 = closed(70 * D, 80 * D, 1, 90 * D), m2 = closed(70 * D, 80 * D, 2, 90 * D);
  const p1 = Math.abs(Math.abs(m1[1]) / D - 29.13) < 0.005, p2 = Math.abs(Math.abs(m2[0]) / D - 10.31) < 0.005;
  proof('E5-degree4-closed-mode1', Math.abs(m1[1]) / D, 29.13, '±0.005° (2-decimal oracle)', p1);
  proof('E5-degree4-closed-mode2', Math.abs(m2[0]) / D, 10.31, '±0.005° (2-decimal oracle)', p2);
  const { doc: json, creases } = degree4();
  const doc = loadDocument(json);
  const L = new LoopClosure(doc, 0);
  // the built geometry's own sector angles (coordinates are rounded to 1e-6 mm)
  const order = L.loops[0].edges;
  const k0 = order.indexOf(creases[0]);
  const ang = sectors(doc, L);
  const a = (/** @type {number} */ i) => ((ang[(k0 + i + 1) % 4] - ang[(k0 + i) % 4] + 4 * Math.PI) % (2 * Math.PI));
  const a1 = a(0), a2 = a(1);
  let worst = 0;
  for (const mode of /** @type {(1|2)[]} */ ([1, 2])) {
    const seed = closed(a1, a2, mode, 2 * D);
    const rho = new Float64Array(doc.nE);
    creases.forEach((e, i) => { rho[e] = seed[i]; });
    const driven = mode === 1 ? creases[0] : creases[1];
    const tr = L.track(rho, driven, 90 * D, 45);
    const ref = closed(a1, a2, mode, 90 * D);
    creases.forEach((e, i) => { worst = Math.max(worst, Math.abs(tr.rho[e] - ref[i]) / D); });
    assert.ok(tr.worstResidual < 1e-10);
    assert.equal(L.dof(tr.rho), 1);
  }
  const pass = worst < 1e-6;
  proof('E5-degree4-tierR', worst, 0, '<1e-6° vs closed form', pass, `DOF=1, loop residual <1e-10`);
  assert.ok(p1 && p2 && pass);
});

test('E5-degree4 Tier C: stiff panels follow mode 1 within 0.5°', async () => {
  const { doc: json0, creases } = degree4();
  const init = new Map(creases.map((e, i) => [e, closed(70 * D, 80 * D, 1, 10 * D)[i] / D]));
  const json = await withInitialPose(json0, init);
  json['pliego:controls'] = [{ id: 'sequence', kind: 'sequence', label: { en: 'step' }, min: 0, max: 1, default: 0 }];
  json['pliego:sequence'] = { mode: 'physical', steps: [{ id: 'drive', label: { en: 'drive' }, duration_ms: 2000, targets: [[creases[0], 90]], release: [], note: null }] };
  const w = new World(json, { meshEdge: 10, gravity: false, ground: false, contact: false, panelStiffness: 1e4, plasticity: false });
  w.setControl('sequence', 1);
  for (let f = 0; f < 180; f++) w.step();
  const ang = (/** @type {number} */ e) => { let s = 0, n = 0; for (let h = 0; h < w.mesh.nH; h++) if (w.mesh.hingeDoc[h] === e) { s += w.theta[h]; n++; } return s / n; };
  const r1 = ang(creases[0]), r2 = ang(creases[1]);
  const ref = closed(70 * D, 80 * D, 1, r1);
  const err = Math.abs(r2 - ref[1]) / D;
  const pass = err < 0.5 && r1 / D > 80; // the hand drive lags the 90° target against the three free creases' stiffness
  proof('E5-degree4-tierC', Math.abs(r2) / D, Math.abs(ref[1]) / D, '±0.5°', pass, `ρ1=${(r1 / D).toFixed(3)}° (drive target 90°, free creases resist), closed form at the measured ρ1, panels ×1e4`);
  assert.ok(pass);
});
