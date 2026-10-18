// @ts-check
// Spec §5.40: a laminate stock's derived block carries the free stack's D12 and D66
// (pliego.laminate v1); the engine reads them in place of the single-sheet plate relations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { fromDerived } from '../src/material.js';
import { cantilever, STOCKS } from './helpers/docbuilder.js';

// pliego.laminate.stock([kraft-120, fashion-cabinet/manta-cruda]) at this commit (case cloth).
const CLOTH = {
  areal_density: 0.00026, thickness: 0.51, E_md: 328650000, E_cd: 155206000, nu: 0.244893,
  D_md: 5640490, D_cd: 2650560, crease_k: 37907.7, crease_yield_deg: 35, crease_set_rate: 0.5,
  score_factor: 0.35, perf_factor: 0.25, tear_strain: 0.03, friction: 0.4, collision_thickness: 0.51,
  G12: 34339500, score_yield_deg: 12.25, D12: 958700, D66: 574058,
};

test('laminate: the material reads the stack D12 / D66; a single sheet keeps the plate relations', () => {
  const m = fromDerived(CLOTH);
  assert.equal(m.D11, CLOTH.D_md);
  assert.equal(m.D22, CLOTH.D_cd);
  assert.equal(m.D12, CLOTH.D12);
  assert.equal(m.D66, CLOTH.D66);
  /** @type {Record<string, number>} */ const single = { ...CLOTH };
  delete single.D12;
  delete single.D66;
  const p = fromDerived(single);
  assert.ok(Math.abs(p.D12 - single.nu * Math.sqrt(single.D_md * single.D_cd)) < 1e-6 * p.D12);
  assert.ok(Math.abs(p.D66 - (single.G12 * 0.51 ** 3) / 12) < 1e-6 * p.D66);
  assert.notEqual(p.D66, m.D66);
});

test('laminate: a cloth-on-kraft strip loads, stays finite and droops', () => {
  /** @type {any} */ (STOCKS)['case-cloth'] = {
    name: { en: 'Case cloth', es: 'Tela de encuadernar', fr: 'Toile de reliure', pt: 'Tecido de encadernação' },
    gsm: 260, caliper_mm: 0.51, derived: CLOTH, derived_basis: 'pliego.laminate v1',
  };
  try {
    const { doc } = cantilever({ length: 120, width: 25, stock: 'case-cloth', spacing: 5 });
    const w = new World(doc, { meshEdge: 6, contact: false, ground: false, damping: 8 });
    for (let f = 0; f < 120; f++) w.step();
    const s = w.stats();
    assert.ok(s.finite, 'the laminate strip stays finite');
    let tip = 0, n = 0;
    for (let v = 0; v < w.mesh.nV; v++) {
      if (Math.abs(w.mesh.uv[2 * v + 1] - 132) < 1e-6) { tip += 200 - w.x[3 * v + 1]; n++; }
    }
    assert.ok(n > 0 && tip / n > 0, 'the free end droops under its own weight');
  } finally {
    delete /** @type {any} */ (STOCKS)['case-cloth'];
  }
});
