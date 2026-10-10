// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { hangingSheet, pageLeaf } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('inextensible: hanging A5 pinned at two corners, then a page turn — stretch < 0.5 % every frame', () => {
  const w = new World(hangingSheet(), { meshEdge: 6, contact: false, ground: false });
  let worst = 0, worstC = 0;
  for (let f = 0; f < 240; f++) { w.step(); const s = w.stats(); worst = Math.max(worst, s.maxStrain); worstC = Math.max(worstC, s.maxCompression); assert.ok(s.finite); }
  const p = new World(pageLeaf(), { meshEdge: 6 });
  p.setControl('turn', 180);
  let worstP = 0, worstPC = 0;
  for (let f = 0; f < 150; f++) { p.step(); const s = p.stats(); worstP = Math.max(worstP, s.maxStrain); worstPC = Math.max(worstPC, s.maxCompression); assert.ok(s.finite); }
  const pass = worst < 0.005 && worstP < 0.005;
  proof('inextensible-hanging', worst, 0.005, '<0.5% stretch every frame', worst < 0.005, `max compression ${(worstC * 100).toFixed(3)}%, 4 s`);
  proof('inextensible-pageturn', worstP, 0.005, '<0.5% stretch every frame', worstP < 0.005, `max compression ${(worstPC * 100).toFixed(3)}%, turn 0→180° over 2.5 s`);
  assert.ok(pass);
});
