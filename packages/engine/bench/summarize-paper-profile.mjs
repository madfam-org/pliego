// Public-safe summary of our own V8 profile; raw profiles retain local paths.
// Usage: profile.cpuprofile paper-run.json [--engine-source archived/src] [--out summary.json]
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { summarizeProfile } from './profile-docs.mjs';
import { sanitizePaperProfile } from './profile-sanitize.mjs';
import { boundsKernelMetadata, createBoundsKernel } from '../src/collision/wasm-bounds-code.js';
const args = process.argv.slice(2), oi = args.indexOf('--out'), ei = args.indexOf('--engine-source');
const paths = args.filter((_a, i) => (oi < 0 || (i !== oi && i !== oi + 1)) && (ei < 0 || (i !== ei && i !== ei + 1)));
if (ei >= 0) assert.ok(args[ei + 1], '--engine-source requires the recorded runtime source directory');
assert.equal(paths.length, 2, 'profile and corresponding run report required');
const bytes = readFileSync(paths[0]), runBytes = readFileSync(paths[1]), profile = JSON.parse(bytes), run = JSON.parse(runBytes);
assert.equal(run.schema, 'pliego-paper-campaign/0.3'); assert.equal(run.source.dirty, false);
const rootURL = new URL('../../../', import.meta.url).href;
let kernel = null;
if (run.protocol.broadPhase === 'wasm') {
  // Runtime provenance: helper/reducer changes may differ, but kernel code may
  // not be guessed from another checkout or an unrelated compiled module.
  const h = createHash('sha256');
  function visit(dir, prefix = '') {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const relative = prefix + entry.name, path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, relative + '/');
      else if (entry.name.endsWith('.js')) { h.update(relative + '\0'); h.update(readFileSync(path)); }
    }
  }
  const runtimeSource = ei >= 0 ? args[ei + 1] : fileURLToPath(new URL('../src/', import.meta.url));
  visit(runtimeSource);
  assert.equal(h.digest('hex'), run.source.engineTreeSHA256, 'Wasm attribution requires actual runtime engine bytes (use --engine-source for an archived checkout)');
  assert.equal(createHash('sha256').update(readFileSync(join(runtimeSource, 'collision/wasm-bounds-code.js'))).digest('hex'),
    createHash('sha256').update(readFileSync(new URL('../src/collision/wasm-bounds-code.js', import.meta.url))).digest('hex'), 'attribution kernel must equal the recorded runtime kernel');
  const exports = createBoundsKernel(new WebAssembly.Memory({ initial: 1 })).exports;
  assert.deepEqual(Object.keys(exports).sort(), ['query', 'refit']);
  const refitIndex = Number(exports.refit.name), queryIndex = Number(exports.query.name);
  assert.ok(Number.isInteger(refitIndex) && Number.isInteger(queryIndex) && refitIndex !== queryIndex, 'exported ABI indices must be verifiable');
  kernel = { ...boundsKernelMetadata, refitIndex, queryIndex };
}
const wasmAttribution = sanitizePaperProfile(profile, rootURL, kernel);
const hash = b => createHash('sha256').update(b).digest('hex');
const result = { schema: 'pliego-profile-summary/0.3', source: run.source,
  runtime: run.runtime, protocol: run.protocol, runSHA256: hash(runBytes),
  cases: run.results.map(r => ({ model: r.model, options: r.options, frames: r.frames })),
  scope: 'Whole-process node --cpu-prof sample of the recorded first-turn case, including loading, construction, JIT and diagnostics. V8 leaf-sample self time weighted by timeDeltas; not retired instructions or isolated World.step CPU clock.',
  profileSHA256: hash(bytes), wasmAttribution, runtimeSource: kernel ? (ei >= 0 ? 'explicit archived source; kernel fingerprint verified' : 'current engine source; fingerprint verified') : 'not needed for JS source-label reduction',
  sanitizerSHA256: hash(readFileSync(new URL('./profile-sanitize.mjs', import.meta.url))), reducerSHA256: hash(readFileSync(new URL(import.meta.url))),
  stageReducerSHA256: hash(readFileSync(new URL('./profile-docs.mjs', import.meta.url))),
  samples: profile.samples.length, ...summarizeProfile(profile) };
const output = JSON.stringify(result, null, 2) + '\n';
assert.ok(!/file:\/\/|\/Users\/|\/home\/|\/tmp\//.test(output), 'public summary must omit absolute local paths');
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`paper-profile-summary: samples=${profile.samples.length}, stages=${result.stages.length}; local paths removed, scope retained`);
