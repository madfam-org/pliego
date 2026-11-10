// Fresh-source JS BVH vs scalar Wasm backend: no physics/model relaxation.
// Usage: fresh-bvh.json fresh-wasm.json [--out result.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const paths = args.filter((_a, i) => oi < 0 || (i !== oi && i !== oi + 1));
assert.equal(paths.length, 2, 'fresh BVH and Wasm reports required');
const bytes = paths.map(p => readFileSync(p)), reports = bytes.map(b => JSON.parse(b));
const hash = x => createHash('sha256').update(x).digest('hex');
for (const r of reports) { assert.equal(r.schema, 'pliego-paper-campaign/0.3'); assert.equal(r.source.dirty, false); assert.ok(r.results.length > 0); }
assert.deepEqual(reports[0].source, reports[1].source, 'same fresh source, engine and harness required');
assert.equal(reports[0].protocol.broadPhase, 'bvh'); assert.equal(reports[1].protocol.broadPhase, 'wasm');
for (let i = 0; i < reports.length; i++) for (const r of reports[i].results) assert.equal(r.options.contactBroadPhase, i ? 'wasm' : 'bvh');
const numerical = r => {
  const c = structuredClone(r); delete c.recordedAt; c.protocol.broadPhase = 'bvh';
  for (const row of c.results) {
    row.options.contactBroadPhase = 'bvh';
    for (const key of ['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs', 'activeStepP95Ms', 'cpuStepMeanMs', 'cpuStepMaxMs', 'activeCpuStepP95Ms']) delete row[key];
    delete row.gates.physics8ms;
  }
  return c;
};
assert.ok(isDeepStrictEqual(numerical(reports[0]), numerical(reports[1])), 'all recorded physics, input metadata, poses, force/contact diagnostics and non-time gates must agree');
const result = { schema: 'pliego-paper-backend-comparison/0.1', recordedAt: new Date().toISOString(),
  comparisonSHA256: hash(readFileSync(new URL(import.meta.url))), inputSHA256: bytes.map(hash), source: reports[0].source,
  cases: reports[0].results.length, sourceCleanAtRuns: true, allRecordedPhysicsFieldsEqual: true,
  comparison: 'whole reports except recordedAt, declared protocol.broadPhase/results.options.contactBroadPhase BVH-to-Wasm execution choice, enumerated result wall/CPU timings and their physics8ms gate; all source/runtime/input metadata, physics options, sampled poses, solver/contact diagnostics and non-time gates exact',
  acceptance: 'backend parity only; timing, material calibration and actual browser/device gates require separate evidence' };
const output = JSON.stringify(result, null, 2) + '\n';
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`paper-backend-parity: ${result.cases} cases; every recorded non-time physics result equal on identical fresh source`);
