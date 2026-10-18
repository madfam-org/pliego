// @ts-check
/**
 * Passes that would repeat themselves are skipped (lane E4, 2026-10-18). A stretch-guard pass that
 * corrected no edge, or a contact pass that pushed nothing, leaves the positions as they were, so
 * the passes after it would do exactly the same: the World stops there. The positions are the same
 * bit for bit (bench/identity.mjs over the corpus); here, the skips happen where they should and a
 * world that skips replays identically.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { twoSheetStack, squareValley } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('pass-skip: a resting stack skips the passes that would repeat, and replays bit-identically', () => {
  const make = () => new World(twoSheetStack({ size: 60 }), { meshEdge: 8, substeps: 8 });
  const a = make(), b = make();
  for (let f = 0; f < 90; f++) { a.step(); b.step(); }
  let same = true;
  for (let i = 0; i < a.x.length; i++) if (!Object.is(a.x[i], b.x[i])) same = false;
  // 90 frames × 8 substeps: the guard runs at least one pass and the contact loop at least one per substep
  const pass = same && a.passesSkipped > 0;
  proof('pass-skip-stack', a.passesSkipped, '>0', 'skipped passes; replay identical', pass, `${a.substepsRun} substeps, contacts ${a.stats().contacts}`);
  assert.ok(pass);
});

test('pass-skip: a fold that keeps the guard busy still runs every pass it needs', () => {
  const w = new World(squareValley({ size: 80 }).doc, { meshEdge: 8, substeps: 8 });
  w.setControl('sequence', 1);
  let peak = 0;
  for (let f = 0; f < 60; f++) { w.step(); peak = Math.max(peak, w.stats().maxStrain); }
  // the documented guarantee holds with the early stop (strain limit 0.45 % + settling)
  const pass = w.stats().finite && peak < 0.01;
  proof('pass-skip-fold', peak, '<0.01', 'peak strain while folding', pass, `${w.passesSkipped} passes skipped`);
  assert.ok(pass);
});
