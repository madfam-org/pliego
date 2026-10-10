// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument, World } from '../src/index.js';
import { LoopClosure } from '../src/kinematics/facetree.js';
import { miuraPoisson } from '../src/kinematics/closedform.js';
import { miura, withInitialPose } from './helpers/docbuilder.js';
import { miuraAngles, miuraMeasure, miuraPose } from './helpers/miura.js';
import { proof } from './helpers/bench.js';

const D = Math.PI / 180;
const CASES = [[60, 60, -0.75], [45, 45, -0.5], [60, 30, -2.25]];

test('E6-miura Tier R: in-plane Poisson ratio ν_SL = −cos²θ·tan²γ (exact to 1e-9)', () => {
  for (const [gd, td, expected] of CASES) {
    const m = miura({ gamma: gd, exact: true });
    const doc = loadDocument(m.doc);
    const g = gd * D, Z = 2 * td * D;
    const L = new LoopClosure(doc, 0);
    const rho = miuraAngles(doc, m, g, Z);
    const res = Math.max(...L.residual(rho).map(Math.abs));
    const dof = L.dof(rho);
    const f = (/** @type {number} */ z) => miuraMeasure(doc, m.grid, miuraPose(doc, m, g, z));
    const at = f(Z);
    const h = 1e-3;
    const d = (/** @type {'Sv'|'Lu'} */ k) => { const v = (/** @type {number} */ z) => Math.log(f(z)[k]); return (8 * (v(Z + h) - v(Z - h)) - (v(Z + 2 * h) - v(Z - 2 * h))) / (12 * h); };
    const nu = -d('Sv') / d('Lu');
    const pass = Math.abs(nu - expected) < 1e-9 && Math.abs(at.theta - td * D) < 1e-9 && res < 1e-10 && dof === 1;
    proof(`E6-miura-tierR(γ=${gd},θ=${td})`, nu, expected, '±1e-9', pass, `formula ${miuraPoisson(g, at.theta).toFixed(12)}, closure ${res.toExponential(1)}, DOF=${dof}`);
    assert.ok(pass);
  }
});

test('E6-miura Tier C: driven creases, stiff panels, ν within 2% of Tier R', async () => {
  for (const [gd, td] of CASES) {
    const m = miura({ gamma: gd, nx: 4, ny: 4 });
    const doc0 = loadDocument(m.doc);
    const g = gd * D;
    const Z1 = 2 * (td - 2) * D, Z2 = 2 * (td + 2) * D;
    const r1 = miuraAngles(doc0, m, g, Z1), r2 = miuraAngles(doc0, m, g, Z2);
    const crease = [...m.zig.flat(), ...m.straight.flat()];
    const json = await withInitialPose(m.doc, new Map(crease.map((e) => [e, r1[e] / D])));
    json['pliego:edges_restAngle'] = json.edges_foldAngle.map((/** @type {number} */ _, /** @type {number} */ e) => (crease.includes(e) ? r1[e] / D : 0));
    json['pliego:controls'] = [{ id: 'sequence', kind: 'sequence', label: { en: 'step' }, min: 0, max: 2, default: 0 }];
    json['pliego:sequence'] = { mode: 'physical', steps: [
      { id: 'hold', label: { en: 'hold' }, duration_ms: 500, targets: crease.map((e) => [e, r1[e] / D]), release: [], note: null },
      { id: 'fold', label: { en: 'fold' }, duration_ms: 1500, targets: crease.map((e) => [e, r2[e] / D]), release: [], note: null },
    ] };
    const w = new World(json, { meshEdge: 6, gravity: false, ground: false, contact: false, panelStiffness: 1e4, plasticity: false });
    const map = w.docVertexMap();
    const measure = () => { const X = new Float64Array(3 * w.doc.nV); for (let v = 0; v < w.doc.nV; v++) for (let c = 0; c < 3; c++) X[3 * v + c] = w.x[3 * map[v] + c]; return miuraMeasure(w.doc, m.grid, X); };
    w.setControl('sequence', 1);
    for (let f = 0; f < 60; f++) w.step();
    const a = measure();
    w.setControl('sequence', 2);
    for (let f = 0; f < 150; f++) w.step();
    const b = measure();
    const nuC = -(Math.log(b.Sv) - Math.log(a.Sv)) / (Math.log(b.Lu) - Math.log(a.Lu));
    const ra = miuraMeasure(doc0, m.grid, miuraPose(doc0, m, g, Z1)), rb = miuraMeasure(doc0, m.grid, miuraPose(doc0, m, g, Z2));
    const nuR = -(Math.log(rb.Sv) - Math.log(ra.Sv)) / (Math.log(rb.Lu) - Math.log(ra.Lu));
    const err = Math.abs(nuC - nuR) / Math.abs(nuR);
    const pass = err <= 0.02 && w.stats().finite;
    proof(`E6-miura-tierC(γ=${gd},θ=${td})`, nuC, nuR, '±2%', pass, `err ${(err * 100).toFixed(2)}%, secant over θ ${td - 2}→${td + 2}°, formula at θ ${miuraPoisson(g, td * D).toFixed(4)}`);
    assert.ok(pass);
  }
});
