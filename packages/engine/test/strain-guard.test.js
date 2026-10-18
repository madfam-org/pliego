// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { STRAIN_LIMIT, STRAIN_PASSES, STRAIN_PASSES_MAX } from '../src/constants.js';
import { hangingSheet } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('strain-guard: repeats until settled, so a large local stretch is brought back in one substep', () => {
  assert.ok(STRAIN_PASSES_MAX > STRAIN_PASSES);
  const w = new World(hangingSheet(), { meshEdge: 6, contact: false, ground: false });
  w.step();
  // pull one free vertex 3 mm sideways (about half a mesh edge): a 4-pass guard leaves the ring around it stretched
  let v = 0;
  while (w.invMass[v] === 0) v++;
  w.x[3 * v] += 3;
  w._projections();
  const s = w.stats().maxStrain;
  proof('strain-guard', s, `≤${STRAIN_LIMIT * 1.05}`, 'one projection pass after a 3 mm pull', s <= STRAIN_LIMIT * 1.05);
  assert.ok(s <= STRAIN_LIMIT * 1.05, `max strain ${s}`);
});
