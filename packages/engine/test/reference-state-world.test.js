import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { gradient, assembleAndFactor } from '../src/xpbd/implicit.js';
import { hessianTimes } from '../src/xpbd/pcg.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';

function world(coordinates = 'reference-displacement', extra = {}) {
  const p = makePatch({ cells: 2, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  return new World(p.doc, { ...p.options, damping: 0, bendDamping: 0, substeps: 4000, newtonIterations: 4,
    membraneReference: 'uv-displacement', membraneArithmetic: 'double-double', lineSearchArithmetic: 'membrane-inertia-increment',
    ...(coordinates === undefined ? {} : { stateCoordinates: coordinates }), ...extra });
}
function initial(w) {
  const x = w.x.map((v, i) => i % 3 === 0 ? v * 1.0001 : v);
  if (w.opts.stateCoordinates === 'reference-displacement') w.setInitialReferencePose(x); else w.x.set(x);
  return x;
}
const raw = w => ({ x: w.x.slice(), v: w.v.slice(), u: w._u?.slice(), us: w._us?.slice(), ut: w._ut?.slice(),
  xs: w.xs.slice(), xt: w.xt.slice(), time: w.time, acc: w._acc, frames: w.framesRun, substeps: w.substepsRun,
  factor: w.sys.ch.Ax.slice(), factorL: w.sys.ch.Lx.slice(), factorState: structuredClone(w._factorState), factorCount: w.factorCount, dirty: w.dirty, block: w.orthotropicMembrane.block.slice(), search: structuredClone(w.energySearch.increment), work: structuredClone(w.orthotropicMembrane.work) });

test('omission and explicit absolute coordinates keep historical shapes and native trajectories', () => {
  const a = world('absolute-position'), b = world('absolute-position'); delete b.opts.stateCoordinates;
  assert.equal(Object.hasOwn(a.opts, 'stateCoordinates'), false);
  assert.equal(Object.hasOwn(a, '_u'), false);
  assert.equal(a.authoritativeState(), undefined);
  initial(a); initial(b);
  for (let i = 0; i < 4; i++) { a._substep(); b._substep(); assert.deepEqual(a.snapshot(), b.snapshot()); }
  console.log('reference-state-compatibility: explicit absolute and omission native snapshots/trajectory equal, no authority fields');
});

test('initial conversion preserves actual x/v and original zero xs/xt; signed zeros and inexact conversion refuse visibly', () => {
  const w = world(), original = w.authoritativeState(), x = initial(w), s = w.authoritativeState();
  assert.deepEqual(s.initialX, x); assert.deepEqual(s.initialU, s.u); assert.deepEqual(s.initialV, w.v);
  assert.deepEqual(s.xs, original.xs); assert.deepEqual(s.xt, original.xt); assert.equal(s.targetValid, false);
  assert.equal(w.authoritativeResiduals(1e-7).public.literalForceGate, null);
  const bad = w.x.slice(), index = w.X0.findIndex(v => v > 1); bad[index] = Number.MIN_VALUE;
  let before = raw(w); assert.throws(() => w.setInitialReferencePose(bad), /one binary64 word/); assert.deepEqual(raw(w), before);
  const plusZero = w.X0.findIndex((v, i) => i % 3 !== 1 && Object.is(v, +0));
  assert.ok(plusZero >= 0); bad.set(w.x); bad[plusZero] = -0; before = raw(w);
  assert.throws(() => w.setInitialReferencePose(bad), /public bytes/); assert.deepEqual(raw(w), before);
  const minusZero = w.X0.findIndex(v => Object.is(v, -0));
  if (minusZero >= 0) assert.ok(Object.is(original.u[minusZero], -0));
  w._substep(); assert.throws(() => w.setInitialReferencePose(x), /pristine/);
  console.log('reference-state-initialization: exact actual-x conversion/raw signs, unchanged uninitialized targets, inexact/+0-to--0 refusals atomic');
});

test('latent predictor, velocity, elastic/inertia objective and explicit GN operator use authority directly', () => {
  const w = world(); initial(w); w._substep();
  const first = w.authoritativeState(), velocity = first.v.slice(); w._substep(); const second = w.authoritativeState();
  for (let i = 0; i < second.u.length; i++) {
    assert.equal(second.ut[i], first.u[i] + w.dt * velocity[i]);
    assert.equal(second.v[i], (second.u[i] - second.us[i]) / w.dt);
    assert.equal(second.x[i], w.X0[i] + second.u[i]);
    assert.equal(second.xt[i], w.X0[i] + second.ut[i]);
  }
  const g = new Float64Array(w.x.length); gradient(w, w._u, g, 'reference-displacement');
  const report = w.authoritativeResiduals(1e-7); assert.deepEqual(g, report.authoritative.elasticGradient);
  const inertiaEnergy = w._u.reduce((s, v, i) => s + .5 * w.mass[Math.floor(i / 3)] * (1 / (w.dt * w.dt)) * (v - w._ut[i]) ** 2, 0);
  assert.equal(implicitEnergy(w, w._u, 'reference-displacement'), inertiaEnergy + report.authoritative.energy);
  assert.equal(report.authoritative.converged, report.authoritative.residualInfinity <= report.forceTolerance);
  assert.equal(report.public.literalForceGate, report.public.residualInfinity <= report.forceTolerance);
  const stats = w.stats(); assert.equal(stats.stateCoordinates.existingStatsCoordinates, 'rounded-public-position');
  assert.equal(stats.stateCoordinates.authoritative.energyNJ, report.authoritative.energy);
  assert.equal(stats.energy.stretch, report.public.energy);
  const p = w._u.map((_, i) => i % 3 === 1 ? 0 : Math.sin(i + .3)), out = new Float64Array(p.length);
  hessianTimes(w, w._u, p, out, 'reference-displacement'); assembleAndFactor(w, w._u, 'reference-displacement');
  const solve = Float64Array.from(out); w.sys.ch.solve(solve);
  assert.ok(Math.hypot(...solve.map((v, i) => v - p[i])) / Math.hypot(...p) < 1e-10);
  console.log('reference-state-dynamics: displacement-first predictor/velocity, direct latent energy/gradient/GN, separate same-tau native residual gates');
});

test('boundary observations, transparent search observer and restore replay are bit-exact', () => {
  const a = world(), b = world(); initial(a); initial(b);
  const events = [], begin = b.energySearch.begin, finish = b.energySearch.finish;
  b.energySearch.begin = function(w) { const value = begin.call(this, w); events.push(w._u.slice()); return value; };
  b.energySearch.finish = function(w, g) { const value = finish.call(this, w, g); events.push(w.x.slice()); for (const observe of [() => w.snapshot(), () => w.authoritativeState(), () => w.authoritativeResiduals(1e-7)]) assert.throws(observe, /boundary/); return value; };
  for (let i = 0; i < 3; i++) { a._substep(); b._substep(); assert.deepEqual(a.snapshot(), b.snapshot()); }
  assert.equal(events.length, 24);
  const s = a.snapshot(), before = raw(a); a.authoritativeState(); a.authoritativeResiduals(1e-7); assert.deepEqual(raw(a), before);
  a._substep(); const end = a.snapshot(); a.restore(s); a._substep(); assert.deepEqual(a.snapshot(), end);
  const state = a.authoritativeState(); state.u[0] += 1; assert.notEqual(state.u[0], a._u[0]);
  console.log('reference-state-replay: 12 observed Newton events match unobserved, observations leave scratch unchanged, boundary snapshot exact replay');
});

test('public view and immutable binding drift refuse before advancing any World state', () => {
  for (const mutate of [w => { w.x[0] += .01; }, w => { w.xs[0] += .01; }, w => { w.xt[0] += .01; },
    w => { w.opts.stateCoordinates = 'absolute-position'; }, w => { w.X0[0] += .01; }, w => { w.mass[0] *= 2; },
    w => { w.dt *= 2; }, w => { w.orthotropicMembrane.elements[0].reference.x0[1] = -0; }]) {
    const w = world(); initial(w); mutate(w); const before = raw(w);
    assert.throws(() => w.step(), /Reference state/); assert.deepEqual(raw(w), before);
    assert.throws(() => w.snapshot(), /Reference state/);
  }
  console.log('reference-state-preflight: public x/xs/xt, mode, origin, M, h and coefficient signed-zero drift all visibly refused before step writes');
});

test('incoming latent/projection/model/domain/factor mismatch refuses restore atomically', () => {
  const w = world(); initial(w); w._substep(); const good = w.snapshot();
  for (const mutate of [s => { s.referenceState.u[0] += .01; }, s => { s.referenceState.xs[0] += .01; },
    s => { s.referenceState.mass[0] *= 2; }, s => { s.referenceState.h *= 2; }, s => { s.referenceState.identity.version++; },
    s => { s.factor.coordinates = 'absolute-position'; }, s => { s.restTheta[0] = .1; }, s => { s.userForce[0] = 1; },
    s => { s.terms.active[0] = 1; }, s => { s.membrane.signature += 'bad'; },
    s => { s.factor.active[0] = 1; s.factor.k[0] = NaN; },
    s => { s.time = 1; s.terms.gateOff = new Uint8Array(w.terms.gateOff.length + 1); },
    s => { s.hingeK[0] = Number.MAX_VALUE; },
    s => { s.factor.x.set(w.X0.map(v => v * 1e20)); }, s => { s.memory = new Uint8Array(0); },
    s => { s.terms.info[0].target = {}; }, s => { s.substepsRun = -1; }, s => { s.referenceState.targetValid = false; },
    s => { s.referenceState.u.set(w.X0.map(v => -v)); s.referenceState.x.fill(0); s.x.fill(0); }]) {
    const bad = structuredClone(good); mutate(bad); const before = raw(w);
    assert.throws(() => w.restore(bad), /snapshot|domain|mismatch/); assert.deepEqual(raw(w), before);
  }
  const old = world('absolute-position'), oldSnapshot = old.snapshot(), before = raw(w);
  assert.throws(() => w.restore(oldSnapshot), /coordinate mismatch/); assert.deepEqual(raw(w), before);
  assert.throws(() => old.restore(good), /coordinate mismatch/);
  console.log('reference-state-restore: nineteen corrupt latent/public/binding/omitted-physics/factor cases plus cross-mode refuse before live state or scratch writes');
});


test('target validity cannot be forged before a completed substep and phase guards clear on errors', () => {
  const w = world(), s = w.snapshot();
  s.referenceState.targetValid = true; s.referenceState.ut.set(s.referenceState.u); s.referenceState.xt.set(s.x);
  const before = raw(w); assert.throws(() => w.restore(s), /target validity/); assert.deepEqual(raw(w), before);
  const original = w._newton; w._newton = () => { throw new Error('injected solve failure'); };
  assert.throws(() => w._substep(), /injected/); assert.equal(w._referenceStepActive, false);
  w._newton = original;
  // A failed substep is not a completed solve; do not offer a gate/snapshot.
  assert.throws(() => w.authoritativeResiduals(1e-7), /target validity/);
  console.log('reference-state-boundaries: no target certificate before a completed step; phase guard cleared on failed solve, incomplete target state visibly refused');
});


test('search binds immutable reference/mode throughout and invalid proposals still backtrack', () => {
  for (const mutate of [w => { w.X0[0] += .01; }, w => { w.orthotropicMembrane.elements[0].Q[0] *= 2; },
    w => { w.opts.stateCoordinates = 'absolute-position'; }]) {
    const w = world(); initial(w); const old = w._u.slice(), projected = w.x.slice();
    w.energySearch.begin(w); w._u[0] += .001; mutate(w);
    assert.throws(() => w.energySearch.finish(w, new Float64Array(w.x.length)), /Reference state/);
    assert.deepEqual(w._u, old); assert.deepEqual(w.x, projected); assert.equal(w.energySearch._incrementObjective, null);
  }
  const w = world(); initial(w); const old = w._u.slice(); w.energySearch.begin(w); w._u[0] = NaN;
  w.energySearch.finish(w, new Float64Array(w.x.length));
  assert.deepEqual(w._u, old); assert.equal(w.energySearch.increment.invalidTrials, 21);
  assert.equal(w.energySearch.increment.last.decision, 'rejected');
  console.log('reference-state-search: immutable X0/Q/mode drift visibly refuses and restores authority/view; all21 nonfinite proposal trials retained then rejected');
});
