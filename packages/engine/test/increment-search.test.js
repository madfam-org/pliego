import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { makePatch } from '../bench/membrane-patch.mjs';

function fixture(stretch = 1.001) {
  const p = makePatch({ cells: 2, membraneModel: 'orthotropic-stvk', membraneNu12: 0.293 });
  const w = new World(p.doc, { ...p.options, damping: 0, bendDamping: 0, substeps: 4000,
    newtonIterations: 4, lineSearchArithmetic: 'membrane-inertia-increment' });
  for (let i = 0; i < w.x.length; i++) w.x[i] *= stretch;
  w.xt.set(w.x);
  const g = new Float64Array(w.x.length); gradient(w, w.x, g);
  return { w, g };
}

function sum(values) {
  // Independent expansion-style compensation, to compare slopes at the actual
  // accepted endpoint rather than alpha times an ideal proposed displacement.
  const parts = [];
  for (let x of values) {
    let j = 0;
    for (let y of parts) { if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x]; const h = x + y, l = y - (h - x); if (l) parts[j++] = l; x = h; }
    parts.length = j; parts.push(x);
  }
  return parts.reduce((a, b) => a + b, 0);
}

test('increment Armijo uses actual rounded endpoints after many halvings, with no total-energy floor', () => {
  const { w, g } = fixture(), s = w.energySearch, before = w.x.slice();
  s.begin(w); for (let i = 0; i < w.x.length; i++) w.x[i] = -9 * before[i];
  const initial = w.x.slice(), direction = initial.map((x, i) => x - before[i]);
  s.finish(w, g); const last = s.increment.last;
  assert.equal(last.decision, 'accepted'); assert.ok(last.trials > 8); assert.equal(s.backtracks, last.trials - 1);
  assert.deepEqual(w.x, before.map((x, i) => x + last.alpha * direction[i]));
  const actual = sum(Array.from(g, (v, i) => v * (w.x[i] - before[i])));
  assert.ok(Math.abs(actual - last.slope) <= Number.EPSILON * Math.abs(actual));
  assert.ok(last.slope < 0 && last.delta <= 1e-4 * last.slope);
  assert.notEqual(actual, last.alpha * sum(Array.from(g, (v, i) => v * direction[i])));
  assert.equal(last.armijoRhs, 1e-4 * last.slope); assert.equal(w.dirty, true);
  console.log(`increment-search: ${last.trials} actual rounded trials; strict Armijo delta=${last.delta}; actual slope=${last.slope}`);
});

test('zero realized displacement distinguishes stationary no-op and unresolved nonzero force', () => {
  const { w, g } = fixture(), s = w.energySearch, before = w.x.slice();
  assert.ok(g.some(x => x !== 0)); s.begin(w);
  const coordinate = Array.from(w.x).findIndex(x => x === Math.max(...w.x));
  const nominal = Number.MIN_VALUE; w.x[coordinate] += nominal;
  assert.deepEqual(w.x, before); assert.notEqual(nominal, 0);
  s.finish(w, g);
  assert.equal(s.increment.last.decision, 'precision-limited-zero-step');
  assert.equal(s.increment.precisionLimited, 1); assert.equal(s.rejected, 1); assert.equal(s.increment.accepted, 0);
  assert.equal(s.increment.last.trials, 1); assert.deepEqual(w.x, before);
  s.begin(w); s.finish(w, new Float64Array(g.length));
  assert.equal(s.increment.last.decision, 'stationary-noop'); assert.equal(s.increment.stationaryNoops, 1);
  assert.equal(s.rejected, 1); assert.equal(s.increment.accepted, 0);
  console.log('increment-search: nonzero nominal rounded to zero rejects with nonzero force; zero supplied gradient is a distinct no-op, never accepted descent');
});

test('nonzero zero/positive-slope proposals reject; invalid membrane trials backtrack or restore', () => {
  for (const type of ['zero-slope', 'positive-slope', 'collapsed', 'nonfinite']) {
    const { w, g } = fixture(), s = w.energySearch, before = w.x.slice(); s.begin(w);
    if (type === 'nonfinite') w.x[0] = NaN;
    else if (type === 'collapsed') w.x.fill(0);
    else for (let i = 0; i < w.x.length; i++) w.x[i] *= 1.0001;
    s.finish(w, type === 'zero-slope' ? new Float64Array(g.length) : g);
    const last = s.increment.last;
    if (type === 'collapsed') { assert.ok(s.increment.invalidTrials > 0); assert.equal(last.decision, 'accepted'); assert.ok(last.trials > 1); }
    else { assert.equal(last.decision, 'rejected'); assert.equal(s.rejected, 1); assert.deepEqual(w.x, before); }
    if (type === 'nonfinite') { assert.equal(s.increment.invalidTrials, 21); assert.equal(last.delta, null); }
    if (type === 'zero-slope' || type === 'positive-slope') assert.equal(last.reason, 'non-descent');
  }
  console.log('increment-search: non-descent is never accepted, collapsed first trial recovers, persistent nonfinite proposal restores after 21 trials');
});

test('ordinary World supplies full first-iteration inertia in the selected mode', () => {
  const { w } = fixture(), original = w.energySearch.finish;
  w.opts.previousPoseStart = true;
  let checked = 0;
  w.energySearch.finish = function (actual, g) {
    const shadow = Object.create(actual);
    for (const key of ['thetaPred', 'hingeGrad', 'edgeDir', 'edgeComp', 'edgeK']) shadow[key] = actual[key].slice();
    shadow.orthotropicMembrane = Object.create(actual.orthotropicMembrane);
    shadow.orthotropicMembrane.work = structuredClone(actual.orthotropicMembrane.work);
    const independent = new Float64Array(g.length); gradient(shadow, this.start, independent);
    const idt2 = 1 / (actual.dt * actual.dt);
    for (let i = 0; i < g.length; i++) independent[i] += actual.mass[Math.floor(i / 3)] * idt2 * (this.start[i] - actual.xt[i]);
    assert.deepEqual(g, independent); checked++;
    return original.call(this, actual, g);
  };
  w.step(w.dt); assert.equal(checked, 4);
  console.log('increment-search: all 4 real World Newton iterations use actual elastic-plus-inertia gradient');
});
