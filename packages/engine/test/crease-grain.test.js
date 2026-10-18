// @ts-check
// A crease bends the paper across it, so its stiffness follows D(φ) of that bending direction
// (Lechenault et al. 2014: κ = D/L*): folding along the grain is easier than folding across it, by
// the stock card's D_md / D_cd. The stock's crease_k is the geometric mean √(D_md·D_cd)/L*.
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { fromDerived, creaseGrainFactor } from '../src/material.js';
import { DocBuilder, STOCKS } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/**
 * A 25 mm strip clamped over `platform` mm (pinned F lines, as the cantilever bench) whose last clamp
 * line is a crease; a `flap` mm flap hangs from it under its own weight. The strip runs along sheet v;
 * grain 90 puts MD along the strip (the crease runs across the grain), grain 0 along the crease.
 * @param {number} grain @param {string} stock
 */
function creasedFlap(grain, stock = 'copy-80', platform = 12, flap = 40, width = 25) {
  const b = new DocBuilder('creased flap');
  const s = b.sheet({ id: 'strip', stock, grain, width, height: platform + flap, placement: { origin: [0, 200, 0], rotation: [0, 0, 0, 1] } });
  const st = [0, 3, 6, 9, platform, platform + flap];
  const lo = st.map((a) => b.vertex(s, 0, a)), hi = st.map((a) => b.vertex(s, width, a));
  for (let i = 0; i + 1 < st.length; i++) b.face([lo[i], hi[i], hi[i + 1], lo[i + 1]]);
  for (let i = 1; i < st.length - 2; i++) b.assign(lo[i], hi[i], 'F', 0, 'none');
  const crease = b.assign(lo[st.length - 2], hi[st.length - 2], 'V', 0, 'crease');
  for (let i = 0; i < st.length - 1; i++) b.joins.push({ id: `clamp-${i}`, type: 'pin', a: { sheet: 'strip', along: [[0, st[i]], [width, st[i]]] }, world: null });
  return { doc: b.build(), crease };
}

/** Mean dihedral (degrees) of the hinges on document edge e. @param {World} w @param {number} e */
function creaseAngle(w, e) {
  let a = 0, n = 0;
  for (let h = 0; h < w.mesh.nH; h++) if (w.mesh.hingeDoc[h] === e) { a += w.theta[h]; n++; }
  return (a / n) * 180 / Math.PI;
}

test('crease-grain: the crease stiffness factor is D(φ)/√(D11·D22) (stock card and laminate)', () => {
  for (const name of ['copy-80', 'cardstock-250']) {
    const m = fromDerived(/** @type {any} */ (STOCKS)[name].derived);
    const across = creaseGrainFactor(m, 0), along = creaseGrainFactor(m, Math.PI / 2);
    const want = m.D11 / m.D22;
    const pass = Math.abs(across / along - want) < 1e-9 * want && Math.abs(across * along - 1) < 1e-9;
    proof(`crease-grain-factor ${name}`, across / along, want, 'exact', pass, `across ${across.toFixed(4)}, along ${along.toFixed(4)}`);
    assert.ok(pass);
  }
  // a laminate (spec §5.40) uses its free stack's D11/D22 the same way; isotropic stock gives 1
  const cloth = fromDerived({ areal_density: 0.00026, thickness: 0.51, E_md: 328650000, E_cd: 155206000, nu: 0.244893,
    D_md: 5640490, D_cd: 2650560, crease_k: 37907.7, crease_yield_deg: 35, crease_set_rate: 0.5, score_factor: 0.35, perf_factor: 0.25,
    tear_strain: 0.03, friction: 0.4, collision_thickness: 0.51, G12: 34339500, score_yield_deg: 12.25, D12: 958700, D66: 574058 });
  assert.ok(Math.abs(creaseGrainFactor(cloth, 0) / creaseGrainFactor(cloth, Math.PI / 2) - 5640490 / 2650560) < 1e-9);
  const iso = fromDerived({ ...STOCKS['copy-80'].derived, E_cd: STOCKS['copy-80'].derived.E_md, D_cd: STOCKS['copy-80'].derived.D_md });
  assert.ok(Math.abs(creaseGrainFactor(iso, 0.7) - 1) < 1e-3, `isotropic stock: ${creaseGrainFactor(iso, 0.7)}`);
});

test('crease-grain: a flap hangs further from a crease along the grain than across it, by D_md/D_cd', () => {
  const sag = (/** @type {number} */ grain) => {
    const { doc, crease } = creasedFlap(grain);
    const w = new World(doc, { meshEdge: 4, substeps: 20, contact: false, ground: false, damping: 8 });
    for (let f = 0; f < 240; f++) w.step();
    assert.ok(w.stats().finite);
    return Math.abs(creaseAngle(w, crease));
  };
  const across = sag(90), along = sag(0);
  const d = STOCKS['copy-80'].derived;
  const want = d.D_md / d.D_cd;
  const ratio = along / across;
  const pass = Math.abs(ratio - want) / want < 0.1;
  proof('crease-grain-sag', ratio, want, '±10 %', pass, `crease sag ${along.toFixed(3)}° along the grain, ${across.toFixed(3)}° across it`);
  assert.ok(pass);
});
