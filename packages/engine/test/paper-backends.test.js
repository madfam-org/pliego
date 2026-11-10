import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const baseline = () => JSON.parse(readFileSync(new URL('../../../docs/research/evidence/paper-2026-11-10/active-capped-eight.json', import.meta.url), 'utf8'));
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pliego-backends-')), before = join(dir, 'before.json'), after = join(dir, 'after.json');
  return { dir, before, after, run(script, candidate, flags = []) {
    writeFileSync(after, JSON.stringify(candidate));
    return spawnSync(process.execPath, [fileURLToPath(new URL(`../bench/${script}`, import.meta.url)), before, after, ...flags, '--out', join(dir, 'result.json')], { encoding: 'utf8' });
  } };
}

test('Fresh backend comparison permits only declared execution/time differences', () => {
  const f = fixture(), a = baseline(), b = structuredClone(a);
  b.protocol.broadPhase = 'wasm'; b.results[0].options.contactBroadPhase = 'wasm'; b.results[0].activeStepP95Ms += 12;
  writeFileSync(f.before, JSON.stringify(a));
  try {
    assert.equal(f.run('compare-paper-backends.mjs', b).status, 0);
    let rejected = 0;
    for (const change of [r => { r.source.engineTreeSHA256 = '0'.repeat(64); }, r => { r.source.harnessSHA256 = '0'.repeat(64); },
      r => { r.results[0].trajectorySHA256 = '0'.repeat(64); }, r => { r.results[0].options.substeps++; },
      r => { r.results[0].coupledContact.unconverged++; }, r => { r.results[0].gates.allSolverStepsConverged = false; },
      r => { r.protocol.seed++; }]) {
      const c = structuredClone(b); change(c); assert.notEqual(f.run('compare-paper-backends.mjs', c).status, 0); rejected++;
    }
    console.log(`paper-backend-checker: declared BVH/Wasm execution and timings accepted; ${rejected} source/input/physics mutations rejected`);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('Retained BVH control migration requires the reviewed Wasm-aware harness fingerprint', () => {
  const f = fixture(), a = baseline(), b = structuredClone(a);
  b.source.harnessSHA256 = createHash('sha256').update(readFileSync(new URL('../bench/paper-campaign.mjs', import.meta.url))).digest('hex');
  writeFileSync(f.before, JSON.stringify(a));
  try {
    assert.notEqual(f.run('compare-paper-execution.mjs', b).status, 0);
    assert.equal(f.run('compare-paper-execution.mjs', b, ['--wasm-harness-metadata']).status, 0);
    b.protocol.broadPhase = 'wasm'; assert.notEqual(f.run('compare-paper-execution.mjs', b, ['--wasm-harness-metadata']).status, 0);
    b.protocol.broadPhase = 'bvh'; b.source.harnessSHA256 = '1'.repeat(64);
    assert.notEqual(f.run('compare-paper-execution.mjs', b, ['--wasm-harness-metadata']).status, 0);
    console.log('paper-harness-migration: explicit known CLI/backend-validation change accepted only for BVH controls; unknown source and backend change rejected');
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
