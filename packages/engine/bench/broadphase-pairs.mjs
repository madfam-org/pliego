// Component experiment: identical ordered pairs from reference and refit BVH.
// Includes native poses and deliberately dense synthetic bounds. No physics gate.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { cpus, platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { SweptCandidates } from '../src/collision/swept.js';
import { readingBook, readingPose } from '../../../apps/web/studio/src/book-layout.js';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const repetitions = Number(arg('--repetitions') ?? 9);
if (!Number.isInteger(repetitions) || repetitions < 3 || repetitions > 101) throw new RangeError('--repetitions must be 3..101');
const path = new URL('../../../docs/research/evidence/paper-2026-11-09/late-turn-objective.json', import.meta.url);
const bytes = readFileSync(path), types = { Float64Array, Float32Array, Int32Array, Uint32Array, Uint8Array };
const capture = JSON.parse(bytes, (_key, v) => v?.typed && types[v.typed] ? new types[v.typed](v.data) : v), s = capture.state;
const root = fileURLToPath(new URL('../../../', import.meta.url)), git = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const status = () => execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
const source = { git: git(), dirty: !!status().trim(), captureSHA256: createHash('sha256').update(bytes).digest('hex'),
  harnessSHA256: createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).digest('hex') };
const initialStatus = status();
const w = new World(readingPose(s.json, readingBook(s.json), s.active), s.options), m = w.mesh;
const tc = Float64Array.from(m.vSheet, i => Math.max(0.05, w.doc.sheets[i].derived.collision_thickness));
const scenes = [
  { name: 'native-initial-energy', from: w.x, to: w.x, thickness: tc.map(t => t + 0.05), fixed: w.fixed },
  { name: 'native-late-energy', from: s.snapshot.x, to: s.snapshot.x, thickness: tc.map(t => t + 0.05), fixed: w.fixed },
  { name: 'native-late-sweep', from: s.xs, to: s.snapshot.x, thickness: tc, fixed: w.fixed },
  { name: 'synthetic-large-prescribed-sweep', from: w.x, to: w.x.map((x, i) => x + 1000 * Math.sin(i * 0.37)), thickness: tc, fixed: w.fixed },
  { name: 'synthetic-dense-all-free', from: new Float64Array(w.x.length), to: new Float64Array(w.x.length), thickness: tc, fixed: new Uint8Array(m.nV) },
];
const percentile = (values, q) => values.toSorted((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * q) - 1)];
const digest = arrays => {
  const h = createHash('sha256');
  for (const a of arrays) { h.update(String(a.byteLength) + '\0'); h.update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)); }
  return h.digest('hex');
};
const pairHash = c => digest([c.vt.subarray(0, 2 * c.vertexTriangleCount), c.ee.subarray(0, 2 * c.edgeEdgeCount)]);
const results = [];
for (const scene of scenes) {
  const builders = { reference: new SweptCandidates(m, scene.thickness), bvh: new SweptCandidates(m, scene.thickness, 'bvh'), bvhReuse: new SweptCandidates(m, scene.thickness, 'bvh') };
  const coldFirstBuildMs = {};
  for (const [mode, c] of Object.entries(builders)) {
    // Build topology on the initial native pose, then refit to each supplied scene.
    const start = performance.now(); c.build(w.x, w.x, w.fixed, w.contact.weldSheet); coldFirstBuildMs[mode] = performance.now() - start;
    for (let i = 0; i < 2; i++) c.build(scene.from, scene.to, scene.fixed, w.contact.weldSheet, mode !== 'bvh');
  }
  const modes = Object.keys(builders), times = Object.fromEntries(modes.map(m => [m, []])), cpu = Object.fromEntries(modes.map(m => [m, []]));
  for (let repeat = 0; repeat < repetitions; repeat++) for (const mode of repeat % 2 ? modes.toReversed() : modes) {
    const used = process.cpuUsage(), start = performance.now(); builders[mode].build(scene.from, scene.to, scene.fixed, w.contact.weldSheet, mode !== 'bvh');
    times[mode].push(performance.now() - start); const delta = process.cpuUsage(used); cpu[mode].push((delta.user + delta.system) / 1000);
  }
  const reference = builders.reference, bvh = builders.bvh;
  for (const c of Object.values(builders)) assert.equal(pairHash(reference), pairHash(c), 'all ordered pair bytes must agree');
  let prefixAABBTests = 0;
  for (let v = 0; v < m.nV; v++) for (const t of reference.triangleOrder) {
    if (reference.triangleBoxes[6 * t] > reference.vertexBoxes[6 * v + 3]) break; prefixAABBTests++;
  }
  for (let i = 0; i < m.nE; i++) for (let j = i + 1; j < m.nE; j++) {
    if (reference.edgeBoxes[6 * reference.edgeOrder[j]] > reference.edgeBoxes[6 * reference.edgeOrder[i] + 3]) break; prefixAABBTests++;
  }
  const row = { name: scene.name, inputSHA256: digest([scene.from, scene.to, scene.thickness, scene.fixed, w.contact.weldSheet]),
    vertexTrianglePairs: bvh.vertexTriangleCount, edgeEdgePairs: bvh.edgeEdgeCount, orderedPairsSHA256: pairHash(bvh), exactOrderedPairMatch: true,
    prefixPrimitiveAABBTests: prefixAABBTests, bvhNodeAABBTests: bvh.triangleTree.nodeTests + bvh.edgeTree.nodeTests,
    bvhRootEnclosureTests: bvh.triangleTree.rootContainmentTests + bvh.edgeTree.rootContainmentTests, coldFirstBuildMs,
    reusedLastBuild: builders.bvhReuse.reusedLastBuild,
    reuseNodeAABBTests: builders.bvhReuse.triangleTree.nodeTests + builders.bvhReuse.edgeTree.nodeTests,
    timings: Object.fromEntries(modes.map(mode => [mode, { medianMs: percentile(times[mode], 0.5), p95Ms: percentile(times[mode], 0.95),
      processCpuMedianMs: percentile(cpu[mode], 0.5), wallMs: times[mode], processCpuMs: cpu[mode] }])) };
  results.push(row);
  console.error(`broadphase-pairs: ${row.name} VT=${row.vertexTrianglePairs} EE=${row.edgeEdgePairs} ordered bytes identical; reference=${row.timings.reference.medianMs.toFixed(3)}ms BVH-rebuild=${row.timings.bvh.medianMs.toFixed(3)}ms reuse=${row.timings.bvhReuse.medianMs.toFixed(3)}ms`);
}
assert.equal(git(), source.git); assert.equal(status(), initialStatus, 'source status changed during run');
const report = { schema: 'pliego-broadphase-pairs/0.2', recordedAt: new Date().toISOString(), source,
  runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  mesh: { vertices: m.nV, triangles: m.nT, edges: m.nE, topologySHA256: digest([m.tris, m.edges, m.vGroup, m.vSheet, m.triSheet]) },
  protocol: { repetitions, warmupBuilds: 2, order: 'alternated reference/BVH-rebuild/BVH-reuse and reverse; sequential, same arrays',
    execution: { reference: 'prefix scan, no reuse', bvh: 'forced full refit and candidate enumeration', bvhReuse: 'exact-content reuse allowed only for same-array Float64 unswept poses; swept inputs rebuild' },
    timingScope: 'candidate build only, separate wall and process CPU deltas including JIT/GC; exploratory local run',
    countScope: 'reference primitive AABB overlap tests vs BVH internal/leaf overlap tests plus separately counted root-enclosure tests; excludes rank/stationary pruning and bound generation',
    physicsAcceptance: 'not evaluated; synthetic dense/large-sweep scenes are culling stress cases, not native physics outcomes' }, results };
const output = JSON.stringify(report, null, 2) + '\n';
if (arg('--out')) writeFileSync(arg('--out'), output); else process.stdout.write(output);
