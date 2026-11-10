import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/index.js';
import { createUVReferenceElement, evaluateOrthotropicElement } from '../src/xpbd/orthotropic-membrane.js';
import { makePatch } from '../bench/membrane-patch.mjs';

const material = { E1: 5.5e9, E2: 2.5e9, G12: 1.43e9, thickness: .1 };
const uv = [0, 0, 2, .2, .3, 1.5], base = [1.25, -.5, 2, 3.25, -.3, 2, 1.55, 1, 2];
const norm = a => Math.hypot(...a), evaluate = (e, x) => evaluateOrthotropicElement(e, x, { arithmetic: 'double-double' });
function world(grain = 31) {
  const patch = makePatch({ cells: 2, grain, membraneModel: 'orthotropic-stvk', membraneNu12: .293 });
  return new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, substeps: 4000, newtonIterations: 4,
    membraneArithmetic: 'double-double', lineSearchArithmetic: 'membrane-inertia-increment', membraneReference: 'uv-displacement' });
}
const rotate = values => Float64Array.from([0, 1, 2].flatMap(i => [values[3*i+2], values[3*i], values[3*i+1]]));

test('actual stored reference has exact zero strain, energy and force for grain and placed/non-isometric reference controls', () => {
  let cases = 0;
  const tilted = [0,0,0,.5960079923851836,2.796117257901679,2.4254892114587703,3.821345956502424,.2829488066708116,-3.616288568068244];
  for (const grain of [0, .37, Math.PI/4, Math.PI/2]) for (const x0 of [base, rotate(base), tilted, base.map((x, i) => x + [3, 4, -5][i%3]), base.map((x, i) => x * [1.2, .7, 1][i%3])]) {
    const e = createUVReferenceElement(uv, material, grain, .293, x0), result = evaluate(e, x0);
    assert.equal(result.energy, 0); assert.ok(result.strain.every(v => v === 0)); assert.ok(result.gradient.every(v => v === 0));
    assert.deepEqual(result.hessian, result.gaussNewton); assert.equal(result.areaRatio, 1);
    assert.equal(result.minimumStretch, 1); assert.equal(result.maximumStretch, 1);
    assert.ok(result.referenceMetricMismatch >= 0 && Number.isFinite(result.referenceMetricMismatch)); cases++;
  }
  const distorted = evaluate(createUVReferenceElement(uv, material, .37, .293, base.map((v, i) => v * [1.2, .7, 1][i%3])), base.map((v, i) => v * [1.2, .7, 1][i%3]));
  assert.ok(distorted.referenceMetricMismatch > .1, 'non-isometric reference is visible, never whitened in energy');
  console.log(`uv-reference-rest: ${cases} actual X0/grain/placement controls exactly zero; metric-relative unit stretches; non-isometric chart mismatch retained`);
});

test('UV material tensor derivatives retain exact stress curvature, objectivity and finite-difference convergence', () => {
  let finest = 0, controls = 0;
  for (const grain of [.37, -.61]) {
    const e = createUVReferenceElement(uv, material, grain, .293, base);
    const x = Float64Array.from(base, (v, i) => v + .03*Math.sin(1.3*i+.2)), value = evaluate(e, x);
    let previous = Infinity;
    for (const h of [1e-3, 5e-4, 2.5e-4, 1.25e-4]) {
      const g = new Float64Array(9), H = new Float64Array(81);
      for (let j = 0; j < 9; j++) {
        const p = x.slice(), m = x.slice(); p[j] += h; m[j] -= h;
        const plus = evaluate(e, p), minus = evaluate(e, m);
        g[j] = (plus.energy-minus.energy)/(2*h);
        for (let i = 0; i < 9; i++) H[9*i+j] = (plus.gradient[i]-minus.gradient[i])/(2*h);
      }
      const error = norm(H.map((v, i) => v-value.hessian[i]))/norm(value.hessian);
      assert.ok(error < .3*previous+1e-10, `${previous} -> ${error}`); previous = error;
      assert.ok(norm(g.map((v, i) => v-value.gradient[i]))/norm(value.gradient) < 2e-4);
    }
    assert.ok(previous < 1e-8); finest = Math.max(finest, previous);
    for (let i = 0; i < 9; i++) for (let j = 0; j < 9; j++) assert.equal(value.hessian[9*i+j], value.hessian[9*j+i]);
    // Rigid motion acts on the current configuration; the stored reference stays fixed.
    const moved = rotate(x).map((v, i) => v + [2, -1, 4][i%3]), result = evaluate(e, moved), expected = rotate(value.gradient);
    assert.ok(Math.abs(result.energy-value.energy)/value.energy < 1e-12);
    assert.ok(norm(result.gradient.map((v, i) => v-expected[i]))/norm(expected) < 1e-12);
    for (let k = 0; k < 16; k++) {
      const p = Array.from({length:9}, (_, i) => Math.sin((k+1)*i+.37));
      const quadratic = p.reduce((s, v, i) => s + v*p.reduce((t, w, j) => t+value.gaussNewton[9*i+j]*w, 0), 0);
      assert.ok(quadratic > -1e-6*norm(value.gaussNewton));
    }
    controls++;
  }
  const flat = createUVReferenceElement([0,0,1,0,0,1], material, .37, .293, [0,0,0,1,0,0,0,0,-1]);
  const compressed = evaluate(flat, [0,0,0,.8,0,0,0,0,-.8]);
  assert.ok(compressed.hessian[40] < 0); assert.equal(compressed.gaussNewton[40], 0);
  console.log(`uv-reference-derivatives: ${controls} grain/sign controls, four halvings each; finest H error=${finest}; symmetry/objectivity/GN PSD and negative exact stress curvature`);
});

test('relative metric diagnostics retain strongly compressed valid triangles and reject collapse', () => {
  const x0 = [0,0,0,1,0,0,0,0,-1], e = createUVReferenceElement([0,0,1,0,0,1], material, .37, .293, x0);
  for (const [sx, sz] of [[1e-9, 1], [1e-5, 1e-5], [2, .3]]) {
    const x = x0.map((v, i) => v*[sx,1,sz][i%3]), result = evaluate(e, x);
    assert.ok(Math.abs(result.areaRatio/(sx*sz)-1) < 1e-12);
    assert.ok(Math.abs(result.maximumStretch/Math.max(sx,sz)-1) < 1e-12);
    assert.ok(Math.abs(result.minimumStretch/Math.min(sx,sz)-1) < 1e-12);
  }
  assert.throws(() => evaluate(e, [0,0,0,0,0,0,0,0,-1]), /collapsed/);
  assert.throws(() => createUVReferenceElement(uv, material, .37, .293, Array(9).fill(0)), /degenerate.*reference/);
  const skew = [0,0,0,1,0,0,1,1e-9,0], skewElement = createUVReferenceElement([0,0,1,0,0,1], material, .37, .293, skew);
  assert.equal(evaluate(skewElement, skew).minimumStretch, 1);
  const skewPose = [0,0,0,1.1,0,0,1.1000000001,1e-9,0], skewResult = evaluate(skewElement, skewPose);
  const shear = (skewPose[6]-skewPose[3])/1e-9, pp = 1.1**2, qq = 1+shear**2, pq = 1.1*shear;
  const maximum = Math.sqrt((pp+qq)/2+Math.hypot((pp-qq)/2,pq));
  assert.ok(Math.abs(skewResult.maximumStretch/maximum-1) < 1e-13);
  assert.ok(Math.abs(skewResult.minimumStretch/(1.1/maximum)-1) < 1e-13);
  assert.throws(() => createUVReferenceElement([0,0,1,0,0,1], material, .37, .293, [0,0,0,1,0,0,1,1e-13,0]), /ill-conditioned/);
  assert.throws(() => evaluateOrthotropicElement(e, x0), /requires double-double/);
  console.log('uv-reference-metric: one-axis 1e-9 and biaxial 1e-5 compression retained; collapsed reference/current and unsupported arithmetic refused');
});

test('native sparse/matrix-free UV GN agree under masks and increments preserve signed finite3D endpoint work', () => {
  const w = world(), m = w.orthotropicMembrane;
  const before = w.x.slice();
  for (let i = 0; i < w.mesh.nV; i++) { w.x[3*i] *= 1.001; w.x[3*i+2] *= .9997; }
  const p = w.x.map((_, i) => Math.sin(i+.37));
  for (const fixed of [false, true]) {
    const mask = w.invMass.slice(), direction = p.slice(); if (fixed) { mask[0] = 0; direction.fill(0,0,3); }
    const out = new Float64Array(p.length), matrix = new Float64Array(p.length), ch = w.sys.ch;
    m.addGaussNewtonTimes(w.x, direction, out, mask); ch.clear(); m.addGaussNewtonBlocks(w, w.x, ch);
    for (let c = 0; c < ch.n; c++) for (let k = ch.Ap[c]; k < ch.Ap[c+1]; k++) {
      const i = ch.perm[ch.Ai[k]], j = ch.perm[c];
      for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) {
        matrix[3*i+a] += ch.Ax[9*k+3*a+b]*direction[3*j+b];
        if (i !== j) matrix[3*j+b] += ch.Ax[9*k+3*a+b]*direction[3*i+a];
      }
    }
    if (fixed) matrix.fill(0,0,3);
    assert.ok(norm(out.map((v, i) => v-matrix[i]))/norm(out) < 1e-12);
  }
  for (const sign of [-1,1]) {
    const after = w.x.map((v, i) => v+sign*.001*Math.sin(i+.8));
    const details = m.energyDifferenceDetails(w.x, after), g = new Float64Array(w.x.length); m.addGradient(w.x,g);
    const direct = m.energy(after)-m.energy(w.x), work = g.reduce((s,v,i)=>s+v*(after[i]-w.x[i]),0);
    assert.equal(details.valid, true); assert.ok(Math.abs(details.difference-direct)/Math.max(1,Math.abs(direct)) < 1e-11);
    assert.ok(Math.abs(details.linear-work)/Math.max(1,Math.abs(work)) < 1e-12);
    assert.ok(Math.abs(details.difference-details.linear-details.remainder)/Math.max(1,Math.abs(direct)) < 1e-12);
  }
  const rest = m.energyDifferenceDetails(before, w.x); assert.equal(rest.linear, 0); assert.ok(rest.remainder > 0);
  console.log('uv-reference-operators: masked/free sparse vs matrix-free; signed finite3D energy increment = gradient work + coherent remainder; rest linear work zero');
});

test('reference identity drift refuses restore atomically and native-rest trials never accept a nonzero step', () => {
  let cases = 0;
  for (const grain of [0,31,45,90]) {
    const w = world(grain), start = w.x.slice(), gradient = new Float64Array(w.x.length);
    w.orthotropicMembrane.addGradient(w.x, gradient); assert.ok(gradient.every(v => v === 0));
    w.energySearch.begin(w); w.energySearch.finish(w, gradient); assert.equal(w.energySearch.increment.last.decision, 'stationary-noop');
    w.energySearch.begin(w); w.x[0] += 2**-40; w.energySearch.finish(w, gradient);
    assert.notEqual(w.energySearch.increment.last.decision, 'accepted'); assert.deepEqual(w.x, start); cases++;
  }
  for (const mutate of [w=>{w.opts.membraneReference='material-coefficients';},w=>{w.orthotropicMembrane.work.reference='material-coefficients';},
    w=>{w.orthotropicMembrane.configuration.reference.version=99;},w=>{w.orthotropicMembrane.elements[0].reference.c=.5;},
    w=>{w.orthotropicMembrane.elements[0].reference.x0[0]+=.1;},w=>{w.orthotropicMembrane.configuration.referenceElements.pop();},
    w=>{w.orthotropicMembrane.elements[0].reference.x0[0]+=.1; w.orthotropicMembrane.configuration.referenceElements[0].x0[0]+=.1;}]) {
    const w = world(), snapshot = w.snapshot(); w.x[0] += .003; mutate(w);
    const before = {snapshot:w.snapshot(), x:w.x.slice(), factor:w.sys.ch.Ax.slice(), start:w.energySearch.start.slice(), opts:structuredClone(w.opts)};
    assert.throws(() => w.restore(snapshot), /reference identity/);
    assert.deepEqual({snapshot:w.snapshot(), x:w.x.slice(), factor:w.sys.ch.Ax.slice(), start:w.energySearch.start.slice(), opts:structuredClone(w.opts)}, before);
  }
  console.log(`uv-reference-state: ${cases} exact-rest stationary/perturbed search controls; seven option/work/config/operator/X0/coordinated identity drifts refused before restore writes`);
});
