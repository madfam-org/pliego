// Compare recorded runs without conflating numerical replay with wall-clock cost.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const paths = process.argv.slice(2);
assert.equal(paths.length, 3, 'usage: compare-paper-runs.mjs baseline.json candidate.json repeat.json');
const [base, a, b] = paths.map(path => JSON.parse(readFileSync(path)));
const numerical = r => Object.fromEntries(Object.entries(r).filter(([key]) => !['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs'].includes(key)));
const key = r => JSON.stringify([r.model, r.options]);
for (const report of [base, a, b]) {
  assert.equal(report.schema, 'pliego-paper-campaign/0.2');
  assert.equal(report.protocol.matrix, 'continuous-contact');
  assert.equal(report.source.dirty, false, 'source must be clean at run');
  for (const field of ['harnessSHA256', 'readerSHA256', 'metricsSHA256', 'fixtureSHA256']) assert.equal(report.source[field], a.source[field]);
}
assert.equal(a.source.git, b.source.git); assert.equal(a.source.engineTreeSHA256, b.source.engineTreeSHA256);
assert.ok(a.results.length > 0); assert.equal(a.results.length, b.results.length);
a.results.forEach((r, i) => assert.deepEqual(numerical(r), numerical(b.results[i])));
const defaults = a.results.filter(r => !r.options.continuousContact);
assert.ok(defaults.length > 0);
for (const r of defaults) {
  const before = base.results.find(p => key(p) === key(r));
  assert.ok(before?.supported); assert.ok(r.supported); assert.deepEqual(numerical(r), numerical(before));
}
const guarded = a.results.filter(r => r.options.continuousContact);
const result = {
  schema: 'pliego-contact-comparison/0.1', source: a.source.git, baseline: base.source.engine,
  comparisonScriptSHA256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  defaultCasesNumericallyIdentical: defaults.length, candidateCasesReplayedIdentically: a.results.length,
  comparison: 'all result fields except build/step timings; includes final pose hash, progress, strain, failure and CCD diagnostics',
  guardedCases: guarded.length, guardedCompletedTurns: guarded.reduce((sum, r) => sum + r.turns, 0),
  guardedZeroProgressFailures: guarded.filter(r => r.error?.includes('zero progress')).length,
  guardedStrainFailures: guarded.filter(r => r.error === 'Numerical gate failed' && r.maxStrain > 0.01).length,
  sourceCleanAtRuns: true,
};
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
console.error(`paper-contact-comparison: default=${defaults.length} repeated=${a.results.length} numerically identical; guarded=${guarded.length}, completed turns=${result.guardedCompletedTurns}`);
