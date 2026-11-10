// Public-safe summary of our own V8 profile; raw profiles retain local paths.
// Usage: profile.cpuprofile paper-run.json [--out summary.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { summarizeProfile } from './profile-docs.mjs';
const args = process.argv.slice(2), oi = args.indexOf('--out');
const paths = args.filter((_a, i) => oi < 0 || (i !== oi && i !== oi + 1));
assert.equal(paths.length, 2, 'profile and corresponding run report required');
const bytes = readFileSync(paths[0]), runBytes = readFileSync(paths[1]), profile = JSON.parse(bytes), run = JSON.parse(runBytes);
assert.equal(run.schema, 'pliego-paper-campaign/0.3'); assert.equal(run.source.dirty, false);
const rootURL = new URL('../../../', import.meta.url).href;
for (const n of profile.nodes) {
  const f = n.callFrame;
  if (f.url.startsWith(rootURL)) f.url = '/pliego/' + f.url.slice(rootURL.length);
  else {
    f.url = ''; f.lineNumber = -1; f.columnNumber = -1;
    if (!['(root)', '(program)', '(idle)', '(garbage collector)'].includes(f.functionName)) f.functionName = '(runtime)';
  }
}
const hash = b => createHash('sha256').update(b).digest('hex');
const result = { schema: 'pliego-profile-summary/0.2', source: run.source,
  runtime: run.runtime, protocol: run.protocol, runSHA256: hash(runBytes),
  cases: run.results.map(r => ({ model: r.model, options: r.options, frames: r.frames })),
  scope: 'Whole-process node --cpu-prof sample of the recorded first-turn case, including loading, construction, JIT and diagnostics. V8 leaf-sample self time weighted by timeDeltas; not retired instructions or isolated World.step CPU clock.',
  profileSHA256: hash(bytes), reducerSHA256: hash(readFileSync(new URL(import.meta.url))),
  stageReducerSHA256: hash(readFileSync(new URL('./profile-docs.mjs', import.meta.url))),
  samples: profile.samples.length, ...summarizeProfile(profile) };
const output = JSON.stringify(result, null, 2) + '\n';
assert.ok(!/file:\/\/|\/Users\/|\/home\/|\/tmp\//.test(output), 'public summary must omit absolute local paths');
if (oi >= 0) writeFileSync(args[oi + 1], output); else process.stdout.write(output);
console.error(`paper-profile-summary: samples=${profile.samples.length}, stages=${result.stages.length}; local paths removed, scope retained`);
