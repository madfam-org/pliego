// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadDocument, World } from '../src/index.js';
import { LoopClosure } from '../src/kinematics/facetree.js';
import { vfold, degree4 as closed } from '../src/kinematics/closedform.js';
import { degree4, vfoldCard } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

const D = Math.PI / 180;

test('E9-vfold Tier R: 1 DOF, flat at 0° and 180°, piece follows the degree-4 closed form', () => {
  const alpha = 60;
  // the V-fold linkage at the gutter point: creases glue-R, centre, glue-L, gutter; sectors (α, α, π−α, π−α)
  const { doc: json, creases } = degree4({ alpha: [alpha, alpha, 180 - alpha, 180 - alpha], signs: [1, -1, 1, 1], exact: true });
  const doc = loadDocument(json);
  const L = new LoopClosure(doc, 0);
  const [glueR, centre, glueL, gutter] = creases;
  const seed = closed(alpha * D, alpha * D, 1, 2 * D); // glue-line drive, mode 1
  const rho = new Float64Array(doc.nE);
  creases.forEach((e, i) => { rho[e] = seed[i]; });
  let worst = 0, dofOk = true, state = rho;
  for (const open of [178, 150, 120, 90, 60, 30, 2]) {
    const rg = (180 - open) * D;
    const tr = L.track(state, gutter, rg, 24);
    state = tr.rho;
    const cf = vfold(alpha * D, rg);
    worst = Math.max(worst, Math.abs(state[centre] - cf.centre) / D, Math.abs(state[glueR] - cf.glue) / D, Math.abs(state[glueL] - cf.glue) / D);
    dofOk = dofOk && L.dof(state) === 1 && tr.worstResidual < 1e-10;
  }
  // flat extremes of the closed form: open card (ρ_g = 0) and closed card (ρ_g = π)
  const open0 = vfold(alpha * D, 0), closedCard = vfold(alpha * D, Math.PI - 1e-12);
  const flat = Math.max(Math.abs(open0.centre), Math.abs(open0.glue), Math.abs(Math.abs(closedCard.centre) - Math.PI), Math.abs(closedCard.glue - Math.PI)) / D;
  const pass = worst < 1e-6 && dofOk && flat < 1e-6;
  proof('E9-vfold-tierR', worst, 0, '<1e-6° (also <0.5°)', pass, `DOF=1 along 2°…178°, flat at both extremes (|Δ|=${flat.toExponential(1)}°)`);
  assert.ok(pass);
});

test('E9-vfold Tier C (integration): cardstock V piece glued on a kinematic card', async () => {
  const { doc, centre, glueR, glueL, alpha } = await vfoldCard();
  const w = new World(doc, { meshEdge: 6, gravity: false, ground: false });
  const ang = (/** @type {number} */ e) => { let s = 0, n = 0; for (let h = 0; h < w.mesh.nH; h++) if (w.mesh.hingeDoc[h] === e) { s += w.theta[h]; n++; } return s / n / D; };
  let worst = 0, maxStrain = 0;
  for (const open of [120, 90, 60, 30]) {
    w.setControl('open', open);
    for (let f = 0; f < 60; f++) w.step();
    const cf = vfold(alpha * D, (180 - open) * D);
    worst = Math.max(worst, Math.abs(ang(centre) - cf.centre / D), Math.abs(ang(glueR) - cf.glue / D), Math.abs(ang(glueL) - cf.glue / D));
    maxStrain = Math.max(maxStrain, w.stats().maxStrain);
  }
  const pass = worst < 1.5 && w.stats().finite;
  proof('E9-vfold-tierC', worst, 0, '<1.5° (integration; Tier C paper, not the 0.5° kinematic oracle)', pass, `closing 120→30°, max stretch ${(maxStrain * 100).toFixed(2)}%, crease plasticity on`);
  assert.ok(pass);
});
