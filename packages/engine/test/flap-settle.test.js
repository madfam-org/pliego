// @ts-check
// Bending damping (constants.js BEND_DAMPING): a hanging flap rings down like paper, not like a
// spring, and its resting pose does not move. A 100 mm copy-paper flap released flat at the studio's
// settings (h = 8 mm, S = 8) swings about 4.4 Hz (f₁ = 0.56·√(D/(ρ_A·L⁴)) for D_md = 5.0e-4 N·m).
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { cantilever } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

/** @param {number|undefined} bendDamping */
function releaseFlap(bendDamping) {
  const { doc } = cantilever({ length: 100, width: 25, stock: 'copy-80', spacing: 3 });
  /** @type {any} */ const o = { meshEdge: 8, substeps: 8, contact: false, ground: false };
  if (bendDamping !== undefined) o.bendDamping = bendDamping;
  const w = new World(doc, o);
  const tip = [];
  for (let i = 0; i < w.mesh.nV; i++) if (Math.abs(w.mesh.uv[2 * i + 1] - 112) < 1e-6) tip.push(i);
  const ys = [];
  let asleepAt = -1;
  for (let f = 0; f < 600; f++) {
    w.step();
    let y = 0;
    for (const v of tip) y += w.x[3 * v + 1] / tip.length;
    ys.push(y);
    if (asleepAt < 0 && w.stats().asleep) asleepAt = f;
  }
  const end = ys[ys.length - 1];
  let settle = 0;
  for (let f = ys.length - 1; f >= 0; f--) if (Math.abs(ys[f] - end) > 0.5) { settle = (f + 1) / 60; break; }
  let swings = 0;
  for (let f = 1; f + 1 < ys.length; f++) if ((ys[f] - ys[f - 1]) * (ys[f + 1] - ys[f]) < 0 && Math.abs(ys[f] - end) > 0.5) swings++;
  return { drop: 200 - end, settle, swings, asleepAt, finite: w.stats().finite };
}

test('flap-settle: a released copy-paper flap settles at least 10 % sooner with bending damping; its rest pose is unchanged', () => {
  const damped = releaseFlap(undefined), free = releaseFlap(0);
  const pass = damped.finite && damped.settle <= 0.9 * free.settle && Math.abs(damped.drop - free.drop) <= 1e-3 * free.drop;
  proof('flap-settle', damped.settle, `≤ 0.9 × ${free.settle.toFixed(2)} s`, 'settled to ±0.5 mm; rest drop within 0.1 %', pass,
    `drop ${damped.drop.toFixed(3)} mm (undamped ${free.drop.toFixed(3)}), swings over 0.5 mm ${damped.swings} (undamped ${free.swings}), undamped settles at ${free.settle.toFixed(2)} s, asleep at frame ${damped.asleepAt} (undamped ${free.asleepAt})`);
  assert.ok(pass);
});
