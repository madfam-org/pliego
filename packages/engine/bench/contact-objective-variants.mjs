// Same retained native pose, two contact energies. This is not World.step replay.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { readingBook, readingPose } from '../../../apps/web/studio/src/book-layout.js';
const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const bytes = readFileSync(arg('--capture') || new URL('../../../docs/research/evidence/paper-2026-11-09/late-turn-objective.json', import.meta.url));
const types = { Float64Array, Float32Array, Int32Array, Uint32Array, Uint8Array };
const capture = JSON.parse(bytes, (_key, v) => v?.typed && types[v.typed] ? new types[v.typed](v.data) : v);
assert.equal(capture.schema, 'pliego-contact-objective-capture/0.1');
const root = fileURLToPath(new URL('../../../', import.meta.url)), hash = data => createHash('sha256').update(data).digest('hex');
const sourceStart = { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  status: execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }) };
const s = capture.state, variants = [];
for (const edgeEdgeMollification of ['off', 'surface-guarded']) {
  const w = new World(readingPose(s.json, readingBook(s.json), s.active), { ...s.options, contactBroadPhase: 'bvh', edgeEdgeMollification });
  // Explicitly transplant recorded pose/driver/inertia state into the changed
  // model; no assertion that these are its own simulation-history states.
  w.restore(s.snapshot); w.dt = s.dt; w.xs.set(s.xs); w.xt.set(s.xt);
  const c = w.coupledContact, before = c.evaluate(w), old = w.x.slice(), gradient = w.g.slice(), residual = c.last.residual;
  if (edgeEdgeMollification === 'off') {
    assert.equal(before, s.last.incrementalEnergy); assert.equal(residual, s.last.residual);
    for (let i = 0; i < gradient.length; i++) if (!w.fixed[Math.floor(i / 3)]) assert.equal(gradient[i], s.gradientBeforeDirection[i]);
  }
  const contacts = c.last.contacts, curvatureRows = c.potential.count, smoothing = c.snapshot().edgeEdgeMollification ?? null;
  const objective = x => implicitEnergy(w, x) + c.potential.evaluate(w, x), differences = [];
  for (let direction = 0; direction < 4; direction++) {
    const p = Float64Array.from(old, (_x, i) => w.fixed[Math.floor(i / 3)] ? 0 : Math.sin(i * 0.71 + direction * 0.42));
    const exactSlope = p.reduce((sum, v, i) => sum + v * gradient[i], 0);
    for (const step of [1e-5, 1e-6, 1e-7, 1e-8, 1e-9]) {
      const plus = objective(old.map((x, i) => x + step * p[i])), minus = objective(old.map((x, i) => x - step * p[i]));
      differences.push({ direction, stepMm: step, exactSlope, centralSlope: (plus - minus) / (2 * step),
        normalizedError: Math.abs((plus - minus) / (2 * step) - exactSlope) / Math.max(1, Math.abs(exactSlope)) });
    }
  }
  c.start.set(old); c.direction(w);
  const delta = w.x.map((x, i) => x - old[i]);
  let slope = 0, maximumDeltaMm = 0;
  for (let i = 0; i < delta.length; i++) if (!w.fixed[Math.floor(i / 3)]) { slope += gradient[i] * delta[i]; maximumDeltaMm = Math.max(maximumDeltaMm, Math.abs(delta[i])); }
  const backtracks = c.backtracks, accepted = c.search(w, before), after = objective(w.x), alpha = c.last.alpha;
  c.evaluate(w);
  variants.push({ edgeEdgeMollification, energyBefore: before, residualBeforeMicroNewtons: residual, contacts, curvatureRows, smoothing,
    directionalDifferences: differences, slope, maximumDeltaMm, accepted, alpha, backtracksAdded: c.backtracks - backtracks,
    energyAfter: after, residualAfterMicroNewtons: c.last.residual, acceptedPoseSHA256: hash(Buffer.from(w.x.buffer)) });
}
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceStart.git);
assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), sourceStart.status);
const result = { schema: 'pliego-objective-variants/0.1', recordedAt: new Date().toISOString(),
  source: { git: sourceStart.git, dirty: !!sourceStart.status.trim(), harnessSHA256: hash(readFileSync(fileURLToPath(import.meta.url))),
    captureSHA256: hash(bytes), capturedEngine: capture.source },
  scope: 'Frozen-join objective on the same retained accepted pose and inertial target; off mode must reconstruct captured scalars/free gradient. Changed contact model is a state transplant, not its World.step history or material validation.', variants };
const output = JSON.stringify(result, null, 2) + '\n';
if (arg('--out')) writeFileSync(arg('--out'), output); else process.stdout.write(output);
console.error(`contact-objective-variants: variants=${variants.length}; captured control reconstructed; changed energy/gradient/direction/search recorded`);
