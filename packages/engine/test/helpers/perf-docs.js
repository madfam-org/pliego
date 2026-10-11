// @ts-check
/**
 * Interactive-rate benchmark over generated sheet documents (backlog item 22). Each document runs
 * at the studio's interactive World options (apps/web/studio/src/physics.js `engineOptions`: mesh
 * edge from the sheet area, 8 substeps), plays its sequence to the end and moves every ranged
 * control, and reports milliseconds per 60 Hz frame while the sheet moves (mean, p95, worst),
 * refactorisations per frame and the simulation size. Generate the documents with the kernel, e.g.
 *   PYTHONPATH=packages/kernel/src PLIEGO_MATERIALS=materials python -m pliego.cartridge <dir> --out <out>
 * Usage: node packages/engine/test/helpers/perf-docs.js [--frames=N] [--accuracy] <file.fold>…
 * `--accuracy` uses the engine's own defaults (mesh ≈ span/30, 20 substeps) instead.
 * Read-proof: one `perf <file>:` line per document and a `perf: documents=N` summary.
 */
import fs from 'node:fs';
import path from 'node:path';
import { World, loadDocument } from '../../src/index.js';
import { engineOptions } from '../../../../apps/web/studio/src/physics.js';

const args = process.argv.slice(2);
const frames = Number((args.find((a) => a.startsWith('--frames=')) ?? '--frames=90').slice(9));
const accuracy = args.includes('--accuracy');
const files = args.filter((a) => !a.startsWith('--'));
if (!files.length) { console.error('usage: perf-docs.js [--frames=N] [--accuracy] <file.fold>…'); process.exit(2); }

let ran = 0;
for (const f of files) {
  const json = JSON.parse(fs.readFileSync(f, 'utf8'));
  const doc = loadDocument(json);
  const opts = accuracy ? { seed: 1 } : engineOptions(json);
  const t0 = performance.now();
  const w = new World(doc, opts);
  const build = performance.now() - t0;
  for (let k = 0; k < 3; k++) w.step(); // JIT warm-up at rest
  for (const c of doc.controls) {
    if (c.kind === 'sequence' && doc.sequence) w.setControl(c.id, doc.sequence.steps.length);
    else if (c.kind === 'wind') w.setControl(c.id, 2);
    else if (typeof c.min === 'number' && typeof c.max === 'number' && c.min !== c.max) w.setControl(c.id, c.default === c.max ? c.min : c.max);
  }
  const times = [];
  const f0 = w.factorCount;
  let maxStrain = 0;
  for (let k = 0; k < frames; k++) {
    const a = performance.now();
    w.step();
    times.push(performance.now() - a);
    maxStrain = Math.max(maxStrain, w.stats().maxStrain);
  }
  const sorted = times.slice().sort((a, b) => a - b);
  const mean = times.reduce((s, x) => s + x, 0) / times.length;
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))];
  const ch = w.sys.ch;
  ran++;
  console.log(`perf ${path.basename(f)}: V=${w.mesh.nV} free=${w.sys.nFree} nnzL=${ch ? ch.nnzL : 0} h=${opts.meshEdge ?? 'auto'} S=${w.opts.substeps} ` +
    `build=${build.toFixed(0)}ms mean=${mean.toFixed(1)} p95=${p95.toFixed(1)} worst=${sorted[sorted.length - 1].toFixed(1)} ms/frame ` +
    `refactors/frame=${((w.factorCount - f0) / frames).toFixed(2)} maxStretch=${(maxStrain * 100).toFixed(3)}% finite=${w.stats().finite}`);
}
console.log(`perf: documents=${ran} frames=${frames} options=${accuracy ? 'accuracy' : 'studio-interactive'} node=${process.version}`);
