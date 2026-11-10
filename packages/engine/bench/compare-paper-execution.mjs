// Exact implementation-substitution check: same physics, options and input protocol.
// Usage: previous.json candidate.json [--out result.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const paths = args.filter((_a, i) => oi < 0 || (i !== oi && i !== oi + 1));
assert.equal(paths.length, 2, 'two paper-campaign reports required');
const bytes = paths.map(path => readFileSync(path)), reports = bytes.map(b => JSON.parse(b));
const hash = b => createHash('sha256').update(b).digest('hex');
for (const r of reports) {
  assert.equal(r.schema, 'pliego-paper-campaign/0.3'); assert.equal(r.source.dirty, false);
  assert.ok(r.results.length > 0);
}
const numerical = r => {
  const copy = structuredClone(r); delete copy.recordedAt;
  // These two fields identify the implementation being compared, retained below.
  delete copy.source.git; delete copy.source.engineTreeSHA256;
  for (const result of copy.results) {
    for (const key of ['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs', 'activeStepP95Ms', 'cpuStepMeanMs', 'cpuStepMaxMs', 'activeCpuStepP95Ms']) delete result[key];
    delete result.gates.physics8ms;
  }
  return copy;
};
assert.deepEqual(numerical(reports[0]), numerical(reports[1]), 'all recorded non-time physics, source/input protocol, diagnostics and sampled poses must agree');
const result = { schema: 'pliego-paper-execution-comparison/0.1', recordedAt: new Date().toISOString(),
  comparisonSHA256: hash(readFileSync(new URL(import.meta.url))), inputSHA256: bytes.map(hash), sources: reports.map(r => r.source),
  sourceCleanAtRuns: true, allRecordedNonTimingFieldsEqual: true, cases: reports[0].results.length,
  comparison: 'whole reports except recordedAt, source.git/source.engineTreeSHA256, enumerated result wall/CPU timing fields and their physics8ms gate; all other source/runtime/input metadata, physics options, sampled pose hashes, solver/contact diagnostics and non-time gates equal',
  acceptance: 'exact recorded implementation parity only; failed or unmeasured material/device gates remain unchanged' };
const output = JSON.stringify(result, null, 2) + '\n';
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`paper-execution: cases=${result.cases}; all recorded non-time physics and input metadata identical`);
