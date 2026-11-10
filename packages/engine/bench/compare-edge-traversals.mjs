// Compare the first active-edge experiment and the rank-pruning refinement.
// Physics acceptance is deliberately separate from these component cost results.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const paths = args.filter((_a, i) => oi < 0 || (i !== oi && i !== oi + 1));
assert.equal(paths.length, 2, 'naive and refined component reports required');
const bytes = paths.map(p => readFileSync(p)), [before, after] = bytes.map(b => JSON.parse(b));
const hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(before.schema, 'pliego-broadphase-pairs/0.3'); assert.equal(after.schema, 'pliego-broadphase-pairs/0.4');
for (const r of [before, after]) { assert.equal(r.source.dirty, false); assert.equal(r.results.length, 5); assert.equal(new Set(r.results.map(x => x.name)).size, 5); }
assert.deepEqual(before.mesh, after.mesh); assert.deepEqual(before.runtime, after.runtime);
assert.equal(before.source.captureSHA256, after.source.captureSHA256);
assert.equal(before.protocol.repetitions, after.protocol.repetitions);
assert.equal(before.protocol.warmupBuilds, after.protocol.warmupBuilds);
const comparisons = after.results.map(row => {
  const prior = before.results.find(r => r.name === row.name); assert.ok(prior);
  for (const field of ['inputSHA256', 'orderedPairsSHA256', 'vertexTrianglePairs', 'edgeEdgePairs']) assert.equal(prior[field], row[field], field);
  assert.equal(prior.exactOrderedPairMatch, true); assert.equal(row.exactOrderedPairMatch, true);
  for (const policy of ['bvhRank', 'bvhActive']) {
    assert.equal(prior.buildWork[policy].reused, false); assert.equal(row.buildWork[policy].reused, false);
    for (const field of ['triangleQueries', 'edgeQueries', 'nodeAABBTests', 'rootEnclosureTests']) assert.equal(prior.buildWork[policy][field], row.buildWork[policy][field], `${policy} ${field}`);
  }
  return { name: row.name, inputSHA256: row.inputSHA256, orderedPairsSHA256: row.orderedPairsSHA256,
    rank: { work: row.buildWork.bvhRank, medianMs: row.timings.bvhRank.medianMs },
    naiveActive: { work: row.buildWork.bvhActive, medianMs: row.timings.bvhActive.medianMs },
    rankedActive: { work: row.buildWork.bvhRanked, medianMs: row.timings.bvhRanked.medianMs },
    auto: { work: row.buildWork.bvh, medianMs: row.timings.bvh.medianMs } };
});
const result = { schema: 'pliego-edge-traversal-comparison/0.1', recordedAt: new Date().toISOString(),
  comparisonSHA256: hash(readFileSync(new URL(import.meta.url))), inputSHA256: bytes.map(hash), sources: [before.source, after.source],
  sameMeshRuntimeInputsAndOrderedPairs: true, originalRankAndNaiveTraversalWorkUnchanged: true,
  scope: 'Five identical component scenes; source-pinned sequential experiments, not a fresh paired device trial. Within refined source all policies use identical inputs and alternating order. Both forced active variants retain dense/large-sweep regressions; auto uses original rank traversal at higher mobility. No World.step, material or device gate is inferred.',
  comparisons };
const output = JSON.stringify(result, null, 2) + '\n';
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error('edge-traversal-comparison: five input/pair fingerprints equal; unchanged rank/naive work; refined work and exploratory timings retained');
