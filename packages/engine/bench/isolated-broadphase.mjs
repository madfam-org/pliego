// Fresh-process, fixed-warmup JS/Wasm component comparison. No physics gate.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve, join, relative, sep, isAbsolute, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

/** A fresh private directory. Explicit paths retain their exact location but
 * must not exist; create parent directories before invoking the CLI. */
export function createIsolatedOutputDirectory(directory) {
  if (directory === undefined || directory === null) return mkdtempSync(join(tmpdir(), 'pliego-isolated-broadphase-'));
  const out = resolve(directory); mkdirSync(out, { mode: 0o700 }); return out;
}
/** Exclusive creation atomically refuses existing files and symbolic links. */
export function writeIsolatedOutput(directory, name, bytes) {
  assert.equal(name, basename(name), 'plain output filename required');
  const path = join(directory, name); writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 }); return path;
}

export function runIsolatedBroadphase() {
const arg = n => { const i = process.argv.indexOf(n); return i < 0 ? null : process.argv[i + 1]; };
const root = resolve(arg('--root') ?? fileURLToPath(new URL('../../../', import.meta.url)));
const requestedOut = arg('--out-dir'), outputLocation = resolve(requestedOut ?? tmpdir());
const rel = relative(root, outputLocation); assert.ok(rel && (rel.startsWith('..' + sep) || isAbsolute(rel)), '--out-dir must be outside source');
const rounds = Number(arg('--rounds') ?? 3), warmup = Number(arg('--warmup') ?? 32), repetitions = Number(arg('--repetitions') ?? 9);
assert.ok(Number.isInteger(rounds) && rounds >= 1 && rounds <= 9);
assert.ok(Number.isInteger(warmup) && warmup >= 0 && warmup <= 1024);
assert.ok(Number.isInteger(repetitions) && repetitions >= 3 && repetitions <= 101);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = x => createHash('sha256').update(x).digest('hex');
const source = { git: git('rev-parse', 'HEAD'), dirty: !!git('status', '--porcelain'), orchestratorSHA256: hash(readFileSync(new URL(import.meta.url))) };
assert.equal(source.dirty, false, 'clean source required');
const out = createIsolatedOutputDirectory(requestedOut);
console.error('isolated-components: output directory=' + out);
const runs = [];
for (let round = 1; round <= rounds; round++) for (const backend of round % 2 ? ['bvh', 'wasm'] : ['wasm', 'bvh']) {
  const name = `component-r${round}-${backend}.json`;
  const child = spawnSync(process.execPath, [join(root, 'packages/engine/bench/broadphase-pairs.mjs'), '--only', backend,
    '--warmup', String(warmup), '--repetitions', String(repetitions)], { cwd: root, encoding: 'utf8', maxBuffer: 16e6 });
  writeIsolatedOutput(out, name + '.log', (child.status === 0 ? '' : child.stdout ?? '') + (child.stderr ?? ''));
  assert.equal(child.status, 0, `child failed: round=${round} backend=${backend}`);
  const path = writeIsolatedOutput(out, name, child.stdout ?? '');
  const bytes = readFileSync(path), report = JSON.parse(bytes);
  assert.equal(report.schema, 'pliego-broadphase-pairs/0.6'); assert.equal(report.source.dirty, false); assert.equal(report.source.git, source.git);
  assert.equal(report.protocol.selectedBackend, backend); assert.equal(report.protocol.warmupBuilds, warmup); assert.equal(report.protocol.repetitions, repetitions);
  assert.equal(report.results.length, 5); assert.equal(new Set(report.results.map(x => x.name)).size, 5);
  runs.push({ round, backend, name, SHA256: hash(bytes), report });
  console.error(`isolated-components: round=${round}/${rounds} backend=${backend}, five scenes completed; source=${source.git.slice(0, 7)}`);
}
const baseline = runs[0].report;
for (const { backend, report } of runs) {
  assert.deepEqual(report.source, baseline.source); assert.deepEqual(report.runtime, baseline.runtime); assert.deepEqual(report.mesh, baseline.mesh);
  assert.deepEqual(report.wasmKernel, baseline.wasmKernel);
  for (let i = 0; i < 5; i++) {
    const a = baseline.results[i], b = report.results[i];
    for (const key of ['name', 'inputSHA256', 'orderedPairsSHA256', 'vertexTrianglePairs', 'edgeEdgePairs']) assert.equal(a[key], b[key]);
    assert.equal(b.exactOrderedPairMatch, true);
    for (const key of ['edgeTraversal', 'reused', 'triangleQueries', 'edgeQueries', 'nodeAABBTests', 'rootEnclosureTests']) assert.equal(a.buildWork.bvh[key], b.buildWork[backend][key]);
  }
}
const median = a => a.toSorted((a, b) => a - b)[Math.floor(a.length / 2)];
const results = baseline.results.map((scene, i) => ({ name: scene.name, inputSHA256: scene.inputSHA256, orderedPairsSHA256: scene.orderedPairsSHA256,
  bvh: runs.filter(r => r.backend === 'bvh').map(r => r.report.results[i].timings.bvh.medianMs),
  wasm: runs.filter(r => r.backend === 'wasm').map(r => r.report.results[i].timings.wasm.medianMs) }));
for (const row of results) { row.bvhMedianOfMediansMs = median(row.bvh); row.wasmMedianOfMediansMs = median(row.wasm); }
assert.equal(git('rev-parse', 'HEAD'), source.git); assert.equal(git('status', '--porcelain'), '');
const result = { schema: 'pliego-isolated-broadphase/0.1', recordedAt: new Date().toISOString(), source,
  runtime: baseline.runtime, mesh: baseline.mesh, wasmKernel: baseline.wasmKernel,
  protocol: { rounds, warmupBuilds: warmup, repetitions, order: 'fresh process for every backend/round; BVH/Wasm then reverse on alternating rounds; one backend callsite per process; reference oracle after timing',
    scope: 'candidate full-build wall/process CPU includes input validation/copies/refit/query/boundary calls; cold constructor/first-build and first compilation retained in raw reports; ordinary background activity remains; no World.step, material, browser/device or universal speedup acceptance' },
  exactOrderedPairAndWorkParity: true, runs: runs.map(({ round, backend, name, SHA256 }) => ({ round, backend, name, SHA256 })), results };
writeIsolatedOutput(out, 'isolated-comparison.json', JSON.stringify(result, null, 2) + '\n');
console.error('isolated-components: all five input/pair/work fingerprints exact across fresh processes; initialization and timed arrays retained');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) runIsolatedBroadphase();
