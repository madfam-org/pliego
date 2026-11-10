import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';

const MODE = 'membrane-inertia-increment';
const IDENTITY = { name: MODE, version: 1, armijo: 1e-4, maxBacktracks: 20 };
function world({ selected = true, arithmetic, lineSearch = true, previousPoseStart = false } = {}) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0,
    ...(selected ? { membraneModel: 'orthotropic-stvk', membraneNu12: 0.293 } : {}) });
  const w = new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, lineSearch,
    substeps: 4000, newtonIterations: 4, previousPoseStart, ...(arithmetic === undefined ? {} : { lineSearchArithmetic: arithmetic }) });
  for (let i = 0; i < w.mesh.nV; i++) w.x[3 * i] += 0.004 * (patch.vertices[i][0] - 20) / 20;
  return w;
}
const bytes = a => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex');
function capture(w) {
  const stats = w.stats();
  return { stats, snapshot: w.snapshot(), options: structuredClone(w.opts),
    buffers: Object.fromEntries(['x', 'v', 'xs', 'xt', 'g', 'mass', 'invMass', 'thetaPred', 'hingeGrad', 'factorDir'].map(key => [key, bytes(w[key])])),
    factor: { Ax: bytes(w.sys.ch.Ax), Lx: w.sys.ch.Lx ? bytes(w.sys.ch.Lx) : null },
    search: w.energySearch ? { start: bytes(w.energySearch.start), delta: bytes(w.energySearch.delta), energy: w.energySearch.energy,
      increment: w.energySearch.increment === undefined ? undefined : structuredClone(w.energySearch.increment) } : null };
}

test('omitted and explicit total-energy preserve legacy options, snapshot/stat shapes and exact World trajectories', () => {
  let comparisons = 0;
  for (const [selected, lineSearch] of [[false, false], [false, true], [true, true]]) {
    const omitted = world({ selected, lineSearch }), explicit = world({ selected, lineSearch, arithmetic: 'total-energy' });
    assert.equal(Object.hasOwn(omitted.opts, 'lineSearchArithmetic'), false);
    assert.equal(Object.hasOwn(explicit.opts, 'lineSearchArithmetic'), false);
    for (let step = 0; step <= 4; step++) {
      assert.deepEqual(capture(explicit), capture(omitted)); comparisons++;
      for (const w of [omitted, explicit]) {
        const saved = w.snapshot(); assert.equal(Object.hasOwn(w.stats(), 'lineSearchIncrement'), false);
        assert.equal(w.energySearch?.increment, undefined);
        if (lineSearch) { assert.deepEqual(Object.keys(saved.energySearch), ['backtracks', 'rejected']); }
        else assert.equal(saved.energySearch, null);
      }
      if (step < 4) { omitted.step(omitted.dt); explicit.step(explicit.dt); }
    }
    // Historical search snapshots contain no arithmetic label and still restore.
    const historical = omitted.snapshot(); explicit.step(explicit.dt); explicit.restore(historical);
    assert.deepEqual(explicit.snapshot(), historical);
  }
  console.log(`increment-search-legacy: ${comparisons} complete omitted/explicit-total state comparisons across spring search on/off and selected membrane; legacy option/stat/snapshot shapes retained, historical snapshots restore`);
});

test('increment snapshot diagnostics are detached copies and same-mode public World replay is bit-exact', () => {
  for (const previousPoseStart of [false, true]) {
    const w = world({ arithmetic: MODE, previousPoseStart });
    for (let i = 0; i < 3; i++) w.step(w.dt);
    const saved = w.snapshot(), detached = structuredClone(saved);
    assert.deepEqual(saved.energySearch.arithmetic, IDENTITY);
    assert.deepEqual(w.stats().lineSearchIncrement, { arithmetic: IDENTITY, increment: saved.energySearch.increment });
    assert.notEqual(saved.energySearch.increment, w.energySearch.increment);
    for (let i = 0; i < 4; i++) w.step(w.dt);
    const expected = { x: bytes(w.x), v: bytes(w.v), stats: w.stats(), snapshot: w.snapshot() };
    assert.deepEqual(saved, detached, 'continued search cannot mutate an existing snapshot');
    w.restore(saved);
    assert.deepEqual(w.energySearch.increment, saved.energySearch.increment);
    assert.notEqual(w.energySearch.increment, saved.energySearch.increment);
    assert.equal(w.energySearch._incrementObjective, null, 'restore cannot preserve a stale in-progress objective');
    const restored = capture(w);
    assert.throws(() => w.energySearch.finish(w, new Float64Array(w.x.length)), /begin/i);
    assert.deepEqual(capture(w), restored, 'finish after boundary restore requires a fresh begin and cannot mutate state');
    for (let i = 0; i < 4; i++) w.step(w.dt);
    assert.deepEqual({ x: bytes(w.x), v: bytes(w.v), stats: w.stats(), snapshot: w.snapshot() }, expected);
    assert.deepEqual(saved, detached, 'restored search cannot retain snapshot diagnostic aliases');
  }
  console.log('increment-search-state-replay: versioned fixed Armijo identity and copied decisions/counters; actual x/v/diagnostic/snapshot replay exact through four public substeps for both starting-pose policies');
});

test('cross-mode and changed/missing policy identities reject before ANY World/search/factor mutation', () => {
  const legacy = world(), increment = world({ arithmetic: MODE }), noSearch = world({ selected: false, lineSearch: false });
  legacy.step(legacy.dt); increment.step(increment.dt); noSearch.step(noSearch.dt);
  let refusals = 0;
  const reject = (target, snapshot) => {
    const before = capture(target), input = structuredClone(snapshot);
    assert.throws(() => target.restore(snapshot), /snapshot.*arithmetic|arithmetic.*snapshot/i);
    assert.deepEqual(capture(target), before, 'identity refusal must precede all World/search/factor writes');
    assert.deepEqual(snapshot, input); refusals++;
  };
  reject(legacy, increment.snapshot()); reject(increment, legacy.snapshot());
  // Preserve model binding while testing a World without an EnergySearch.
  const forged = noSearch.snapshot(); forged.energySearch = increment.snapshot().energySearch; reject(noSearch, forged);
  for (const mutate of [s => { delete s.energySearch; }, s => { s.energySearch = null; },
    s => { delete s.energySearch.arithmetic; }, s => { s.energySearch.arithmetic = null; },
    s => { s.energySearch.arithmetic = MODE; }, s => { s.energySearch.arithmetic = []; },
    ...Object.keys(IDENTITY).map(key => s => { s.energySearch.arithmetic[key] = key === 'name' ? 'total-energy' : 999; }),
    s => { s.energySearch.arithmetic.unknownPolicy = true; }]) {
    const changed = increment.snapshot(); mutate(changed); reject(increment, changed);
  }
  const malformedLegacy = legacy.snapshot(); malformedLegacy.energySearch.increment = {}; reject(legacy, malformedLegacy);
  for (const mutate of [w => { w.energySearch = null; }, w => { delete w.energySearch.increment; },
    w => { w.opts.lineSearchArithmetic = 'total-energy'; }]) {
    const target = world({ arithmetic: MODE }), incoming = target.snapshot(); mutate(target); reject(target, incoming);
  }
  const driftedLegacy = world(), legacyInput = driftedLegacy.snapshot();
  driftedLegacy.energySearch.increment = structuredClone(increment.energySearch.increment); reject(driftedLegacy, legacyInput);
  console.log(`increment-search-state-binding: ${refusals} cross-mode/missing/name/version/Armijo/backtrack/extra-field refusals preserve every captured state, factor buffer and search counter; incoming snapshots untouched`);
});

test('malformed new diagnostics reject in preflight, before position or factor restoration', () => {
  const w = world({ arithmetic: MODE }); w.step(w.dt); let refusals = 0;
  const signedZero = w.snapshot(); signedZero.energySearch.increment.last.slope = -0;
  w.restore(signedZero);
  assert.equal(Object.is(w.energySearch.increment.last.slope, -0), true);
  assert.equal(Object.is(w.snapshot().energySearch.increment.last.slope, -0), true);
  assert.equal(Object.is(w.stats().lineSearchIncrement.increment.last.slope, -0), true);
  for (const mutate of [s => { delete s.energySearch.increment; }, s => { s.energySearch.increment = null; },
    s => { s.energySearch.increment.accepted = -1; }, s => { s.energySearch.increment.stationaryNoops = NaN; },
    s => { s.energySearch.increment.precisionLimited = 0.5; }, s => { s.energySearch.increment.invalidTrials = Infinity; },
    s => { s.energySearch.increment.last = { decision: 'bad', alpha: NaN }; }]) {
    const changed = w.snapshot(); changed.x[0] += 3; changed.time += 1; mutate(changed);
    const before = capture(w); assert.throws(() => w.restore(changed), /increment|snapshot|diagnostic/i);
    assert.deepEqual(capture(w), before); refusals++;
  }
  console.log(`increment-search-state-preflight: signed-zero decision data preserved; ${refusals} missing/nonfinite/negative/fractional diagnostic payloads refused before x/time/factor/search mutation`);
});
