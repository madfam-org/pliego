import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { OrthotropicMembrane } from '../src/xpbd/orthotropic-membrane.js';

const python = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const oracle = fileURLToPath(new URL('../bench/membrane-gradient-precision.py', import.meta.url));
const evidence = new URL('../../../docs/research/evidence/membrane-increment-2026-11-10/captured-trials-input.json', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const nativeInertia = (x, xt, mass, h) => Array.from(x, (value, i) => mass[Math.floor(i/3)]*(1/(h*h))*(value-xt[i]));
const sum = values => {
  let value = 0, correction = 0;
  for (const term of values) {
    const next = value+term; correction += Math.abs(value) >= Math.abs(term) ? (value-next)+term : (term-next)+value; value = next;
  }
  return value+correction;
};
function precise(cases, digits = 80) {
  const raw = JSON.stringify({ cases });
  const result = JSON.parse(execFileSync(python, [oracle, '--digits', String(digits)], { input: raw, encoding: 'utf8', maxBuffer: 8e6 }));
  assert.equal(result.inputSHA256, sha(raw));
  return result.cases;
}
function law(fixture, arithmetic) {
  const material = fixture.material, mesh = { nV: fixture.vertices.length, nT: fixture.triangles.length,
    uv: Float64Array.from(fixture.vertices.flat()), tris: Int32Array.from(fixture.referenceCoefficients.triangles.flat()),
    triSheet: new Int32Array(fixture.triangles.length) };
  const result = new OrthotropicMembrane(mesh, [{ Emd: material.E1, Ecd: material.E2, G12: material.G12, t: material.thickness }],
    { sheets: [{ grainDeg: fixture.grain }] }, [material.nu12], arithmetic);
  result.elements.forEach((element, i) => {
    const captured = fixture.referenceCoefficients.elements[i];
    for (const key of ['alpha', 'beta', 'Q']) assert.ok(Array.from(element[key]).every((v, j) => v === captured[key][j]),
      'candidate must use identical captured coefficient values (JSON zero signs may be lost)');
    assert.equal(element.volume, captured.volume);
  });
  return result;
}
function evaluated(fixture, arithmetic) {
  const membrane = law(fixture, arithmetic), x = Float64Array.from(fixture.x), gradient = new Float64Array(x.length);
  membrane.addGradient(x, gradient);
  return { ...fixture, runtime: { arithmetic, energy: membrane.energy(x), gradient: Array.from(gradient) } };
}
function bind(value) {
  const inputs = { x: value.x, gradient: value.runtime.gradient };
  for (const key of ['direction', 'inertiaGradient', 'xt', 'mass']) if (value[key]) inputs[key] = value[key];
  if (value.h !== undefined) inputs.h = [value.h];
  if (value.runtime.incrementalGradient) inputs.incrementalGradient = value.runtime.incrementalGradient;
  value.stateFloat64LE = {}; value.stateSHA256 = {};
  for (const [key, array] of Object.entries(inputs)) {
    const bytes = Buffer.alloc(array.length*8); array.forEach((v, i) => bytes.writeDoubleLE(v, i*8));
    value.stateFloat64LE[key] = bytes.toString('base64'); value.stateSHA256[key] = sha(bytes);
  }
  return value;
}
function fixture(grain = 0, nonaffine = false) {
  const source = JSON.parse(readFileSync(evidence)).cases[49], material = source.material;
  const vertices = [[0, 0], [40, 0], [0, 40]], triangles = [[0, 1, 2]];
  const mesh = { nV: 3, nT: 1, uv: Float64Array.from(vertices.flat()), tris: Int32Array.of(0, 1, 2), triSheet: Int32Array.of(0) };
  const membrane = new OrthotropicMembrane(mesh, [{ Emd: material.E1, Ecd: material.E2, G12: material.G12, t: material.thickness }],
    { sheets: [{ grainDeg: grain }] }, [material.nu12]);
  const x = vertices.flatMap(([u, v], i) => nonaffine ? [1.0001*u+.0003*i, .0002*Math.sin(i), -1.00002*v+.0001*i*i] : [u, 0, -v]);
  return { vertices, triangles, grain, material, x, direction: x.map((_, i) => 2**-30*Math.sin(i+.2)),
    referenceCoefficients: { triangles, elements: membrane.elements.map(e => ({ alpha: Array.from(e.alpha), beta: Array.from(e.beta), Q: Array.from(e.Q), volume: e.volume })) } };
}

test('independent gradient reference proves known finite Piola energy/force and native versus real inertia', () => {
  const raw = execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' });
  assert.equal(raw, execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' }));
  const value = JSON.parse(raw); assert.equal(value.passed, true); assert.equal(value.testCases, 2);
  console.log('gradient-precision-analytical: independent finite Piola energy/gradient and native+real inertia/projection controls pass; no runtime formula copied');
});

test('independent stored polynomial and UV/material truths stay distinct while DD reduces native-rest gradient error', () => {
  const inputs = [];
  for (const grain of [0, 31, 45, 90]) for (const nonaffine of [false, true]) for (const arithmetic of ['binary64', 'double-double']) {
    inputs.push(bind(evaluated(fixture(grain, nonaffine), arithmetic)));
  }
  const a = precise(inputs), b = precise(inputs, 100);
  let oldRest = 0, newRest = 0, worstDD = 0;
  for (let i = 0; i < a.length; i++) {
    delete a[i].decimalDigits; delete b[i].decimalDigits; assert.deepEqual(a[i], b[i]);
    const stored = a[i].meanings.storedCoefficientPolynomial;
    if (inputs[i].runtime.arithmetic === 'double-double') worstDD = Math.max(worstDD, stored.elasticGradientError.maximumComponentMicroN);
    if (i % 4 < 2) {
      const value = stored.elasticGradientError.maximumComponentMicroN;
      if (inputs[i].runtime.arithmetic === 'double-double') newRest = Math.max(newRest, value); else oldRest = Math.max(oldRest, value);
      assert.equal(a[i].meanings.independentExactUVMaterial.gradientL2MicroN, 0);
    }
  }
  assert.ok(newRest < 1e-19); assert.ok(oldRest > 1e-7); assert.ok(worstDD < 1e-8);
  console.log(`gradient-precision-arithmetic:16 source-identical rest/finite3D-pose cases at four grains, complete80/100 truth agrees; native-rest maxcomponent error old=${oldRest},DD=${newRest}microN; allDD max=${worstDD}; UV/material zero-rest meaning kept separate`);
});

test('frozen actual trajectory witness49 meets predeclared projected error without changing inertia or coefficients', () => {
  const archived = JSON.parse(readFileSync(evidence)).cases[49];
  const base = { vertices: archived.vertices, triangles: archived.triangles, material: archived.material, grain: archived.grain,
    referenceCoefficients: archived.referenceCoefficients, x: archived.before,
    xt: archived.xt, mass: archived.mass, h: archived.h,
    direction: archived.after.map((value, i) => value-archived.before[i]) };
  const inertia = nativeInertia(base.x, base.xt, base.mass, base.h);
  const inputs = ['binary64', 'double-double'].map(arithmetic => {
    const value = evaluated(base, arithmetic); value.inertiaGradient = inertia.slice();
    value.runtime.incrementalGradient = value.runtime.gradient.map((g, i) => g+inertia[i]);
    return bind(value);
  });
  assert.deepEqual(inputs[0].runtime.incrementalGradient, archived.gradient, 'old rounded World force reproduced at same stored pose');
  assert.deepEqual(inputs[0].inertiaGradient, inputs[1].inertiaGradient);
  const a = precise(inputs), b = precise(inputs, 100);
  a.forEach((value, i) => { delete value.decimalDigits; delete b[i].decimalDigits; assert.deepEqual(value, b[i]); assert.equal(value.inertia.nativeAssociationVerified, true); });
  const oldError = a[0].meanings.storedCoefficientPolynomial.nativeRoundedIncrementalProjectedSlopeAbsoluteErrorNJ;
  const error = a[1].meanings.storedCoefficientPolynomial.nativeRoundedIncrementalProjectedSlopeAbsoluteErrorNJ;
  assert.ok(Math.abs(oldError-1.0785003360089267e-24) < 1e-37);
  assert.ok(error <= 1e-27, `predeclared witness49 slope gate1e-27nJ failed: ${error}`);
  const membrane = law(base, 'double-double'), remainder = membrane.energyDifferenceDetails(base.x, archived.after).remainder;
  const massR = base.direction.map((d, i) => .5*base.mass[Math.floor(i/3)]*(1/(base.h*base.h))*d*d);
  const computed = sum([sum(inputs[1].runtime.incrementalGradient.map((g, i) => g*base.direction[i])), remainder, ...massR]);
  assert.ok(computed > 0, 'old first candidate must be recognized as a positive computed change with accurate base gradient');
  console.log(`gradient-precision-frozen49: same x/xt/M/h/native inertia and exact stored coefficients; projected slope error old=${oldError}nJ DD=${error}nJ <=1e-27; old first candidate new computed increment=${computed}>0; actual search/backtrack covered separately`);
});

test('lossless fields, native association and algebra-only inertia labels prevent unsupported claims', () => {
  const value = evaluated(fixture(31, true), 'double-double');
  value.inertiaGradient = value.x.map((_, i) => .25*i);
  const algebra = precise([bind(structuredClone(value))])[0];
  assert.equal(algebra.inertia.nativeAssociationVerified, false); assert.match(algebra.inertia.scope, /algebra-only/);
  value.xt = value.x.map((x, i) => x-1e-5*i); value.mass = [.02, .02, .02]; value.h = 1e-5;
  value.inertiaGradient = nativeInertia(value.x, value.xt, value.mass, value.h);
  bind(value); assert.equal(precise([value])[0].inertia.nativeAssociationVerified, true);
  const variants = [];
  for (const mutate of [v => { v.inertiaGradient[0] = 1e-30; }, v => { delete v.mass; },
    v => { v.stateSHA256.gradient = '0'.repeat(64); }, v => { v.stateFloat64LE.direction = 'AA=='; },
    v => { v.referenceCoefficients.triangles = [[0, 2, 1]]; }, v => { v.runtime.gradient[0] = null; }]) {
    const copy = structuredClone(value); mutate(copy); variants.push(copy);
  }
  for (const bad of variants) {
    const result = spawnSync(python, [oracle], { input: JSON.stringify(bad), encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.ok(JSON.parse(result.stderr).error);
  }
  const wrong = structuredClone(value); wrong.inertiaGradient[3] += 1; bind(wrong);
  const result = spawnSync(python, [oracle], { input: JSON.stringify(wrong), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(JSON.parse(result.stderr).error, /native m\*/);
  console.log('gradient-precision-bindings: exactLE/SHA field bindings; coherent native inertia association verified, altered native term rejected even after rehash; absent physical inputs explicitly algebra-only');
});
