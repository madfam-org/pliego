import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { makePatch } from '../bench/membrane-patch.mjs';
import { gradient } from '../src/xpbd/implicit.js';
import { implicitEnergy } from '../src/xpbd/energy-search.js';

const MODE = 'membrane-inertia-increment';
function fixture(options = {}, selected = true) {
  const patch = makePatch({ cells: 2, pattern: 'forward', grain: 0,
    ...(selected ? { membraneModel: 'orthotropic-stvk', membraneNu12: 0.293 } : {}) });
  return new World(patch.doc, { ...patch.options, lineSearch: true, lineSearchArithmetic: MODE,
    damping: 0, bendDamping: 0, substeps: 4000, newtonIterations: 4, ...options });
}
function begin(w) {
  w.xt.set(w.x); w.energySearch.begin(w);
  const g = new Float64Array(w.x.length); gradient(w, w.x, g); return g;
}

test('increment arithmetic requires explicit research prerequisites and retains positive flat-panel bending stiffness', () => {
  let refusals = 0;
  for (const options of [{ lineSearch: false }, { damping: 1 }, { bendDamping: 1 }, { gravity: true },
    { contact: true, barrierContact: true }, { ground: true, contact: true, barrierContact: true },
    { plasticity: true }, { physicalMembrane: false }, { membraneCompression: 0.05 },
    { membraneProjection: undefined }, { membranePoissonConvention: undefined }, { membraneCurvature: undefined }]) {
    assert.throws(() => fixture(options), /increment|explicitly require|research|unsupported/i); refusals++;
  }
  assert.throws(() => fixture({}, false), /orthotropic|increment/i); refusals++;
  for (const value of ['unknown', false, 1, {}]) { assert.throws(() => fixture({ lineSearchArithmetic: value }), /lineSearchArithmetic/); refusals++; }
  const w = fixture(); assert.ok(w.hingeK.some(k => k > 0));
  const g = begin(w); assert.ok(g.every(v => v === 0));
  assert.equal(implicitEnergy(w, w.x), 0); w.energySearch.finish(w, g);
  assert.equal(w.energySearch.increment.last.decision, 'stationary-noop');
  assert.equal(w.energySearch.increment.stationaryNoops, 1); assert.equal(w.energySearch.rejected, 0);
  const beforeRepeat = w.x.slice(), decisions = structuredClone(w.energySearch.increment);
  assert.throws(() => w.energySearch.finish(w, g), /begin/i);
  assert.deepEqual(w.x, beforeRepeat); assert.deepEqual(w.energySearch.increment, decisions);
  console.log(`increment-search-domain-constructor: ${refusals} unsupported options/spring/enum refusals; positive native panel stiffness admitted only with exactly zero actual work; true zero-gradient/zero-step labeled stationary-noop`);
});

test('every increment begin rejects unsupported current physics and invalid start metrics without moving x', () => {
  const mutations = {
    fixed: w => { w.fixed[0] = 1; w.invMass[0] = 0; },
    zeroMass: w => { w.mass[0] = 0; }, nonfiniteMass: w => { w.mass[0] = NaN; },
    incoherentInverse: w => { w.invMass[0] *= 2; }, nonfiniteInverse: w => { w.invMass[0] = Infinity; },
    userForce: w => { w.userForce[0] = 1; }, predictorForce: w => { w.fext[0] = 1; },
    wind: w => { w.drivers.wind = 1; }, damping: w => { w.opts.damping = 1; }, bendingDamping: w => { w.bendDamp = 1; },
    arithmeticIdentity: w => { w.opts.lineSearchArithmetic = 'total-energy'; },
    gravity: w => { w.opts.gravity = true; }, contactObject: w => { w.contact = {}; },
    coupledContactObject: w => { w.coupledContact = {}; }, motionGuard: w => { w.motionGuard = {}; }, edgeContact: w => { w.edgeContact = {}; },
    currentY: w => { w.x[1] = 1e-12; }, previousY: w => { w.xs[1] = 1e-12; }, targetY: w => { w.xt[1] = 1e-12; }, velocityY: w => { w.v[1] = 1e-12; },
    nonfinitePose: w => { w.x[0] = Infinity; }, collapsedMetric: w => { w.x.fill(0); },
    nonzeroRest: w => { w.restTheta[0] = 1e-6; },
    underflowEnergyNonzeroForce: w => {
      w.hingeK[0] = Number.MIN_VALUE; w.theta[0] = 2 * Math.PI;
      assert.equal(0.5 * w.hingeK[0] * w.theta[0] * w.theta[0], 0);
      assert.notEqual(w.hingeK[0] * w.theta[0], 0, 'force must be checked even when omitted energy underflows to zero');
    },
    // Active terms/drives are forbidden even when their stiffness/force is zero.
    zeroForceTerm: w => { const t = w.drivers.grabTerm; w.terms.active[t] = 1; w.terms.k[t] = 0; },
    zeroForceDrive: w => { w.driveOn[0] = 1; w.driveK[0] = 0; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const w = fixture(); w.xt.set(w.x); mutate(w); const before = w.x.slice();
    assert.throws(() => w.energySearch.begin(w), /increment/i, name); assert.deepEqual(w.x, before, name);
  }
  console.log(`increment-search-domain-begin: ${Object.keys(mutations).length} actual force/driver/contact/mass/planarity/hinge/start-metric mutations reject, including zero-force active terms/drives; no x changes`);
});

test('changed objective or unsupported proposals restore the pre-search x and mark dirty before throwing', () => {
  const mutations = {
    timestep: w => { w.dt *= 2; }, mass: w => { w.mass[0] *= 2; w.invMass[0] = 1 / w.mass[0]; },
    inverse: w => { w.invMass[0] *= 2; }, target: w => { w.xt[0] += 0.001; },
    nonplanarCandidate: w => { w.x[1] = 0.001; }, externalForce: w => { w.userForce[0] = 1; },
    forceWithNonfiniteCandidate: w => { w.userForce[0] = 1; w.x[0] = Infinity; },
    arithmeticIdentity: w => { w.opts.lineSearchArithmetic = 'total-energy'; },
    nonzeroRest: w => { w.restTheta[0] = 0.01; },
    zeroForceTerm: w => { const t = w.drivers.grabTerm; w.terms.active[t] = 1; w.terms.k[t] = 0; },
    zeroForceDrive: w => { w.driveOn[0] = 1; w.driveK[0] = 0; },
  };
  for (const [name, mutate] of Object.entries(mutations)) {
    const w = fixture(), g = begin(w), before = w.x.slice();
    w.x[0] += 0.0001; mutate(w); w.dirty = false;
    assert.throws(() => w.energySearch.finish(w, g), /increment/i, name);
    assert.deepEqual(w.x, before, name); assert.equal(w.dirty, true, name);
  }
  const w = fixture(), g = begin(w), before = w.x.slice(); w.x[0] += 0.1; g[0] = NaN; w.dirty = false;
  assert.throws(() => w.energySearch.finish(w, g), /gradient/i); assert.deepEqual(w.x, before); assert.equal(w.dirty, true);
  const unbegun = fixture(), initial = unbegun.x.slice(), counters = structuredClone(unbegun.energySearch.increment);
  assert.throws(() => unbegun.energySearch.finish(unbegun, new Float64Array(unbegun.x.length)), /begin/i);
  assert.deepEqual(unbegun.x, initial); assert.deepEqual(unbegun.energySearch.increment, counters);
  console.log(`increment-search-domain-finish: ${Object.keys(mutations).length + 1} target/M/inverse/h/unsupported-physics/proposal/gradient failures restore x0 and dirty the factor before visible errors; no fallback arithmetic`);
});

test('invalid membrane trials backtrack visibly while realized-zero and non-descent decisions remain distinct', () => {
  let invalidTrials = 0;
  for (const nonfinite of [false, true]) {
    const w = fixture(), g = begin(w), before = w.x.slice();
    if (nonfinite) w.x[0] = Infinity; else w.x.fill(0);
    assert.doesNotThrow(() => w.energySearch.finish(w, g));
    assert.ok(w.energySearch.increment.invalidTrials > 0); invalidTrials += w.energySearch.increment.invalidTrials;
    assert.equal(w.energySearch.rejected, 1); assert.deepEqual(w.x, before); assert.equal(w.dirty, true);
  }
  const limited = fixture(), g = begin(limited), old = limited.x.slice(); g[0] = 1;
  limited.energySearch.finish(limited, g);
  assert.equal(limited.energySearch.increment.last.decision, 'precision-limited-zero-step');
  assert.equal(limited.energySearch.increment.precisionLimited, 1); assert.equal(limited.energySearch.rejected, 1); assert.deepEqual(limited.x, old);
  for (const zeroGradient of [false, true]) {
    const w = fixture(), rhs = begin(w), before = w.x.slice(); w.x[0] += 0.001;
    if (!zeroGradient) rhs[0] = 1;
    w.energySearch.finish(w, rhs);
    assert.equal(w.energySearch.increment.last.decision, 'rejected'); assert.equal(w.energySearch.increment.last.reason, 'non-descent');
    assert.equal(w.energySearch.increment.accepted, 0); assert.equal(w.energySearch.rejected, 1); assert.deepEqual(w.x, before);
  }
  console.log(`increment-search-domain-decisions: ${invalidTrials} invalid trial metrics retained as backtracks; nonzero-gradient/zero-realized-step is precision limited; nonzero candidate with zero/positive slope rejects; stationary no-op remains separate`);
});
