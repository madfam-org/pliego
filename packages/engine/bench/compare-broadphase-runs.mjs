// Compare index substitutions without weakening recorded physics/replay gates.
// Usage: previous.json indexed.json [repeat.json] [--reference fresh-reference.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const args = process.argv.slice(2), referenceIndex = args.indexOf('--reference'), outputIndex = args.indexOf('--out');
const paths = args.filter((_a, i) => !((referenceIndex >= 0 && (i === referenceIndex || i === referenceIndex + 1)) || (outputIndex >= 0 && (i === outputIndex || i === outputIndex + 1))));
assert.ok(paths.length === 2 || paths.length === 3, 'usage: previous.json indexed.json [repeat.json] [--reference fresh.json] [--out result.json]');
const read = path => JSON.parse(readFileSync(path));
const previous = read(paths[0]), indexed = read(paths[1]), repeat = paths[2] ? read(paths[2]) : null;
const reference = referenceIndex >= 0 ? read(args[referenceIndex + 1]) : null;
const reports = [previous, indexed, repeat, reference].filter(Boolean);
for (const r of reports) {
  assert.equal(r.schema, 'pliego-paper-campaign/0.3'); assert.equal(r.source.dirty, false);
  for (const field of ['readerSHA256', 'metricsSHA256', 'fixtureSHA256']) assert.equal(r.source[field], indexed.source[field]);
  for (const field of ['seed', 'frameSeconds', 'framesPerTurn', 'requestedTurns', 'stopOnZeroProgress', 'fallback', 'matrix']) assert.equal(r.protocol[field], indexed.protocol[field]);
  for (const field of ['node', 'arch', 'platform']) assert.equal(r.runtime[field], indexed.runtime[field]);
  assert.equal(r.reduction, indexed.reduction);
}
assert.equal(previous.protocol.broadPhase ?? 'reference', 'reference'); assert.equal(indexed.protocol.broadPhase, 'bvh');
for (const r of [repeat, reference].filter(Boolean)) {
  assert.equal(r.source.git, indexed.source.git); assert.equal(r.source.engineTreeSHA256, indexed.source.engineTreeSHA256);
  assert.equal(r.source.harnessSHA256, indexed.source.harnessSHA256);
}
if (repeat) assert.equal(repeat.protocol.broadPhase, 'bvh');
if (reference) assert.equal(reference.protocol.broadPhase, 'reference');
const numerical = r => {
  const fields = Object.fromEntries(Object.entries(r).filter(([key]) => !['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs', 'activeStepP95Ms', 'cpuStepMeanMs', 'cpuStepMaxMs', 'activeCpuStepP95Ms'].includes(key)));
  const { physics8ms, ...gates } = fields.gates; fields.gates = gates;
  fields.options = { ...fields.options }; delete fields.options.contactBroadPhase;
  return fields;
};
const match = (a, b) => {
  const aa = numerical(a), bb = numerical(b);
  return aa.model === bb.model && JSON.stringify(Object.entries(aa.options).sort()) === JSON.stringify(Object.entries(bb.options).sort());
};
assert.ok(indexed.results.length > 0);
for (const r of indexed.results) for (const baseline of [previous, repeat, reference].filter(Boolean)) {
  const before = baseline.results.find(b => match(b, r)); assert.ok(before, 'matching model/options must be present');
  assert.deepEqual(numerical(r), numerical(before), 'every recorded non-timing field must agree, including all sampled pose bytes via trajectory hash');
}
const result = { schema: 'pliego-broadphase-comparison/0.1', recordedAt: new Date().toISOString(),
  comparisonSHA256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  sources: { previous: previous.source, indexed: indexed.source, repeat: repeat?.source ?? null, freshReference: reference?.source ?? null },
  previousCasesMatched: indexed.results.length, indexedRepeatCasesMatched: repeat ? indexed.results.length : 0, freshReferenceCasesMatched: reference ? indexed.results.length : 0,
  comparison: 'all recorded result fields except enumerated wall/CPU timing fields, their physics8ms gate and the declared contactBroadPhase option; includes trajectory hashes and force/CCD diagnostics',
  protocol: 'matching seed/frame interval/turn count/zero-progress policy/fallback, reader/metrics/fixture fingerprints and all other model options; prior harness bytes may differ and are retained in sources',
  sourceCleanAtRuns: true, allRecordedNonTimingFieldsEqual: true };
const output = JSON.stringify(result, null, 2) + '\n';
if (outputIndex >= 0) writeFileSync(args[outputIndex + 1], output); else process.stdout.write(output);
console.error(`broadphase-replay: prior=${result.previousCasesMatched}, repeat=${result.indexedRepeatCasesMatched}, fresh-reference=${result.freshReferenceCasesMatched}; recorded non-time fields and sampled trajectories identical`);
