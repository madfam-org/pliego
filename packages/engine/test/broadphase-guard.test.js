// @ts-check
/**
 * Contact broad phase on a diverged world (sim readiness, lane S). When a simulation blows up, one
 * triangle can span kilometres; the spatial hash then tried to register it in billions of cells and
 * the step died with "RangeError: Invalid typed array length" (commons paper-weaving `heart`), which
 * hid the real failure. The grid now coarsens so no triangle spans more than about four cells.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { twoSheetStack } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('a triangle blown up to kilometres does not abort the broad phase', () => {
  const w = new World(twoSheetStack(), { meshEdge: 6, substeps: 8 });
  const sane = Float64Array.from(w.x);
  w.contact.broadPhase(sane, w.fixed, 10);
  const pairs = w.contact.nPairs;
  const x = Float64Array.from(w.x);
  x[0] += 5e6; x[1] -= 3e6; x[2] += 4e6;   // one vertex 7 km away
  const t0 = performance.now();
  w.contact.broadPhase(x, w.fixed, 10);
  const ms = performance.now() - t0;
  // the sane layout keeps its exact candidate list (the guard does not trigger there)
  w.contact.broadPhase(sane, w.fixed, 10);
  const pass = ms < 5000 && w.contact.nPairs === pairs;
  proof('broadphase-guard', ms, '<5000 ms', 'no RangeError with a 7 km triangle; sane candidates unchanged', pass, `${ms.toFixed(1)} ms, ${pairs} pairs on the sane layout`);
  assert.ok(pass);
});
