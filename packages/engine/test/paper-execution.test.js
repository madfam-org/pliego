import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('execution parity retains physics gates and permits only the reviewed metadata migration', () => {
  const baseline = JSON.parse(readFileSync(new URL('../../../docs/research/evidence/paper-2026-11-10/ba6-eight-turn.json', import.meta.url), 'utf8'));
  const script = fileURLToPath(new URL('../bench/compare-paper-execution.mjs', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'pliego-execution-'));
  const before = join(dir, 'before.json'), after = join(dir, 'after.json'), output = join(dir, 'comparison.json');
  const run = (candidate, flags = []) => {
    writeFileSync(after, JSON.stringify(candidate));
    return spawnSync(process.execPath, [script, before, after, ...flags, '--out', output], { encoding: 'utf8' });
  };
  try {
    writeFileSync(before, JSON.stringify(baseline));
    const changedTime = structuredClone(baseline); changedTime.results[0].activeStepP95Ms += 100;
    assert.equal(run(changedTime).status, 0, 'only enumerated timings may change');
    let rejected = 0;
    for (const change of [r => { r.results[0].trajectorySHA256 = '0'.repeat(64); },
      r => { r.results[0].options.substeps++; }, r => { r.protocol.seed++; },
      r => { r.results[0].mollification.uncoveredEdges++; }, r => { r.results[0].gates.allSolverStepsConverged = false; },
      r => { r.source.harnessSHA256 = '1'.repeat(64); }]) {
      const candidate = structuredClone(baseline); change(candidate);
      assert.notEqual(run(candidate).status, 0); rejected++;
    }
    const migrated = structuredClone(baseline);
    migrated.source.harnessSHA256 = '13520a4edfb729765e07613baabf6990322f11eed35362debf92742fbea51f72';
    migrated.protocol.iterationOverride = null;
    assert.notEqual(run(migrated).status, 0, 'migration is never implicit');
    assert.equal(run(migrated, ['--legacy-iteration-metadata']).status, 0);
    migrated.protocol.iterationOverride = 32;
    assert.notEqual(run(migrated, ['--legacy-iteration-metadata']).status, 0, 'non-null overrides cannot be inferred');
    migrated.protocol.iterationOverride = null; migrated.source.harnessSHA256 = '2'.repeat(64);
    assert.notEqual(run(migrated, ['--legacy-iteration-metadata']).status, 0, 'unreviewed harness cannot use compatibility');
    console.log(`paper-execution-checker: ${rejected} altered physics/input fields rejected; explicit null-only fingerprinted migration checked`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
