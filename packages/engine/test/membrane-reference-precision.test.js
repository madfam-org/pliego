import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createUVReferenceElement, evaluateOrthotropicElement } from '../src/xpbd/orthotropic-membrane.js';
import { World } from '../src/index.js';
import { gradient } from '../src/xpbd/implicit.js';
import { makePatch } from '../bench/membrane-patch.mjs';

const python = process.env.PLIEGO_AUDIT_PYTHON || 'python3';
const oracle = fileURLToPath(new URL('../bench/membrane-reference-precision.py', import.meta.url));
const material = { E1: 5.5e9, E2: 2.5e9, nu12: .293, G12: .387*Math.sqrt(5.5e9*2.5e9), thickness: .1 };
const sha = v => createHash('sha256').update(v).digest('hex');
const norm = v => Math.hypot(...v);
const relative = (a, b) => norm(a.map((v, i) => v-b[i]))/Math.max(1, norm(a), norm(b));
function precise(cases, digits = 80) {
  const input = JSON.stringify({ cases });
  const result = JSON.parse(execFileSync(python, [oracle, '--digits', String(digits)], { input, encoding: 'utf8', maxBuffer: 32e6 }));
  assert.equal(result.inputSHA256, sha(input)); return result.cases;
}
function descriptor(e) {
  return { Q: Array.from(e.Q), volume: e.volume, reference: { ...e.reference,
    u: Array.from(e.reference.u), v: Array.from(e.reference.v), x0: Array.from(e.reference.x0) } };
}
const evaluate = (e, x) => evaluateOrthotropicElement(e, x, { arithmetic: 'double-double' });
function single(uv, x0, x, grain, includeHessian = true) {
  const e = createUVReferenceElement(uv, material, grain*Math.PI/180, material.nu12, x0), value = evaluate(e, x);
  return { vertices: [uv.slice(0, 2), uv.slice(2, 4), uv.slice(4, 6)], triangles: [[0, 1, 2]], material, grain,
    x: Array.from(x), includeHessian, referenceCoefficients: { triangles: [[0, 1, 2]], elements: [descriptor(e)] },
    runtime: { energy: value.energy, gradient: Array.from(value.gradient), ...(includeHessian ? { exactHessian: Array.from(value.hessian), gaussNewton: Array.from(value.gaussNewton) } : {}) } };
}
function rotation(angle) {
  const [x, y, z] = [1, 2, 3].map(v => v/Math.sqrt(14)), c = Math.cos(angle), s = Math.sin(angle), d = 1-c;
  return [c+x*x*d,x*y*d-z*s,x*z*d+y*s,y*x*d+z*s,c+y*y*d,y*z*d-x*s,z*x*d-y*s,z*y*d+x*s,c+z*z*d];
}
function transform(x, r, t = [0, 0, 0]) {
  return x.flatMap((_v, i) => i%3 ? [] : [0, 1, 2].map(k => r[3*k]*x[i]+r[3*k+1]*x[i+1]+r[3*k+2]*x[i+2]+t[k]));
}

test('direct reference-metric oracle has independent analytic Piola, Hessian and stress-free controls', () => {
  const a = execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' });
  assert.equal(a, execFileSync(python, [oracle, '--self-test'], { encoding: 'utf8' }));
  const proof = JSON.parse(a); assert.equal(proof.passed, true); assert.equal(proof.testCases, 3);
  console.log('reference-precision-analytic: direct metric scalar/FSP tangent validates finite Piola energy+gradient+exactH, negative compressed stress curvature vs GN, and stress-free reference');
});

test('32 actual native-rest searches have zero new-law gradient and reject every nonzero proposal at all four grains', () => {
  const cases = [];
  for (const grain of [0, 31, 45, 90]) {
    const patch = makePatch({ cells: 1, grain, membraneModel: 'orthotropic-stvk', membraneNu12: material.nu12 });
    const w = new World(patch.doc, { ...patch.options, damping: 0, bendDamping: 0, substeps: 1000,
      lineSearchArithmetic: 'membrane-inertia-increment', membraneArithmetic: 'double-double', membraneReference: 'uv-displacement' });
    const before = w.x.slice(), g = new Float64Array(w.x.length); gradient(w, before, g);
    assert.equal(w.orthotropicMembrane.energy(before), 0); assert.ok(g.every(v => v === 0));
    for (const index of [0, 2]) for (const direction of [-1, 1]) for (const magnitude of [2**-40, 2**-50]) {
      w.x.set(before); w.xt.set(before); w.xs.set(before); w.v.fill(0); w.energySearch.begin(w); w.x[index] += direction*magnitude;
      const candidate = w.x.slice(); w.energySearch.finish(w, g); const last = w.energySearch.increment.last;
      assert.equal(last.decision, 'rejected'); assert.deepEqual(w.x, before);
      const after = last.trials === 1 ? candidate : Float64Array.from(before, (x, i) => x+last.alpha*(candidate[i]-x));
      const mesh = w.mesh;
      cases.push({ vertices: patch.vertices, triangles: patch.triangles, material: patch.material, grain, x: Array.from(before), after: Array.from(after),
        referenceCoefficients: { triangles: Array.from({ length: mesh.nT }, (_, i) => Array.from(mesh.tris.slice(3*i, 3*i+3))), elements: w.orthotropicMembrane.elements.map(descriptor) },
        xt: Array.from(w.xt), mass: Array.from(w.mass), h: w.dt, inertiaGradient: Array.from(before, () => 0),
        direction: Array.from(after, (x, i) => x-before[i]),
        runtime: { ...last, energy: 0, gradient: Array.from(g), incrementalGradient: Array.from(g) } });
    }
    assert.equal(w.substepsRun, 0); assert.equal(w.framesRun, 0); assert.equal(w.time, 0);
  }
  const a = precise(cases), b = precise(cases, 100);
  a.forEach((proof, i) => {
    delete proof.decimalDigits; delete b[i].decimalDigits; assert.deepEqual(proof, b[i]);
    for (const value of Object.values(proof.meanings)) {
      assert.equal(value.energyNJ, 0); assert.ok(value.gradient.every(v => v === 0));
      assert.ok(value.endpointEnergyDeltaNJ > 0); assert.ok(value.endpointNativeCoefficientPotentialDeltaNJ > 0);
      assert.equal(value.passesNativeCoefficientRecordedArmijo, false);
    }
  });
  console.log('reference-precision-rest: all32 actual native Y0 searches have exact zero energy/gradient and reject nonzero proposals; direct Decimal endpoint U+native/real inertia agrees80/100; no timesteps or convergence claim');
});

test('generic triangles, finite3D placements and all grains match independent direct-metric gradient/exactH/GN', () => {
  const uv = [0, 0, 2, .2, .3, 1.5], base = [0, 0, 0, 2, 0, -.2, .3, 0, -1.5];
  const pose = [0, 0, 0, 2.086, .032, -.214, .357, -.054, -1.461];
  const identity = [1,0,0,0,1,0,0,0,1], permutation = [0,0,1,1,0,0,0,1,0];
  const cases = [];
  for (const grain of [0, 31, 45, 90]) for (const r of [identity, permutation, rotation(.73)]) {
    cases.push(single(uv, transform(base, r, [3.1, -2.3, 4.7]), transform(pose, r, [3.1, -2.3, 4.7]), grain));
  }
  const a = precise(cases), b = precise(cases, 100); let ug = 0, uh = 0;
  a.forEach((proof, i) => {
    delete proof.decimalDigits; delete b[i].decimalDigits; assert.deepEqual(proof, b[i]);
    const value = proof.meanings.representedUVDisplacement;
    ug = Math.max(ug, value.gradientError.maximumComponentMicroN); uh = Math.max(uh, value.exactHessianMaximumComponentError);
    assert.ok(value.energyAbsoluteErrorNJ < 1e-6); assert.ok(value.gradientError.maximumComponentMicroN < 1e-6);
    assert.ok(value.exactHessianMaximumComponentError < 1e-4); assert.ok(value.gaussNewtonMaximumComponentError < 1e-4);
  });
  // Exact represented 90-degree permutation/translation, transforming BOTH
  // current and actual reference poses, preserves energy and covariant forces.
  const dyadicUV = [0,0,2,0,0,2], x0 = [0,0,0,2,0,0,0,0,-2], x = [0,0,0,2.125,.0625,0,.0625,-.03125,-1.875];
  const first = single(dyadicUV, x0, x, 31), moved = single(dyadicUV, transform(x0, permutation, [4,-2,1]), transform(x, permutation, [4,-2,1]), 31);
  const [p, q] = precise([first, moved]);
  assert.equal(p.meanings.representedUVDisplacement.energyNJ, q.meanings.representedUVDisplacement.energyNJ);
  assert.deepEqual(transform(p.meanings.representedUVDisplacement.gradient, permutation), q.meanings.representedUVDisplacement.gradient);
  console.log(`reference-precision-placed:12 generic/placed element cases at0/31/45/90degrees; represented direct-metric max gradient error=${ug}, exactH=${uh}; exact finite3D covariance and complete80/100 truth parity`);
});

test('independent tensor gradient and exactH converge against direct scalar/gradient finite differences', () => {
  const uv = [0,0,2,.2,.3,1.5], x0 = [0,0,0,2,0,-.2,.3,0,-1.5], x = [0,0,0,2.086,.032,-.214,.357,-.054,-1.461];
  const base = single(uv, x0, x, 31), truth = precise([base])[0].meanings.representedUVDisplacement;
  let previousG = Infinity, previousH = Infinity;
  for (const h of [1e-3, 5e-4, 2.5e-4, 1.25e-4]) {
    const inputs = [];
    for (let j=0;j<9;j++) for (const sign of [1,-1]) {
      const point = x.slice(); point[j] += sign*h;
      inputs.push({ ...base, x: point, includeHessian: false, runtime: { energy: 0, gradient: Array(9).fill(0) } });
    }
    const observed = precise(inputs).map(v => v.meanings.representedUVDisplacement), g = [], H = Array(81).fill(0);
    for (let j=0;j<9;j++) {
      g[j] = (observed[2*j].energyNJ-observed[2*j+1].energyNJ)/(2*h);
      for (let i=0;i<9;i++) H[9*i+j] = (observed[2*j].gradient[i]-observed[2*j+1].gradient[i])/(2*h);
    }
    const ge = relative(g, truth.gradient), he = relative(H, truth.exactHessian);
    assert.ok(ge < .3*previousG+1e-11); assert.ok(he < .3*previousH+1e-11);
    previousG = ge; previousH = he;
  }
  assert.ok(previousG < 1e-6 && previousH < 1e-7);
  console.log(`reference-precision-FD: direct scalar and independently differentiated tensor gradient/Hessian approach quadratically with halving; final relative gradient=${previousG},exactH=${previousH}`);
});

test('reference identity, actual X0 consistency and informational nodezero semantics are explicit', () => {
  const uv = [0,0,2,.2,.3,1.5], x0 = [0,0,0,2,0,-.2,.3,0,-1.5];
  const native = [0,31,45,90].map(grain => single(uv, x0, x0, grain, false));
  const a = precise(native), b = precise(native, 100);
  a.forEach((value, i) => {
    delete value.decimalDigits; delete b[i].decimalDigits; assert.deepEqual(value, b[i]);
    for (const meaning of Object.values(value.meanings)) {
      assert.equal(meaning.energyNJ, 0); assert.ok(meaning.gradient.every(g => g === 0));
    }
  });
  const base = single([0,0,2,0,0,2], [0,0,0,2,0,0,0,0,-2], [0,0,0,2.1,0,0,0,0,-1.9], 45);
  const old = precise([base])[0];
  const bound = structuredClone(base), element = bound.referenceCoefficients.elements[0], ref = element.reference;
  const words = [...ref.u,...ref.v,...ref.x0,ref.c,ref.s,...element.Q,element.volume], raw = Buffer.alloc(words.length*8);
  words.forEach((v, i) => raw.writeDoubleLE(v, i*8));
  bound.referenceEncoding = { version: 1, order: ['u[3]','v[3]','x0[9]','c','s','Q[4]','volume'], floatsPerElement: 22, nativeElementOrder: true };
  bound.referenceFloat64LE = raw.toString('base64'); bound.referenceSHA256 = sha(raw);
  const binding = precise([bound])[0].provenance;
  assert.equal(binding.referenceLosslessSupplied, true); assert.equal(binding.referenceFloat64LESHA256, sha(raw));
  const cache = structuredClone(base); cache.referenceCoefficients.elements[0].reference.u[0] = 123;
  cache.referenceCoefficients.elements[0].reference.v[0] = -456;
  assert.deepEqual(precise([cache])[0].meanings, old.meanings, 'rounded informational nodezero cannot define the derivative');
  const bad = [];
  bad.push({ ...bound, referenceSHA256: '0'.repeat(64) });
  const corrupt = Buffer.from(raw); corrupt.writeDoubleLE(7, 8*6);
  bad.push({ ...bound, referenceFloat64LE: corrupt.toString('base64'), referenceSHA256: sha(corrupt) });
  for (const mutate of [v => { delete v.referenceCoefficients.elements[0].reference; },
    v => { v.referenceCoefficients.elements[0].reference.mode = 'material-coefficients'; },
    v => { v.referenceCoefficients.elements[0].reference.version = true; },
    v => { v.referenceCoefficients.elements[0].reference.x0 = Array(9).fill(0); },
    v => { v.referenceCoefficients.triangles = [[0,2,1]]; }, v => { v.x[0] = null; }]) {
    const value = structuredClone(base); mutate(value); bad.push(value);
  }
  for (const value of bad) {
    const result = spawnSync(python, [oracle], { input: JSON.stringify(value), encoding: 'utf8' });
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.ok(JSON.parse(result.stderr).error);
  }
  console.log('reference-precision-domain: generic rational-UV native rest has exact zero truth at80/100 using rational inverse/Gram; explicit descriptor/native cycles/reference metric validated; informational u0/v0 never replace coherent derivatives');
});
