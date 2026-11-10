// Contact-free off/on ablation: material/solver response must not be credited to
// the multiplier when no contact energy or stencil is active.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const paths = args.filter((_a, i) => oi < 0 || (i !== oi && i !== oi + 1));
assert.equal(paths.length, 1, 'one axial-pull --local-contact report required');
const bytes = readFileSync(paths[0]), r = JSON.parse(bytes), hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(r.schema, 'pliego-axial-pull/0.4'); assert.equal(r.source.dirty, false);
const normalize = row => {
  const copy = structuredClone(row); delete copy.options.edgeEdgeMollification;
  for (const key of ['meanStepMs', 'p95StepMs', 'p95ActiveStepMs', 'maxStepMs']) delete copy[key];
  delete copy.gates.physics8ms;
  for (const c of [copy.coupledContact, copy.unload.coupledContact]) {
    if (c.edgeEdgeMollification) {
      assert.ok(c.edgeEdgeMollification.totals.evaluations > 0);
      for (const key of ['activeEdges', 'smoothedEdges', 'uncoveredEdges', 'parallelEdges', 'curvatureRows']) assert.equal(c.edgeEdgeMollification.totals[key], 0);
      delete c.edgeEdgeMollification;
    }
    delete c.configuration.edgeEdgeMollification;
  }
  return copy;
};
let pairs = 0;
for (const row of r.results) {
  assert.equal(row.error, null); assert.equal(row.maximumBarrierStencils, 0); assert.equal(row.maximumBarrierEnergy, 0);
  for (const key of ['tensile', 'axialBar5Percent', 'drift1Percent', 'finalForceConverged', 'allSolverStepsConverged']) assert.equal(row.gates[key], true);
  assert.ok(Object.values(row.unload.gates).every(v => v === true));
  if (row.options.edgeEdgeMollification !== 'surface-guarded') continue;
  const before = r.results.find(x => !x.options.edgeEdgeMollification && x.options.barrierIterations === row.options.barrierIterations);
  assert.ok(before); assert.deepEqual(normalize(row), normalize(before), 'every recorded non-time material/force/loaded and unloaded pose result must be unchanged'); pairs++;
}
assert.equal(pairs, 2); assert.equal(r.results.length, 4);
const result = { schema: 'pliego-axial-contact-comparison/0.1', source: r.source,
  comparisonSHA256: hash(readFileSync(new URL(import.meta.url))), inputSHA256: hash(bytes), pairs,
  comparison: 'all recorded non-time off/on results at each budget, except the declared mode and validated zero-contact smoothing diagnostics; includes loaded/unloaded pose hashes, every material/force gate and solver counter',
  acceptance: 'synthetic axial estimate and unloading only; no contact-force, held-out material, mesh/timestep convergence or booklet/device certification' };
const output = JSON.stringify(result, null, 2) + '\n';
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`axial-contact-comparison: pairs=${pairs}; all non-time off/on results identical, contact inactive, load/unload gates passed`);
