// Separate unchanged controls, changed contact physics and candidate repeat.
// Usage: old-control.json fresh-control.json candidate.json repeat.json [--out result.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const paths = args.filter((_v, i) => oi < 0 || (i !== oi && i !== oi + 1));
assert.equal(paths.length, 4, 'four reports required: old-control fresh-control candidate repeat');
const [old, control, candidate, repeat] = paths.map(path => JSON.parse(readFileSync(path)));
for (const r of [old, control, candidate, repeat]) {
  assert.equal(r.schema, 'pliego-paper-campaign/0.3'); assert.equal(r.source.dirty, false);
  for (const key of ['harnessSHA256', 'readerSHA256', 'metricsSHA256', 'fixtureSHA256']) assert.equal(r.source[key], candidate.source[key]);
  for (const key of ['seed', 'frameSeconds', 'framesPerTurn', 'requestedTurns', 'stopOnZeroProgress', 'fallback', 'matrix', 'broadPhase', 'coupledContact']) assert.equal(r.protocol[key], candidate.protocol[key]);
  for (const key of ['node', 'arch', 'platform']) assert.equal(r.runtime[key], candidate.runtime[key]);
  assert.equal(r.reduction, candidate.reduction); assert.deepEqual(r.materialAudit, candidate.materialAudit);
}
for (const r of [control, repeat]) for (const key of ['git', 'engineTreeSHA256']) assert.equal(r.source[key], candidate.source[key]);
for (const r of [old, control]) assert.equal(r.protocol.edgeMollification, 'off');
for (const r of [candidate, repeat]) assert.equal(r.protocol.edgeMollification, 'surface-guarded');
const numerical = r => {
  const fields = Object.fromEntries(Object.entries(r).filter(([key]) => !['buildMs', 'stepMeanMs', 'stepP95Ms', 'stepMaxMs', 'activeStepP95Ms', 'cpuStepMeanMs', 'cpuStepMaxMs', 'activeCpuStepP95Ms'].includes(key)));
  const { physics8ms, ...gates } = fields.gates; fields.gates = gates; return fields;
};
const options = r => { const o = { ...r.options }; delete o.edgeEdgeMollification; return JSON.stringify(Object.entries(o).sort()); };
const match = (a, b) => a.model === b.model && options(a) === options(b);
assert.ok(control.results.length > 0 && candidate.results.length > 0);
assert.equal(candidate.results.length, repeat.results.length);
for (const r of control.results) {
  assert.ok(!r.options.edgeEdgeMollification || r.options.edgeEdgeMollification === 'off');
  const before = old.results.find(b => match(b, r)); assert.ok(before);
  assert.deepEqual(numerical(r), numerical(before), 'every recorded non-time control field and sampled pose must remain unchanged');
}
const changes = [];
for (const r of candidate.results) {
  assert.equal(r.options.edgeEdgeMollification, 'surface-guarded'); assert.equal(r.options.barrierContact, true);
  const again = repeat.results.find(b => match(b, r)); assert.ok(again);
  assert.deepEqual(numerical(r), numerical(again), 'every recorded non-time candidate field, sampled pose and smoothing diagnostic must replay');
  const before = control.results.find(b => match(b, r)); assert.ok(before);
  changes.push({ model: r.model, options: r.options, sameTrajectoryAsControl: r.trajectorySHA256 === before.trajectorySHA256,
    control: { trajectorySHA256: before.trajectorySHA256, coupledContact: before.coupledContact, gates: before.gates, activeStepP95Ms: before.activeStepP95Ms },
    candidate: { trajectorySHA256: r.trajectorySHA256, coupledContact: r.coupledContact, mollification: r.mollification, gates: r.gates, activeStepP95Ms: r.activeStepP95Ms } });
}
const result = { schema: 'pliego-contact-variant-comparison/0.1', recordedAt: new Date().toISOString(),
  comparisonSHA256: createHash('sha256').update(readFileSync(new URL(import.meta.url))).digest('hex'),
  sources: { old: old.source, control: control.source, candidate: candidate.source, repeat: repeat.source },
  unchangedControlCases: control.results.length, candidateRepeatCases: repeat.results.length,
  comparison: 'all recorded result fields except enumerated wall/CPU timings and their physics8ms gate; controls unchanged, candidate repeat exact; changed contact model judged by separate retained gates',
  sourceScope: 'same harness and input fingerprints; old engine identity retained in source.engine and engineTreeSHA256; fresh control/candidate/repeat share git and engine bytes',
  changes };
const output = JSON.stringify(result, null, 2) + '\n';
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`contact-variant-comparison: unchanged controls=${control.results.length}, exact candidate repeats=${repeat.results.length}; physics changes and failed gates retained`);
