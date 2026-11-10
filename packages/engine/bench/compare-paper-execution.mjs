// Exact implementation-substitution check: same physics, options and input protocol.
// Usage: previous.json candidate.json [--legacy-iteration-metadata|--wasm-harness-metadata] [--out result.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const legacy = args.includes('--legacy-iteration-metadata'), wasmHarness = args.includes('--wasm-harness-metadata');
assert.ok(!(legacy && wasmHarness), 'choose one reviewed harness migration');
const paths = args.filter((a, i) => a !== '--legacy-iteration-metadata' && a !== '--wasm-harness-metadata' && (oi < 0 || (i !== oi && i !== oi + 1)));
assert.equal(paths.length, 2, 'two paper-campaign reports required');
const bytes = paths.map(path => readFileSync(path)), reports = bytes.map(b => JSON.parse(b));
const hash = b => createHash('sha256').update(b).digest('hex');
for (const r of reports) {
  assert.equal(r.schema, 'pliego-paper-campaign/0.3'); assert.equal(r.source.dirty, false);
  assert.ok(r.results.length > 0);
}
// One reviewed harness migration added a nullable override and its application.
// No absent value is inferred for unknown harness versions or non-null overrides.
if (legacy) {
  assert.equal(reports[0].source.harnessSHA256, 'e90ce6226d2d8c09e776dee64eddb96df293232d22597df8d1fe068c53c40118');
  assert.equal(reports[1].source.harnessSHA256, '13520a4edfb729765e07613baabf6990322f11eed35362debf92742fbea51f72');
  assert.equal(Object.hasOwn(reports[0].protocol, 'iterationOverride'), false);
  assert.equal(reports[1].protocol.iterationOverride, null);
}
// This reviewed change only adds Wasm CLI validation/actual-backend checks.
// The retained comparison is JS BVH to fresh JS BVH; backend substitution uses
// a separate checker requiring identical fresh source/harness fingerprints.
if (wasmHarness) {
  assert.equal(reports[0].source.harnessSHA256, '13520a4edfb729765e07613baabf6990322f11eed35362debf92742fbea51f72');
  assert.equal(reports[1].source.harnessSHA256, '4dae29e2922615993736728d6cef16c4b93053e7427703b5565a0c9b0fe386a1');
  for (const r of reports) assert.equal(r.protocol.broadPhase, 'bvh');
}
const numerical = r => {
  const copy = structuredClone(r); delete copy.recordedAt;
  // These two fields identify the implementation being compared, retained below.
  delete copy.source.git; delete copy.source.engineTreeSHA256;
  if (legacy || wasmHarness) delete copy.source.harnessSHA256;
  if (legacy) copy.protocol.iterationOverride = null;
  for (const result of copy.results) {
    for (const key of ['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs', 'activeStepP95Ms', 'cpuStepMeanMs', 'cpuStepMaxMs', 'activeCpuStepP95Ms']) delete result[key];
    delete result.gates.physics8ms;
  }
  return copy;
};
assert.ok(isDeepStrictEqual(numerical(reports[0]), numerical(reports[1])), 'all recorded non-time physics, source/input protocol, diagnostics and sampled poses must agree');
const result = { schema: 'pliego-paper-execution-comparison/0.1', recordedAt: new Date().toISOString(),
  comparisonSHA256: hash(readFileSync(new URL(import.meta.url))), inputSHA256: bytes.map(hash), sources: reports.map(r => r.source),
  sourceCleanAtRuns: true, allRecordedNonTimingFieldsEqual: true,
  compatibility: legacy ? 'explicit reviewed harness fingerprints: absent iterationOverride equals null; all effective solver options and other protocol fields compared exactly' : wasmHarness ? 'explicit reviewed harness fingerprints: CLI validation/actual Wasm selection checks only; BVH options and all input/result metadata remain exact' : 'none', cases: reports[0].results.length,
  comparison: 'whole reports except recordedAt, source.git/source.engineTreeSHA256, enumerated result wall/CPU timing fields and their physics8ms gate; subject to explicitly recorded reviewed harness compatibility, all other source/runtime/input metadata, physics options, sampled pose hashes, solver/contact diagnostics and non-time gates equal',
  acceptance: 'exact recorded implementation parity only; failed or unmeasured material/device gates remain unchanged' };
const output = JSON.stringify(result, null, 2) + '\n';
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`paper-execution: cases=${result.cases}; all recorded non-time physics and input metadata identical`);
