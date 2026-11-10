import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OrthotropicMembrane } from '../src/xpbd/orthotropic-membrane.js';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { makePatch } from '../bench/membrane-patch.mjs';

const python = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const oracle = fileURLToPath(new URL('../bench/membrane-increment-precision.py', import.meta.url));
const material = { E1: 5.5e9, E2: 2.5e9, nu12: .293, G12: .387 * Math.sqrt(5.5e9 * 2.5e9), thickness: .1 };
const sum = values => {
  let total = 0, correction = 0;
  for (const value of values) {
    const next = total + value;
    correction += Math.abs(total) >= Math.abs(value) ? (total - next) + value : (value - next) + total;
    total = next;
  }
  return total + correction;
};
const sha = value => createHash('sha256').update(value).digest('hex');
function precise(cases, digits = 80) {
  const raw = JSON.stringify({ cases });
  const result = JSON.parse(execFileSync(python, [oracle, '--digits', String(digits)], { input: raw, encoding: 'utf8', maxBuffer: 8e6 }));
  assert.equal(result.inputSHA256, sha(raw));
  return result.cases;
}
function capture(membrane, before, after, xt, mass, h, suppliedGradient) {
  const elastic = new Float64Array(before.length); membrane.addGradient(before, elastic);
  const gradient = suppliedGradient ?? Float64Array.from(elastic, (g, i) => g + mass[Math.floor(i / 3)] * (1 / (h * h)) * (before[i] - xt[i]));
  const delta = Float64Array.from(after, (x, i) => x - before[i]);
  const details = membrane.energyDifferenceDetails(before, after);
  const slope = sum(Array.from(delta, (d, i) => gradient[i] * d));
  const massR = Array.from(delta, (d, i) => .5 * mass[Math.floor(i / 3)] * (1 / (h * h)) * d * d);
  const inertia = x => sum(Array.from(x, (v, i) => .5 * mass[Math.floor(i / 3)] * (1 / (h * h)) * (v - xt[i]) ** 2));
  const mesh = membrane.mesh;
  return {
    vertices: Array.from({ length: mesh.nV }, (_, i) => Array.from(mesh.uv.slice(2*i, 2*i+2))),
    triangles: Array.from({ length: mesh.nT }, (_, i) => Array.from(mesh.tris.slice(3*i, 3*i+3))),
    material, grain: membrane.configuration.grainDegrees[0],
    referenceCoefficients: { triangles: Array.from({ length: mesh.nT }, (_, i) => Array.from(mesh.tris.slice(3*i, 3*i+3))),
      elements: membrane.elements.map(e => ({ alpha: Array.from(e.alpha), beta: Array.from(e.beta), Q: Array.from(e.Q), volume: e.volume })) },
    before: Array.from(before), after: Array.from(after), xt: Array.from(xt), mass: Array.from(mass), h, gradient: Array.from(gradient),
    runtime: { membraneRemainder: details.remainder, inertiaRemainder: sum(massR), slope,
      increment: sum([...Array.from(delta, (d, i) => gradient[i]*d), details.remainder, ...massR]),
      armijoRhs: 1e-4 * slope, c1: 1e-4,
      rawDifference: membrane.energy(after) + inertia(after) - (membrane.energy(before) + inertia(before)) },
  };
}
function fixture(grain = 0) {
  const mesh = { nV: 3, nT: 1, tris: Int32Array.of(0, 1, 2), triSheet: Int32Array.of(0), uv: Float64Array.of(0, 0, 40, 0, 0, 40) };
  const membrane = new OrthotropicMembrane(mesh, [{ Emd: material.E1, Ecd: material.E2, G12: material.G12, t: material.thickness }], { sheets: [{ grainDeg: grain }] }, [.293]);
  const before = Float64Array.of(0, 0, 0, 40.00390625, 0, -.001953125, .0009765625, 0, -39.998046875);
  return { membrane, before, mass: Float64Array.of(.02, .02, .02), h: 1e-6 };
}

test('independent Decimal increment oracle proves analytical Green-plus-inertia values before runtime comparisons', () => {
  const a = execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' });
  const b = execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' });
  assert.equal(a, b);
  const proof = JSON.parse(a); assert.equal(proof.passed, true); assert.equal(proof.testCases, 3);
  assert.equal(proof.proofs.analyticalFiniteStretchAndInertiaDeltaNJ, 511/128);
  console.log('increment-precision-analytic: direct finite Green energy plus exact quadratic inertia, reversal and zero endpoint increment; three deterministic self-tests');
});

test('version2 diagnostic rounds exact stored products/remainders once with ties, cancellation and signed underflow controls', () => {
  const tiny = Number.MIN_VALUE;
  const cases = [
    { label: 'tie to even lower', g: [1, 2**-53], d: [1, 1], mr: 0, ir: 0, expected: 1 },
    { label: 'tie to even upper', g: [1, 3*2**-53], d: [1, 1], mr: 0, ir: 0, expected: 1+2**-51 },
    { label: 'cancellation retains unit', g: [2**53, 1, -(2**53)], d: [1, 1, 1], mr: 0, ir: 0, expected: 1 },
    { label: 'mixed sign remainders', g: [1e16, -1e16], d: [1, 1], mr: 1, ir: -.5, expected: .5 },
    { label: 'overflowing products cancel exactly', g: [1e308, 1e308], d: [1e308, -1e308], mr: 1, ir: 0, expected: 1 },
    { label: 'minimum subnormal retained', g: [tiny], d: [1], mr: 0, ir: 0, expected: tiny },
    { label: 'positive subnormal midpoint to zero', g: [tiny], d: [.5], mr: 0, ir: 0, expected: 0 },
    { label: 'negative subnormal midpoint to zero', g: [-tiny], d: [.5], mr: 0, ir: 0, expected: -0 },
    { label: 'subnormal midpoint to even upper', g: [tiny], d: [.5], mr: tiny, ir: 0, expected: 2*tiny },
    { label: 'negative strict underflow', g: [-tiny], d: [.25], mr: 0, ir: 0, expected: -0 },
    { label: 'all negative zeros are rational zero', g: [-0, -0], d: [1, 1], mr: -0, ir: -0, expected: 0 },
    { label: 'exact cancellation is positive zero', g: [-tiny, tiny], d: [1, 1], mr: 0, ir: 0, expected: 0 },
  ];
  const script = String.raw`
import importlib.util,json,math,sys
from decimal import localcontext
spec=importlib.util.spec_from_file_location('increment_precision',sys.argv[1])
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
answer=[]
for case in json.load(sys.stdin):
    outputs=[]
    for digits in (6,28,80,100):
        with localcontext() as context:
            context.prec=digits
            value=module.correctly_rounded_runtime_term_sum(case['g'],case['d'],case['mr'],case['ir'])
            outputs.append({'value':value,'hex':value.hex(),'negativeZero':value==0 and math.copysign(1,value)<0})
    assert all(value==outputs[0] for value in outputs)
    answer.append(outputs[0])
print(json.dumps({'version':module.DIAGNOSTIC_SUM_VERSION,'outputs':answer}))
`;
  const result = JSON.parse(execFileSync(python, ['-c', script, oracle], { input: JSON.stringify(cases), encoding: 'utf8' }));
  assert.equal(result.version, 'exact-rational-dot-plus-remainders/2');
  result.outputs.forEach((value, i) => {
    assert.ok(Object.is(value.value, cases[i].expected), `${cases[i].label}: got ${value.hex}`);
    assert.equal(value.negativeZero, Object.is(cases[i].expected, -0), cases[i].label);
  });
  console.log('increment-diagnostic-v2:12 analytical exact-product/remainder controls; ties-even upper/lower, catastrophic/mixed-sign cancellation, overflowing products with finite sum, subnormals, canonical exact+0 and negative underflow-0; identical across Decimal6/28/80/100');
});

test('actual f64 tiny and larger increments retain absolute errors and resolve raw total-potential cancellation', () => {
  const cases = [];
  for (const grain of [0, 31, 90]) for (const step of [2**-10, 2**-30, 2**-37]) {
    const { membrane, before, mass, h } = fixture(grain);
    const after = Float64Array.from(before, (x, i) => x + (i % 3 === 1 || i < 3 ? 0 : step * Math.sin(i + .3)));
    const g = new Float64Array(before.length); membrane.addGradient(before, g);
    const xt = Float64Array.from(before, (x, i) => x + h*h/mass[Math.floor(i/3)]*g[i]);
    cases.push(capture(membrane, before, after, xt, mass, h));
  }
  const answers = precise(cases), high = precise(cases, 100);
  let improvements = 0, worstTinyAbsolute = 0, worstLargerAbsolute = 0;
  for (let i = 0; i < cases.length; i++) {
    for (const name of ['storedCoefficientPolynomial', 'independentExactUVMaterial']) {
      const value = answers[i].meanings[name], deeper = high[i].meanings[name];
      assert.equal(value.potentialDeltaNJ, deeper.potentialDeltaNJ);
      assert.equal(value.runtimeRecordedIncrementAbsoluteErrorNJ, deeper.runtimeRecordedIncrementAbsoluteErrorNJ);
      assert.ok(Number.isFinite(value.armijoMarginUsingRecordedRhsNJ));
    }
    const observed = answers[i].meanings.storedCoefficientPolynomial;
    if (i % 3 === 0) {
      worstLargerAbsolute = Math.max(worstLargerAbsolute, observed.runtimeRecordedIncrementAbsoluteErrorNJ);
      assert.ok(observed.runtimeRecordedIncrementAbsoluteErrorNJ < 1e-7);
    } else {
      worstTinyAbsolute = Math.max(worstTinyAbsolute, observed.runtimeRecordedIncrementAbsoluteErrorNJ);
      assert.ok(observed.runtimeRecordedIncrementAbsoluteErrorNJ < 1e-12);
      if (observed.rawDifferenceAbsoluteErrorNJ > 100*observed.runtimeRecordedIncrementAbsoluteErrorNJ) improvements++;
    }
  }
  assert.ok(improvements >= 3, 'several tiny changes must resolve substantially below raw-total subtraction error');
  console.log(`increment-precision-cancellation: nine actual f64 cases at grains0/31/90, 80/100 direct truth agrees; larger absolute error=${worstLargerAbsolute}nJ, tiny=${worstTinyAbsolute}nJ, improved cases=${improvements}; no relative near-zero or EPS-bound assertion`);
});

test('Green and inertia increments remain covariant for exact represented finite 3D coordinate permutations and translations', () => {
  const { membrane, before, mass, h } = fixture(31), step = 2**-10;
  const after = Float64Array.from(before, (x, i) => x + (i % 3 === 1 ? 0 : (i-3)*step));
  const xt = Float64Array.from(before, (x, i) => x + (i-2)*step);
  const first = capture(membrane, before, after, xt, mass, h);
  const transform = x => Float64Array.from([0, 1, 2].flatMap(i => [x[3*i+2]+4, x[3*i]-2, x[3*i+1]+1]));
  const moved = capture(membrane, transform(before), transform(after), transform(xt), mass, h);
  const [a, b] = precise([first, moved]);
  for (const name of ['storedCoefficientPolynomial', 'independentExactUVMaterial']) {
    assert.equal(a.meanings[name].potentialDeltaNJ, b.meanings[name].potentialDeltaNJ);
    assert.equal(a.meanings[name].realGradientSlopeNJ, b.meanings[name].realGradientSlopeNJ);
  }
  console.log('increment-precision-covariance: direct Green+inertia scalar values identical under exact represented finite3D permutation/translation; this is algebra, not out-of-plane World-domain acceptance');
});

test('actual cyclic coefficient order, lossless LE bytes, hashes and invalid inputs are checked', () => {
  const { membrane, before, mass, h } = fixture();
  const after = before.slice(); after[3] -= 2**-20;
  const value = capture(membrane, before, after, before, mass, h);
  const original = precise([value])[0];
  const e = value.referenceCoefficients.elements[0];
  value.referenceCoefficients.triangles[0] = [1, 2, 0];
  e.alpha = [e.alpha[1], e.alpha[2], e.alpha[0]]; e.beta = [e.beta[1], e.beta[2], e.beta[0]];
  value.stateFloat64LE = {}; value.stateSHA256 = {};
  for (const key of ['before', 'after', 'xt', 'mass', 'h', 'gradient']) {
    const array = key === 'h' ? [value.h] : value[key], raw = Buffer.alloc(8*array.length);
    array.forEach((x, i) => raw.writeDoubleLE(x, 8*i));
    value.stateFloat64LE[key] = raw.toString('base64'); value.stateSHA256[key] = sha(raw);
  }
  assert.deepEqual(precise([value])[0].meanings, original.meanings);
  const variants = [];
  for (const mutate of [v => { v.referenceCoefficients.triangles[0] = [0, 2, 1]; },
    v => { delete v.referenceCoefficients.triangles; }, v => { v.after[3] = null; },
    v => { v.stateSHA256.xt = '0'.repeat(64); }, v => { v.stateFloat64LE.after = 'AA=='; },
    v => { v.mass[0] = 0; }, v => { v.h = 0; }]) {
    const bad = structuredClone(value); mutate(bad); variants.push(bad);
  }
  for (const input of variants) {
    const failed = spawnSync(python, [oracle], { input: JSON.stringify(input), encoding: 'utf8' });
    assert.equal(failed.status, 1); assert.equal(failed.stdout, ''); assert.ok(JSON.parse(failed.stderr).error);
  }
  console.log('increment-precision-input: nontrivial actual cyclic coefficient remap agrees; LE byte/hash binding, reversed/missing mapping, nonfinite endpoint, mass/h and malformed capture reject');
});

test('real World EnergySearch.finish stable increment is judged against independent Decimal potential change', () => {
  const patch = makePatch({ cells: 1, grain: 31, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const w = new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, substeps: 1000,
    lineSearchArithmetic: 'membrane-inertia-increment' });
  for (let i = 0; i < patch.vertices.length; i++) { w.x[3*i] *= 1.0001; w.x[3*i+2] *= .99998; }
  w.xt.set(w.x); const before = w.x.slice(), g = new Float64Array(w.x.length); gradient(w, before, g);
  w.energySearch.begin(w);
  // An explicitly prescribed candidate exercises actual runtime globalization;
  // it does not stand in for a World timestep or a converged Newton direction.
  for (let i = 0; i < w.x.length; i++) w.x[i] -= 1e-12*g[i];
  const candidate = w.x.slice(); w.energySearch.finish(w, g);
  const last = w.energySearch.increment?.last ?? w.energySearch.last;
  assert.ok(last, 'new arithmetic must expose its actual decision');
  assert.equal(last.decision, 'accepted');
  const value = capture(w.orthotropicMembrane, before, w.x, w.xt, w.mass, w.dt, g);
  value.material = patch.material; value.runtime = { ...last, c1: 1e-4 };
  if (value.runtime.delta !== undefined) value.runtime.increment = value.runtime.delta;
  const proof = precise([value])[0];
  for (const name of ['storedCoefficientPolynomial', 'independentExactUVMaterial']) {
    const result = proof.meanings[name];
    assert.ok(result.potentialDeltaNJ < 0); assert.equal(result.passesRealPotentialRecordedArmijo, true);
    assert.ok(result.runtimeRecordedIncrementAbsoluteErrorNJ < 1e-6);
    assert.ok(result.runtimeRecordedIncrementAbsoluteErrorNJ < result.armijoMarginUsingRecordedRhsNJ);
  }
  assert.ok(candidate.every(Number.isFinite));
  w.x.set(before); w.xt.set(before); w.energySearch.begin(w);
  for (let i = 0; i < w.x.length; i++) w.x[i] += 1e-12*g[i];
  const ascentCandidate = w.x.slice(); w.energySearch.finish(w, g);
  const rejected = w.energySearch.increment.last;
  assert.equal(rejected.decision, 'rejected'); assert.deepEqual(w.x, before);
  const actualLastTrial = rejected.trials === 1 ? ascentCandidate
    : Float64Array.from(before, (x, i) => x + rejected.alpha*(ascentCandidate[i]-x));
  const rejectedCase = capture(w.orthotropicMembrane, before, actualLastTrial, w.xt, w.mass, w.dt, g);
  rejectedCase.material = patch.material; rejectedCase.runtime = { ...rejected, c1: 1e-4 };
  const rejectedProof = precise([rejectedCase])[0]; assert.equal(rejectedProof.actualStep.zeroRealDelta, false);
  for (const value of Object.values(rejectedProof.meanings)) {
    assert.ok(value.potentialDeltaNJ > 0); assert.equal(value.passesRealPotentialRecordedArmijo, false);
  }
  console.log(`increment-precision-runtime: actual World EnergySearch.finish accepted alpha=${last.alpha}; direct 80-digit captured-polynomial AND independent UV/material decrease pass recorded Armijo margin; no timestep/force convergence claim`);
});

test('near-rest accepted computed decrease can be a real captured-polynomial increase and remains explicit', () => {
  const patch = makePatch({ cells: 1, grain: 45, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  const w = new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, substeps: 1000,
    lineSearchArithmetic: 'membrane-inertia-increment' });
  const before = w.x.slice(); w.xt.set(before); w.xs.set(before);
  const g = new Float64Array(w.x.length); gradient(w, before, g);
  w.energySearch.begin(w); w.x[2] -= 2**-40; w.energySearch.finish(w, g);
  const last = w.energySearch.increment.last;
  assert.equal(last.decision, 'accepted'); assert.equal(last.trials, 9); assert.equal(last.alpha, 1/256);
  assert.equal(w.x[2], -(2**-48));
  const value = capture(w.orthotropicMembrane, before, w.x, w.xt, w.mass, w.dt, g);
  value.material = patch.material; value.runtime = { ...last, c1: 1e-4 };
  const a = precise([value], 80)[0], b = precise([value], 100)[0];
  delete a.decimalDigits; delete b.decimalDigits; assert.deepEqual(a, b);
  const stored = a.meanings.storedCoefficientPolynomial;
  assert.ok(Math.abs(last.delta-(-6.472749837974225e-22)) < 1e-35);
  assert.ok(Math.abs(stored.potentialDeltaNJ-2.131138134777538e-22) < 1e-35);
  assert.ok(Math.abs(stored.armijoMarginUsingRecordedRhsNJ-(-2.1345210095494716e-22)) < 1e-35);
  assert.equal(stored.passesRealPotentialRecordedArmijo, false);
  assert.ok(stored.runtimeRecordedIncrementAbsoluteErrorNJ > 1e10*last.heuristicScale,
    'the heuristic scale must never be described as a certified increment error bound');
  console.log(`increment-precision-counterexample: computed accepted delta=${last.delta}nJ, real stored-polynomial delta=${stored.potentialDeltaNJ}nJ, actual error=${stored.runtimeRecordedIncrementAbsoluteErrorNJ}nJ, Armijo margin=${stored.armijoMarginUsingRecordedRhsNJ}nJ; 80/100 full proof agrees; approximate arithmetic is not certified real descent`);
});
