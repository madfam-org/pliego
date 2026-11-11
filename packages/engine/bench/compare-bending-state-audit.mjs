// Strict-repeat and observer-parity comparison of bending capture reports. Every leaf is compared
// under only named exclusions (recordedAt; for parity also the observer fields), reusing the planar
// comparator's leaf walk. Failed gates and the literal tolerance are preserved, never re-judged.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { assertStateModalPayloadEqual } from './compare-membrane-state-modal-audit.mjs';
import { reserveStateModalOutput } from './membrane-state-modal-output.mjs';

const sha = data => createHash('sha256').update(data).digest('hex');
const MODES = ['strict-repeat', 'transparent-solve-observer'];

/** Per-row and total force outcomes exactly as recorded; every judged step counted once. */
export function bendingForceOutcomes(report) {
  assert.equal(report.schema, 'pliego-bending-state-audit/1');
  assert.ok(report.source?.dirty === false && /^[0-9a-f]{40}$/.test(report.source.git), 'clean pinned source required');
  const rows = report.results[0].trajectories; assert.equal(rows.length, 24, 'complete declared matrix required');
  const keys = new Set(); let steps = 0, publicFailed = 0, authoritativeFailed = 0;
  const perRow = rows.map(t => {
    const key = [t.level, t.budget, t.seed].join(':'); assert.ok(!keys.has(key), 'duplicate row ' + key); keys.add(key);
    const judged = t.trace.filter(o => o.step > 0);
    assert.equal(judged.length, t.steps, 'every judged step traced: ' + key);
    const pub = judged.filter(o => o.literalForceGate !== true || o.validation.publicConverged !== true || o.validation.valid !== true).length;
    const lat = judged.filter(o => o.authoritativeConverged !== true || o.validation.authoritativeConverged !== true || o.validation.valid !== true).length;
    assert.equal(pub, t.failedSteps, 'public failure count differs from the trace: ' + key); assert.equal(lat, t.authoritativeFailedSteps, 'latent failure count differs from the trace: ' + key);
    steps += t.steps; publicFailed += pub; authoritativeFailed += lat;
    const worst = kind => Math.max(...judged.map(o => o[kind] ?? Infinity));
    return { level: t.level, budget: t.budget, seed: t.seed, steps: t.steps, publicFailed: pub, authoritativeFailed: lat,
      worstPublicResidual: worst('residualInfinity'), worstAuthoritativeResidual: worst('authoritativeResidualInfinity'), classification: t.classification };
  });
  return { judgedSteps: steps, publicFailed, authoritativeFailed, forceTolerance: rows[0].forceTolerance, perRow };
}

export function compareBendingReports(a, b, { mode = 'strict-repeat' } = {}) {
  assert.ok(MODES.includes(mode), 'unknown named comparison');
  const forceOutcomes = [bendingForceOutcomes(a), bendingForceOutcomes(b)];
  if (mode === 'transparent-solve-observer') { assert.equal(a.protocol.instrument, false); assert.equal(b.protocol.instrument, true); }
  const comparison = assertStateModalPayloadEqual(a, b, { observerComparison: mode === 'transparent-solve-observer' });
  return { schema: 'pliego-bending-state-comparison/1', recordedAt: new Date().toISOString(), mode, comparison, forceOutcomes,
    comparatorSHA256: sha(readFileSync(fileURLToPath(import.meta.url))),
    scope: 'complete 24-row identity and recorded force comparison only; failed gates and the literal tolerance preserved; no time, material, booklet or device acceptance' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), parity = args.includes('--observer-comparison'), oi = args.indexOf('--out');
  const files = args.filter((a, i) => a !== '--observer-comparison' && a !== '--out' && i !== oi + 1);
  assert.ok(oi >= 0 && args[oi + 1] && files.length === 2, 'usage: [--observer-comparison] A B --out fresh-durable-output');
  const [a, b] = files.map(f => JSON.parse(readFileSync(resolve(f), 'utf8')));
  const sink = reserveStateModalOutput(args[oi + 1], { pretty: true });
  try { sink.write(compareBendingReports(a, b, { mode: parity ? 'transparent-solve-observer' : 'strict-repeat' })); } finally { sink.close(); }
  console.error('bending-state-comparison: ' + (parity ? 'observer parity' : 'strict repeat') + ' passed over every leaf');
}
