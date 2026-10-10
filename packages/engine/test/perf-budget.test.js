// @ts-check
import test from 'node:test';
import { World } from '../src/index.js';
import { foldingSquare } from './helpers/docbuilder.js';
import { proof } from './helpers/bench.js';

test('perf-budget: ~1500-vertex creased sheet, S = 20 (report, do not fail)', () => {
  for (const [S, h] of [[20, 5.4], [8, 5.4], [20, 9]]) {
    const w = new World(foldingSquare({ size: 200 }).doc, { meshEdge: h, substeps: S, gravity: false });
    const nV = w.mesh.nV;
    for (let f = 0; f < 5; f++) w.step(); // warm up the JIT
    let t0 = performance.now();
    for (let f = 0; f < 30; f++) w.step();
    const idle = (performance.now() - t0) / 30; // asleep after settling (deterministic sleep)
    w.setControl('sequence', 1);
    const f0 = w.factorCount;
    t0 = performance.now();
    for (let f = 0; f < 12; f++) w.step();
    const moving = (performance.now() - t0) / 12;
    const facts = (w.factorCount - f0) / 12;
    proof(`perf-budget-S${S}-h${h}`, `${idle.toFixed(1)} ms/frame at rest, ${moving.toFixed(1)} ms/frame folding`, '<8 ms', 'report only', idle < 8 && moving < 8, `V=${nV}, ${facts.toFixed(1)} refactorisations/frame while folding, Node ${process.version}`);
  }
});
