// Reproduce a captured native incremental objective, not World.step replay.
// The capture preserves a pre-direction accepted pose and its inertial target.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';
import { pointTriangleDistanceSquared, edgeEdgeDistanceSquared } from '../src/collision/distance.js';
import { gapBarrier } from '../src/collision/barrier.js';
import { readingBook, readingPose } from '../../../apps/web/studio/src/book-layout.js';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
const path = arg('--capture') || new URL('../../../docs/research/evidence/paper-2026-11-09/late-turn-objective.json', import.meta.url);
const bytes = readFileSync(path), types = { Float64Array, Float32Array, Int32Array, Uint32Array, Uint8Array };
const capture = JSON.parse(bytes, (_key, value) => value?.typed && types[value.typed] ? new types[value.typed](value.data) : value);
assert.equal(capture.schema, 'pliego-contact-objective-capture/0.1');
const s = capture.state, root = fileURLToPath(new URL('../../../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const w = new World(readingPose(s.json, readingBook(s.json), s.active), s.options);
w.restore(s.snapshot); w.dt = s.dt; w.xs.set(s.xs); w.xt.set(s.xt);
const c = w.coupledContact, before = c.evaluate(w), old = w.x.slice(), g = w.g.slice();
let gradientDifference = 0;
for (let i = 0; i < g.length; i++) if (!w.fixed[Math.floor(i / 3)]) gradientDifference = Math.max(gradientDifference, Math.abs(g[i] - s.gradientBeforeDirection[i]));
const residual = c.last.residual, contacts = c.potential.count;
assert.equal(gradientDifference, 0, 'captured free gradient values must reproduce');
assert.equal(before, s.last.incrementalEnergy, 'captured energy must reproduce');
assert.equal(residual, s.last.residual, 'captured residual must reproduce');
c.direction(w);
const delta = w.x.map((x, i) => x - old[i]); w.x.set(old);
let slope = 0, maxDelta = 0;
for (let i = 0; i < g.length; i++) if (!w.fixed[Math.floor(i / 3)]) { slope += g[i] * delta[i]; maxDelta = Math.max(maxDelta, Math.abs(delta[i])); }
const objective = x => implicitEnergy(w, x) + c.potential.evaluate(w, x);

// Split scalar energies without changing the potential. Separate summations can
// differ from the total in their last rounding bits; retain both in the report.
function components(x) {
  const P = c.potential, C = P.candidates, m = w.mesh, tc = P.thickness;
  P.evaluate(w, x); let vt = 0, ee = 0, ground = 0;
  for (let pair = 0; pair < C.vertexTriangleCount; pair++) {
    const v = C.vt[2 * pair], t = C.vt[2 * pair + 1], a = m.tris[3 * t], b = m.tris[3 * t + 1], z = m.tris[3 * t + 2];
    vt += gapBarrier(Math.sqrt(pointTriangleDistanceSquared(x, v, a, b, z)) - 0.5 * (tc[v] + Math.max(tc[a], tc[b], tc[z])), P.distance, P.stiffness);
  }
  for (let pair = 0; pair < C.edgeEdgeCount; pair++) {
    const e = C.ee[2 * pair], f = C.ee[2 * pair + 1], a = m.edges[2 * e], b = m.edges[2 * e + 1], z = m.edges[2 * f], d = m.edges[2 * f + 1];
    ee += gapBarrier(Math.sqrt(edgeEdgeDistanceSquared(x, a, b, z, d)) - 0.5 * (Math.max(tc[a], tc[b]) + Math.max(tc[z], tc[d])), P.distance, P.stiffness);
  }
  if (w.opts.ground) for (let v = 0; v < m.nV; v++) if (!w.fixed[v]) ground += gapBarrier(x[3 * v + 1], P.distance, P.stiffness);
  return { implicit: implicitEnergy(w, x), vt, ee, ground };
}

const baseComponents = components(old), rows = [];
for (const alpha of [1, 0.1, 0.01, 0.001, 0.0001, 0.00001, 0.000001]) {
  const a = old.map((x, i) => x + alpha * delta[i]), b = old.map((x, i) => x - alpha * delta[i]);
  const plus = objective(a), minus = objective(b), pa = components(a), pb = components(b);
  rows.push({ alpha, plus, minus, centralSlope: (plus - minus) / (2 * alpha), slope,
    armijo: plus <= before + 1e-4 * alpha * slope + 1e-12 * Math.max(1, Math.abs(before)),
    componentEvenChange: Object.fromEntries(Object.keys(baseComponents).map(k => [k, 0.5 * (pa[k] + pb[k]) - baseComponents[k]])) });
}
const result = {
  schema: 'pliego-objective-diagnosis/0.2', recordedAt: new Date().toISOString(),
  source: { git: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim(),
    harnessSHA256: hash(readFileSync(fileURLToPath(import.meta.url))), captureSHA256: hash(bytes), capturedEngine: capture.source },
  scope: 'Native accepted-pose frozen-objective reconstruction; JSON values reproduce energy/free gradient/residual. Not bit-exact World.step replay, material validation or a smoothness certificate at feature ties.',
  completedFramesAtObservation: capture.completedFramesAtObservation,
  capturedResidual: s.last.residual, reconstructedResidual: residual, gradientDifference,
  capturedEnergy: s.last.incrementalEnergy, reconstructedEnergy: before, contacts, slope, maxDelta, baseComponents, rows,
};
const output = JSON.stringify(result, null, 2) + '\n';
if (arg('--out')) writeFileSync(arg('--out'), output); else process.stdout.write(output);
console.error(`contact-objective-replay: free gradient difference=${gradientDifference}, residual=${residual} µN, stencils=${contacts}, directions=${rows.length}; captured scalar values reproduced`);
