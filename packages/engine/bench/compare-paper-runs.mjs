// Compare recorded runs without conflating numerical replay with wall-clock cost.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const paths = process.argv.slice(2);
assert.equal(paths.length, 3, 'usage: compare-paper-runs.mjs baseline.json candidate.json repeat.json');
const [base, a, b] = paths.map(path => JSON.parse(readFileSync(path)));
const numerical = r => {
  const fields = Object.fromEntries(Object.entries(r).filter(([key]) => !['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs', 'activeStepP95Ms'].includes(key)));
  const { physics8ms, ...gates } = fields.gates; fields.gates = gates;
  return fields;
};
const key = r => JSON.stringify([r.model, r.options]);
for (const report of [base, a, b]) {
  assert.equal(report.schema, 'pliego-paper-campaign/0.2');
  assert.equal(report.protocol.matrix, a.protocol.matrix);
  assert.ok(['continuous-contact', 'coupled-contact'].includes(report.protocol.matrix));
  assert.equal(report.source.dirty, false, 'source must be clean at run');
  for (const field of ['harnessSHA256', 'readerSHA256', 'metricsSHA256', 'fixtureSHA256']) assert.equal(report.source[field], a.source[field]);
}
assert.equal(a.source.git, b.source.git); assert.equal(a.source.engineTreeSHA256, b.source.engineTreeSHA256);
assert.ok(a.results.length > 0 && b.results.length > 0);
for (const repeat of b.results) {
  const original = a.results.find(r => key(r) === key(repeat)); assert.ok(original, 'repeat must identify a recorded candidate');
  assert.deepEqual(numerical(original), numerical(repeat));
}
const defaults = a.results.filter(r => !r.options.continuousContact && !r.options.barrierContact && !r.options.previousPoseStart);
assert.ok(defaults.length > 0);
for (const r of defaults) {
  const before = base.results.find(p => key(p) === key(r));
  assert.ok(before?.supported); assert.ok(r.supported); assert.deepEqual(numerical(r), numerical(before));
}
const guarded = a.results.filter(r => r.options.continuousContact);
const result = {
  schema: 'pliego-contact-comparison/0.2', source: a.source.git, baseline: base.source.engine,
  comparisonScriptSHA256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  defaultCasesNumericallyIdentical: defaults.length, candidateCasesReplayedIdentically: b.results.length,
  comparison: 'all recorded result fields except build/step timings and their physics8ms gate; includes final pose hash, progress, strain, failure and solver/CCD diagnostics; not a full per-frame trajectory hash',
  guardedCases: guarded.length, guardedCompletedTurns: guarded.reduce((sum, r) => sum + r.turns, 0),
  guardedZeroProgressFailures: guarded.filter(r => r.error?.includes('zero progress')).length,
  guardedStrainFailures: guarded.filter(r => r.error === 'Numerical gate failed' && r.maxStrain > 0.01).length,
  coupledCases: a.results.filter(r => r.options.barrierContact).length,
  coupledEndpointPasses: a.results.filter(r => r.options.barrierContact && r.gates.endpointProgress).length,
  previousPoseCases: a.results.filter(r => r.options.previousPoseStart).length,
  sourceCleanAtRuns: true,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
console.error(`paper-contact-comparison: default=${defaults.length} repeated=${b.results.length} numerically identical; guarded=${guarded.length}, coupled=${result.coupledCases}, coupled endpoint passes=${result.coupledEndpointPasses}`);
