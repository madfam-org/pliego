// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { World, loadDocument } from '../src/index.js';
import { HAND_EASE_MIN } from '../src/constants.js';
import { proof } from './helpers/bench.js';

const kernelDoc = (/** @type {string} */ name) => JSON.parse(readFileSync(new URL(`./fixtures/kernel/${name}.fold`, import.meta.url), 'utf8'));

/** Play a document's fold program at real time; peak stretch and the lowest hand scale. @param {any} json @param {number} extra s */
function play(json, extra) {
  const doc = loadDocument(json);
  const w = new World(doc, { meshEdge: 8.5, substeps: 8 });
  const total = doc.sequence.steps.reduce((/** @type {number} */ a, /** @type {any} */ s) => a + s.duration_ms, 0) / 1000;
  w.setControl('sequence', doc.sequence.steps.length);
  let peak = 0, low = 1;
  for (let f = 0; f < Math.round((total + extra) * 60); f++) { w.step(); peak = Math.max(peak, w.stats().maxStrain); low = Math.min(low, w.handScale); assert.ok(w.stats().finite); }
  return { peak, low, end: w.handScale };
}

test('hand-ease: a hand forcing a twist fold eases instead of stretching the paper, then firms up', () => {
  const r = play(kernelDoc('hexagonal-twist-steep'), 2);
  proof('hand-ease-twist', r.peak, '<5%', 'peak stretch, triangle twist (steep), whole program', r.peak < 0.05, `hand eased to ${r.low}, ends at ${r.end}; 26 % peak with a fixed hand (sim matrix before)`);
  assert.ok(r.low < 1 && r.low >= HAND_EASE_MIN, `the hand eased (${r.low})`);
  assert.ok(r.peak < 0.05, `peak stretch ${r.peak}`);
  assert.equal(r.end, 1, 'the hand is back to full stiffness once the paper settles');
});
